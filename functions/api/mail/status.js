/**
 * GET /api/mail/status — the signed-in user's mailbox connection state (safe
 * fields only; never the token). The browser never reads mail_connections
 * directly.
 */
import { requireUser, wrapAuthErrors } from '../_lib/auth.js'
import { getSupabaseUrl } from '../_lib/extractReceipt.js'

export const onRequestGet = wrapAuthErrors(async ({ request, env }) => {
  const user = await requireUser(request, env)
  const url = getSupabaseUrl(env), key = env.SUPABASE_SERVICE_ROLE_KEY
  const rows = await fetch(
    `${url}/rest/v1/mail_connections?user_id=eq.${user.user_id}&provider=eq.gmail&select=email,status,last_error,last_scan_at&limit=1`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  ).then(r => r.ok ? r.json() : [])
  const c = rows[0]
  return Response.json({
    connected: !!c,
    configured: !!(env.GOOGLE_CLIENT_ID && env.MAIL_TOKEN_KEY),
    email: c?.email || null, status: c?.status || null,
    last_error: c?.last_error || null, last_scan_at: c?.last_scan_at || null,
  })
})
