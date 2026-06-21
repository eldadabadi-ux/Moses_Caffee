/**
 * POST /api/admin/onboard — owner-only: onboard a NEW customer.
 * Creates the customer's login (auth user) + their organization + an owner
 * membership. Service-role is required to create an auth user, so this runs
 * server-side and verifies the caller is the platform owner first.
 *
 * Body: { businessName, ownerEmail, password }
 * → { ok, org, user }
 */
import { requireUser, wrapAuthErrors } from '../_lib/auth.js'

const SUPERADMIN = 'eldadabadi@gmail.com'
function sbUrl(env) { return env.VITE_SUPABASE_URL || env.SUPABASE_URL || 'https://dsoucojqjrodxozcbicf.supabase.co' }
const cors = { 'Content-Type': 'application/json' }

function makeSlug(name) {
  const base = (name || '').trim().toLowerCase()
    .replace(/[^a-z0-9֐-׿]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24)
  const rand = Math.random().toString(36).slice(2, 6)
  return `${base || 'org'}-${rand}`
}

export const onRequestPost = wrapAuthErrors(async (context) => {
  const caller = await requireUser(context.request, context.env)
  if ((caller.email || '').toLowerCase() !== SUPERADMIN) {
    return Response.json({ error: 'forbidden' }, { status: 403, headers: cors })
  }
  const key = context.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) return Response.json({ error: 'server_config', message: 'service role key missing' }, { status: 500, headers: cors })
  const url = sbUrl(context.env)
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }

  let body
  try { body = await context.request.json() } catch { return Response.json({ error: 'bad_json' }, { status: 400, headers: cors }) }
  const businessName = (body?.businessName || '').trim()
  const ownerEmail   = (body?.ownerEmail || '').trim().toLowerCase()
  const password     = body?.password || ''
  if (!businessName || !ownerEmail || password.length < 8) {
    return Response.json({ error: 'missing_fields', message: 'businessName, ownerEmail, password(≥8) required' }, { status: 400, headers: cors })
  }

  // 1) Create the customer's login (auth user)
  const uRes = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST', headers,
    body: JSON.stringify({ email: ownerEmail, password, email_confirm: true }),
  })
  if (!uRes.ok) {
    const detail = (await uRes.text()).slice(0, 300)
    const dup = /already.*registered|exists|duplicate/i.test(detail)
    return Response.json({ error: dup ? 'email_taken' : 'user_failed', detail }, { status: 400, headers: cors })
  }
  const newUser = await uRes.json()

  // 2) Create the organization (owned by the new user)
  const oRes = await fetch(`${url}/rest/v1/organizations`, {
    method: 'POST', headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      name: businessName, business_name: businessName, slug: makeSlug(businessName),
      owner_id: newUser.id, plan: 'pilot', subscription_status: 'active',
    }),
  })
  if (!oRes.ok) {
    const detail = (await oRes.text()).slice(0, 300)
    // rollback the auth user we just created
    await fetch(`${url}/auth/v1/admin/users/${newUser.id}`, { method: 'DELETE', headers }).catch(() => {})
    return Response.json({ error: 'org_failed', detail }, { status: 400, headers: cors })
  }
  const org = (await oRes.json())[0]

  // 3) Owner membership
  const mRes = await fetch(`${url}/rest/v1/memberships`, {
    method: 'POST', headers,
    body: JSON.stringify({ org_id: org.id, user_id: newUser.id, role: 'owner' }),
  })
  if (!mRes.ok) {
    const detail = (await mRes.text()).slice(0, 300)
    await fetch(`${url}/rest/v1/organizations?id=eq.${org.id}`, { method: 'DELETE', headers }).catch(() => {})
    await fetch(`${url}/auth/v1/admin/users/${newUser.id}`, { method: 'DELETE', headers }).catch(() => {})
    return Response.json({ error: 'membership_failed', detail }, { status: 400, headers: cors })
  }

  return Response.json({ ok: true, org: { id: org.id, name: org.name, slug: org.slug }, user: { id: newUser.id, email: ownerEmail } }, { headers: cors })
})
