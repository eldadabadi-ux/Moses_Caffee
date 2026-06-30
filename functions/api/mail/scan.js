/**
 * POST /api/mail/scan — scan the signed-in user's connected mailbox now and
 * import any new receipts as PENDING. (Also the same logic the background cron
 * worker will call in P2.)
 */
import { requireMember, wrapAuthErrors } from '../_lib/auth.js'
import { getSupabaseUrl } from '../_lib/extractReceipt.js'
import { scanConnection } from '../_lib/gmailScan.js'

export const onRequestPost = wrapAuthErrors(async ({ request, env }) => {
  const user = await requireMember(request, env)
  const url = getSupabaseUrl(env), key = env.SUPABASE_SERVICE_ROLE_KEY
  const h = { apikey: key, Authorization: `Bearer ${key}` }

  const conns = await fetch(`${url}/rest/v1/mail_connections?user_id=eq.${user.user_id}&provider=eq.gmail&select=*&limit=1`, { headers: h }).then(r => r.ok ? r.json() : [])
  const conn = conns[0]
  if (!conn) return Response.json({ error: 'no_connection', message: 'אין תיבת מייל מחוברת' }, { status: 400 })

  // User's VAT rate (default 18)
  let vatRate = 18
  try {
    const s = await fetch(`${url}/rest/v1/user_settings?user_id=eq.${user.user_id}&select=vat_rate&limit=1`, { headers: h }).then(r => r.ok ? r.json() : [])
    if (s[0]?.vat_rate > 0) vatRate = Number(s[0].vat_rate)
  } catch {}

  try {
    const out = await scanConnection(conn, env, { vatRate })
    return Response.json({ ok: true, ...out })
  } catch (err) {
    await fetch(`${url}/rest/v1/mail_connections?id=eq.${conn.id}`, {
      method: 'PATCH', headers: { ...h, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: err?.code === 'AUTH' ? 'error' : conn.status, last_error: (err?.message || '').slice(0, 200) }),
    })
    return Response.json({ error: 'scan_failed', message: err?.message || 'שגיאת סריקה' }, { status: 502 })
  }
})
