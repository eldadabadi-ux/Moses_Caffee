/**
 * migrations — know which supabase_*.sql files have actually been applied.
 *
 *   npm run migrations              # status: applied / pending / changed-since-applied
 *   npm run migrations -- --mark=supabase_foo.sql
 *                                   # record a file as applied (after running it)
 *   npm run migrations -- --check   # exit non-zero if anything is pending (used by ship)
 *   npm run migrations -- --baseline
 *                                   # one-off: record every file currently on disk
 *                                   # as applied, for a database that predates this
 *                                   # ledger
 *
 * WHY: the repo carries ~15 loose SQL files and the only record of which had
 * been run was memory. The July audit caught one result of that —
 * supabase/migrations/20260609_multi_tenant.sql was never applied and references
 * tables that do not exist. Shipping code whose migration is still pending is an
 * outage that no test catches, because the tests run against a database where
 * someone happened to run it.
 *
 * This deliberately does NOT execute SQL. Applying DDL needs a privileged
 * connection; exposing an RPC that runs arbitrary SQL would be a much worse hole
 * than the problem it solves. Run the file in the Supabase SQL editor (or via
 * the Supabase CLI), then mark it here.
 */
import { readdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !SERVICE) { console.error('\nMissing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (.env.test).\n'); process.exit(1) }
const sb = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })

const arg = (n) => { const h = process.argv.find(a => a.startsWith(`--${n}=`)); return h ? h.split('=').slice(1).join('=') : null }
const CHECK = process.argv.includes('--check')
const c = { g: s => `\x1b[32m${s}\x1b[0m`, r: s => `\x1b[31m${s}\x1b[0m`,
            y: s => `\x1b[33m${s}\x1b[0m`, b: s => `\x1b[1m${s}\x1b[0m`, d: s => `\x1b[2m${s}\x1b[0m` }

const sha = (t) => createHash('sha256').update(t, 'utf8').digest('hex').slice(0, 16)

async function localFiles() {
  const names = (await readdir('.')).filter(f => /^supabase_.*\.sql$/.test(f)).sort()
  const out = []
  for (const name of names) out.push({ name, sha: sha(await readFile(name, 'utf8')) })
  return out
}

async function ledger() {
  const { data, error } = await sb.from('schema_migrations').select('name, sha256, applied_at, note')
  if (error) { console.error(c.r(`\nCannot read schema_migrations: ${error.message}\n`)); process.exit(1) }
  return Object.fromEntries((data || []).map(r => [r.name, r]))
}

// ── mark one file as applied ─────────────────────────────────────────────────
const mark = arg('mark')
if (mark) {
  const files = await localFiles()
  const f = files.find(x => x.name === mark)
  if (!f) { console.error(c.r(`\nNo such migration file: ${mark}\n`)); process.exit(1) }
  const { error } = await sb.from('schema_migrations')
    .upsert({ name: f.name, sha256: f.sha, applied_by: 'migrations.mjs', note: arg('note') || null },
            { onConflict: 'name' })
  if (error) { console.error(c.r(`\nFailed to record: ${error.message}\n`)); process.exit(1) }
  console.log(c.g(`\nrecorded ${f.name} as applied (${f.sha})\n`))
  process.exit(0)
}

// ── baseline an existing database ────────────────────────────────────────────
// Standard first step for a database that predates the ledger: this DB is
// already in the state these files produce, so record them and start tracking
// from here. It asserts nothing about files added later.
if (process.argv.includes('--baseline')) {
  const files = await localFiles()
  const applied = await ledger()
  const todo = files.filter(f => !applied[f.name])
  if (!todo.length) { console.log(c.g('\nNothing to baseline — every file is already recorded.\n')); process.exit(0) }

  console.log(c.y(`\nBaselining ${todo.length} file(s) as already applied:`))
  for (const f of todo) console.log(`  ${f.name}`)
  console.log(c.d('\nThis records them; it does not run them. Only do this when the database'
    + '\nis genuinely already in the state these files produce.\n'))

  const { error } = await sb.from('schema_migrations').upsert(
    todo.map(f => ({ name: f.name, sha256: f.sha, applied_by: 'baseline', note: 'pre-existing database' })),
    { onConflict: 'name' })
  if (error) { console.error(c.r(`\nFailed: ${error.message}\n`)); process.exit(1) }
  console.log(c.g(`recorded ${todo.length} file(s)\n`))
  process.exit(0)
}

// ── status ───────────────────────────────────────────────────────────────────
const files = await localFiles()
const applied = await ledger()

const pending = [], drifted = [], ok = []
for (const f of files) {
  const rec = applied[f.name]
  if (!rec) pending.push(f)
  else if (rec.sha256 !== f.sha) drifted.push({ ...f, appliedAt: rec.applied_at })
  else ok.push(f)
}

console.log(c.b(`\nMigrations — ${files.length} file(s)\n`))
for (const f of ok) console.log(`  ${c.g('applied')}  ${f.name}`)
for (const f of drifted) console.log(`  ${c.y('CHANGED')}  ${f.name}  ${c.d(`— edited since it was applied (${String(f.appliedAt).slice(0, 10)})`)}`)
for (const f of pending) console.log(`  ${c.r('PENDING')}  ${f.name}`)

// A file recorded in the ledger but no longer on disk is worth knowing about too.
const orphans = Object.keys(applied).filter(n => !files.some(f => f.name === n))
for (const n of orphans) console.log(`  ${c.d('orphan ')}  ${n}  ${c.d('— recorded as applied but no longer in the repo')}`)

if (pending.length || drifted.length) {
  console.log(c.y(`\n${pending.length} pending, ${drifted.length} changed since applied.`))
  console.log('Run the file in the Supabase SQL editor, then record it:')
  for (const f of [...pending, ...drifted]) console.log(c.d(`  npm run migrations -- --mark=${f.name}`))
  console.log()
  if (CHECK) process.exit(1)
} else {
  console.log(c.g('\nEverything on disk has been applied to this database.\n'))
}
