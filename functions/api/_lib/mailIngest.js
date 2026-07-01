/**
 * mailIngest — shared core for turning one email attachment into a PENDING
 * receipt. Used by both the Gmail and the Outlook/Graph scanners so the
 * OCR → store-file → insert logic lives in ONE place.
 */
import { extractReceipt, getSupabaseUrl } from './extractReceipt.js'

const rnd = () => Math.random().toString(36).slice(2, 10)

// Service-role Supabase REST helpers (the worker/function bypasses RLS).
export function makeDb(env) {
  const url = getSupabaseUrl(env), key = env.SUPABASE_SERVICE_ROLE_KEY
  const h = { apikey: key, Authorization: `Bearer ${key}` }
  return {
    async select(pathQs) {
      const r = await fetch(`${url}/rest/v1/${pathQs}`, { headers: h }); return r.ok ? r.json() : []
    },
    async insert(table, row) {
      const r = await fetch(`${url}/rest/v1/${table}`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(row) })
      if (!r.ok) throw new Error(`insert ${table} ${r.status}: ${(await r.text()).slice(0, 160)}`)
    },
    async uploadFile(path, bytes, mime) {
      const r = await fetch(`${url}/storage/v1/object/receipts/${path}`, { method: 'POST', headers: { ...h, 'Content-Type': mime, 'x-upsert': 'true' }, body: bytes })
      return r.ok
    },
    async patch(table, qs, row) {
      await fetch(`${url}/rest/v1/${table}?${qs}`, { method: 'PATCH', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify(row) })
    },
  }
}

/** True if a receipt from this email message was already imported. */
export async function alreadyImported(db, messageId) {
  const dup = await db.select(`receipts?source_meta->>message_id=eq.${encodeURIComponent(messageId)}&select=id&limit=1`)
  return dup.length > 0
}

/**
 * OCR one attachment and insert it as a PENDING receipt. Returns true if a
 * receipt was created. `b64` is standard base64; `meta` = { from, subject,
 * message_id, provider }; `fallbackDateMs` used when the receipt has no date.
 */
export async function ingestReceipt({ db, env, conn, vatRate = 18, mimeType, b64, meta, fallbackDateMs }) {
  let result
  try { result = await extractReceipt({ images: [b64], mimeType, env, userId: conn.user_id, vatRate }) }
  catch { return false }
  if (!result || !(result.total_amount > 0 || result.vendor_name)) return false

  const ext = mimeType.includes('pdf') ? 'pdf' : (mimeType.split('/')[1] || 'bin')
  const storagePath = `${conn.user_id}/email_${rnd()}.${ext}`
  let bytes; try { bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0)) } catch { bytes = null }
  if (bytes) await db.uploadFile(storagePath, bytes, mimeType)
  const receiptImage = mimeType.startsWith('image/') ? `data:${mimeType};base64,${b64}` : null

  await db.insert('receipts', {
    user_id: conn.user_id, org_id: conn.org_id || null,
    vendor_name: result.vendor_name || 'ספק לא ידוע',
    receipt_date: result.receipt_date || new Date(fallbackDateMs || Date.now()).toISOString().slice(0, 10),
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
    storage_path: bytes ? storagePath : null,
    source_meta: meta,
  })
  return true
}
