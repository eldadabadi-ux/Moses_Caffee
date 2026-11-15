/**
 * /api/admin/flags — owner-only management of per-customer module flags
 * (client request #10, SaaS packaging). Feature-flag rows are service-role-write
 * only (RLS blocks end users), so flipping a module for a customer runs here.
 *
 *   GET  → { orgs:[{id,name,plan,subscription_status}], overrides:[{key,org_id,enabled}],
 *           globals:[{key,enabled}], modules:[key] }
 *   POST { orgId, key, enabled }  enabled=null clears the override (back to default)
 *        → { ok }
 */
import { requireUser, wrapAuthErrors } from '../_lib/auth.js'
import { writeAudit } from '../_lib/audit.js'
import { MODULE_FLAGS, FLAG_KEYS } from '../_lib/flags.js'

const SUPERADMIN_FALLBACK = 'eldadabadi@gmail.com'
const sbUrl = (env) => env.VITE_SUPABASE_URL || env.SUPABASE_URL || 'https://dsoucojqjrodxozcbicf.supabase.co'
const cors = { 'Content-Type': 'application/json' }

/** Owner + MFA step-up guard, mirroring /api/admin/onboard. Returns a Response to
 *  short-circuit on failure, or null when the caller is cleared. */
async function guardOwner(context) {
  const caller = await requireUser(context.request, context.env)
  const superadmin = (context.env.SUPERADMIN_EMAIL || SUPERADMIN_FALLBACK).toLowerCase()
  if ((caller.email || '').toLowerCase() !== superadmin) {
    return { res: Response.json({ error: 'forbidden' }, { status: 403, headers: cors }) }
  }
  const key = context.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) return { res: Response.json({ error: 'server_config' }, { status: 500, headers: cors }) }
  const url = sbUrl(context.env)
  // Require AAL2 once the owner has a verified TOTP factor (same rule as onboard).
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
  const [orgs, flags] = await Promise.all([
    fetch(`${url}/rest/v1/organizations?select=id,name,business_name,plan,subscription_status&order=name`, { headers }).then(r => r.ok ? r.json() : []),
    fetch(`${url}/rest/v1/feature_flags?select=key,org_id,enabled,note`, { headers }).then(r => r.ok ? r.json() : []),
  ])
  return Response.json({
    orgs,
    overrides: (flags || []).filter(f => f.org_id),
    globals: (flags || []).filter(f => !f.org_id),
    modules: MODULE_FLAGS,
  }, { headers: cors })
})

export const onRequestPost = wrapAuthErrors(async (context) => {
  const g = await guardOwner(context)
  if (g.res) return g.res
  const { caller, url, headers } = g

  let body
  try { body = await context.request.json() } catch { return Response.json({ error: 'bad_json' }, { status: 400, headers: cors }) }
  const orgId = (body?.orgId || '').trim()
  const key = (body?.key || '').trim()
  const enabled = body?.enabled
  if (!orgId) return Response.json({ error: 'missing_org' }, { status: 400, headers: cors })
  if (!FLAG_KEYS.includes(key)) return Response.json({ error: 'unknown_flag' }, { status: 400, headers: cors })

  const scope = `key=eq.${encodeURIComponent(key)}&org_id=eq.${encodeURIComponent(orgId)}`

  if (enabled === null || enabled === undefined) {
    // Clear the override → the tenant falls back to global/default.
    const del = await fetch(`${url}/rest/v1/feature_flags?${scope}`, { method: 'DELETE', headers })
    if (!del.ok) return Response.json({ error: 'write_failed', detail: (await del.text()).slice(0, 200) }, { status: 400, headers: cors })
    await writeAudit(context.env, { orgId, userId: caller.user_id, action: 'flag_cleared', target: key })
    return Response.json({ ok: true, cleared: true }, { headers: cors })
  }

  const on = !!enabled
  const existing = await fetch(`${url}/rest/v1/feature_flags?${scope}&select=id`, { headers }).then(r => r.ok ? r.json() : [])
  let res
  if (existing?.[0]?.id) {
    res = await fetch(`${url}/rest/v1/feature_flags?id=eq.${existing[0].id}`, {
      method: 'PATCH', headers, body: JSON.stringify({ enabled: on, updated_at: new Date().toISOString() }) })
  } else {
    res = await fetch(`${url}/rest/v1/feature_flags`, {
      method: 'POST', headers, body: JSON.stringify({ key, org_id: orgId, enabled: on, note: 'admin console' }) })
  }
  if (!res.ok) return Response.json({ error: 'write_failed', detail: (await res.text()).slice(0, 200) }, { status: 400, headers: cors })
  await writeAudit(context.env, { orgId, userId: caller.user_id, action: 'flag_set', target: key, meta: { enabled: on } })
  return Response.json({ ok: true, enabled: on }, { headers: cors })
})
