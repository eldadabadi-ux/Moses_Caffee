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
const MAIN = 'master'

const c = { g: (s) => `\x1b[32m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`,
            y: (s) => `\x1b[33m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m`,
            d: (s) => `\x1b[2m${s}\x1b[0m` }

const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim()

/** Turn a wall of test output into the one line that explains the failure. */
function diagnose(out) {
  if (/Host not in allowlist|ENOTFOUND|EAI_AGAIN|fetch failed|ECONNREFUSED/i.test(out))
    return 'Could not reach Supabase. Check your connection and .env.test - this is not a code problem.'
  if (/PENDING|pending,/.test(out))
    return 'A database migration has not been applied yet. Run it in the Supabase SQL editor,'
         + '\n      then: npm run migrations -- --mark=<file>.sql'
  if (/Missing SUPABASE|SUPABASE_SERVICE_ROLE_KEY/i.test(out))
    return 'Missing environment variables in .env.test (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).'
  const fails = out.split('\n').filter(l => /^not ok /.test(l.trim())).slice(0, 8)
  if (fails.length) return 'Failing tests:\n' + fails.map(l => '      ' + l.trim()).join('\n')
  return null
}

function step(label, cmd) {
  process.stdout.write(`  ${label} … `)
  const r = spawnSync(cmd, { shell: true, stdio: 'pipe', encoding: 'utf8' })
  if (r.status !== 0) {
    console.log(c.r('FAILED'))
    const out = (r.stdout || '') + (r.stderr || '')
    const why = diagnose(out)
    if (why) console.log('\n    ' + c.y(why) + '\n')
    else console.log(c.d(out.slice(-1500)))
    console.log(c.d('    (nothing was pushed - fix it and run again: npm run ship)'))
    process.exit(1)
  }
  console.log(c.g('✓'))
  return r.stdout || ''
}
const die = (msg) => { console.error('\n' + c.r('עצירה: ') + msg + '\n'); process.exit(1) }

console.log('\n' + c.b('Moses Caffee - release') + '\n')

// ── 1. preconditions ─────────────────────────────────────────────────────────
if (sh('git status --porcelain')) die('Working tree has uncommitted changes. Commit or stash them first.')

// Release whatever branch you are standing on. Already on master means there
// are unpushed commits to send straight out; anything else gets merged first.
const BRANCH = sh('git rev-parse --abbrev-ref HEAD')
const onMain = BRANCH === MAIN

sh(`git fetch origin ${MAIN}`)
const range = onMain ? `origin/${MAIN}..${MAIN}` : `${MAIN}..${BRANCH}`
const commits = sh(`git log --oneline ${range}`).split('\n').filter(Boolean)
if (!commits.length) {
  die(onMain
    ? `Nothing to push - ${MAIN} matches origin/${MAIN}.`
    : `Nothing new on ${BRANCH} compared to ${MAIN}.`)
}

// ── 2. checks ────────────────────────────────────────────────────────────────
console.log(c.b('Checks'))
step('unit tests        ', 'npm run test:unit')

if (existsSync('.env.test')) {
  // A pending migration is an outage that no test catches: the tests pass
  // against a database where someone happened to run the SQL by hand.
  step('migrations        ', 'npm run migrations -- --check')
  step('security tests    ', 'npm run test:security')
} else {
  console.log('  ' + c.y('migrations         - skipped (no .env.test)'))
  console.log('  ' + c.y('security tests     - skipped (no .env.test)'))
}

step('build             ', 'npm run build')

// ── 3. plan ──────────────────────────────────────────────────────────────────
console.log('\n' + c.b('What happens next'))
console.log(onMain
  ? `  ${commits.length} commits on ${c.b(MAIN)} get pushed:`
  : `  ${commits.length} commits move from ${c.b(BRANCH)} to ${c.b(MAIN)} and get pushed:`)
for (const l of commits.reverse()) console.log(c.d('    ' + l))
console.log(`\n  Pushing to ${MAIN} triggers GitHub Actions, which builds and deploys to Cloudflare Pages.`)
console.log(c.d('  (nothing here talks to Cloudflare directly - no wrangler login needed)'))

if (!YES) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const ans = (await rl.question('\n  Proceed? (yes/no) ')).trim().toLowerCase()
  rl.close()
  if (ans !== 'yes' && ans !== 'y') die('Cancelled. Nothing was pushed.')
}

// ── 4. merge + push ──────────────────────────────────────────────────────────
console.log('\n' + c.b('Releasing'))
if (!onMain) {
  step(`checkout ${MAIN}   `, `git checkout ${MAIN}`)
  step('sync with origin  ', `git merge --ff-only origin/${MAIN}`)
  step('merge branch      ', `git merge --no-ff ${BRANCH} -m "Merge ${BRANCH}"`)
}
step('push              ', `git push origin ${MAIN}`)

const remote = sh('git remote get-url origin')
console.log('\n' + c.g(c.b('  Pushed. ')) + 'The deploy is running in GitHub Actions now.\n')
if (/github\.com/.test(remote)) {
  const repo = remote.replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, '')
  console.log('  Watch the deploy:')
  console.log(c.d(`    ${repo}/actions`))
}
console.log('\n  ' + c.b('Once the deploy finishes (about 2 minutes):'))
console.log('    1. Open the app and hard-refresh (Ctrl+Shift+R)')
console.log('    2. Go to Suppliers -> Merge suppliers and approve the grouping')
console.log('    3. Optional data cleanup: ' + c.b('npm run cleanup') + '\n')
