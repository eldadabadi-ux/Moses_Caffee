/**
 * units — tests over the unit spellings and product names actually present in
 * the live Moses_Caffee data (30 Aug 2026).
 * Run: node --test tests/unit/units.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeUnit, parsePackSize, pricePerBaseUnit, withUnitPricing,
  comparablePricing, unitLabel,
} from '../../functions/api/_lib/units.js'

// ── normalizeUnit ────────────────────────────────────────────────────────────
test('the three live spellings of a kilo fold to one unit', () => {
  for (const raw of ['ק"ג', 'קילו', 'קג', 'ק״ג', ' קג ', 'KG']) {
    assert.equal(normalizeUnit(raw)?.unit, 'kg', `failed on "${raw}"`)
  }
})

test('litres and grams fold too', () => {
  for (const raw of ['ליטר', "ל'", 'ל', 'L']) assert.equal(normalizeUnit(raw)?.unit, 'l', raw)
  for (const raw of ['גרם', "גר'", 'גר', 'g']) assert.equal(normalizeUnit(raw)?.unit, 'g', raw)
  for (const raw of ["יח'", 'יח', 'יחידה', 'יחידות']) assert.equal(normalizeUnit(raw)?.unit, 'unit', raw)
})

test('containers are recognised but marked as pack-like', () => {
  for (const raw of ['מארז', 'קופסה', 'קרטון', 'מגש', 'גוש']) {
    const u = normalizeUnit(raw)
    assert.ok(u, raw)
    assert.equal(u.packLike, true, raw)
    assert.equal(u.dimension, 'count', raw)
  }
})

test('every unit maps to its dimension base', () => {
  assert.equal(normalizeUnit('גרם').base, 'kg')
  assert.equal(normalizeUnit('מ"ל').base, 'l')
  assert.equal(normalizeUnit("יח'").base, 'unit')
})

test('an unknown or empty unit is null, not a guess', () => {
  for (const raw of ['', null, undefined, 'בליטש', '???']) assert.equal(normalizeUnit(raw), null)
})

test('unitLabel round-trips to Hebrew', () => {
  assert.equal(unitLabel('kg'), 'ק"ג')
  assert.equal(unitLabel('l'), 'ליטר')
})

// ── parsePackSize — real product names from the DB ───────────────────────────
test('pack size comes out of real product names', () => {
  assert.deepEqual(
    (({ quantity, unit }) => ({ quantity, unit }))(parsePackSize('חלב טרי בקרטון 1 ליטר 3% טרה/תנובה')),
    { quantity: 1, unit: 'l' })
  assert.deepEqual(
    (({ quantity, unit }) => ({ quantity, unit }))(parsePackSize("חלב קרבטון 3% (12 יח' בקרטון)")),
    { quantity: 12, unit: 'unit' })
  assert.deepEqual(
    (({ quantity, unit }) => ({ quantity, unit }))(parsePackSize('סלט טבולה עגבניות מבושל 4 קג - מטבוחה מרוקאית')),
    { quantity: 4, unit: 'kg' })
  assert.deepEqual(
    (({ quantity, unit }) => ({ quantity, unit }))(parsePackSize('חלב דל לקטוז/נטול לקטוז 1 ליטר')),
    { quantity: 1, unit: 'l' })
})

test('a fat percentage is never read as a pack size', () => {
  assert.equal(parsePackSize('חלב טרי 3%'), null)
  assert.equal(parsePackSize('גבינה 5% שומן'), null)
})

test('a name with no size yields null', () => {
  for (const n of ['מלפפון', 'עגבניה אשכולות', 'חסה לאליק גוש', '']) {
    assert.equal(parsePackSize(n), null, n)
  }
})

// ── pricePerBaseUnit ─────────────────────────────────────────────────────────
test('a kilo line prices per kilo', () => {
  const p = pricePerBaseUnit({ item_name: 'עגבניה אשכולות', quantity: 4, unit: 'ק"ג', unit_price: 7.5, price: 30 })
  assert.equal(p.base, 'kg')
  assert.equal(p.value, 7.5)
  assert.equal(p.source, 'unit')
})

test('grams convert to a per-kilo price', () => {
  const p = pricePerBaseUnit({ item_name: 'תבלין', quantity: 500, unit: 'גרם', price: 25 })
  assert.equal(p.base, 'kg')
  assert.equal(p.value, 50)          // ₪25 for 0.5 kg
})

test('the two live spellings of a kilo give the SAME price', () => {
  const a = pricePerBaseUnit({ item_name: 'x', quantity: 2, unit: 'ק"ג', price: 20 })
  const b = pricePerBaseUnit({ item_name: 'x', quantity: 2, unit: 'קילו', price: 20 })
  const c = pricePerBaseUnit({ item_name: 'x', quantity: 2, unit: 'קג', price: 20 })
  assert.equal(a.value, b.value)
  assert.equal(b.value, c.value)
  assert.equal(a.base, c.base)
})

test('a carton priced per unit is repriced per litre from its name', () => {
  // 6 cartons of 1 L at ₪48 total → ₪8 per litre, not ₪8 per "unit".
  const p = pricePerBaseUnit({ item_name: 'חלב טרי בקרטון 1 ליטר 3% טרה/תנובה', quantity: 6, unit: 'קרטון', price: 48 })
  assert.equal(p.base, 'l')
  assert.equal(p.value, 8)
  assert.equal(p.source, 'pack_size')
})

test('a 12-pack is priced per piece', () => {
  const p = pricePerBaseUnit({ item_name: "חלב קרבטון 3% (12 יח' בקרטון)", quantity: 2, unit: 'מארז', price: 72 })
  assert.equal(p.base, 'unit')
  assert.equal(p.value, 3)           // 24 pieces for ₪72
})

test('no unit at all still yields a per-piece price, flagged as assumed', () => {
  const p = pricePerBaseUnit({ item_name: 'מלפפון', quantity: 3, unit: '', price: 15 })
  assert.equal(p.base, 'unit')
  assert.equal(p.value, 5)
  assert.equal(p.source, 'assumed_count')
})

test('price falls back to quantity × unit_price when the line total is missing', () => {
  const p = pricePerBaseUnit({ item_name: 'x', quantity: 3, unit: 'ק"ג', unit_price: 10, price: 0 })
  assert.equal(p.value, 10)
})

test('nothing to divide by returns null instead of Infinity', () => {
  assert.equal(pricePerBaseUnit({ item_name: 'x', quantity: 0, unit: 'ק"ג', price: 0 }), null)
  assert.equal(pricePerBaseUnit({ item_name: 'x', quantity: 5, unit: 'ק"ג', price: 0, unit_price: 0 }), null)
  assert.equal(pricePerBaseUnit(null), null)
})

test('a missing quantity is treated as one, not as zero', () => {
  const p = pricePerBaseUnit({ item_name: 'x', unit: 'ק"ג', price: 12 })
  assert.equal(p.value, 12)
})

// ── withUnitPricing / comparablePricing ──────────────────────────────────────
test('withUnitPricing annotates without losing the original line', () => {
  const item = { item_name: 'עגבניה אשכולות', quantity: 4, unit: 'קילו', unit_price: 7.5, price: 30, category_l1: 'ירקות ופירות' }
  const out = withUnitPricing(item)
  assert.equal(out.item_name, item.item_name)
  assert.equal(out.unit, 'קילו')             // the printed unit is preserved
  assert.equal(out.category_l1, 'ירקות ופירות')
  assert.equal(out.unit_canonical, 'kg')
  assert.equal(out.base_unit, 'kg')
  assert.equal(out.price_per_base_unit, 7.5)
})

test('two suppliers selling the same goods differently become comparable', () => {
  // Supplier A: 4 kg loose. Supplier B: 2 boxes of 4 kg each.
  const a = withUnitPricing({ item_name: 'מטבוחה', quantity: 4, unit: 'ק"ג', price: 100 })
  const b = withUnitPricing({ item_name: 'סלט טבולה עגבניות מבושל 4 קג - מטבוחה מרוקאית', quantity: 2, unit: 'קופסה', price: 160 })
  assert.ok(comparablePricing(a, b))
  assert.equal(a.base_unit, 'kg')
  assert.equal(b.base_unit, 'kg')
  assert.equal(a.price_per_base_unit, 25)    // ₪25/kg
  assert.equal(b.price_per_base_unit, 20)    // ₪20/kg — genuinely cheaper
})

test('items in different dimensions are NOT comparable', () => {
  const kg = withUnitPricing({ item_name: 'x', quantity: 1, unit: 'ק"ג', price: 10 })
  const l  = withUnitPricing({ item_name: 'y', quantity: 1, unit: 'ליטר', price: 10 })
  assert.equal(comparablePricing(kg, l), false)
})

test('an explicit pack_size field beats one guessed from the name', () => {
  // The name says 3% (not a size); the document said the carton holds 2 litres.
  const p = pricePerBaseUnit({ item_name: 'חלב טרי 3%', pack_size: '2 ליטר', quantity: 3, unit: 'קרטון', price: 36 })
  assert.equal(p.base, 'l')
  assert.equal(p.value, 6)          // ₪36 for 6 litres
})

test('an unusable pack_size falls back to the product name', () => {
  const p = pricePerBaseUnit({ item_name: 'חלב טרי בקרטון 1 ליטר 3%', pack_size: '', quantity: 2, unit: 'קרטון', price: 16 })
  assert.equal(p.base, 'l')
  assert.equal(p.value, 8)
})
