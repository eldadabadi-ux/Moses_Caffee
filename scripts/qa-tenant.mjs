/**
 * qa-tenant — provision (and destroy) a throwaway, data-rich tenant for VISUAL
 * QA of the UI, reusing the pentest/E2E provisioning pattern (service role from
 * .env.test, synthetic user, explicit org scoping on every row).
 *
 * Unlike the E2E fixtures this one seeds a believable café: several suppliers,
 * two years of receipts across months, line items with units (so the dashboard
 * drill-down, product comparison and insights all have something to show).
 *
 *   node scripts/qa-tenant.mjs provision <out.json>   # creates + writes session file
 *   node scripts/qa-tenant.mjs destroy   <out.json>   # removes everything it created
 *
 * The out.json carries the browser localStorage key + session object, so a dev
 * tab can be signed in by injecting it — no password typing involved.
 * ⚠️ Synthetic tenants on the LIVE Supabase — always destroy when done.
 */
import '../tests/integration/_env.js'
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!(URL && ANON && SERVICE)) { console.error('env not set — needs .env.test'); process.exit(1) }

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
const [cmd, outPath] = process.argv.slice(2)
if (!cmd || !outPath) { console.error('usage: qa-tenant.mjs provision|destroy <file.json>'); process.exit(1) }

// ── Seed shape: suppliers + per-month receipts with unit-priced line items ────
const SUPPLIERS = ['תנובה שיווק', 'קפה העולם בע"מ', 'מחסני השוק', 'שטראוס מים']
// [vendor, category_text, items]; חלב/פולי קפה bought from TWO suppliers at
// different ₪/unit so the product comparison + savings insights light up.
const BASKETS = [
  ['תנובה שיווק', 'מוצרי מזון ומכולת', [
    { item_name: 'חלב 3%', quantity: 12, unit: 'ליטר', price: 78, category_l1: 'מוצרי מזון ומכולת', category_l2: 'מוצרי חלב' },
    { item_name: 'גבינה לבנה', quantity: 4, unit: 'ק"ג', price: 92, category_l1: 'מוצרי מזון ומכולת', category_l2: 'מוצרי חלב' },
  ]],
  ['מחסני השוק', 'מוצרי מזון ומכולת', [
    { item_name: 'חלב 3%', quantity: 10, unit: 'ליטר', price: 79, category_l1: 'מוצרי מזון ומכולת', category_l2: 'מוצרי חלב' },
    { item_name: 'סוכר', quantity: 5, unit: 'ק"ג', price: 30, category_l1: 'מוצרי מזון ומכולת', category_l2: 'יבשים' },
  ]],
  ['קפה העולם בע"מ', 'קפה ותה', [
    { item_name: 'פולי קפה אספרסו', quantity: 3, unit: 'ק"ג', price: 255, category_l1: 'קפה ותה', category_l2: 'פולי קפה' },
  ]],
  ['מחסני השוק', 'קפה ותה', [
    { item_name: 'פולי קפה אספרסו', quantity: 2, unit: 'ק"ג', price: 196, category_l1: 'קפה ותה', category_l2: 'פולי קפה' },
  ]],
  ['שטראוס מים', 'שתייה', [
    { item_name: 'מים מינרליים', quantity: 24, unit: 'יח\'', price: 68, category_l1: 'שתייה', category_l2: 'מים' },
  ]],
]

async function provision() {
  const RUN = Math.random().toString(36).slice(2, 8)
  const email = `qa_ui_${RUN}@moses-test.local`, PW = `QaUi!${RUN}Xz9`
  const { data: u, error: ue } = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true })
  if (ue) throw new Error('createUser: ' + ue.message)
  const uid = u.user.id
  const { data: org, error: oe } = await admin.from('organizations').insert({ name: `QA UI ${RUN}`, owner_id: uid }).select('id').single()
  if (oe) throw new Error('org: ' + oe.message)
  await admin.from('memberships').insert({ org_id: org.id, user_id: uid, role: 'owner' })

  const supByName = {}
  for (const name of SUPPLIERS) {
    const { data: s, error: se } = await admin.from('suppliers').insert({ user_id: uid, org_id: org.id, name }).select('id').single()
    if (se) throw new Error('supplier: ' + se.message)
    supByName[name] = s.id
  }

  // Two years of receipts, a few per month, amounts varied by a deterministic
  // wobble so the monthly chart isn't a flat line.
  const rows = []
  let n = 0
  for (const year of [2025, 2026]) {
    const months = year === 2026 ? 11 : 12
    for (let m = 1; m <= months; m++) {
      for (const [vendor, cat, items] of BASKETS) {
        n++
        if (n % 3 === 0 && year === 2025) continue            // thinner back-year
        const base = items.reduce((s, it) => s + it.price, 0)
        const wobble = 1 + (((m * 7 + n) % 10) - 5) / 25      // ±20%
        const amount = Math.round(base * wobble * 1.18 * 100) / 100
        rows.push({
          user_id: uid, org_id: org.id, book: 'cafe',
          supplier_id: supByName[vendor], vendor_name: vendor,
          amount, amount_before_vat: Math.round(amount / 1.18 * 100) / 100,
          currency: 'ILS',
          receipt_date: `${year}-${String(m).padStart(2, '0')}-${String(3 + (n % 24)).padStart(2, '0')}`,
          category_text: cat,
          items: items.map(it => ({ ...it, price: Math.round(it.price * wobble * 100) / 100 })),
        })
      }
    }
  }
  for (let i = 0; i < rows.length; i += 50) {
    const { error: re } = await admin.from('receipts').insert(rows.slice(i, i + 50))
    if (re) throw new Error('receipts: ' + re.message)
  }

  const sb = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: sess, error: le } = await sb.auth.signInWithPassword({ email, password: PW })
  if (le) throw new Error('signIn: ' + le.message)

  const ref = new globalThis.URL(URL).hostname.split('.')[0]
  const out = {
    uid, orgId: org.id, email,
    storageKey: `sb-${ref}-auth-token`,
    session: sess.session,
    receipts: rows.length,
  }
  writeFileSync(outPath, JSON.stringify(out, null, 2))
  console.log(`provisioned ${email} (uid ${uid}, org ${org.id}) — ${rows.length} receipts, session → ${outPath}`)
}

async function destroy() {
  const t = JSON.parse(readFileSync(outPath, 'utf8'))
  for (const tbl of ['receipts', 'supplier_aliases', 'supplier_budgets', 'suppliers', 'categories', 'user_settings', 'memberships']) {
    try { await admin.from(tbl).delete().eq('user_id', t.uid) } catch {}
  }
  try { await admin.from('organizations').delete().eq('id', t.orgId) } catch {}
  try { await admin.auth.admin.deleteUser(t.uid) } catch {}
  // Verify nothing is left behind.
  const { count } = await admin.from('receipts').select('id', { count: 'exact', head: true }).eq('user_id', t.uid)
  console.log(`destroyed ${t.email} — remaining receipts: ${count ?? 0}`)
}

;(cmd === 'provision' ? provision() : destroy()).catch(e => { console.error(e.message); process.exit(1) })
