/**
 * gmailScan — read a connected Gmail mailbox (read-only), find receipt emails,
 * and OCR their attachments into PENDING receipts. The shared OCR→store→insert
 * logic lives in mailIngest.js (also used by the Outlook/Graph scanner).
 *
 * ⚠️ Cloudflare limits a single Worker invocation to 50 subrequests. Each receipt
 * costs ~6-8 (message fetch + category load + Gemini + upload + insert), so we
 * process only a small batch per call, oldest-first, and return `more:true` when
 * a backlog remains — the caller (scan endpoint / client) loops until drained.
 */
import { decryptToken } from './mailCrypto.js'
import { makeDb, ingestReceipt } from './mailIngest.js'

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'
const RECEIPT_QUERY = 'has:attachment (invoice OR receipt OR קבלה OR חשבונית OR חשבון OR תשלום OR הזמנה OR "מס עסקה" OR "תעודת משלוח")'
const RECEIPT_MIME = /^(application\/pdf|image\/(jpe?g|png|webp|heic|heif))$/i
const MAX_LIST    = 15   // candidate messages to list
const MAX_EXAMINE = 8    // messages to fetch per call (subrequest guard)
const MAX_INGEST  = 2    // receipts to OCR per call (subrequest + duration guard)

const b64urlToB64 = s => String(s || '').replace(/-/g, '+').replace(/_/g, '/')

async function refreshAccessToken(refreshToken, env) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  })
  if (!res.ok) { const e = new Error(`token refresh ${res.status}`); e.code = 'AUTH'; throw e }
  return (await res.json()).access_token
}
const gget = async (path, token) => {
  const res = await fetch(GMAIL + path, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`gmail ${path.split('?')[0]} ${res.status}`)
  return res.json()
}
function collectAttachments(payload, out = []) {
  if (!payload) return out
  if (payload.body?.attachmentId && RECEIPT_MIME.test(payload.mimeType || '')) out.push({ attachmentId: payload.body.attachmentId, mimeType: payload.mimeType })
  for (const p of (payload.parts || [])) collectAttachments(p, out)
  return out
}
const headerOf = (msg, name) => (msg.payload?.headers || []).find(h => h.name?.toLowerCase() === name)?.value || ''

export async function scanGmail(conn, env, { vatRate = 18 } = {}) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.MAIL_TOKEN_KEY) { const e = new Error('Gmail integration not configured'); e.code = 'NO_CONFIG'; throw e }
  const token = await refreshAccessToken(await decryptToken(conn.refresh_token_enc, env.MAIL_TOKEN_KEY), env)
  const db = makeDb(env)

  const lastMs = Number(conn.last_internal_date) || 0
  const q = lastMs > 0 ? `${RECEIPT_QUERY} after:${Math.floor(lastMs / 1000)}` : `${RECEIPT_QUERY} newer_than:30d`
  const list = await gget(`/messages?q=${encodeURIComponent(q)}&maxResults=${MAX_LIST}`, token)
  const ids = (list.messages || []).map(m => m.id)
  if (!ids.length) {
    await db.patch('mail_connections', `id=eq.${conn.id}`, { last_scan_at: new Date().toISOString(), status: 'active', last_error: null })
    return { imported: 0, scanned: 0, more: false, lastInternalDate: lastMs }
  }

  // One query to find which of the listed messages were already imported (Gmail
  // ids are safe in a PostgREST in-list) — avoids one dedup subrequest per message.
  const importedSet = new Set()
  try {
    const dup = await db.select(`receipts?source_meta->>message_id=in.(${ids.join(',')})&select=source_meta&limit=${ids.length}`)
    for (const r of dup) { const m = r?.source_meta?.message_id; if (m) importedSet.add(m) }
  } catch { /* fall through — dedup is best-effort, ingest is idempotent enough */ }

  // Process oldest-first so the watermark (last_internal_date) advances monotonically.
  const newIds = ids.filter(id => !importedSet.has(id)).reverse()

  let imported = 0, examined = 0, ingested = 0, maxInternal = lastMs, more = false
  for (const id of newIds) {
    if (ingested >= MAX_INGEST || examined >= MAX_EXAMINE) { more = true; break }
    examined++
    let msg
    try { msg = await gget(`/messages/${id}?format=full`, token) } catch { continue }
    const internalDate = Number(msg.internalDate) || 0
    const atts = collectAttachments(msg.payload)
    if (atts.length) {
      const meta = { from: headerOf(msg, 'from'), subject: headerOf(msg, 'subject'), message_id: id, provider: 'gmail' }
      for (const att of atts) {
        try {
          const a = await gget(`/messages/${id}/attachments/${att.attachmentId}`, token)
          if (a.data && await ingestReceipt({ db, env, conn, vatRate, mimeType: att.mimeType, b64: b64urlToB64(a.data), meta, fallbackDateMs: internalDate })) imported++
        } catch (e) { if (e?.code === 'OCR') throw e /* else skip this attachment */ }
      }
      ingested++
    }
    if (internalDate > maxInternal) maxInternal = internalDate
  }
  if (newIds.length > examined) more = true

  await db.patch('mail_connections', `id=eq.${conn.id}`, { last_internal_date: maxInternal, last_scan_at: new Date().toISOString(), status: 'active', last_error: null })
  return { imported, scanned: examined, more, lastInternalDate: maxInternal }
}
