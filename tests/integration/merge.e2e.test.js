/**
 * merge.e2e — end-to-end supplier-merge against a LIVE deployment, exactly as a
 * user drives it: provision a throwaway tenant with duplicate supplier rows +
 * receipts, sign in, call GET then POST /api/suppliers/merge over HTTP, and
 * assert the DB end state. Two scenarios:
 *   - all:    every spelling picked → the 3 rows collapse to 1 supplier
 *   - untick: a review-band spelling left unticked → it stays its own supplier
 *             (proves unchecking excludes it from relinking AND folding)
 *
 * ⚠️  Runs against the LIVE site + LIVE Supabase (synthetic PENTEST_* fixtures,
 *     always torn down). Target host via MERGE_SITE (default moses-caffee).
 * Run:  npm run test:merge    (needs .env.test; skips cleanly without it)
 */
import './_env.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'

const SITE = process.env.MERGE_SITE || 'https://moses-caffee.pages.dev'
const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!(URL && ANON && SERVICE)) {
  test('supplier-merge E2E', { skip: 'env not set — see tests/security/README.md' }, () => {})
} else {
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
  // Counts make the canonical deterministic: the dominant spelling (×4) is always
  // chosen as canonical, so the typo variant we untick is reliably a non-canonical
  // review row. (Equal counts leave the canonical choice to an unstable tie-break.)
  const CANON = 'מידן סחר בעמ', MEMBER = 'מידן סחר', DUP = 'מיזן סחר בעמ'
  const SEED = [[CANON, 4], [MEMBER, 2], [DUP, 2]]

  async function provision() {
    const RUN = Math.random().toString(36).slice(2, 8)
    const email = `pentest_merge_${RUN}@moses-test.local`, PW = `Pentest!${RUN}Xz9`
    const { data: u, error: ue } = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true })
    if (ue) throw new Error('createUser: ' + ue.message)
    const uid = u.user.id
    const { data: org } = await admin.from('organizations').insert({ name: `PENTEST merge ${RUN}`, owner_id: uid }).select('id').single()
    await admin.from('memberships').insert({ org_id: org.id, user_id: uid, role: 'owner' })
    const supByName = {}
    for (const [name, count] of SEED) {
      const { data: s } = await admin.from('suppliers').insert({ user_id: uid, org_id: org.id, name }).select('id').single()
      supByName[name] = s.id
      for (let i = 0; i < count; i++) {
        await admin.from('receipts').insert({ user_id: uid, org_id: org.id, supplier_id: s.id, vendor_name: name, amount: 10, currency: 'ILS', receipt_date: '2026-11-01', category_text: 'PENTEST' })
      }
    }
    const sb = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: sess, error: le } = await sb.auth.signInWithPassword({ email, password: PW })
    if (le) throw new Error('signIn: ' + le.message)
    return { uid, orgId: org.id, token: sess.session.access_token, supByName }
  }
  async function destroy(t) {
    if (!t) return
    for (const tbl of ['receipts', 'supplier_aliases', 'suppliers', 'memberships']) { try { await admin.from(tbl).delete().eq('user_id', t.uid) } catch {} }
    try { await admin.from('organizations').delete().eq('id', t.orgId) } catch {}
    try { await admin.auth.admin.deleteUser(t.uid) } catch {}
  }
  const api = (token, body) => fetch(`${SITE}/api/suppliers/merge`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  // Mirror the client's buildMergeGroups: picked spellings drive aliases + stored.
  async function mergeAll(token, pick) {
    const preview = await (await api(token)).json()
    const clusters = (preview.clusters || []).filter(c => !c.junk)
    let queue = clusters.map(c => {
      const picked = [...c.members, ...c.review].filter(m => pick(c, m))
      return { canonical: c.canonical, supplier_id: c.existing_supplier?.id || undefined,
        aliases: picked.map(m => m.name),
        stored: [...new Set(picked.flatMap(m => (m.stored?.length ? m.stored : [m.name])))] }
    })
    let guard = 0
    while (queue.length && guard++ < 20) {
      const r = await (await api(token, { groups: queue })).json()
      const rem = r.remaining || []
      if (rem.length >= queue.length) break
      queue = queue.filter(g => rem.includes(g.canonical))
    }
  }

  test('all spellings picked → 3 duplicate suppliers collapse to 1', async () => {
    const t = await provision()
    try {
      await mergeAll(t.token, () => true)
      const sups = (await admin.from('suppliers').select('id,merged_into').eq('user_id', t.uid)).data || []
      const recs = (await admin.from('receipts').select('supplier_id').eq('user_id', t.uid)).data || []
      assert.equal(sups.filter(s => !s.merged_into).length, 1, 'should be exactly one active supplier')
      assert.equal(new Set(recs.map(r => r.supplier_id)).size, 1, 'all receipts on one supplier')
    } finally { await destroy(t) }
  })

  test('unticking the DUP spelling keeps it a separate supplier', async () => {
    const t = await provision()
    try {
      // DUP is deterministically a non-canonical review row (CANON has more receipts).
      await mergeAll(t.token, (_c, m) => m.name !== DUP)
      const sups = (await admin.from('suppliers').select('id,merged_into').eq('user_id', t.uid)).data || []
      const recs = (await admin.from('receipts').select('supplier_id').eq('user_id', t.uid)).data || []
      const dupId = t.supByName[DUP]
      assert.equal(sups.filter(s => !s.merged_into).length, 2, 'two active: the merged CANON, and the untouched DUP')
      assert.ok(sups.find(s => s.id === dupId && !s.merged_into), 'DUP supplier is still active')
      assert.equal(recs.filter(r => r.supplier_id === dupId).length, 2, 'DUP keeps its own receipts')
    } finally { await destroy(t) }
  })
}
