/**
 * /api/admin/clients — the operator's client-management console (15.11.26):
 * who each customer is, what they pay monthly, which features they bought and
 * at what price, and how they pay. client_accounts rows are service-role-only
 * (RLS with zero policies — a tenant must never see pricing), so everything
 * runs here behind the owner+MFA guard, exactly like /api/admin/flags.
 *
 *   GET  → { orgs:[{id,name,business_name,plan,subscription_status}],
 *            clients:[client_accounts rows], modules:[key] }
 *   POST { orgId, record:{contact_name?,contact_phone?,contact_email?,
 *          monthly_price?,features?,payment_method?,payment_notes?,
 *          status?,started_at?,notes?}, syncFlags? }
 *        → { ok } — upserts the org's card; with syncFlags (default true) a
 *          purchased feature also flips the org's module flag ON and a removed
 *          one clears the override back to default, so "what he bought" and
 *          "what he can use" cannot drift apart.
 */
import { requireUser, wrapAuthErrors } from '../_lib/auth.js'
import { writeAudit } from '../_lib/audit.js'
import { MODULE_FLAGS, resolveFlags } from '../_lib/flags.js'

const SUPERADMIN_FALLBACK = 'eldadabadi@gmail.com'
const sbUrl = (env) => env.VITE_SUPABASE_URL || env.SUPABASE_URL || 'https://dsoucojqjrodxozcbicf.supabase.co'
const cors = { 'Content-Type': 'application/json' }

