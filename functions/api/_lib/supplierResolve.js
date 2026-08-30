/**
 * supplierResolve — resolve a scanned vendor string to a CANONICAL supplier row.
 *
 * This is the server side of audit finding R1. Pure string reasoning lives in
 * `supplierMatch.js`; this module is the I/O around it — reading the tenant's
 * supplier catalogue, creating a supplier, and learning an alias.
 *
 * Contract (client request #3): the pipeline never invents a supplier when one
 * plausibly already exists. Three outcomes only —
 *   'linked'  a confident match (or a known alias) → supplier_id is set
 *   'ask'     a plausible match the USER must confirm → suggestion is returned,
 *             supplier_id stays null until they answer
 *   'created' nothing resembled it → a new supplier row
 *
 * Every read and write carries an explicit org_id / user_id predicate: this runs
 * with the service role, so RLS is not doing the scoping here (guardrail 3).
 */
import { matchVendor, normalizeVendor, isJunkVendor } from './supplierMatch.js'

const sbHeaders = (key) => ({ apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' })

/** Tenant predicate — org when the user has one, else their user_id. */
function scopeOf({ orgId, userId }) {
  return orgId ? `org_id=eq.${orgId}` : `user_id=eq.${userId}`
}

/**
 * Load the tenant's active suppliers with their confirmed aliases.
 * Merged-away suppliers are excluded — they must never win a match again.
 */
export async function loadSupplierCatalogue(url, key, { orgId, userId }) {
  if (!key || !url || (!orgId && !userId)) return []
  try {
    const scope = scopeOf({ orgId, userId })
    const [supRes, aliasRes] = await Promise.all([
      fetch(`${url}/rest/v1/suppliers?${scope}&merged_into=is.null&select=id,name,user_id,org_id`, { headers: sbHeaders(key) }),
      fetch(`${url}/rest/v1/supplier_aliases?${scope}&select=supplier_id,alias`, { headers: sbHeaders(key) }),
    ])
    if (!supRes.ok) return []
    const suppliers = await supRes.json()
    const aliases = aliasRes.ok ? await aliasRes.json() : []
    const byId = {}
    for (const a of aliases) (byId[a.supplier_id] ||= []).push(a.alias)
    return (suppliers || []).map(s => ({ ...s, aliases: byId[s.id] || [] }))
  } catch { return [] }
}

/** Insert a supplier and return the created row (or null). */
export async function createSupplier(url, key, { name, userId, orgId, createdFrom = 'scan' }) {
  const clean = String(name || '').trim()
  if (!clean) return null
  try {
    const res = await fetch(`${url}/rest/v1/suppliers`, {
      method: 'POST',
      headers: { ...sbHeaders(key), Prefer: 'return=representation,resolution=merge-duplicates' },
      body: JSON.stringify({ name: clean, user_id: userId, org_id: orgId || null, created_from: createdFrom }),
    })
    if (!res.ok) return null
    const rows = await res.json()
    return rows?.[0] || null
  } catch { return null }
}

/**
 * Remember that `alias` means `supplierId`, so the same spelling is never
 * questioned twice. Idempotent — a repeat is silently ignored.
 */
export async function learnAlias(url, key, { supplierId, alias, userId, orgId, source = 'scan_confirmed' }) {
  const norm = normalizeVendor(alias)
  if (!supplierId || !norm) return false
  try {
    const res = await fetch(`${url}/rest/v1/supplier_aliases?on_conflict=user_id,alias_norm`, {
      method: 'POST',
      headers: { ...sbHeaders(key), Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({
        supplier_id: supplierId, alias: String(alias).trim(), alias_norm: norm,
        user_id: userId, org_id: orgId || null, source,
      }),
    })
    return res.ok
  } catch { return false }
}

/**
 * Resolve one scanned vendor name.
 *
 * @param {object}  opts
 * @param {string}  opts.vendorName raw text as the OCR read it
 * @param {string}  opts.url        Supabase REST base
 * @param {string}  opts.key        service-role key
 * @param {string}  opts.userId
 * @param {string?} opts.orgId
 * @param {Array?}  opts.catalogue  pre-loaded suppliers (saves a round trip)
 * @param {boolean} opts.autoCreate create a supplier on a clear miss (default true)
 * @returns {Promise<{outcome:'linked'|'ask'|'created'|'skipped',
 *                    supplier_id:string|null, supplier_name:string|null,
 *                    score:number, suggestion:object|null}>}
 */
export async function resolveSupplier({ vendorName, url, key, userId, orgId, catalogue, autoCreate = true }) {
  const miss = { outcome: 'skipped', supplier_id: null, supplier_name: null, score: 0, suggestion: null }
  if (!key || !url || !userId) return miss

  // An OCR failure is not a business — never let it become a supplier row.
  if (isJunkVendor(vendorName)) return { ...miss, outcome: 'skipped' }

  const list = catalogue || await loadSupplierCatalogue(url, key, { orgId, userId })
  const m = matchVendor(vendorName, list)

  if (m.decision === 'auto' && m.supplier) {
    // A confident match also teaches the spelling, so the next identical scan is
    // an exact alias hit rather than a fuzzy one.
    if (normalizeVendor(vendorName) !== normalizeVendor(m.supplier.name)) {
      await learnAlias(url, key, { supplierId: m.supplier.id, alias: vendorName, userId, orgId, source: 'scan_auto' })
    }
    return { outcome: 'linked', supplier_id: m.supplier.id, supplier_name: m.supplier.name, score: m.score, suggestion: null }
  }

  if (m.decision === 'ask' && m.supplier) {
    // Deliberately NOT linked. The client asks the user; their answer comes back
    // to /api/suppliers/resolve and becomes an alias or a new supplier.
    return {
      outcome: 'ask', supplier_id: null, supplier_name: null, score: m.score,
      suggestion: {
        scanned: String(vendorName || '').trim(),
        candidates: m.alternatives.map(a => ({ id: a.supplier.id, name: a.supplier.name, score: a.score })),
      },
    }
  }

  if (!autoCreate) return { ...miss, outcome: 'skipped' }

  const created = await createSupplier(url, key, { name: String(vendorName).trim(), userId, orgId, createdFrom: 'scan' })
  if (!created) return miss
  return { outcome: 'created', supplier_id: created.id, supplier_name: created.name, score: 0, suggestion: null }
}
