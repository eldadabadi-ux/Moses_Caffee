/**
 * insights.test — the periodic report (Phase 8, client issue #5). Deterministic
 * fixtures with a fixed `now`, so spend trend, savings, price alerts, document
 * gaps, budgets and VAT are all pinned.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildInsights, insightWindow } from '../../src/lib/insights.js'

const NOW = new Date('2026-06-15T12:00:00Z')

test('insightWindow gives the current month and the one before it', () => {
  const w = insightWindow('month', NOW)
  assert.equal(w.cur.from, '2026-06-01')
  assert.equal(w.cur.to, '2026-06-30')
  assert.equal(w.prev.from, '2026-05-01')
  assert.equal(w.prev.to, '2026-05-31')
})

// Café expense docs across May (prev) and June (cur), two suppliers of tomatoes.
const receipts = () => [
  { id: 'm1', vendor_name: 'ספק א', supplier_id: 'a', receipt_date: '2026-05-10', amount: 100, vat_amount: 18,
    doc_type: 'receipt', archived_at: null, book: 'cafe', category_text: 'ירקות',
    items: [{ item_name: 'עגבניה', quantity: 10, unit: 'ק"ג', price: 100, price_per_base_unit: 10, base_unit: 'kg' }] },
  { id: 'j1', vendor_name: 'ספק א', supplier_id: 'a', receipt_date: '2026-06-05', amount: 150, vat_amount: 27,
    doc_type: 'receipt', archived_at: null, book: 'cafe', category_text: 'ירקות',
    items: [{ item_name: 'עגבניה', quantity: 10, unit: 'ק"ג', price: 150, price_per_base_unit: 15, base_unit: 'kg' }] },
  { id: 'j2', vendor_name: 'ספק ב', supplier_id: 'b', receipt_date: '2026-06-20', amount: 80, vat_amount: 14,
    doc_type: 'receipt', archived_at: null, book: 'cafe', category_text: 'ירקות',
    items: [{ item_name: 'עגבניות', quantity: 10, unit: 'ק"ג', price: 80, price_per_base_unit: 8, base_unit: 'kg' }] },
  // an open delivery note (no matched invoice) → a document gap
  { id: 'dn', vendor_name: 'ספק ג', supplier_id: 'c', receipt_date: '2026-06-01', amount: 200,
    doc_type: 'delivery_note', archived_at: null, book: 'cafe', matched_invoice_id: null, items: [] },
  // an events doc that must NOT colour café numbers
  { id: 'ev', vendor_name: 'קייטרינג', supplier_id: null, receipt_date: '2026-06-10', amount: 9999,
    doc_type: 'receipt', archived_at: null, book: 'events', category_text: 'ירקות', items: [] },
]

test('spend trend compares the period to the one before, café only', () => {
  const r = buildInsights(receipts(), { period: 'month', now: NOW })
  // June café expense (receipts only, delivery note excluded as it is not... it IS an expense doc)
  // j1 150 + j2 80 + dn 200 = 430; May = 100 → +330%
  assert.equal(r.spend.total, 430)
  assert.equal(r.spend.prevTotal, 100)
  assert.equal(r.spend.changePct, 330)
  assert.ok(!String(r.spend.total).includes('9999'))
})

test('savings surfaces the cheaper supplier for the same product', () => {
  const r = buildInsights(receipts(), { period: 'month', now: NOW })
  const tomato = r.savings[0]
  assert.ok(tomato, JSON.stringify(r.savings))
  assert.equal(tomato.cheapest.vendor, 'ספק ב')   // ₪8/kg vs ספק א median
  assert.ok(tomato.spreadPct >= 10)
})

test('price alerts catch a within-period rise', () => {
  const r = buildInsights(receipts(), { period: 'month', now: NOW })
  // ספק א tomatoes: only one June point → no within-June rise. Use a year window.
  const y = buildInsights(receipts(), { period: 'year', now: NOW })
  const rise = y.priceAlerts.find(a => a.vendor === 'ספק א')
  assert.ok(rise, JSON.stringify(y.priceAlerts))
  assert.equal(rise.change_pct, 50)   // 10 → 15 ₪/kg
})

test('document gaps count open delivery notes', () => {
  const r = buildInsights(receipts(), { period: 'month', now: NOW })
  assert.equal(r.docGaps.openNotes, 1)
})

test('budget alerts flag over-budget suppliers only', () => {
  const budgets = [
    { supplier_id: 'a', period: 'monthly', amount: 100, alert_pct: 80 },  // used 150 → over
    { supplier_id: 'b', period: 'monthly', amount: 1000, alert_pct: 80 }, // used 80 → ok (hidden)
  ]
  const suppliers = [{ id: 'a', name: 'ספק א' }, { id: 'b', name: 'ספק ב' }]
  const r = buildInsights(receipts(), { period: 'month', now: NOW, budgets, suppliers })
  assert.equal(r.budgetAlerts.length, 1)
  assert.equal(r.budgetAlerts[0].supplier, 'ספק א')
  assert.equal(r.budgetAlerts[0].state, 'over')
})

test('VAT summary sums input VAT for the period, café only', () => {
  const r = buildInsights(receipts(), { period: 'month', now: NOW })
  // June: 27 + 14 = 41 (the delivery note has no vat_amount; events excluded)
  assert.equal(r.vat.total, 41)
})
