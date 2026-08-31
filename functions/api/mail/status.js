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
    `${url}/rest/v1/mail_connections?user_id=eq.${user.user_id}&select=id,provider,email,status,last_error,last_scan_at,error_since`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  ).then(r => r.ok ? r.json() : [])

  // A connection that has been failing needs the user's attention: scanning has
  // silently stopped for that mailbox, and receipts are piling up unimported.
  const broken = rows.filter(r => r.status === 'error' || r.status === 'revoked')

  return Response.json({
    connections: rows,
    needs_attention: broken.map(r => ({
      id: r.id, provider: r.provider, email: r.email, status: r.status,
      since: r.error_since || null,
      days: r.error_since
        ? Math.max(0, Math.floor((Date.now() - new Date(r.error_since).getTime()) / 86400000))
        : null,
    })),
    providers: {
      gmail:   !!(env.GOOGLE_CLIENT_ID && env.MAIL_TOKEN_KEY),
      outlook: !!(env.MICROSOFT_CLIENT_ID && env.MAIL_TOKEN_KEY),
    },
  })
})
