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
import { checkRateLimit, rateLimitedResponse } from '../_lib/rateLimit.js'

export const onRequestPost = wrapAuthErrors(async ({ request, env }) => {
  const user = await requireMember(request, env)

  // Throttle mailbox scans per user (A.8.12). A single "scan now" click loops up
  // to ~15 batched rounds client-side, so 30/min leaves room for that + a retry.
  const rl = await checkRateLimit(env, `${user.user_id}:mailscan`, { limit: 30, windowSec: 60 })
  if (!rl.allowed) return rateLimitedResponse(rl.retryAfter)

  const url = getSupabaseUrl(env), key = env.SUPABASE_SERVICE_ROLE_KEY
  const h = { apikey: key, Authorization: `Bearer ${key}` }

  let conns = []
  try {
    conns = await fetch(`${url}/rest/v1/mail_connections?user_id=eq.${user.user_id}&select=*`, { headers: h }).then(r => r.ok ? r.json() : [])
  } catch (e) {
    // Raw DB/network detail logged server-side only; client gets a generic message (A.8.28).
    console.error('[mail/scan] connections fetch failed:', e?.message || e)
    return Response.json({ ok: false, imported: 0, more: false, error: 'שגיאת מערכת — נסה שוב מאוחר יותר' })
  }
  if (!conns.length) return Response.json({ error: 'no_connection', message: 'אין תיבת מייל מחוברת' }, { status: 400 })

  let vatRate = 18
  try {
    const s = await fetch(`${url}/rest/v1/user_settings?user_id=eq.${user.user_id}&select=vat_rate&limit=1`, { headers: h }).then(r => r.ok ? r.json() : [])
    if (s[0]?.vat_rate > 0) vatRate = Number(s[0].vat_rate)
  } catch {}

  let imported = 0, errors = 0, more = false, lastError = null, scanned = 0
  const since = Number(conns[0]?.last_internal_date) || 0   // pre-scan watermark (diagnostics)
  for (const conn of conns) {
    try {
      const r = await scanConnection(conn, env, { vatRate })
      imported += r.imported
      scanned += r.scanned || 0
      if (r.more) more = true
    } catch (err) {
      errors++
      const raw = (err?.message || String(err))
      // Log the raw detail server-side; surface only a safe message to the client.
      // Keep our own user-facing quota/OCR notice (safe + useful); genericize the
      // rest so no upstream/DB text leaks (A.8.28).
      console.error('[mail/scan] connection error:', raw)
      lastError = /מכסה|quota|OCR|Gemini/i.test(raw) ? raw.slice(0, 160) : 'שגיאה בסריקת המייל — נסה שוב מאוחר יותר'
      // Best-effort status update — must not itself crash the request (a failing
      // PATCH here, e.g. when already at the subrequest limit, previously 500'd).
      try {
        const isAuth = err?.code === 'AUTH'
        await fetch(`${url}/rest/v1/mail_connections?id=eq.${conn.id}`, { method: 'PATCH', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({
          status: isAuth ? 'error' : conn.status,
          last_error: raw.slice(0, 200),
          ...(isAuth && !conn.error_since ? { error_since: new Date().toISOString() } : {}),
        }) })
      } catch {}
    }
  }
  return Response.json({ ok: errors === 0, imported, more, errors, error: lastError, scanned, since })
})
