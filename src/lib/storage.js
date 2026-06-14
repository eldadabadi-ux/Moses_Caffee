/**
 * storage — private receipt-file storage on Supabase Storage.
 *
 * Files live in a PRIVATE bucket `receipts` under `${user_id}/${receipt_id}.<ext>`.
 * RLS (see supabase_inbound.sql) restricts every object to its owning user.
 * Files are never public — they are read through short-lived signed URLs.
 *
 * Replaces the legacy base64-in-DB `receipts.receipt_image`; new ingestion
 * channels (email/share/link) store the original file here and keep only its
 * `storage_path` on the row.
 */
import { supabase } from './supabase'

export const RECEIPTS_BUCKET = 'receipts'

const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
}

export function extForMime(mime) {
  return EXT_BY_MIME[(mime || '').toLowerCase()] || 'bin'
}

/** Build the canonical object path for a user's receipt file. */
export function receiptStoragePath(userId, receiptId, mime) {
  return `${userId}/${receiptId}.${extForMime(mime)}`
}

/**
 * Upload a receipt file (Blob/File/ArrayBuffer) to the private bucket.
 * Returns the storage path to persist on the receipt row.
 */
export async function uploadReceiptFile(userId, receiptId, file, mime) {
  const path = receiptStoragePath(userId, receiptId, mime || file?.type)
  const { error } = await supabase.storage
    .from(RECEIPTS_BUCKET)
    .upload(path, file, { upsert: true, contentType: mime || file?.type || 'application/octet-stream' })
  if (error) throw error
  return path
}

/** Short-lived signed URL for displaying/downloading a stored receipt file. */
export async function signedReceiptUrl(path, expiresIn = 3600) {
  if (!path) return null
  const { data, error } = await supabase.storage.from(RECEIPTS_BUCKET).createSignedUrl(path, expiresIn)
  if (error) return null
  return data?.signedUrl || null
}

/** Permanently remove a stored receipt file (used on purge-from-archive). */
export async function deleteReceiptFile(path) {
  if (!path) return
  const { error } = await supabase.storage.from(RECEIPTS_BUCKET).remove([path])
  if (error) throw error
}
