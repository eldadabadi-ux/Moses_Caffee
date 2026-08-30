/**
 * receiptImage — SSOT for "give me a scannable image of this receipt".
 *
 * A receipt's pixels can live in two places:
 *   - `storage_path`   → the original file in the private `receipts` bucket
 *                        (the canonical location since audit C1)
 *   - `receipt_image`  → a legacy inline base64 data URL still on the row
 *
 * Every consumer that needs to LOOK at a receipt again (re-scan, re-classify,
 * export) must go through here instead of reaching for `receipt_image`, so that
 * migrating a row to Storage never silently breaks a feature.
 *
 * Returns a JPEG data URL sized for the scan API, or null when the receipt has
 * no retrievable image at all.
 */
import { supabase } from './supabase'
import { signedReceiptUrl } from './storage'
import { downscaleForUpload } from './imageUtils'
import { pdfToImages } from './pdfUtils'

const MAX_DIM = 2000
const QUALITY = 0.9

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const fr = new FileReader()
  fr.onload = () => resolve(fr.result)
  fr.onerror = reject
  fr.readAsDataURL(blob)
})

/**
 * Lazily fetch the legacy inline image for ONE receipt.
 *
 * The list queries deliberately omit the heavy `receipt_image` column, so a row
 * in memory can have an image in the DB that the client has never loaded. This
 * pulls it for a single id, on demand — never for a list.
 */
export async function fetchLegacyInlineImage(receiptId) {
  if (!receiptId) return null
  try {
    const { data, error } = await supabase
      .from('receipts').select('receipt_image').eq('id', receiptId).single()
    if (error) return null
    const img = data?.receipt_image || null
    return (typeof img === 'string' && img.startsWith('data:')) ? img : null
  } catch { return null }
}

/**
 * Resolve a receipt row to a JPEG data URL suitable for re-scanning.
 *
 * Order of preference:
 *   1. inline base64 already on the row (cheapest — no network)
 *   2. the original file in Storage (image → downscale, PDF → first page)
 *   3. the legacy inline image fetched on demand by id
 *
 * @param {object} r receipt row (needs at least `id`; uses `storage_path`,
 *                   `receipt_image` when present)
 * @returns {Promise<string|null>} `data:image/jpeg;base64,…` or null
 */
export async function receiptScanImage(r) {
  if (!r) return null

  // 1. Inline image already in hand.
  if (typeof r.receipt_image === 'string' && r.receipt_image.startsWith('data:')) {
    return downscaleForUpload(r.receipt_image, MAX_DIM, QUALITY)
  }

  // 2. The original file in the private bucket.
  if (r.storage_path) {
    try {
      const url = await signedReceiptUrl(r.storage_path)
      if (url) {
        const res = await fetch(url)
        if (res.ok) {
          const blob = await res.blob()
          if (/\.pdf$/i.test(r.storage_path) || blob.type === 'application/pdf') {
            const pages = await pdfToImages(blob, { maxPages: 1 })
            if (pages[0]) return downscaleForUpload(pages[0], MAX_DIM, QUALITY)
          } else {
            const dataUrl = await blobToDataUrl(blob)
            if (typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
              return downscaleForUpload(dataUrl, MAX_DIM, QUALITY)
            }
          }
        }
      }
    } catch { /* fall through to the legacy path */ }
  }

  // 3. Legacy inline image that the list query didn't load.
  const legacy = await fetchLegacyInlineImage(r.id)
  if (legacy) return downscaleForUpload(legacy, MAX_DIM, QUALITY)

  return null
}

/** True when this receipt has pixels somewhere we can get to. */
export const hasRetrievableImage = (r) =>
  !!(r?.storage_path || (typeof r?.receipt_image === 'string' && r.receipt_image.startsWith('data:')))
