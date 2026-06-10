/**
 * POST /api/admin/onboard — SuperAdmin-only: connect a NEW customer.
 * Creates the tenant (business) + the customer's login user, and assigns the
 * user to that tenant. Service-role is required to create an auth user, so this
 * runs server-side and verifies the caller is the platform owner first.
 *
 * Body: { businessName, slug, plan?, ownerEmail, password, features? }
 */
import { requireUser, wrapAuthErrors } from '../_lib/auth.js'

const SUPERADMIN = 'eldadabadi@gmail.com'
function sbUrl(env) { return env.VITE_SUPABASE_URL || env.SUPABASE_URL || 'https://dsoucojqjrodxozcbicf.supabase.co' }
const cors = { 'Content-Type': 'application/json' }

export const onRequestPost = wrapAuthErrors(async (context) => {
  const user = await requireUser(context.request, context.env)
  if ((user.email || '').toLowerCase() !== SUPERADMIN) {
    return Response.json({ error: 'forbidden' }, { status: 403, headers: cors })
  }
  const key = context.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) return Response.json({ error: 'server_config', message: 'service role key missing' }, { status: 500, headers: cors })
  const url = sbUrl(context.env)

  let body
  try { body = await context.request.json() } catch { return Response.json({ error: 'bad_json' }, { status: 400, headers: cors }) }
  const businessName = (body?.businessName || '').trim()
  const slug = (body?.slug || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-')
  const ownerEmail = (body?.ownerEmail || '').trim().toLowerCase()
  const password = body?.password || ''
  const plan = body?.plan === 'basic' ? 'basic' : 'pro'
  const features = (body?.features && typeof body.features === 'object') ? body.features : {}
  if (!businessName || !slug || !ownerEmail || password.length < 8) {
    return Response.json({ error: 'missing_fields', message: 'businessName, slug, ownerEmail, password(≥8) required' }, { status: 400, headers: cors })
  }

  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }

  // 1) Create the tenant (business)
  const tRes = await fetch(`${url}/rest/v1/tenants`, {
    method: 'POST', headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({ name: businessName, slug, business_name: businessName, plan, features }),
  })
  if (!tRes.ok) {
    const detail = (await tRes.text()).slice(0, 300)
    const dup = /duplicate key|already exists|unique/i.test(detail)
    return Response.json({ error: dup ? 'slug_taken' : 'tenant_failed', detail }, { status: 400, headers: cors })
  }
  const tenant = (await tRes.json())[0]

  // 2) Create the customer's login (auth user) bound to this tenant
  const uRes = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST', headers,
    body: JSON.stringify({ email: ownerEmail, password, email_confirm: true, user_metadata: { tenant_id: tenant.id } }),
  })
  if (!uRes.ok) {
    const detail = (await uRes.text()).slice(0, 300)
    // best-effort rollback of the tenant we just created
    await fetch(`${url}/rest/v1/tenants?id=eq.${tenant.id}`, { method: 'DELETE', headers }).catch(() => {})
    const dup = /already.*registered|exists/i.test(detail)
    return Response.json({ error: dup ? 'email_taken' : 'user_failed', detail }, { status: 400, headers: cors })
  }
  const newUser = await uRes.json()

  // 3) Ensure the profile is bound to this tenant as owner (trigger created it from metadata)
  await fetch(`${url}/rest/v1/profiles?id=eq.${newUser.id}`, {
    method: 'PATCH', headers, body: JSON.stringify({ tenant_id: tenant.id, role: 'owner', email: ownerEmail }),
  }).catch(() => {})

  // 4) Audit
  await fetch(`${url}/rest/v1/audit_log`, {
    method: 'POST', headers,
    body: JSON.stringify({ tenant_id: tenant.id, user_id: user.user_id, action: 'tenant_onboarded', target: ownerEmail, meta: { plan } }),
  }).catch(() => {})

  return Response.json({ ok: true, tenant, user: { id: newUser.id, email: ownerEmail } }, { headers: cors })
})
