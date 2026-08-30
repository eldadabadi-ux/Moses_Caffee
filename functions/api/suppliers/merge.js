/**
 * Cloudflare Pages Function — /api/suppliers/merge
 *
 * The one-off cleanup that turns the tenant's free-text `vendor_name` history
 * into canonical suppliers (audit R1).
 *
 * GET  → a PREVIEW: every distinct vendor_name with its receipt count and spend,
 *        grouped into probable suppliers. Changes nothing.
 *        { clusters: [{ canonical, members[], review[], junk }], unlinked, total }
 *
 * POST { groups: [{ canonical, aliases[], supplier_id? }] } → APPLY:
 *        find-or-create each supplier, learn every alias, and stamp
 *        receipts.supplier_id on the matching rows.
 *        { suppliers_created, aliases_learned, receipts_linked }
 *
 * `vendor_name` is never rewritten — it stays the literal text the scan read
 * (expand/contract). Only `supplier_id` is added, so the migration is reversible
 * by clearing one column, and re-running it is a no-op.
 */
import { requireMember, wrapAuthErrors } from '../_lib/auth.js'
import { getSupabaseUrl } from '../_lib/extractReceipt.js'
import { createSupplier, learnAlias, loadSupplierCatalogue } from '../_lib/supplierResolve.js'
import { clusterVendors, normalizeVendor, matchVendor } from '../_lib/supplierMatch.js'
import { errorResponse } from '../_lib/response.js'
import { writeAudit } from '../_lib/audit.js'

const cors = (request, env) => ({
  'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || (request.headers.get('origin') || '').trim() || '*',
  'Content-Type': 'application/json',
})
const sbh = (key) => ({ apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' })

/**
 * Encode a value before it goes into a PostgREST query string. Mandatory for
 * anything client-supplied: a raw '#' ends the URL at the fragment, so the
 * `&org_id=eq.…` tenant predicate is never sent — and these requests use the
 * service-role key, so RLS will not catch it (guardrail 3).
 */
const q = (v) => encodeURIComponent(String(v ?? ''))
const scopeOf = (user) => (user.org_id ? `org_id=eq.${q(user.org_id)}` : `user_id=eq.${q(user.user_id)}`)

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || (request.headers.get('origin') || '').trim() || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  } })
}

/**
 * Distinct vendor_name rows for the tenant, with counts and spend.
 *
 * Groups by the TRIMMED name for display, but remembers every exact stored
 * spelling under it. The apply step filters on the stored value, so a receipt
 * saved as "מייזן " (trailing space from OCR) would otherwise be counted in the
 * preview and then never linked.
 */
async function loadVendorRows(url, key, user) {
  const res = await fetch(
    `${url}/rest/v1/receipts?${scopeOf(user)}&select=vendor_name,amount,supplier_id&limit=100000`,
    { headers: sbh(key) })
  if (!res.ok) return { rows: [], unlinked: 0 }
  const receipts = await res.json()
  const map = {}
  let unlinked = 0
  for (const r of receipts) {
    const stored = r.vendor_name || ''
    const name = stored.trim()
    if (!name) continue
    if (!r.supplier_id) unlinked++
    ;(map[name] ||= { name, count: 0, total: 0, linked: 0, stored: new Set() })
    map[name].count++
    map[name].total += parseFloat(r.amount) || 0
    map[name].stored.add(stored)
    if (r.supplier_id) map[name].linked++
  }
  return {
    rows: Object.values(map).map(v => ({ ...v, total: Math.round(v.total * 100) / 100, stored: [...v.stored] })),
    unlinked,
  }
}

export const onRequestGet = wrapAuthErrors(async (context) => {
  const user = await requireMember(context.request, context.env)
  const CORS = cors(context.request, context.env)
  const key = context.env.SUPABASE_SERVICE_ROLE_KEY
  const url = getSupabaseUrl(context.env)
  if (!key) return errorResponse('שירות הספקים אינו מוגדר בשרת', 500, { code: 'server_config', headers: CORS })

  const { rows, unlinked } = await loadVendorRows(url, key, user)
  const catalogue = (await loadSupplierCatalogue(url, key, { orgId: user.org_id, userId: user.user_id })) || []

  const storedByName = Object.fromEntries(rows.map(r => [r.name, r.stored]))
  const clusters = clusterVendors(rows).map(c => {
    // If one of these spellings already resolves to a supplier, propose THAT
    // supplier rather than creating a second one beside it — but ONLY on a
    // near-certain match. An "ask"-band hit (0.60–0.92) must never be linked
    // silently: "קפה אחים" scores 0.65 against "מאפיית אחים בע\"מ", and stamping
    // its receipts with that supplier would corrupt the bakery's spend for good.
    const existing = matchVendor(c.canonical, catalogue)
    return {
      ...c,
      existing_supplier: existing.decision === 'auto' && existing.supplier
        ? { id: existing.supplier.id, name: existing.supplier.name, score: existing.score }
        : null,
      // Surfaced for the user to accept or ignore — never auto-applied.
      possible_supplier: existing.decision === 'ask' && existing.supplier
        ? { id: existing.supplier.id, name: existing.supplier.name, score: existing.score }
        : null,
      // Every exact spelling on disk for this cluster — what the apply step
      // must filter on.
      stored: [...new Set([...c.members, ...c.review].flatMap(m => storedByName[m.name] || [m.name]))],
      receipts: [...c.members, ...c.review].reduce((n, m) => n + m.count, 0),
      total: Math.round([...c.members, ...c.review].reduce((n, m) => n + m.total, 0) * 100) / 100,
    }
  })

  return Response.json({
    clusters,
    unlinked,
    total_names: rows.length,
    total_suppliers_after: clusters.filter(c => !c.junk).length,
  }, { headers: CORS })
})

