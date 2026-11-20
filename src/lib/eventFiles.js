/**
 * eventFiles — attachments on an event quote (client request 20.11.26): the
 * conference programme, a sketch, a requirements document — any file type.
 *
 * Files live in the existing private `receipts` bucket under
 * `<user_id>/events/<quote_id>/<random>.<ext>`; storage RLS already restricts
 * every object to the user whose id is the FIRST path segment, so a nested
 * folder needs no new policy. The row keeps only a reference.
 */
import { supabase } from './supabase'
import { RECEIPTS_BUCKET } from './storage'

const MAX_BYTES = 25 * 1024 * 1024   // one upload; the bucket itself is unlimited

/** Extension from the original filename — the bucket accepts any type. */
function extOf(name = '') {
  const m = String(name).match(/\.([A-Za-z0-9]{1,8})$/)
  return m ? m[1].toLowerCase() : 'bin'
}

const rand = () => Math.random().toString(36).slice(2, 10)

export function quoteFilePath(userId, quoteId, fileName) {
  return `${userId}/events/${quoteId}/${rand()}.${extOf(fileName)}`
}

/**
 * Upload one file and return the descriptor to append to the quote's
 * `attachments`. The original name is kept for display — the stored name is
 * randomised so two files called "תוכנית.pdf" cannot collide.
 */
export async function uploadQuoteFile(userId, quoteId, file) {
  if (!file) throw new Error('לא נבחר קובץ')
  if (file.size > MAX_BYTES) throw new Error(`הקובץ גדול מ-${Math.round(MAX_BYTES / 1024 / 1024)}MB`)
  const path = quoteFilePath(userId, quoteId, file.name)
  const { error } = await supabase.storage.from(RECEIPTS_BUCKET)
    .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (error) throw error
  return { path, name: file.name, size: file.size, type: file.type || '', at: new Date().toISOString() }
}

/** A short-lived link; the bucket is private and never served publicly. */
export async function quoteFileUrl(path, seconds = 300) {
  const { data, error } = await supabase.storage.from(RECEIPTS_BUCKET).createSignedUrl(path, seconds)
  if (error) { console.warn('[event-files] sign failed:', error.message); return null }
  return data?.signedUrl || null
}

export async function deleteQuoteFile(path) {
  const { error } = await supabase.storage.from(RECEIPTS_BUCKET).remove([path])
  if (error) throw error
}

/** Human size for the file list. */
export function fmtSize(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
