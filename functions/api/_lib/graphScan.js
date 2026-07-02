/**
 * graphScan — read a connected Outlook / Microsoft 365 mailbox (Mail.Read) via
 * Microsoft Graph, find receipt emails, and OCR their attachments into PENDING
 * receipts. Shares the OCR→store→insert core (mailIngest.js) with the Gmail path.
 *
 * ⚠️ Same 50-subrequest-per-invocation budget as gmailScan: process a small batch
 * per call and return `more:true` when a backlog remains.
 */
import { decryptToken, encryptToken } from './mailCrypto.js'
import { makeDb, alreadyImported, ingestReceipt } from './mailIngest.js'

const GRAPH = 'https://graph.microsoft.com/v1.0'
const RECEIPT_MIME = /^(application\/pdf|image\/(jpe?g|png|webp|heic|heif))$/i
const KW = /(invoice|receipt|קבלה|חשבונית|חשבון|תשלום|הזמנה|תעודת משלוח)/i
const MAX_LIST    = 15
const MAX_EXAMINE = 10
const MAX_INGEST  = 4

// Microsoft rotates refresh tokens on each use → persist the new one.
async function refresh(conn, env, db) {
  const rt = await decryptToken(conn.refresh_token_enc, env.MAIL_TOKEN_KEY)
  const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.MICROSOFT_CLIENT_ID, client_secret: env.MICROSOFT_CLIENT_SECRET, refresh_token: rt, grant_type: 'refresh_token', scope: 'https://graph.microsoft.com/Mail.Read offline_access' }),
  })
  if (!res.ok) { const e = new Error(`ms token ${res.status}`); e.code = 'AUTH'; throw e }
  const tok = await res.json()
  if (tok.refresh_token && tok.refresh_token !== rt) {
    try { await db.patch('mail_connections', `id=eq.${conn.id}`, { refresh_token_enc: await encryptToken(tok.refresh_token, env.MAIL_TOKEN_KEY) }) } catch {}
  }
  return tok.access_token
}
const gget = async (path, token) => { const r = await fetch(GRAPH + path, { headers: { Authorization: `Bearer ${token}` } }); if (!r.ok) throw new Error(`graph ${r.status}`); return r.json() }

export async function scanGraph(conn, env, { vatRate = 18 } = {}) {
  if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET || !env.MAIL_TOKEN_KEY) { const e = new Error('Outlook integration not configured'); e.code = 'NO_CONFIG'; throw e }
  const db = makeDb(env)
  const token = await refresh(conn, env, db)

  const lastMs = Number(conn.last_internal_date) || 0
  const sinceIso = new Date(lastMs > 0 ? lastMs : Date.now() - 30 * 864e5).toISOString()
  const filter = encodeURIComponent(`hasAttachments eq true and receivedDateTime ge ${sinceIso}`)
  // Oldest-first so the watermark advances monotonically across looped calls.
  const list = await gget(`/me/messages?$filter=${filter}&$select=id,subject,from,receivedDateTime&$top=${MAX_LIST}&$orderby=receivedDateTime asc`, token)
  const msgs = list.value || []

  let imported = 0, examined = 0, ingested = 0, maxMs = lastMs, more = false
  for (const m of msgs) {
    if (ingested >= MAX_INGEST || examined >= MAX_EXAMINE) { more = true; break }
    const ms = Date.parse(m.receivedDateTime) || 0
    if (!KW.test(m.subject || '')) { if (ms > maxMs) maxMs = ms; continue }   // likely-receipt subjects only
    examined++
    try {
      if (await alreadyImported(db, m.id)) { if (ms > maxMs) maxMs = ms; continue }
      const atts = await gget(`/me/messages/${m.id}/attachments?$select=contentType,contentBytes,name`, token)
      const files = (atts.value || []).filter(a => (a['@odata.type'] || '').includes('fileAttachment') && RECEIPT_MIME.test(a.contentType || '') && a.contentBytes)
      if (files.length) {
        const meta = { from: m.from?.emailAddress?.address || '', subject: m.subject || '', message_id: m.id, provider: 'outlook' }
        for (const f of files) {
          if (await ingestReceipt({ db, env, conn, vatRate, mimeType: f.contentType, b64: f.contentBytes, meta, fallbackDateMs: ms })) imported++
        }
        ingested++
      }
    } catch { /* skip this message */ }
    if (ms > maxMs) maxMs = ms
  }
  if (msgs.length > examined && more === false && msgs.length >= MAX_LIST) more = true

  await db.patch('mail_connections', `id=eq.${conn.id}`, { last_internal_date: maxMs, last_scan_at: new Date().toISOString(), status: 'active', last_error: null })
  return { imported, scanned: examined, more, lastInternalDate: maxMs }
}
