/**
 * cleanup — optional data housekeeping, run AFTER the app is deployed.
 *
 *   npm run cleanup           # dry run — reports, changes nothing
 *   npm run cleanup -- --apply
 *
 * Neither step is required for the app to work:
 *   - images: moves legacy base64 receipt images out of the DB rows into the
 *     private Storage bucket. Until this runs, those receipts show a document
 *     icon instead of a thumbnail; opening and editing them works either way.
 *   - units: annotates existing line items with canonical units and ₪ per base
 *     unit, so price comparisons cover the history and not just new scans.
 *
 * Images run in two phases on purpose: phase 1 only uploads (nothing is lost if
 * it fails), phase 2 clears the now-duplicated column and is the only
 * destructive step. Phase 2 is skipped unless --clear is passed, and even then
 * it clears a row ONLY after confirming that row's file exists and is non-empty
 * in Storage. Rows that fail the check keep their inline image and are listed.
 *
 * `npm run cleanup -- --verify` runs that check alone and writes nothing. It
 * reports counts, row ids and file sizes — never receipt content — so the
 * safety of the destructive step can be established without anyone reading
 * confidential data.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const APPLY = process.argv.includes('--apply')
const CLEAR = process.argv.includes('--clear')
const VERIFY = process.argv.includes('--verify')
if (!existsSync('.env.test')) {
  console.error('\nMissing .env.test (needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY).\n')
  process.exit(1)
}
const run = (label, script, extra = '') => {
  console.log(`\n\x1b[1m── ${label} ──\x1b[0m`)
  const r = spawnSync(`node --env-file=.env.test scripts/${script} ${APPLY ? '--apply' : ''} ${extra}`,
    { shell: true, stdio: 'inherit' })
  if (r.status !== 0) { console.error(`\n${label}: FAILED\n`); process.exit(1) }
}

if (VERIFY) {
  console.log('\n\x1b[36mVERIFY ONLY - checks every row against Storage, writes nothing\x1b[0m')
  run('Image storage report', 'analyze-images.mjs')
  run('Storage verification', 'backfill-images.mjs', '--verify')
  console.log('\n\x1b[2mNothing was changed. If every row reports a file present and non-empty,'
    + '\nthe destructive step is safe: npm run cleanup -- --apply --clear\x1b[0m\n')
  process.exit(0)
}

console.log(APPLY ? '\n\x1b[32mAPPLY mode - changes will be written\x1b[0m' : '\n\x1b[33mDRY RUN - nothing will change\x1b[0m')
run('Image storage report', 'analyze-images.mjs')
run('Move images to Storage (phase 1 - non-destructive)', 'backfill-images.mjs', '--phase=1')
run('Unit pricing on existing receipts', 'backfill-units.mjs')

if (CLEAR) {
  console.log('\n\x1b[31mPhase 2 - clearing base64 from the rows. Each row is verified against Storage first; anything unverifiable keeps its image.\x1b[0m')
  run('Clear base64 from the DB (destructive)', 'backfill-images.mjs', '--phase=2')
} else {
  console.log('\n\x1b[2mPhase 2 (clearing base64) did not run.'
    + '\nCheck it is safe first:  npm run cleanup -- --verify'
    + '\nThen clear:              npm run cleanup -- --apply --clear\x1b[0m')
}
console.log(APPLY ? '\n\x1b[32mDone.\x1b[0m\n' : '\n\x1b[2mThat was a dry run. To execute: npm run cleanup -- --apply\x1b[0m\n')
