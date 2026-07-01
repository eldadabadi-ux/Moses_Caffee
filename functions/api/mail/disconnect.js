/**
 * POST /api/mail/disconnect?provider=gmail|outlook — revoke access for that
 * provider and delete the stored connection (incl. the encrypted token).
 */
import { requireUser, wrapAuthErrors } from '../_lib/auth.js'
import { getSupabaseUrl } from '../_lib/extractReceipt.js'
import { decryptToken } from '../_lib/mailCrypto.js'

export const onRequestPost = wrapAuthErrors(async ({ request, env }) => {
  const user = await requireUser(request, env)
  const provider = new URL(request.url).searchParams.get('provider') === 'outlook' ? 'outlook' : 'gmail'
  const url = getSupabaseUrl(env), key = env.SUPABASE_SERVICE_ROLE_KEY
  const h = { apikey: key, Authorization: `Bearer ${key}` }

  const conns = await fetch(`${url}/rest/v1/mail_connections?user_id=eq.${user.user_id}&provider=eq.${provider}&select=id,refresh_token_enc&limit=1`, { headers: h }).then(r => r.ok ? r.json() : [])
  const conn = conns[0]
  if (conn) {
    try {
      const rt = await decryptToken(conn.refresh_token_enc, env.MAIL_TOKEN_KEY)
      if (provider === 'gmail') await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(rt), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
      // (Microsoft has no simple server-side revoke endpoint; deleting the stored token is sufficient.)
    } catch {}
    await fetch(`${url}/rest/v1/mail_connections?id=eq.${conn.id}`, { method: 'DELETE', headers: h })
  }
  return Response.json({ ok: true })
})