const PAYMENT_METHODS = ['bank_transfer', 'standing_order', 'bit', 'credit_card', 'check', 'other']
const STATUSES = ['active', 'trial', 'paused', 'churned']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Owner + MFA step-up guard (mirrors /api/admin/flags). */
async function guardOwner(context) {
  const caller = await requireUser(context.request, context.env)
  const superadmin = (context.env.SUPERADMIN_EMAIL || SUPERADMIN_FALLBACK).toLowerCase()
  if ((caller.email || '').toLowerCase() !== superadmin) {
    return { res: Response.json({ error: 'forbidden' }, { status: 403, headers: cors }) }
  }
  const key = context.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) return { res: Response.json({ error: 'server_config' }, { status: 500, headers: cors }) }
  const url = sbUrl(context.env)
  try {
    const fRes = await fetch(`${url}/auth/v1/admin/users/${caller.user_id}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
    if (fRes.ok) {
      const factors = (await fRes.json())?.factors || []
      const hasTotp = factors.some(f => f.status === 'verified' && (f.factor_type === 'totp' || f.type === 'totp'))
      if (hasTotp && caller.aal !== 'aal2') {
        return { res: Response.json({ error: 'mfa_required', message: 'נדרש אימות דו-שלבי (2FA).' }, { status: 403, headers: cors }) }
      }
    }
  } catch { /* factor lookup failed → don't hard-block */ }
  return { caller, key, url, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }
}

export const onRequestGet = wrapAuthErrors(async (context) => {
  const g = await guardOwner(context)
  if (g.res) return g.res
  const { url, headers } = g
  const [orgs, clients, flagRows] = await Promise.all([
    fetch(`${url}/rest/v1/organizations?select=id,name,business_name,plan,subscription_status&order=name`, { headers }).then(r => r.ok ? r.json() : []),
    fetch(`${url}/rest/v1/client_accounts?select=*`, { headers }).then(r => r.ok ? r.json() : []),
    fetch(`${url}/rest/v1/feature_flags?select=key,org_id,enabled`, { headers }).then(r => r.ok ? r.json() : []),
  ])
  // The modules each org can use RIGHT NOW (override → global → default) — the
  // console pre-checks these on a client that has no card yet, so the first
  // save mirrors reality instead of switching anything off by surprise.
  const enabled_modules = Object.fromEntries((orgs || []).map(o => {
    const eff = resolveFlags(flagRows || [], o.id)
    return [o.id, MODULE_FLAGS.filter(k => eff[k])]
  }))
  return Response.json({ orgs, clients, modules: MODULE_FLAGS, enabled_modules }, { headers: cors })
})

/** Validate + shape the writable fields; returns { record } or { error }. */
function cleanRecord(body) {
  const rec = body?.record
  if (!rec || typeof rec !== 'object') return { error: 'missing_record' }
  const out = { updated_at: new Date().toISOString() }

  for (const k of ['contact_name', 'contact_phone', 'contact_email', 'payment_notes', 'notes']) {
    if (k in rec) out[k] = rec[k] == null ? null : String(rec[k]).slice(0, 500)
  }
  if ('monthly_price' in rec) {
    const n = parseFloat(rec.monthly_price)
    if (!Number.isFinite(n) || n < 0) return { error: 'bad_price' }
    out.monthly_price = Math.round(n * 100) / 100
  }
  if ('payment_method' in rec) {
    if (rec.payment_method != null && !PAYMENT_METHODS.includes(rec.payment_method)) return { error: 'bad_payment_method' }
    out.payment_method = rec.payment_method ?? null
  }
  if ('status' in rec) {
    if (!STATUSES.includes(rec.status)) return { error: 'bad_status' }
    out.status = rec.status
  }
  if ('started_at' in rec) {
    if (rec.started_at != null && !DATE_RE.test(String(rec.started_at))) return { error: 'bad_date' }
    out.started_at = rec.started_at ?? null
  }
  if ('features' in rec) {
    // Only known module keys, only { price } — a feature the code doesn't sell
    // cannot be recorded as sold.
    const feats = {}
    for (const [key, f] of Object.entries(rec.features || {})) {
      if (!MODULE_FLAGS.includes(key)) return { error: 'unknown_feature', detail: key }
      const price = parseFloat(f?.price)
      if (!Number.isFinite(price) || price < 0) return { error: 'bad_feature_price', detail: key }
      feats[key] = { price: Math.round(price * 100) / 100 }
    }
    out.features = feats
  }
  return { record: out }
}

/**
 * Align the org's module flags with its purchased features — BINARY (operator
 * decision 15.11.26): checked = the module is ON for this client, unchecked =
 * explicitly OFF. No "fall back to default" middle state — the client card is
 * the single source of truth for what a customer can use. Audited per flip.
 */
async function syncFeatureFlags(context, g, orgId, features) {
  const { url, headers, caller } = g
  const existing = await fetch(
    `${url}/rest/v1/feature_flags?org_id=eq.${encodeURIComponent(orgId)}&select=id,key,enabled`,
    { headers }).then(r => r.ok ? r.json() : [])
  const byKey = Object.fromEntries(existing.map(f => [f.key, f]))
  const changes = []

  for (const key of MODULE_FLAGS) {
    const want = key in features
    const cur = byKey[key]
    if (cur?.enabled === want) continue
    const res = cur?.id
      ? await fetch(`${url}/rest/v1/feature_flags?id=eq.${cur.id}`, { method: 'PATCH', headers, body: JSON.stringify({ enabled: want, updated_at: new Date().toISOString() }) })
      : await fetch(`${url}/rest/v1/feature_flags`, { method: 'POST', headers, body: JSON.stringify({ key, org_id: orgId, enabled: want, note: 'client card' }) })
    if (res.ok) {
      changes.push({ key, enabled: want })
      await writeAudit(context.env, { orgId, userId: caller.user_id, action: 'flag_set', target: key, meta: { enabled: want, via: 'client_account' } })
    }
  }
  return changes
}

export const onRequestPost = wrapAuthErrors(async (context) => {
  const g = await guardOwner(context)
  if (g.res) return g.res
  const { caller, url, headers } = g

  let body
  try { body = await context.request.json() } catch { return Response.json({ error: 'bad_json' }, { status: 400, headers: cors }) }
  const orgId = (body?.orgId || '').trim()
  if (!orgId) return Response.json({ error: 'missing_org' }, { status: 400, headers: cors })

  const { record, error, detail } = cleanRecord(body)
  if (error) return Response.json({ error, detail }, { status: 400, headers: cors })

  // Upsert the card (PK = org_id), merging over any existing row.
  const res = await fetch(`${url}/rest/v1/client_accounts?on_conflict=org_id`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ org_id: orgId, ...record }),
  })
  if (!res.ok) return Response.json({ error: 'write_failed', detail: (await res.text()).slice(0, 200) }, { status: 400, headers: cors })
  const saved = (await res.json())?.[0]

  await writeAudit(context.env, {
    orgId, userId: caller.user_id, action: 'client_account_saved',
    meta: { monthly_price: saved?.monthly_price, status: saved?.status, features: Object.keys(saved?.features || {}) },
  })

  // Purchased features drive the module flags unless the caller opts out.
  let flagChanges = []
  if (body.syncFlags !== false && 'features' in record) {
    flagChanges = await syncFeatureFlags(context, g, orgId, record.features)
  }

  return Response.json({ ok: true, client: saved, flagChanges }, { headers: cors })
})
