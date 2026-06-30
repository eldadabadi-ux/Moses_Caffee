/**
 * POST /api/mail/disconnect — revoke Google access and delete the stored
 * connection (incl. the encrypted refresh token).
 */
import { requireUser, wrapAuthErrors } from '../_lib/auth.js'
import { getSupabaseUrl } from '../_lib/extractReceipt.js'
import { decryptToken } from '../_lib/mailCrypto.js'

export const onRequestPost = wrapAuthErrors(async ({ request, env }) => {
  const user = await requireUser(request, env)
  const url = getSupabaseUrl(env), key = env.SUPABASE_SERVICE_ROLE_KEY
  const h = { apikey: key, Authorization: `Bearer ${key}` }

  const conns = await fetch(`${url}/rest/v1/mail_connections?user_id=eq.${user.user_id}&provider=eq.gmail&select=id,refresh_token_enc&limit=1`, { headers: h }).then(r => r.ok ? r.json() : [])
  const conn = conns[0]
  if (conn) {
    // Best-effort revoke at Google
    try {
      const rt = await decryptToken(conn.refresh_token_enc, env.MAIL_TOKEN_KEY)
      await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(rt), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
    } catch {}
    await fetch(`${url}/rest/v1/mail_connections?id=eq.${conn.id}`, { method: 'DELETE', headers: h })
  }
  return Response.json({ ok: true })
})
