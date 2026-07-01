/**
 * GET /api/mail/status — the signed-in user's mailbox connections (safe fields
 * only, never tokens) + which providers are configured on the server.
 */
import { requireUser, wrapAuthErrors } from '../_lib/auth.js'
import { getSupabaseUrl } from '../_lib/extractReceipt.js'

export const onRequestGet = wrapAuthErrors(async ({ request, env }) => {
  const user = await requireUser(request, env)
  const url = getSupabaseUrl(env), key = env.SUPABASE_SERVICE_ROLE_KEY
  const rows = await fetch(
    `${url}/rest/v1/mail_connections?user_id=eq.${user.user_id}&select=provider,email,status,last_error,last_scan_at`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  ).then(r => r.ok ? r.json() : [])

  return Response.json({
    connections: rows,
    providers: {
      gmail:   !!(env.GOOGLE_CLIENT_ID && env.MAIL_TOKEN_KEY),
      outlook: !!(env.MICROSOFT_CLIENT_ID && env.MAIL_TOKEN_KEY),
    },
  })
})
