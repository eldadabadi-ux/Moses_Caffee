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
 *   - Phase 2 VERIFIES each row against Storage before clearing it: the object at
 *     storage_path must exist and be non-empty. A row whose file is missing or
 *     zero-length keeps its inline image and is reported. This replaces "look at
 *     the app and confirm" — which only ever checks a sample, and is impossible
 *     anyway when the data belongs to someone else and is confidential.
 *   - Uses the service role (auth.uid() IS NULL) so the enforce_own_org trigger
 *     leaves user_id/org_id untouched.
 *   - Run phase-2 clearing only AFTER the new front-end (which no longer writes
 *     receipt_image) is deployed, or the old code will re-hydrate it.
 *
 * Run (in order — phase 2 is the only destructive step):
 *   node --env-file=.env.test scripts/backfill-images.mjs                      # dry-run, both phases
 *   node --env-file=.env.test scripts/backfill-images.mjs --apply --phase=1    # upload only (safe)
 *   …deploy the new front-end, verify thumbnails load…
 *   node --env-file=.env.test scripts/backfill-images.mjs --apply --phase=2    # clear inline images
 *   node --env-file=.env.test scripts/backfill-images.mjs --verify              # check only, no writes
 *
 * --verify reports how many rows have a valid file in Storage without touching
 * anything and without printing any receipt content — only ids, sizes and counts.
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const APPLY = process.argv.includes('--apply')
// Phase selection: 1 = upload to Storage (non-destructive), 2 = clear the inline
// column (destructive). Default runs both, which is only safe once the front-end
// that reads from Storage is already deployed.
const phaseArg = (process.argv.find(a => a.startsWith('--phase')) || '').split('=')[1]
const VERIFY = process.argv.includes('--verify')
const PHASE = VERIFY ? 2 : (phaseArg === '1' ? 1 : phaseArg === '2' ? 2 : 0)   // 0 = both
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

const phaseLabel = PHASE === 1 ? 'phase 1 only (upload)' : PHASE === 2 ? 'phase 2 only (clear)' : 'both phases'
log(`\n${APPLY ? '🟢 APPLY' : '🔵 DRY-RUN'} — ${rows.length} receipts · ${phaseLabel}\n`)

let toUpload = 0, uploadBytes = 0, uploaded = 0, uploadFail = 0
let toClear = 0, clearBytes = 0, cleared = 0
let skipped = 0

// ── Phase 1: legacy inline image, no storage_path → upload to bucket ──────────
for (const r of (PHASE === 2 ? [] : rows)) {
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
// DESTRUCTIVE, so every row is verified against Storage first: the object must
// exist and be non-empty. Anything that fails the check keeps its inline image.
let verifiedOk = 0, verifiedMissing = 0
const missingRows = []

if (PHASE !== 1) {
  // One listing per user folder, rather than a request per row.
  const candidates = rows.filter(r => r.storage_path && (r.receipt_image || ''))
  const folders = [...new Set(candidates.map(r => String(r.storage_path).split('/')[0]))]
  const sizeByPath = new Map()

  for (const folder of folders) {
    let offset = 0
    for (;;) {
      const { data: objs, error: le } = await sb.storage.from(BUCKET)
        .list(folder, { limit: 1000, offset })
      if (le) { log(`  ⚠ could not list ${folder}: ${le.message}`); break }
      if (!objs?.length) break
      for (const o of objs) {
        const size = o?.metadata?.size
        sizeByPath.set(`${folder}/${o.name}`, Number.isFinite(size) ? size : null)
      }
      if (objs.length < 1000) break
      offset += objs.length
    }
  }

  for (const r of candidates) {
    const size = sizeByPath.get(r.storage_path)
    if (size === undefined || size === null || size <= 0) {
      verifiedMissing++
      missingRows.push({ id: r.id, path: r.storage_path, reason: size === undefined ? 'not in bucket' : `size ${size}` })
      continue
    }
    verifiedOk++
  }

  log(`\n── Storage verification ────────────────────────`)
  log(`rows with an inline image AND a storage_path: ${candidates.length}`)
  log(`  file present and non-empty : ${verifiedOk}`)
  log(`  file missing or empty      : ${verifiedMissing}`)
  if (missingRows.length) {
    log('  the following rows will KEEP their inline image:')
    for (const m of missingRows.slice(0, 20)) log(`    ${m.id}  ${m.path}  (${m.reason})`)
    if (missingRows.length > 20) log(`    …and ${missingRows.length - 20} more`)
  }
  log('')

  const missingIds = new Set(missingRows.map(m => m.id))
  for (const r of (VERIFY ? [] : candidates)) {
    if (missingIds.has(r.id)) continue          // never clear what we could not verify
    const img = r.receipt_image || ''
    toClear++; clearBytes += img.length
    if (!APPLY) { log(`  would clear inline image on ${r.id} (${mb(img.length)} freed)`); continue }
    const { error: ce } = await sb.from('receipts').update({ receipt_image: null }).eq('id', r.id)
    if (ce) { log(`  ✗ ${r.id}: clear failed — ${ce.message}`); continue }
    cleared++
  }
}

log('\n── summary ─────────────────────────────────────')
log(`phase 1 — uploads to Storage : ${APPLY ? uploaded + ' done, ' + uploadFail + ' failed' : toUpload + ' pending'} · ${mb(uploadBytes)}`)
log(`phase 2 — inline images clear: ${APPLY ? cleared + ' done' : toClear + ' pending'} · ${mb(clearBytes)} freed`)
if (skipped) log(`skipped (non-dataURL inline): ${skipped}`)
if (VERIFY) log('\nverification only — nothing was cleared.')
else if (PHASE === 1) log('\nphase 2 (clearing inline images) was NOT run — do that after deploying the new front-end.')
if (verifiedMissing) log(`⚠ ${verifiedMissing} row(s) kept their inline image because the Storage file was missing or empty.`)
log(APPLY ? '\n✅ done — re-run scripts/analyze-images.mjs to verify\n'
          : '\n(dry-run only — nothing changed. Re-run with --apply to execute.)\n')
