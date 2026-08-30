/**
 * ship — take the current work live, safely, in one command.
 *
 *   npm run ship
 *
 * What it does, stopping at the first failure:
 *   1. refuses to run on a dirty working tree
 *   2. runs the unit tests (no network needed)
 *   3. runs the RLS security tests (needs Supabase — skipped with a warning if
 *      .env.test is missing)
 *   4. builds, so a broken build is caught here and not in CI
 *   5. merges the feature branch into master and pushes
 *
 * The push is what deploys: .github/workflows/deploy.yml builds and publishes to
 * Cloudflare Pages on every push to master. Nothing here talks to Cloudflare
 * directly, so no local wrangler login is needed.
 *
 * Nothing is merged or pushed until every check above has passed, and the plan
 * is printed for confirmation first (skip with --yes).
 */
import { execSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'

const YES = process.argv.includes('--yes')
const BRANCH = 'feat/phase0-c1-and-quickfixes'
const MAIN = 'master'

const c = { g: (s) => `\x1b[32m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`,
            y: (s) => `\x1b[33m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m`,
            d: (s) => `\x1b[2m${s}\x1b[0m` }

const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim()

/** Turn a wall of test output into the one line that explains the failure. */
function diagnose(out) {
  if (/Host not in allowlist|ENOTFOUND|EAI_AGAIN|fetch failed|ECONNREFUSED/i.test(out))
    return 'לא הצלחתי להגיע ל-Supabase. בדוק חיבור אינטרנט ואת .env.test — זו לא בעיה בקוד.'
  if (/Missing SUPABASE|SUPABASE_SERVICE_ROLE_KEY/i.test(out))
    return 'חסרים משתני סביבה ב-.env.test (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).'
  const fails = out.split('\n').filter(l => /^not ok /.test(l.trim())).slice(0, 8)
  if (fails.length) return 'בדיקות שנכשלו:\n' + fails.map(l => '      ' + l.trim()).join('\n')
  return null
}

function step(label, cmd) {
  process.stdout.write(`  ${label} … `)
  const r = spawnSync(cmd, { shell: true, stdio: 'pipe', encoding: 'utf8' })
  if (r.status !== 0) {
    console.log(c.r('נכשל'))
    const out = (r.stdout || '') + (r.stderr || '')
    const why = diagnose(out)
    if (why) console.log('\n    ' + c.y(why) + '\n')
    else console.log(c.d(out.slice(-1500)))
    console.log(c.d('    (שום דבר לא נדחף — תקן והרץ שוב: npm run ship)'))
    process.exit(1)
  }
  console.log(c.g('✓'))
  return r.stdout || ''
}
const die = (msg) => { console.error('\n' + c.r('עצירה: ') + msg + '\n'); process.exit(1) }

console.log('\n' + c.b('שחרור לאוויר — Moses Caffee') + '\n')

// ── 1. preconditions ─────────────────────────────────────────────────────────
if (sh('git status --porcelain')) die('יש שינויים לא שמורים. עשה commit או stash קודם.')

const current = sh('git rev-parse --abbrev-ref HEAD')
if (current !== BRANCH) {
  console.log(c.y(`  אתה על "${current}" — עובר ל-"${BRANCH}"`))
  step('מעבר לענף', `git checkout ${BRANCH}`)
}

const commits = sh(`git log --oneline ${MAIN}..${BRANCH}`).split('\n').filter(Boolean)
if (!commits.length) die(`אין שום דבר חדש ב-${BRANCH} מעל ${MAIN}.`)

// ── 2. checks ────────────────────────────────────────────────────────────────
console.log(c.b('בדיקות'))
step('בדיקות יחידה', 'npm run test:unit')

if (existsSync('.env.test')) {
  step('בדיקות אבטחה (RLS)', 'npm run test:security')
} else {
  console.log('  ' + c.y('בדיקות אבטחה — דולג (אין .env.test)'))
}

step('בנייה', 'npm run build')

// ── 3. plan ──────────────────────────────────────────────────────────────────
console.log('\n' + c.b('מה יקרה עכשיו'))
console.log(`  ${commits.length} קומיטים יעברו מ-${c.b(BRANCH)} ל-${c.b(MAIN)} וידחפו ל-GitHub:`)
for (const l of commits.reverse()) console.log(c.d('    ' + l))
console.log(`\n  הדחיפה ל-${MAIN} מפעילה את GitHub Actions, שבונה ופורס ל-Cloudflare Pages.`)
console.log(c.d('  (אף שלב כאן לא מדבר ישירות עם Cloudflare — אין צורך ב-wrangler login)'))

if (!YES) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const ans = (await rl.question('\n  להמשיך? (yes/no) ')).trim().toLowerCase()
  rl.close()
  if (ans !== 'yes' && ans !== 'y') die('בוטל לבקשתך. שום דבר לא נדחף.')
}

// ── 4. merge + push ──────────────────────────────────────────────────────────
console.log('\n' + c.b('שחרור'))
step('משיכת עדכונים', `git fetch origin ${MAIN}`)
step(`מעבר ל-${MAIN}`, `git checkout ${MAIN}`)
step('סנכרון עם origin', `git merge --ff-only origin/${MAIN}`)
step('מיזוג הענף', `git merge --no-ff ${BRANCH} -m "Merge ${BRANCH}: supplier identity, units, bot tools, events book"`)
step('דחיפה', `git push origin ${MAIN}`)

const remote = sh('git remote get-url origin')
console.log('\n' + c.g(c.b('  הכל נדחף. ')) + 'הפריסה רצה עכשיו ב-GitHub Actions.\n')
if (/github\.com/.test(remote)) {
  const repo = remote.replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, '')
  console.log('  מעקב אחרי הפריסה:')
  console.log(c.d(`    ${repo}/actions`))
}
console.log('\n  ' + c.b('אחרי שהפריסה מסתיימת (בערך 2 דקות):'))
console.log('    1. פתח את האפליקציה ורענן (Ctrl+Shift+R)')
console.log('    2. היכנס ל־' + c.b('ספקים ← איחוד ספקים') + ' ואשר את הקיבוץ')
console.log('    3. אופציונלי — ניקוי נתונים ברקע: ' + c.b('npm run cleanup') + '\n')
