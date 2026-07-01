/**
 * POST /api/mail/scan — scan ALL of the signed-in user's connected mailboxes now
 * (Gmail and/or Outlook) and import any new receipts as PENDING.
 */
import { requireMember, wrapAuthErrors } from '../_lib/auth.js'
import { getSupabaseUrl } from '../_lib/extractReceipt.js'
import { scanConnection } from '../_lib/mailScan.js'

export const onRequestPost = wrapAuthErrors(async ({ request, env }) => {
  const user = await requireMember(request, env)
  const url = getSupabaseUrl(env), key = env.SUPABASE_SERVICE_ROLE_KEY
  const h = { apikey: key, Authorization: `Bearer ${key}` }

  const conns = await fetch(`${url}/rest/v1/mail_connections?user_id=eq.${user.user_id}&select=*`, { headers: h }).then(r => r.ok ? r.json() : [])
  if (!conns.length) return Response.json({ error: 'no_connection', message: 'אין תיבת מייל מחוברת' }, { status: 400 })

  let vatRate = 18
  try {
    const s = await fetch(`${url}/rest/v1/user_settings?user_id=eq.${user.user_id}&select=vat_rate&limit=1`, { headers: h }).then(r => r.ok ? r.json() : [])
    if (s[0]?.vat_rate > 0) vatRate = Number(s[0].vat_rate)
  } catch {}

  let imported = 0, errors = 0
  for (const conn of conns) {
    try { imported += (await scanConnection(conn, env, { vatRate })).imported }
    catch (err) {
      errors++
      await fetch(`${url}/rest/v1/mail_connections?id=eq.${conn.id}`, { method: 'PATCH', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: err?.code === 'AUTH' ? 'error' : conn.status, last_error: (err?.message || '').slice(0, 200) }) })
    }
  }
  return Response.json({ ok: true, imported, errors })
})
