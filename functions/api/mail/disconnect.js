/**
 * POST /api/mail/disconnect?provider=gmail|outlook[&email=<address>]
 * Revoke access for that mailbox and delete the stored connection (including the
 * encrypted token).
 *
 * `email` identifies WHICH mailbox when several of the same provider are
 * connected (client request #14). It may be omitted only when exactly one is.
 */
import { requireUser, wrapAuthErrors } from '../_lib/auth.js'
import { getSupabaseUrl } from '../_lib/extractReceipt.js'
import { decryptToken } from '../_lib/mailCrypto.js'
import { writeAudit } from '../_lib/audit.js'

export const onRequestPost = wrapAuthErrors(async ({ request, env }) => {
  const user = await requireUser(request, env)
  const params = new URL(request.url).searchParams
  const provider = params.get('provider') === 'outlook' ? 'outlook' : 'gmail'
  const email = (params.get('email') || '').trim()
  const url = getSupabaseUrl(env), key = env.SUPABASE_SERVICE_ROLE_KEY
  const h = { apikey: key, Authorization: `Bearer ${key}` }

  // With several mailboxes per provider, an address is required to say WHICH one
  // to disconnect; without one we would silently drop whichever came back first.
  const emailFilter = email ? `&email=eq.${encodeURIComponent(email)}` : ''
  const conns = await fetch(`${url}/rest/v1/mail_connections?user_id=eq.${user.user_id}&provider=eq.${encodeURIComponent(provider)}${emailFilter}&select=id,email,refresh_token_enc`, { headers: h }).then(r => r.ok ? r.json() : [])
  if (conns.length > 1 && !email) {
    return Response.json({ error: 'ambiguous', message: 'יש כמה תיבות מחוברות — יש לציין כתובת', mailboxes: conns.map(c => c.email) }, { status: 400 })
  }
  const conn = conns[0]
  if (conn) {
    try {
      const rt = await decryptToken(conn.refresh_token_enc, env.MAIL_TOKEN_KEY)
      if (provider === 'gmail') await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(rt), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
      // (Microsoft has no simple server-side revoke endpoint; deleting the stored token is sufficient.)
    } catch {}
    await fetch(`${url}/rest/v1/mail_connections?id=eq.${conn.id}`, { method: 'DELETE', headers: h })
    await writeAudit(env, { userId: user.user_id, action: 'mailbox_disconnected', target: provider, meta: { provider, email: conn.email } })
  }
  return Response.json({ ok: true })
})
