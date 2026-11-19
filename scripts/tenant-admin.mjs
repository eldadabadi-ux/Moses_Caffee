/**
 * tenant-admin — export or purge ONE customer's tenant, end to end.
 *
 * Written 19.11.26 for the café client's clean restart, and kept as the
 * offboarding tool: the in-app account deletion leaves rows behind in several
 * tables (compliance finding H2, frozen until the reviewers sign off), and it
 * needs the customer's own session, which an operator does not have.
 *
 *   node scripts/tenant-admin.mjs export <email> <outDir>
 *   node scripts/tenant-admin.mjs purge  <email> --confirm
 *
 * export  writes one JSON per table plus every scanned file from storage, so
 *         the business keeps its accounting material after the wipe.
 * purge   deletes storage objects, then rows, then memberships, then the org
 *         (only when this user is its sole member), then the auth user.
 *
 * Service role from .env.test — the same provisioning pattern the E2E and QA
 * scripts use. It prints COUNTS, never customer data.
 */
import '../tests/integration/_env.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!(URL && SERVICE)) { console.error('env not set — needs .env.test'); process.exit(1) }
const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })

// Tables keyed by the owning user. organizations/memberships are handled apart
// (shared rows), and schema_migrations/client_accounts/feature_flags are
// platform tables that no customer owns.
const USER_TABLES = ['receipts', 'suppliers', 'supplier_aliases', 'supplier_budgets', 'categories', 'user_settings', 'event_quotes', 'audit_log']
const BUCKET = 'receipts'

const [cmd, email, arg3] = process.argv.slice(2)
if (!cmd || !email) {
  console.error('usage: tenant-admin.mjs export <email> <outDir> | purge <email> --confirm')
  process.exit(1)
}

/**
 * Resolve the auth user by email. A masked address ("mk***@gmail.com") is
 * accepted so an operator can name the account without the full address being
 * typed into a terminal or a transcript; it must match exactly one user.
 */
async function findUser(mail) {
  const users = []
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error('listUsers: ' + error.message)
    users.push(...(data?.users || []))
    if ((data?.users || []).length < 200) break
  }
  const want = mail.toLowerCase()
  if (!want.includes('*')) return users.find(u => (u.email || '').toLowerCase() === want) || null
  const [pre, post] = want.split(/\*+/)
  const hits = users.filter(u => {
    const e = (u.email || '').toLowerCase()
    return e.startsWith(pre) && e.endsWith(post)
  })
  if (hits.length > 1) throw new Error(`the pattern matches ${hits.length} users — give the full address`)
  return hits[0] || null
}

async function rowsOf(table, uid) {
  const { data, error } = await admin.from(table).select('*').eq('user_id', uid)
  if (error) {
    if (/column .*user_id.* does not exist/i.test(error.message)) return null   // not a per-user table here
    throw new Error(`${table}: ${error.message}`)
  }
  return data || []
}

async function storagePaths(uid) {
  // Receipts carry their own storage_path — the authoritative list of files.
  const { data, error } = await admin.from('receipts').select('storage_path').eq('user_id', uid).not('storage_path', 'is', null)
  if (error) throw new Error('storage_path lookup: ' + error.message)
  return [...new Set((data || []).map(r => r.storage_path).filter(Boolean))]
}

async function doExport() {
  const outDir = arg3
  if (!outDir) { console.error('export needs an output directory'); process.exit(1) }
  const user = await findUser(email)
  if (!user) { console.error('no such user'); process.exit(1) }
  mkdirSync(outDir, { recursive: true })
  mkdirSync(join(outDir, 'files'), { recursive: true })

  const summary = { exported_at: new Date().toISOString(), user_id: user.id, email, tables: {}, files: 0 }
  for (const t of USER_TABLES) {
    const rows = await rowsOf(t, user.id)
    if (rows === null) continue
    writeFileSync(join(outDir, `${t}.json`), JSON.stringify(rows, null, 2), 'utf8')
    summary.tables[t] = rows.length
    console.log(`  ${t.padEnd(18)} ${rows.length}`)
  }
  const { data: mem } = await admin.from('memberships').select('*').eq('user_id', user.id)
  writeFileSync(join(outDir, 'memberships.json'), JSON.stringify(mem || [], null, 2), 'utf8')
  const orgIds = [...new Set((mem || []).map(m => m.org_id).filter(Boolean))]
  if (orgIds.length) {
    const { data: orgs } = await admin.from('organizations').select('*').in('id', orgIds)
    writeFileSync(join(outDir, 'organizations.json'), JSON.stringify(orgs || [], null, 2), 'utf8')
  }

  const paths = await storagePaths(user.id)
  for (const p of paths) {
    const { data, error } = await admin.storage.from(BUCKET).download(p)
    if (error || !data) { console.warn(`  ! file missing: ${p.slice(0, 40)}…`); continue }
    const safe = p.replace(/[\\/:*?"<>|]/g, '_')
    writeFileSync(join(outDir, 'files', safe), Buffer.from(await data.arrayBuffer()))
    summary.files++
  }
  writeFileSync(join(outDir, '_summary.json'), JSON.stringify(summary, null, 2), 'utf8')
  console.log(`\nexported ${summary.files}/${paths.length} files → ${outDir}`)
}

async function doPurge() {
  if (arg3 !== '--confirm') { console.error('refusing to purge without --confirm'); process.exit(1) }
  const user = await findUser(email)
  if (!user) { console.error('no such user'); process.exit(1) }
  const uid = user.id
  console.log(`purging ${email} (${uid})`)

  const paths = await storagePaths(uid)
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100)
    const { error } = await admin.storage.from(BUCKET).remove(batch)
    if (error) console.warn('  ! storage batch failed: ' + error.message)
  }
  console.log(`  storage           ${paths.length} files removed`)

  for (const t of USER_TABLES) {
    const { error, count } = await admin.from(t).delete({ count: 'exact' }).eq('user_id', uid)
    if (error) { console.warn(`  ! ${t}: ${error.message}`); continue }
    console.log(`  ${t.padEnd(18)} ${count ?? 0} rows deleted`)
  }

  const { data: mem } = await admin.from('memberships').select('org_id').eq('user_id', uid)
  const orgIds = [...new Set((mem || []).map(m => m.org_id).filter(Boolean))]
  await admin.from('memberships').delete().eq('user_id', uid)
  for (const orgId of orgIds) {
    // Only drop an organization nobody else belongs to — a shared tenant must
    // survive one member leaving.
    const { count } = await admin.from('memberships').select('user_id', { count: 'exact', head: true }).eq('org_id', orgId)
    if ((count ?? 0) > 0) { console.log(`  org ${orgId} kept (${count} other members)`); continue }
    await admin.from('feature_flags').delete().eq('org_id', orgId)
    await admin.from('client_accounts').delete().eq('org_id', orgId)
    const { error } = await admin.from('organizations').delete().eq('id', orgId)
    console.log(`  org ${orgId} ${error ? 'FAILED: ' + error.message : 'deleted'}`)
  }

  const { error: ue } = await admin.auth.admin.deleteUser(uid)
  console.log(`  auth user         ${ue ? 'FAILED: ' + ue.message : 'deleted'}`)
  console.log('\npurge complete')
}

if (cmd === 'export') await doExport()
else if (cmd === 'purge') await doPurge()
else { console.error('unknown command'); process.exit(1) }
