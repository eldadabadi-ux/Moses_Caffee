/**
 * gmailScan — read a connected Gmail mailbox, find receipt emails, OCR their
 * attachments with the shared extractReceipt pipeline, and insert each as a
 * PENDING receipt (status='pending', source='email') for the user to review.
 *
 * Reuses: extractReceipt (OCR), getSupabaseUrl. All Gmail access is read-only
 * (gmail.readonly). Never stores the email body — only the receipt file +
 * minimal metadata (from / subject / message_id).
 */
import { extractReceipt, getSupabaseUrl } from './extractReceipt.js'
import { decryptToken } from './mailCrypto.js'

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'
// Likely-receipt emails: an attachment + a receipt-ish word (HE/EN).
const RECEIPT_QUERY = 'has:attachment (invoice OR receipt OR קבלה OR חשבונית OR חשבון OR תשלום OR הזמנה OR "מס עסקה" OR "תעודת משלוח")'
const RECEIPT_MIME = /^(application\/pdf|image\/(jpe?g|png|webp|heic|heif))$/i
const MAX_PER_SCAN = 25   // cap work per scan run

function b64urlToB64(s) { return String(s || '').replace(/-/g, '+').replace(/_/g, '/') }

async function refreshAccessToken(refreshToken, env) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) { const e = new Error(`token refresh ${res.status}: ${(await res.text()).slice(0, 160)}`); e.code = 'AUTH'; throw e }
  return (await res.json()).access_token
}

const gget = async (path, token) => {
  const res = await fetch(GMAIL + path, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`gmail ${path.split('?')[0]} ${res.status}`)
  return res.json()
}

// Flatten a Gmail payload into a list of attachment parts (recursively).
function collectAttachments(payload, out = []) {
  if (!payload) return out
  if (payload.body?.attachmentId && RECEIPT_MIME.test(payload.mimeType || '')) {
    out.push({ attachmentId: payload.body.attachmentId, mimeType: payload.mimeType, filename: payload.filename || 'receipt' })
  }
  for (const p of (payload.parts || [])) collectAttachments(p, out)
  return out
}
const headerOf = (msg, name) => (msg.payload?.headers || []).find(h => h.name?.toLowerCase() === name)?.value || ''

// ── Server-side Supabase (service-role) helpers ──────────────────────────────
function sb(env) {
  const url = getSupabaseUrl(env), key = env.SUPABASE_SERVICE_ROLE_KEY
  return {
    async select(pathQs) {
      const r = await fetch(`${url}/rest/v1/${pathQs}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
      return r.ok ? r.json() : []
    },
    async insert(table, row) {
      const r = await fetch(`${url}/rest/v1/${table}`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify(row),
      })
      if (!r.ok) throw new Error(`insert ${table} ${r.status}: ${(await r.text()).slice(0, 160)}`)
      return r.json()
    },
    async uploadFile(path, bytes, mime) {
      const r = await fetch(`${url}/storage/v1/object/receipts/${path}`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': mime, 'x-upsert': 'true' },
        body: bytes,
      })
      return r.ok   // best-effort
    },
    async patch(table, qs, row) {
      await fetch(`${url}/rest/v1/${table}?${qs}`, {
        method: 'PATCH',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(row),
      })
    },
  }
}

const rnd = () => Math.random().toString(36).slice(2, 10)

/**
 * Scan one mail connection. Returns { imported, scanned, lastInternalDate }.
 * @param {object} conn  a row from mail_connections (with refresh_token_enc)
 */
export async function scanConnection(conn, env, { vatRate = 18 } = {}) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.MAIL_TOKEN_KEY) {
    const e = new Error('Gmail integration not configured'); e.code = 'NO_CONFIG'; throw e
  }
  const refresh = await decryptToken(conn.refresh_token_enc, env.MAIL_TOKEN_KEY)
  const token = await refreshAccessToken(refresh, env)
  const db = sb(env)

  // Incremental window: after the last imported message, else last 30 days.
  const lastMs = Number(conn.last_internal_date) || 0
  const q = lastMs > 0
    ? `${RECEIPT_QUERY} after:${Math.floor(lastMs / 1000)}`
    : `${RECEIPT_QUERY} newer_than:30d`

  const list = await gget(`/messages?q=${encodeURIComponent(q)}&maxResults=${MAX_PER_SCAN}`, token)
  const ids = (list.messages || []).map(m => m.id)
  let imported = 0, maxInternal = lastMs

  for (const id of ids) {
    try {
      const msg = await gget(`/messages/${id}?format=full`, token)
      const internalDate = Number(msg.internalDate) || 0
      if (internalDate > maxInternal) maxInternal = internalDate

      // Dedup — already imported this message?
      const dup = await db.select(`receipts?source_meta->>message_id=eq.${id}&select=id&limit=1`)
      if (dup.length) continue

      const atts = collectAttachments(msg.payload)
      if (!atts.length) continue
      const from = headerOf(msg, 'from'), subject = headerOf(msg, 'subject')

      for (const att of atts) {
        const a = await gget(`/messages/${id}/attachments/${att.attachmentId}`, token)
        if (!a.data) continue
        const b64 = b64urlToB64(a.data)
        let result
        try {
          result = await extractReceipt({ images: [b64], mimeType: att.mimeType, env, userId: conn.user_id, vatRate })
        } catch { continue }   // unreadable attachment — skip
        if (!result || !(result.total_amount > 0 || result.vendor_name)) continue

        // Store the original file privately; keep an inline data URL for images
        // so the existing receipt thumbnail/lightbox works with no new UI.
        const ext = att.mimeType.includes('pdf') ? 'pdf' : (att.mimeType.split('/')[1] || 'bin')
        const storagePath = `${conn.user_id}/email_${id}_${rnd()}.${ext}`
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
        await db.uploadFile(storagePath, bytes, att.mimeType)
        const receiptImage = att.mimeType.startsWith('image/') ? `data:${att.mimeType};base64,${b64}` : null

        await db.insert('receipts', {
          user_id: conn.user_id, org_id: conn.org_id || null,
          vendor_name: result.vendor_name || 'ספק לא ידוע',
          receipt_date: result.receipt_date || new Date(internalDate).toISOString().slice(0, 10),
          amount: result.total_amount || 0,
          amount_before_vat: result.amount_before_vat || 0,
          vat_amount: result.vat_amount || 0,
          vat_rate: vatRate,
          currency: result.currency || 'ILS',
          category_text: result.category || 'שונות',
          items: result.items || null,
          receipt_image: receiptImage,
          ai_extracted: true,
          source: 'email',
          status: 'pending',
          storage_path: storagePath,
          source_meta: { from, subject, message_id: id, provider: 'gmail' },
        })
        imported++
      }
    } catch { /* skip this message, continue the scan */ }
  }

  await db.patch('mail_connections', `id=eq.${conn.id}`, {
    last_internal_date: maxInternal, last_scan_at: new Date().toISOString(), status: 'active', last_error: null,
  })
  return { imported, scanned: ids.length, lastInternalDate: maxInternal }
}
