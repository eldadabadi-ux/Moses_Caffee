/**
 * extract.test — the post-extraction reconciliation logic (client issue #9).
 *
 * These are the pure functions that stand between a model's raw reading and the
 * stored receipt. Each test encodes a failure the client reported: VAT added on
 * top of VAT-inclusive consumer lines, a fabricated VAT split on exempt
 * documents, swapped money columns, and an address stored as a supplier name.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  reconcileTotalFromItems, reconcileVat, validateLineMath,
  looksLikeAddress, sanitizeVendorFields,
} from '../../functions/api/_lib/extractReceipt.js'

const VAT = 18
const item = (price, extra = {}) => ({ item_name: 'x', price, ...extra })

// ── reconcileTotalFromItems ──────────────────────────────────────────────────

test('misread total + net B2B lines → items sum becomes the base, VAT added', () => {
  const r = reconcileTotalFromItems(
    { total_amount: 12.5, items: [item(100), item(50)], items_include_vat: false }, VAT)
  assert.equal(r.amount_before_vat, 150)
  assert.equal(r.total_amount, 177)
  assert.equal(r.vat_amount, 27)
  assert.equal(r._total_from_items, true)
})

test('misread total + VAT-inclusive consumer lines → items sum IS the total (no 18% on top)', () => {
  const r = reconcileTotalFromItems(
    { total_amount: 12.5, items: [item(100), item(50)], items_include_vat: true }, VAT)
  assert.equal(r.total_amount, 150)              // NOT 177
  assert.equal(r.amount_before_vat, 127.12)      // 150 / 1.18
  assert.equal(r.vat_amount, 22.88)
  assert.equal(r._total_from_items, true)
})

test('stated total ≈ items sum (gross lines, total read fine) → untouched', () => {
  const r = reconcileTotalFromItems(
    { total_amount: 150.4, amount_before_vat: 0, items: [item(100), item(50.4)] }, VAT)
  assert.equal(r.total_amount, 150.4)
  assert.equal(r._total_from_items, undefined)
})

test('stated total ≈ items sum + VAT (net lines, gross total) → breakdown pinned, total kept', () => {
  const r = reconcileTotalFromItems(
    { total_amount: 177, items: [item(100), item(50)] }, VAT)
  assert.equal(r.total_amount, 177)
  assert.equal(r.amount_before_vat, 150)
  assert.equal(r.vat_amount, 27)
  assert.equal(r._total_from_items, undefined)
})

test('single-line receipts are never rewritten from items', () => {
  const r = reconcileTotalFromItems({ total_amount: 10, items: [item(999)] }, VAT)
  assert.equal(r.total_amount, 10)
})

// ── reconcileVat ─────────────────────────────────────────────────────────────

test('VAT-exempt document (before == total, vat 0) survives — no fabricated 18%', () => {
  const r = reconcileVat({ total_amount: 450, amount_before_vat: 450, vat_amount: 0 }, VAT)
  assert.equal(r.total_amount, 450)
  assert.equal(r.amount_before_vat, 450)
  assert.equal(r.vat_amount, 0)
})

test('printed, internally-consistent breakdown is kept verbatim', () => {
  const r = reconcileVat({ total_amount: 118, amount_before_vat: 100, vat_amount: 18 }, VAT)
  assert.equal(r.amount_before_vat, 100)
  assert.equal(r.vat_amount, 18)
})

test('no printed breakdown → derived from the configured rate', () => {
  const r = reconcileVat({ total_amount: 118, amount_before_vat: 0, vat_amount: 0 }, VAT)
  assert.equal(r.amount_before_vat, 100)
  assert.equal(r.vat_amount, 18)
})

test('inconsistent before > total → recomputed from the total', () => {
  const r = reconcileVat({ total_amount: 118, amount_before_vat: 150, vat_amount: 0 }, VAT)
  assert.equal(r.amount_before_vat, 100)
  assert.equal(r.vat_amount, 18)
})

// ── validateLineMath ─────────────────────────────────────────────────────────

test('consistent lines pass through untouched', () => {
  const r = validateLineMath({ items: [{ quantity: 3, unit_price: 7.5, price: 22.5 }] })
  assert.equal(r.items[0].price, 22.5)
  assert.equal(r._needs_review, undefined)
})

test('swapped money columns are detected and repaired', () => {
  // printed: qty 4 × ₪30.6 = ₪122.4, but OCR returned unit_price=122.4, price=30.6
  const r = validateLineMath({ items: [{ quantity: 4, unit_price: 122.4, price: 30.6 }] })
  assert.equal(r.items[0].unit_price, 30.6)
  assert.equal(r.items[0].price, 122.4)
  assert.equal(r.items[0]._columns_swapped, true)
  assert.equal(r._needs_review, undefined)
})

test('an unrepairable mismatch is flagged for review, not guessed', () => {
  // 3 × ₪10 is neither 45 nor repairable by a swap (3 × 45 ≠ 10)
  const r = validateLineMath({ items: [{ quantity: 3, unit_price: 10, price: 45 }] })
  assert.equal(r.items[0]._math_mismatch, true)
  assert.equal(r._needs_review, true)
  assert.equal(r.items[0].price, 45) // values untouched — the user decides
})

test('lines without full qty×price data are left alone', () => {
  const r = validateLineMath({ items: [{ quantity: 1, unit_price: 0, price: 55 }] })
  assert.equal(r.items[0].price, 55)
  assert.equal(r._needs_review, undefined)
})

// ── vendor name vs address ───────────────────────────────────────────────────

test('street addresses are recognised as not-a-business-name', () => {
  assert.equal(looksLikeAddress('רחוב הדקל 12, רמת גן'), true)
  assert.equal(looksLikeAddress('שד\' ההסתדרות 88 חיפה'), true)
  assert.equal(looksLikeAddress('ת.ד 2210 מפרץ חיפה'), true)
  assert.equal(looksLikeAddress('03-5551234 514477221'), true) // phone + ח.פ digits
})

test('real business names are NOT mistaken for addresses', () => {
  assert.equal(looksLikeAddress('מידן שיווק ומסחר בע"מ'), false)
  assert.equal(looksLikeAddress('סופר הכפר בע"מ'), false)
  assert.equal(looksLikeAddress('חלב 3% תנובה'), false)
  assert.equal(looksLikeAddress('מחסני השוק'), false)
})

test('an address in vendor_name is moved to vendor_address and the name blanked', () => {
  const r = sanitizeVendorFields({ vendor_name: 'רחוב הדקל 12, רמת גן', vendor_address: '' })
  assert.equal(r.vendor_name, '')
  assert.equal(r.vendor_address, 'רחוב הדקל 12, רמת גן')
})

test('a clean vendor_name is untouched', () => {
  const r = sanitizeVendorFields({ vendor_name: 'קטיף ירקות קצוצים בע"מ', vendor_address: 'רחוב הדקל 12' })
  assert.equal(r.vendor_name, 'קטיף ירקות קצוצים בע"מ')
  assert.equal(r.vendor_address, 'רחוב הדקל 12')
})
