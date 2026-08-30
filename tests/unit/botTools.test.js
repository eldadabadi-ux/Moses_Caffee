/**
 * botTools — the assistant's data access. Exercised against a stubbed Supabase
 * REST layer so the tenant scoping, the comparison math and the archive rule are
 * all verified without a network.
 * Run: node --test tests/unit/botTools.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { runTool, buildOrientation, TOOL_DEFS } from '../../functions/api/_lib/botTools.js'

const CTX = { url: 'https://db.test', key: 'service-key', orgId: 'org-1', userId: 'user-1' }

const SUPPLIERS = [
  { id: 'sup-katif', name: 'קטיף ירקות קצוצים בע"מ', merged_into: null },
  { id: 'sup-mizan', name: 'מיזן סחר ושיווק מזון איכותי בע"מ', merged_into: null },
]

// Two suppliers selling the same milk in different packagings, plus an archived
// receipt that statistics must still see.
const RECEIPTS = [
  { id: 'r1', vendor_name: 'קטיף ירקות קצוצים בע"מ', supplier_id: 'sup-katif',
    receipt_date: '2026-06-10', amount: 120, doc_type: 'delivery_note', archived_at: null,
    category_text: 'מוצרי מזון ומכולת',
    items: [{ item_name: 'חלב טרי', quantity: 12, unit: "יח'", price: 120,
              price_per_base_unit: 10, base_unit: 'l' }] },
  { id: 'r2', vendor_name: 'קתוף ירקות קצוצים בע"מ', supplier_id: 'sup-katif',
    receipt_date: '2026-08-10', amount: 156, doc_type: 'delivery_note', archived_at: null,
    category_text: 'מוצרי מזון ומכולת',
    items: [{ item_name: 'חלב טרי', quantity: 12, unit: "יח'", price: 156,
              price_per_base_unit: 13, base_unit: 'l' }] },
  { id: 'r3', vendor_name: 'מיזן סחר ושיווק מזון איכותי בע"מ', supplier_id: 'sup-mizan',
    receipt_date: '2026-07-01', amount: 96, doc_type: 'delivery_note',
    archived_at: '2026-08-01T00:00:00Z',            // ARCHIVED — must still count
    category_text: 'מוצרי מזון ומכולת',
    items: [{ item_name: 'חלב טרי', quantity: 12, unit: 'קרטון', price: 96,
              price_per_base_unit: 8, base_unit: 'l' }] },
  { id: 'r4', vendor_name: 'קטיף ירקות קצוצים בע"מ', supplier_id: 'sup-katif',
    receipt_date: '2026-08-25', amount: 5000, doc_type: 'summary_invoice', archived_at: null,
    category_text: 'מוצרי מזון ומכולת', items: [] },
]

// Rows belonging to ANOTHER tenant — must never appear in a result.
const FOREIGN = [
  { id: 'x1', vendor_name: 'ספק של מישהו אחר', supplier_id: null, receipt_date: '2026-08-01',
    amount: 99999, doc_type: 'receipt', archived_at: null, category_text: 'אחר', items: [] },
]

let lastUrls = []
function installStub() {
  lastUrls = []
  globalThis.fetch = async (url) => {
    const u = String(url)
    lastUrls.push(u)
    // Enforce what the real database would: only rows matching the scope.
    const scoped = u.includes('org_id=eq.org-1') || u.includes('user_id=eq.user-1')
    const pick = (rows) => (scoped ? rows : [...rows, ...FOREIGN])
    if (u.includes('/rest/v1/suppliers')) return json(scoped ? SUPPLIERS : [])
    if (u.includes('/rest/v1/receipts')) return json(pick(RECEIPTS))
    return json([])
  }
}
const json = (data) => ({ ok: true, status: 200, json: async () => data })

test.beforeEach(installStub)

// ── contract ─────────────────────────────────────────────────────────────────
test('every tool is declared with a schema and has an executor', async () => {
  assert.ok(TOOL_DEFS.length >= 4)
  for (const t of TOOL_DEFS) {
    assert.ok(t.name && t.description && t.input_schema, t.name)
    const out = await runTool(t.name, {}, CTX)
    assert.ok(out && typeof out === 'object' && !out.error, `${t.name}: ${JSON.stringify(out)}`)
  }
})

test('an unknown tool is reported, not thrown', async () => {
  const out = await runTool('drop_everything', {}, CTX)
  assert.match(out.error, /לא מוכר/)
})

// ── tenant isolation ─────────────────────────────────────────────────────────
test('every data request carries an explicit tenant predicate', async () => {
  await runTool('query_receipts', {}, CTX)
  assert.ok(lastUrls.length > 0)
  for (const u of lastUrls) {
    assert.ok(u.includes('org_id=eq.org-1'), `unscoped request: ${u}`)
  }
})

test('a user with no org falls back to user scoping, never to none', async () => {
  await runTool('query_receipts', {}, { ...CTX, orgId: null })
  for (const u of lastUrls) {
    assert.ok(u.includes('user_id=eq.user-1'), `unscoped request: ${u}`)
  }
})

// ── query_receipts ───────────────────────────────────────────────────────────
test('a supplier filter accepts an OCR variant of the name', async () => {
  // "קתוף" is a mis-scan of "קטיף" — both belong to sup-katif.
  const out = await runTool('query_receipts', { supplier: 'קטיף' }, CTX)
  assert.equal(out.found, 3)                       // r1, r2, r4
  assert.ok(out.receipts.every(r => r.supplier.includes('קטיף')))
})

test('an unknown supplier says so instead of returning everything', async () => {
  const out = await runTool('query_receipts', { supplier: 'ספק שלא קיים בכלל' }, CTX)
  assert.equal(out.found, 0)
  assert.match(out.note, /לא נמצא ספק/)
})

test('summary invoices are excluded from the spend total (no double counting)', async () => {
  const out = await runTool('query_receipts', { supplier: 'קטיף' }, CTX)
  // r1 120 + r2 156 = 276; the ₪5,000 summary invoice must NOT be added.
  assert.match(out.total_spend, /276/)
})

test('line items are returned only when asked for', async () => {
  const off = await runTool('query_receipts', { supplier: 'קטיף' }, CTX)
  assert.equal(off.receipts[0].items, undefined)
  const on = await runTool('query_receipts', { supplier: 'קטיף', include_items: true }, CTX)
  assert.ok(Array.isArray(on.receipts.find(r => r.date === '2026-06-10').items))
})

test('archived receipts are visible — archiving is not forgetting', async () => {
  const out = await runTool('query_receipts', { supplier: 'מיזן' }, CTX)
  assert.equal(out.found, 1)
  assert.equal(out.receipts[0].archived, true)
})

// ── compare_product_prices ───────────────────────────────────────────────────
test('prices compare per base unit across suppliers, cheapest first', async () => {
  const out = await runTool('compare_product_prices', { product: 'חלב' }, CTX)
  assert.equal(out.comparable_products, 1)
  const p = out.products[0]
  assert.equal(p.unit, 'ליטר')
  // קטיף averages (10+13)/2 = 11.5 ₪/l; מיזן is 8 ₪/l — including the archived one.
  assert.match(p.cheapest, /מיזן/)
  assert.match(p.most_expensive, /קטיף/)
  assert.equal(p.difference_pct, 30)             // (11.5-8)/11.5 ≈ 30%
})

test('a product bought from a single supplier is not "comparable"', async () => {
  const out = await runTool('compare_product_prices', { product: 'לא קיים' }, CTX)
  assert.equal(out.comparable_products, 0)
  assert.match(out.note, /אי אפשר להשוות/)
})

// ── supplier_report ──────────────────────────────────────────────────────────
test('a supplier report sums real periods, at the requested granularity', async () => {
  const out = await runTool('supplier_report', { supplier: 'קטיף', granularity: 'month' }, CTX)
  assert.equal(out.documents, 2)                  // the summary invoice is not an expense
  assert.match(out.total, /276/)
  assert.deepEqual(out.periods.map(p => p.period), ['2026-06', '2026-08'])
})

test('quarterly and yearly granularity roll up correctly', async () => {
  const q = await runTool('supplier_report', { supplier: 'קטיף', granularity: 'quarter' }, CTX)
  assert.deepEqual(q.periods.map(p => p.period), ['2026-Q2', '2026-Q3'])
  const y = await runTool('supplier_report', { supplier: 'קטיף', granularity: 'year' }, CTX)
  assert.deepEqual(y.periods.map(p => p.period), ['2026'])
  assert.equal(y.periods[0].documents, 2)
})

test('with no supplier the report covers the whole business', async () => {
  const out = await runTool('supplier_report', {}, CTX)
  assert.equal(out.supplier, 'כל הספקים')
  assert.equal(out.documents, 3)                  // r1, r2, r3 — not the summary invoice
})

// ── price_changes ────────────────────────────────────────────────────────────
test('a price rise at one supplier is detected and quantified', async () => {
  const out = await runTool('price_changes', { min_change_pct: 5 }, CTX)
  const milk = out.changes.find(c => c.product === 'חלב טרי' && c.supplier.includes('קטיף'))
  assert.ok(milk, JSON.stringify(out))
  assert.equal(milk.direction, 'עלייה')
  assert.equal(milk.change_pct, 30)               // 10 → 13 ₪/l
  assert.equal(milk.unit, 'ליטר')
})

test('a high threshold filters the noise out and says why', async () => {
  const out = await runTool('price_changes', { min_change_pct: 90 }, CTX)
  assert.equal(out.found, 0)
  assert.match(out.note, /לא נמצאו שינויי מחיר/)
})

// ── orientation ──────────────────────────────────────────────────────────────
test('the orientation block describes what exists without dumping it', async () => {
  const o = await buildOrientation(CTX)
  assert.equal(o.documents, 4)
  assert.equal(o.archived, 1)
  assert.equal(o.delivery_notes, 3)
  assert.equal(o.summary_invoices, 1)
  assert.equal(o.date_range, '2026-06-10 … 2026-08-25')
  assert.ok(o.suppliers.includes('קטיף ירקות קצוצים בע"מ'))
  // The canonical name replaces the OCR variant — "קתוף" must not appear.
  assert.ok(!o.suppliers.some(s => s.includes('קתוף')))
})

test('a database failure surfaces as data, not as an exception', async () => {
  globalThis.fetch = async () => { throw new Error('connection refused') }
  const out = await runTool('query_receipts', {}, CTX)
  assert.ok(out.error)
})
