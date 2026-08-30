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
 * destructive step. Phase 2 is skipped unless --clear is passed.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const APPLY = process.argv.includes('--apply')
const CLEAR = process.argv.includes('--clear')
if (!existsSync('.env.test')) {
  console.error('\nחסר .env.test (צריך SUPABASE_URL ו-SUPABASE_SERVICE_ROLE_KEY).\n')
  process.exit(1)
}
const run = (label, script, extra = '') => {
  console.log(`\n\x1b[1m── ${label} ──\x1b[0m`)
  const r = spawnSync(`node --env-file=.env.test scripts/${script} ${APPLY ? '--apply' : ''} ${extra}`,
    { shell: true, stdio: 'inherit' })
  if (r.status !== 0) { console.error(`\n${label}: נכשל\n`); process.exit(1) }
}

console.log(APPLY ? '\n\x1b[32mמצב ביצוע\x1b[0m' : '\n\x1b[33mהרצה יבשה — שום דבר לא ישתנה\x1b[0m')
run('דו"ח מצב תמונות', 'analyze-images.mjs')
run('העברת תמונות ל-Storage (שלב 1 — לא הרסני)', 'backfill-images.mjs', '--phase=1')
run('יחידות מידה על קבלות קיימות', 'backfill-units.mjs')

if (CLEAR) {
  console.log('\n\x1b[31mשלב 2 — מחיקת ה-base64 מהשורות. הרץ רק אחרי שאימתת שהתמונות נטענות באפליקציה.\x1b[0m')
  run('ניקוי base64 מה-DB (הרסני)', 'backfill-images.mjs', '--phase=2')
} else {
  console.log('\n\x1b[2mשלב 2 (מחיקת ה-base64) לא רץ. אחרי שתאמת שהתמונות נטענות: npm run cleanup -- --apply --clear\x1b[0m')
}
console.log(APPLY ? '\n\x1b[32mהסתיים.\x1b[0m\n' : '\n\x1b[2mזו הייתה הרצה יבשה. לביצוע: npm run cleanup -- --apply\x1b[0m\n')