export const onRequestPost = wrapAuthErrors(async (context) => {
  const user = await requireMember(context.request, context.env)
  const CORS = cors(context.request, context.env)
  const key = context.env.SUPABASE_SERVICE_ROLE_KEY
  const url = getSupabaseUrl(context.env)
  if (!key) return errorResponse('שירות הספקים אינו מוגדר בשרת', 500, { code: 'server_config', headers: CORS })

  let body
  try { body = await context.request.json() } catch {
    return errorResponse('גוף הבקשה אינו תקין', 400, { code: 'bad_json', headers: CORS })
  }
  const groups = Array.isArray(body?.groups) ? body.groups : null
  if (!groups?.length) return errorResponse('לא נבחרו קבוצות למיזוג', 400, { code: 'bad_input', headers: CORS })

  let created = 0, aliases = 0, linked = 0
  const problems = []

  for (const g of groups) {
    const canonical = String(g?.canonical || '').trim()
    if (!normalizeVendor(canonical)) { problems.push(`שם ריק — דולג`); continue }

    // Find or create the canonical supplier, verifying tenant ownership when the
    // client supplied an id.
    let supplierId = g?.supplier_id || null
    if (supplierId) {
      const res = await fetch(`${url}/rest/v1/suppliers?id=eq.${q(supplierId)}&${scopeOf(user)}&select=id`, { headers: sbh(key) })
      const rows = res.ok ? await res.json() : []
      if (!rows.length) { problems.push(`ספק לא נמצא: ${canonical}`); continue }
    } else {
      const row = await createSupplier(url, key, { name: canonical, userId: user.user_id, orgId: user.org_id, createdFrom: 'merge' })
      if (!row) { problems.push(`יצירת ספק נכשלה: ${canonical}`); continue }
      supplierId = row.id
      created++
    }

    // Every spelling in the group — including the canonical one — becomes an
    // alias and gets its receipts stamped.
    const spellings = [...new Set([canonical, ...(Array.isArray(g?.aliases) ? g.aliases : [])].map(x => String(x || '').trim()).filter(Boolean))]
    // The exact values stored on the rows may differ from the trimmed display
    // name; the client echoes them back so the filter actually matches.
    const stored = [...new Set([...(Array.isArray(g?.stored) ? g.stored : []), ...spellings].map(String).filter(Boolean))]

    for (const spelling of spellings) {
      if (normalizeVendor(spelling) !== normalizeVendor(canonical)) {
        if (await learnAlias(url, key, { supplierId, alias: spelling, userId: user.user_id, orgId: user.org_id, source: 'merge' })) aliases++
      }
    }

    for (const value of stored) {
      // `Prefer: count=exact` + return=minimal: we need the number of rows
      // touched, NOT the rows. Asking for representation here would pull every
      // receipt's legacy base64 image into the Worker (guardrail 4).
      const res = await fetch(
        `${url}/rest/v1/receipts?${scopeOf(user)}&vendor_name=eq.${q(value)}`,
        { method: 'PATCH',
          headers: { ...sbh(key), Prefer: 'return=minimal,count=exact' },
          body: JSON.stringify({ supplier_id: supplierId }) })
      if (res.ok) {
        // Content-Range looks like "0-41/42"; the total is what we want.
        const total = parseInt((res.headers.get('content-range') || '').split('/')[1], 10)
        linked += Number.isFinite(total) ? total : 0
      } else problems.push(`עדכון קבלות נכשל: ${value.trim()}`)
    }
  }

  await writeAudit(context.env, {
    orgId: user.org_id || null, userId: user.user_id,
    action: 'suppliers_merged', target: null,
    meta: { groups: groups.length, suppliers_created: created, aliases_learned: aliases, receipts_linked: linked },
  })

  return Response.json({
    suppliers_created: created, aliases_learned: aliases, receipts_linked: linked,
    problems: problems.length ? problems : undefined,
  }, { headers: CORS })
})
