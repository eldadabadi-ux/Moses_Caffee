/**
 * salesMath — revenue must never be counted twice, and profit must never be
 * invented. These tests pin both, plus the binding condition that the sales
 * module ships switched OFF (guardrail 7).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  dayTotal, rangeTotals, profitSummary, monthlySeries,
  bestSellers, hourHistogram, profitByProduct,
} from '../../functions/api/_lib/salesMath.js'
import { FLAG_DEFAULTS, MODULE_FLAGS } from '../../functions/api/_lib/flags.js'

const day = (business_date, gross, extra = {}) => ({ business_date, gross, ...extra })
const line = (business_date, product_name, line_total, extra = {}) =>
  ({ business_date, product_name, line_total, qty: 1, ...extra })

// ── the module must not reach an existing customer ──────────────────────────
test('the sales module is OFF by default and sold as a module', () => {
  assert.equal(FLAG_DEFAULTS.sales, false,
    'the revenue module must default to false — an existing tenant must never see it unasked')
  assert.ok(MODULE_FLAGS.includes('sales'), 'it must be switchable per customer')
})

// ── one day, one figure ─────────────────────────────────────────────────────
test('a day with lines is worth its lines; a manual day is worth what was entered', () => {
  const d = day('2026-11-20', 1000)
  assert.equal(dayTotal(d, []), 1000)
  assert.equal(dayTotal(d, [line('2026-11-20', 'קפה', 300), line('2026-11-20', 'סנדוויץ', 250)]), 550)
})

test('lines of another day never leak into this one', () => {
  const d = day('2026-11-20', 1000)
  assert.equal(dayTotal(d, [line('2026-11-19', 'קפה', 900)]), 1000)
})

test('rangeTotals mixes detailed and manual days without double counting', () => {
  const days = [day('2026-11-01', 500, { vat: 76.27, transactions: 20 }), day('2026-11-02', 999, { vat: 61, transactions: 15 })]
  const lines = [line('2026-11-02', 'קפה', 200), line('2026-11-02', 'עוגה', 200)]
  const t = rangeTotals(days, lines)
  assert.equal(t.gross, 900)              // 500 manual + 400 from lines, NOT 1499
  assert.equal(t.days, 2)
  assert.equal(t.transactions, 35)
  assert.equal(t.avgTicket, 25.71)
  assert.equal(t.avgDay, 450)
})

test('profit is measured on revenue net of VAT', () => {
  const s = profitSummary({ gross: 1180, net: 1000 }, 600)
  assert.equal(s.profit, 400)
  assert.equal(s.margin, 40)              // 400/1000, not 400/1180
})

test('monthlySeries buckets by month and ignores other years', () => {
  const days = [day('2026-01-05', 100), day('2026-01-31', 50), day('2025-01-05', 999), day('2026-03-02', 70)]
  const s = monthlySeries(days, [], 2026)
  assert.equal(s.length, 12)
  assert.equal(s[0].total, 150)
  assert.equal(s[0].count, 2)
  assert.equal(s[2].total, 70)
  assert.equal(s[6].total, 0)
})

// ── what sells, and when ────────────────────────────────────────────────────
test('bestSellers ranks by revenue or by quantity', () => {
  const lines = [
    line('2026-11-01', 'קפה הפוך', 12, { qty: 1, product_key: 'cafe' }),
    line('2026-11-01', 'קפה הפוך', 24, { qty: 2, product_key: 'cafe' }),
    line('2026-11-01', 'עוגת גבינה', 40, { qty: 1, product_key: 'cake' }),
  ]
  assert.equal(bestSellers(lines)[0].key, 'cake')
  assert.equal(bestSellers(lines, { by: 'qty' })[0].key, 'cafe')
  assert.equal(bestSellers(lines)[1].revenue, 36)
})

test('hourHistogram counts only lines that know their hour', () => {
  const h = hourHistogram([
    line('2026-11-01', 'קפה', 12, { hour: 8 }),
    line('2026-11-01', 'קפה', 12, { hour: 8 }),
    line('2026-11-01', 'עוגה', 40, { hour: 16 }),
    line('2026-11-01', 'מיץ', 15),               // no hour → excluded
  ])
  assert.equal(h.known, 3)
  assert.equal(h.hours[8].total, 24)
  assert.equal(h.hours[16].total, 40)
  assert.equal(h.hours[0].total, 0)
})

// ── profit is never invented ────────────────────────────────────────────────
test('a product with no known cost reports revenue and NO profit', () => {
  const rows = profitByProduct(
    [line('2026-11-01', 'קפה', 36, { qty: 3, product_key: 'cafe' }),
     line('2026-11-01', 'מים', 20, { qty: 2, product_key: 'water' })],
    { cafe: 4 })
  const cafe = rows.find(r => r.key === 'cafe')
  const water = rows.find(r => r.key === 'water')
  assert.equal(cafe.cost, 12)
  assert.equal(cafe.profit, 24)
  assert.equal(cafe.margin, 67)
  assert.equal(water.costKnown, false)
  assert.equal(water.profit, null, 'an unknown cost must not read as 100% margin')
  assert.equal(water.margin, null)
  assert.equal(rows[0].key, 'cafe', 'known-profit rows rank first')
})

test('profitByProduct accepts a Map of costs and groups by product key', () => {
  const rows = profitByProduct(
    [line('2026-11-01', 'קפה הפוך', 12, { qty: 1, product_key: 'cafe' }),
     line('2026-11-02', 'קפה  הפוך', 12, { qty: 1, product_key: 'cafe' })],
    new Map([['cafe', 5]]))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].qty, 2)
  assert.equal(rows[0].profit, 14)
})
