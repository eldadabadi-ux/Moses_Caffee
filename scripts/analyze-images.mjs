/**
 * READ-ONLY analysis for audit finding C1 — how much base64 image data lives in
 * the `receipts` rows, and how many rows still need backfilling to Storage.
 *
 * Changes nothing. Run:
 *   node --env-file=.env.test scripts/analyze-images.mjs
 *
 * Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (already in .env.test).
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !SERVICE) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (put them in .env.test).')
  process.exit(1)
}
const sb = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })

const PAGE = 200
const mb = (n) => (n / 1048576).toFixed(2) + ' MB'

let from = 0
let total = 0, withImage = 0, withStorage = 0
let legacyRows = 0, legacyBytes = 0          // receipt_image set, storage_path NULL  → needs backfill
let dualRows = 0, dualBytes = 0              // both set (new scans: small thumb in row)
let biggest = 0

for (;;) {
  const { data, error } = await sb
    .from('receipts')
    .select('id, archived_at, storage_path, receipt_image')
    .order('id', { ascending: true })
    .range(from, from + PAGE - 1)
  if (error) { console.error('query failed:', error.message); process.exit(1) }
  if (!data.length) break

  for (const r of data) {
    total++
    const bytes = (r.receipt_image || '').length     // base64 chars ≈ bytes
    const hasImg = bytes > 0
    const hasStore = !!r.storage_path
    if (hasImg) withImage++
    if (hasStore) withStorage++
    if (hasImg && !hasStore) { legacyRows++; legacyBytes += bytes; if (bytes > biggest) biggest = bytes }
    else if (hasImg && hasStore) { dualRows++; dualBytes += bytes }
  }
  from += data.length
  if (data.length < PAGE) break
}

console.log('\n── receipts image-storage analysis (C1) ─────────────────────')
console.log('total receipts (incl. archived):', total)
console.log('rows with an inline receipt_image:', withImage)
console.log('rows with a storage_path (in bucket):', withStorage)
console.log('')
console.log('LEGACY  (inline image, NO storage_path → to backfill):', legacyRows, '·', mb(legacyBytes))
console.log('DUAL    (inline thumb + storage_path, from S1.4 scans):', dualRows, '·', mb(dualBytes))
console.log('biggest single inline legacy image:', mb(biggest))
console.log('TOTAL base64 currently pulled by the list select(*):', mb(legacyBytes + dualBytes))
console.log('─────────────────────────────────────────────────────────────\n')
