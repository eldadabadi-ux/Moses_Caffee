/**
 * productCompare.test — product identity + cross-supplier per-base-unit
 * comparison (Phase 5, client issue #4).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeProduct, productKey, sameProduct } from '../../src/lib/productMatch.js'
import { buildProductComparison, comparisonCsv } from '../../src/lib/productCompare.js'

// ── productMatch ──────────────────────────────────────────────────────────────
test('singular and plural of a product fold to one key', () => {
  assert.equal(normalizeProduct('עגבניה'), normalizeProduct('עגבניות'))
  assert.equal(normalizeProduct('מלפפון'), normalizeProduct('מלפפונים'))
  assert.equal(normalizeProduct('ביצה'), normalizeProduct('ביצים'))
})

test('sizes, percentages and pack words are stripped from identity', () => {
  assert.equal(normalizeProduct('חלב טרי 1 ליטר 3%'), normalizeProduct('חלב טרי'))
  assert.equal(normalizeProduct('קמח 500 גרם'), normalizeProduct('קמח'))
  assert.equal(normalizeProduct('עגבניות קופסה 4 קג'), normalizeProduct('עגבניה'))
})

test('a distinct descriptor keeps products apart (no silent pooling)', () => {
  assert.notEqual(normalizeProduct('עגבניה אשכולות'), normalizeProduct('עגבניה'))
  assert.ok(!sameProduct({ item_name: 'חלב 3%' }, { item_name: 'חלב סויה' }))
})

test('productKey falls back to category when the name is empty', () => {
  assert.equal(productKey({ item_name: '', category_l3: 'ירקות עלים' }), 'ירקות עלים')
  assert.equal(productKey({ name: '   ', l2: 'חלב ומוצריו' }), 'חלב ומוצריו')
})

// ── buildProductComparison ────────────────────────────────────────────────────
// Two suppliers of tomatoes priced per kg, one supplier of cucumbers (single → dropped).
const flat = () => [
  { name: 'עגבניה', vendor: 'ספק א', quantity: 4, unit: 'ק"ג', price: 40, price_per_base_unit: 10, base_unit: 'kg', date: '2026-03-01', extra: {} },
  { name: 'עגבניות', vendor: 'ספק ב', quantity: 2, unit: 'ק"ג', price: 16, price_per_base_unit: 8, base_unit: 'kg', date: '2026-03-10', extra: {} },
  { name: 'עגבניות', vendor: 'ספק ב', quantity: 1, unit: 'ק"ג', price: 8, price_per_base_unit: 8, base_unit: 'kg', date: '2026-03-20', extra: {} },
  { name: 'מלפפון', vendor: 'ספק א', quantity: 3, unit: 'ק"ג', price: 15, price_per_base_unit: 5, base_unit: 'kg', date: '2026-03-05', extra: {} },
]

test('groups one product across spellings and ranks suppliers cheapest-first', () => {
  const model = buildProductComparison(flat())
  assert.equal(model.length, 1, 'only the multi-supplier product is kept')
  const tomato = model[0]
  assert.equal(tomato.base_unit, 'kg')
  assert.equal(tomato.supplierCount, 2)
  assert.equal(tomato.cheapest.vendor, 'ספק ב')
  assert.equal(tomato.cheapest.price, 8)
  assert.equal(tomato.dearest.vendor, 'ספק א')
  assert.equal(tomato.spreadPct, 25)   // 10 vs 8 → 25% dearer
})

test('legacy lines with no stored per-unit price are recomputed on the fly', () => {
  const rows = [
    { name: 'שמן זית', vendor: 'ספק א', quantity: 2, unit: 'ליטר', price: 60, price_per_base_unit: null, base_unit: null, date: '2026-01-01', extra: {} },
    { name: 'שמן זית', vendor: 'ספק ב', quantity: 1, unit: 'ליטר', price: 25, price_per_base_unit: null, base_unit: null, date: '2026-01-02', extra: {} },
  ]
  const model = buildProductComparison(rows)
  assert.equal(model.length, 1)
  assert.equal(model[0].base_unit, 'l')
  assert.equal(model[0].cheapest.price, 25)   // ₪25/l recomputed
  assert.equal(model[0].dearest.price, 30)    // ₪60 / 2 l
})

test('lines in incomparable units do not pool into one price', () => {
  const rows = [
    { name: 'גבינה', vendor: 'ספק א', quantity: 1, unit: 'ק"ג', price: 50, price_per_base_unit: 50, base_unit: 'kg', date: '2026-02-01', extra: {} },
    { name: 'גבינה', vendor: 'ספק ב', quantity: 1, unit: 'ק"ג', price: 40, price_per_base_unit: 40, base_unit: 'kg', date: '2026-02-01', extra: {} },
    { name: 'גבינה', vendor: 'ספק ג', quantity: 10, unit: "יח'", price: 100, price_per_base_unit: 10, base_unit: 'unit', date: '2026-02-01', extra: {} },
  ]
  const model = buildProductComparison(rows)
  assert.equal(model[0].base_unit, 'kg', 'dominant base unit wins')
  assert.equal(model[0].supplierCount, 2, 'the per-unit supplier is excluded from the per-kg comparison')
})

test('comparisonCsv emits a BOM header and one row per supplier', () => {
  const csv = comparisonCsv(buildProductComparison(flat()))
  assert.ok(csv.startsWith('﻿'), 'UTF-8 BOM for Excel Hebrew')
  const lines = csv.trim().split('\r\n')
  assert.equal(lines.length, 3, 'header + 2 suppliers')
  assert.ok(lines[0].includes('מחיר ליחידה'))
})
