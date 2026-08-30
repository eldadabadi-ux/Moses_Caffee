/**
 * C1 backfill — move legacy base64 receipt images OUT of the DB and into the
 * private `receipts` Storage bucket, then clear the inline `receipt_image` column.
 *
 * Two phases:
 *   1. rows with an inline image but NO storage_path  → upload to bucket, set storage_path
 *   2. rows with a storage_path but still an inline image → null receipt_image
 *
 * Safety:
 *   - DRY-RUN by default (reports only). Pass --apply to mutate.
 *   - Idempotent: skips rows already migrated. Uploads BEFORE clearing anything.
 *   - Uses the service role (auth.uid() IS NULL) so the enforce_own_org trigger
 *     leaves user_id/org_id untouched.
 *   - Run phase-2 clearing only AFTER the new front-end (which no longer writes
 *     receipt_image) is deployed, or the old code will re-hydrate it.
 *
 * Run:
 *   node --env-file=.env.test scripts/backfill-images.mjs            # dry-run
 *   node --env-file=.env.test scripts/backfill-images.mjs --apply    # execute
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const APPLY = process.argv.includes('--apply')
if (!URL || !SERVICE) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (.env.test).'); process.exit(1) }

const sb = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
const BUCKET = 'receipts'
const EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf' }
const mb = (n) => (n / 1048576).toFixed(2) + ' MB'
const log = (...a) => console.log(...a)

// Pull every row (incl. archived). Dataset is small; no paging needed.
const { data: rows, error } = await sb
  .from('receipts')
  .select('id, user_id, storage_path, receipt_image')
  .order('id', { ascending: true })
  .limit(100000)
if (error) { console.error('load failed:', error.message); process.exit(1) }

log(`\n${APPLY ? '🟢 APPLY' : '🔵 DRY-RUN'} — ${rows.length} receipts\n`)

let toUpload = 0, uploadBytes = 0, uploaded = 0, uploadFail = 0
let toClear = 0, clearBytes = 0, cleared = 0
let skipped = 0

// ── Phase 1: legacy inline image, no storage_path → upload to bucket ──────────
for (const r of rows) {
  const img = r.receipt_image || ''
  const isDataUrl = img.startsWith('data:')
  if (r.storage_path || !isDataUrl) continue
  const m = /^data:([^;]+);base64,(.*)$/s.exec(img)
  if (!m) { log(`  ⚠ ${r.id}: inline image is not a base64 data URL — skipped`); skipped++; continue }
  const mime = m[1].toLowerCase()
  const buf = Buffer.from(m[2], 'base64')
  const path = `${r.user_id}/${r.id}.${EXT[mime] || 'jpg'}`
  toUpload++; uploadBytes += buf.length
  if (!APPLY) { log(`  would upload ${r.id} (${mb(buf.length)}) → ${path}`); continue }
  const up = await sb.storage.from(BUCKET).upload(path, new Blob([buf], { type: mime }), { upsert: true, contentType: mime })
  if (up.error) { log(`  ✗ ${r.id}: upload failed — ${up.error.message}`); uploadFail++; continue }
  const { error: ue } = await sb.from('receipts').update({ storage_path: path }).eq('id', r.id)
  if (ue) { log(`  ✗ ${r.id}: set storage_path failed — ${ue.message}`); uploadFail++; continue }
  r.storage_path = path                       // reflect for phase 2
  uploaded++; log(`  ✓ uploaded ${r.id} → ${path}`)
}

// ── Phase 2: has storage_path but still an inline image → clear receipt_image ─
for (const r of rows) {
  const img = r.receipt_image || ''
  if (!r.storage_path || !img) continue
  toClear++; clearBytes += img.length
  if (!APPLY) { log(`  would clear inline image on ${r.id} (${mb(img.length)} freed)`); continue }
  const { error: ce } = await sb.from('receipts').update({ receipt_image: null }).eq('id', r.id)
  if (ce) { log(`  ✗ ${r.id}: clear failed — ${ce.message}`); continue }
  cleared++
}

log('\n── summary ─────────────────────────────────────')
log(`phase 1 — uploads to Storage : ${APPLY ? uploaded + ' done, ' + uploadFail + ' failed' : toUpload + ' pending'} · ${mb(uploadBytes)}`)
log(`phase 2 — inline images clear: ${APPLY ? cleared + ' done' : toClear + ' pending'} · ${mb(clearBytes)} freed`)
if (skipped) log(`skipped (non-dataURL inline): ${skipped}`)
log(APPLY ? '\n✅ backfill complete — re-run scripts/analyze-images.mjs to verify 0 MB inline\n'
          : '\n(dry-run only — nothing changed. Re-run with --apply to execute.)\n')
