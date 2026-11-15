/**
 * /api/inbound/alias — the signed-in customer's personal inbound email address
 * (client request #7). GET ensures an alias exists for the user and returns it
 * with the configured inbound domain, so the settings screen can show the full
 * address and a forwarding guide.
 *
 * The alias is minted once and reused; the unique index on
 * user_settings.inbound_alias guarantees no two customers share one.
 */
import { requireMember, wrapAuthErrors } from '../_lib/auth.js'
import { getSupabaseUrl } from '../_lib/extractReceipt.js'
import { genAlias, inboundAddress } from '../_lib/inbound.js'

export const onRequestGet = wrapAuthErrors(async ({ request, env }) => {
  const user = await requireMember(request, env)
  const url = getSupabaseUrl(env), key = env.SUPABASE_SERVICE_ROLE_KEY
  const h = { apikey: key, Authorization: `Bearer ${key}` }
  const domain = env.INBOUND_DOMAIN || null

  const existing = await fetch(
    `${url}/rest/v1/user_settings?user_id=eq.${user.user_id}&select=inbound_alias,business_name&limit=1`,
    { headers: h }).then(r => r.ok ? r.json() : []).catch(() => [])
  const row = existing?.[0]

  if (row?.inbound_alias) {
    return Response.json({ alias: row.inbound_alias, domain, address: inboundAddress(row.inbound_alias, domain) })
  }

  // Mint one, retrying on the (rare) unique collision.
  const bizName = row?.business_name || ''
  let alias = null
  for (let i = 0; i < 6 && !alias; i++) {
    const candidate = genAlias(bizName)
    const common = { ...h, 'Content-Type': 'application/json', Prefer: 'return=representation' }
    let res
    if (row) {
      // A settings row exists — claim the alias only while it is still null.
      res = await fetch(`${url}/rest/v1/user_settings?user_id=eq.${user.user_id}&inbound_alias=is.null`,
        { method: 'PATCH', headers: common, body: JSON.stringify({ inbound_alias: candidate }) })
    } else {
      res = await fetch(`${url}/rest/v1/user_settings`,
        { method: 'POST', headers: common, body: JSON.stringify({ user_id: user.user_id, inbound_alias: candidate }) })
    }
    if (res.status === 409) continue             // alias taken → new candidate
    if (!res.ok) break
    const out = await res.json().catch(() => [])
    if (Array.isArray(out) && out[0]?.inbound_alias) alias = out[0].inbound_alias
    else {
      // PATCH matched no row (another request set it first) → re-read and use it.
      const reread = await fetch(
        `${url}/rest/v1/user_settings?user_id=eq.${user.user_id}&select=inbound_alias&limit=1`,
        { headers: h }).then(r => r.ok ? r.json() : []).catch(() => [])
      if (reread?.[0]?.inbound_alias) alias = reread[0].inbound_alias
    }
  }

  if (!alias) return Response.json({ error: 'alias_unavailable' }, { status: 503 })
  return Response.json({ alias, domain, address: inboundAddress(alias, domain) })
})
