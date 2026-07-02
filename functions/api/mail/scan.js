/**
 * POST /api/mail/scan — scan ALL of the signed-in user's connected mailboxes now
 * (Gmail and/or Outlook) and import any new receipts as PENDING.
 *
 * Never throws a raw 500: any per-connection failure is caught and surfaced in
 * the JSON `error` field so the client (and we) can see the real cause.
 */
import { requireMember, wrapAuthErrors } from '../_lib/auth.js'
import { getSupabaseUrl } from '../_lib/extractReceipt.js'
import { scanConnection } from '../_lib/mailScan.js'

export const onRequestPost = wrapAuthErrors(async ({ request, env }) => {
  const user = await requireMember(request, env)
  const url = getSupabaseUrl(env), key = env.SUPABASE_SERVICE_ROLE_KEY
  const h = { apikey: key, Authorization: `Bearer ${key}` }

  let conns = []
  try {
    conns = await fetch(`${url}/rest/v1/mail_connections?user_id=eq.${user.user_id}&select=*`, { headers: h }).then(r => r.ok ? r.json() : [])
  } catch (e) {
    return Response.json({ ok: false, imported: 0, more: false, error: `db: ${(e?.message || e)}`.slice(0, 200) })
  }
  if (!conns.length) return Response.json({ error: 'no_connection', message: 'אין תיבת מייל מחוברת' }, { status: 400 })

  let vatRate = 18
  try {
    const s = await fetch(`${url}/rest/v1/user_settings?user_id=eq.${user.user_id}&select=vat_rate&limit=1`, { headers: h }).then(r => r.ok ? r.json() : [])
    if (s[0]?.vat_rate > 0) vatRate = Number(s[0].vat_rate)
  } catch {}

  let imported = 0, errors = 0, more = false, lastError = null
  for (const conn of conns) {
    try {
      const r = await scanConnection(conn, env, { vatRate })
      imported += r.imported
      if (r.more) more = true
    } catch (err) {
      errors++
      lastError = (err?.message || String(err)).slice(0, 200)
      // Best-effort status update — must not itself crash the request (a failing
      // PATCH here, e.g. when already at the subrequest limit, previously 500'd).
      try {
        await fetch(`${url}/rest/v1/mail_connections?id=eq.${conn.id}`, { method: 'PATCH', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: err?.code === 'AUTH' ? 'error' : conn.status, last_error: lastError }) })
      } catch {}
    }
  }
  return Response.json({ ok: errors === 0, imported, more, errors, error: lastError })
})
