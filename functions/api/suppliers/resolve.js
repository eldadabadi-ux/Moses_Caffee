/**
 * Cloudflare Pages Function — /api/suppliers/resolve
 *
 * The user's answer to "is this the same supplier?" (client request #3).
 *
 * POST { scanned, supplier_id }            → link the spelling to that supplier
 * POST { scanned, new_name }               → create a new supplier for it
 * POST { scanned, supplier_id, receipt_id} → also stamp that receipt
 * → { supplier_id, supplier_name, alias_learned }
 *
 * The answer is stored as an alias, so the same spelling is never questioned
 * twice — every confirmation teaches the matcher.
 */
import { requireMember, wrapAuthErrors } from '../_lib/auth.js'
import { getSupabaseUrl } from '../_lib/extractReceipt.js'
import { createSupplier, learnAlias } from '../_lib/supplierResolve.js'
import { normalizeVendor } from '../_lib/supplierMatch.js'
import { errorResponse } from '../_lib/response.js'
import { writeAudit } from '../_lib/audit.js'

// Every client-supplied value is encoded before it enters a PostgREST query
// string: a raw '#' would truncate the URL and drop the tenant predicate from a
// service-role request (guardrail 3).
const q = (v) => encodeURIComponent(String(v ?? ''))

const cors = (request, env) => ({
  'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || (request.headers.get('origin') || '').trim() || '*',
  'Content-Type': 'application/json',
})

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || (request.headers.get('origin') || '').trim() || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  } })
}

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
  const scanned = String(body?.scanned || '').trim()
  const receiptId = body?.receipt_id || null
  let supplierId = body?.supplier_id || null
  let supplierName = null

  if (!scanned) return errorResponse('חסר שם הספק שנסרק', 400, { code: 'bad_input', headers: CORS })

  if (supplierId) {
    // Confirm the supplier belongs to this tenant BEFORE trusting the client's id.
    const scope = user.org_id ? `org_id=eq.${q(user.org_id)}` : `user_id=eq.${q(user.user_id)}`
    const res = await fetch(`${url}/rest/v1/suppliers?id=eq.${q(supplierId)}&${scope}&select=id,name`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    const rows = res.ok ? await res.json() : []
    if (!rows.length) return errorResponse('הספק לא נמצא', 404, { code: 'not_found', headers: CORS })
    supplierName = rows[0].name
  } else {
    const name = String(body?.new_name || scanned).trim()
    if (!normalizeVendor(name)) return errorResponse('שם ספק לא תקין', 400, { code: 'bad_input', headers: CORS })
    const created = await createSupplier(url, key, { name, userId: user.user_id, orgId: user.org_id, createdFrom: 'manual' })
    if (!created) return errorResponse('יצירת הספק נכשלה', 500, { code: 'create_failed', headers: CORS })
    supplierId = created.id
    supplierName = created.name
  }

  const aliasLearned = normalizeVendor(scanned) === normalizeVendor(supplierName)
    ? false
    : await learnAlias(url, key, { supplierId, alias: scanned, userId: user.user_id, orgId: user.org_id, source: 'scan_confirmed' })

  if (receiptId) {
    const scope = user.org_id ? `org_id=eq.${q(user.org_id)}` : `user_id=eq.${q(user.user_id)}`
    await fetch(`${url}/rest/v1/receipts?id=eq.${q(receiptId)}&${scope}`, {
      method: 'PATCH',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ supplier_id: supplierId }),
    })
  }

  await writeAudit(context.env, {
    orgId: user.org_id || null, userId: user.user_id,
    action: 'supplier_resolved', target: supplierId,
    meta: { scanned, supplier_name: supplierName, alias_learned: aliasLearned },
  })

  return Response.json({ supplier_id: supplierId, supplier_name: supplierName, alias_learned: aliasLearned }, { headers: CORS })
})
