/**
 * /api/mail/cron — scan ALL active mailbox connections (every customer). Called
 * by the scheduled cron Worker (mail-scan-worker). Protected by a shared secret
 * (env.CRON_SECRET) — NOT a user JWT. Reuses the same scan core + Pages env as
 * the on-demand /api/mail/scan, so no secrets are duplicated.
 */
import { getSupabaseUrl } from '../_lib/extractReceipt.js'
import { writeAudit } from '../_lib/audit.js'
import { scanConnection } from '../_lib/mailScan.js'
import { constantTimeEqual } from '../_lib/auth.js'

export async function onRequest({ request, env }) {
  const secret = request.headers.get('x-cron-secret') || new URL(request.url).searchParams.get('secret')
  // Constant-time compare — a plain !== leaks, via response timing, how many
  // leading characters of the secret matched (A.8.24 crypto hygiene).
  if (!env.CRON_SECRET || !constantTimeEqual(secret, env.CRON_SECRET)) return new Response('forbidden', { status: 403 })

  const url = getSupabaseUrl(env), key = env.SUPABASE_SERVICE_ROLE_KEY
  const h = { apikey: key, Authorization: `Bearer ${key}` }

  const conns = await fetch(`${url}/rest/v1/mail_connections?status=eq.active&select=*`, { headers: h })
    .then(r => r.ok ? r.json() : [])

  let imported = 0, errors = 0
  const broken = []
  const nowIso = new Date().toISOString()
  for (const conn of conns) {
    try {
      let vatRate = 18
      const s = await fetch(`${url}/rest/v1/user_settings?user_id=eq.${conn.user_id}&select=vat_rate&limit=1`, { headers: h }).then(r => r.ok ? r.json() : [])
      if (s[0]?.vat_rate > 0) vatRate = Number(s[0].vat_rate)
      const out = await scanConnection(conn, env, { vatRate })
      imported += out.imported
    } catch (e) {
      errors++
      const isAuth = e?.code === 'AUTH'
      // A refresh-token failure means this mailbox has stopped importing and will
      // stay stopped until the user reconnects. Stamp WHEN it started so the app
      // can say "3 days" rather than just "error", and so a daily cron does not
      // reset the clock on every run.
      await fetch(`${url}/rest/v1/mail_connections?id=eq.${conn.id}`, {
        method: 'PATCH', headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: isAuth ? 'error' : conn.status,
          last_error: (e?.message || '').slice(0, 200),
          ...(isAuth && !conn.error_since ? { error_since: nowIso } : {}),
        }),
      })
      if (isAuth) {
        broken.push({ email: conn.email, provider: conn.provider, since: conn.error_since || nowIso })
        await writeAudit(env, {
          orgId: conn.org_id || null, userId: conn.user_id,
          action: 'mailbox_auth_failed', target: conn.provider,
          meta: { email: conn.email, error: (e?.message || '').slice(0, 200) },
        })
      }
    }
  }
  return Response.json({ ok: true, connections: conns.length, imported, errors, broken })
}
