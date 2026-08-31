/**
 * Event-quote pricing (client request #17).
 * Run: node --test tests/unit/quotes.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { priceLine, quoteTotals, suggestUnitPrice, QUOTE_UNITS } from '../../functions/api/_lib/quotes.js'

test('the sellable units are exactly the ones the client listed', () => {
  assert.deepEqual(QUOTE_UNITS.map(u => u.value), ['unit', 'kg', 'g', 'l', 'pack', 'tray'])
})

test('a line multiplies out and reports its base unit', () => {
  const l = priceLine({ item_name: 'סלט יווני', quantity: 8, unit: 'ק"ג', unit_price: 55 })
  assert.equal(l.price, 440)
  assert.equal(l.unit_canonical, 'kg')
  assert.equal(l.base_unit, 'kg')
  assert.equal(l.price_per_base_unit, 55)
})

test('grams price per kilo, so a quote compares against a per-kilo cost', () => {
  const l = priceLine({ item_name: 'תבלין', quantity: 500, unit: 'גרם', unit_price: 0.4 })
  assert.equal(l.price, 200)
  assert.equal(l.base_unit, 'kg')
  assert.equal(l.price_per_base_unit, 400)
})

test('trays are counted, not weighed', () => {
  const l = priceLine({ item_name: 'מגש פירות', quantity: 4, unit: 'מגש', unit_price: 220 })
  assert.equal(l.price, 880)
  assert.equal(l.base_unit, 'unit')
})

test('a missing quantity or price yields zero, never NaN', () => {
  assert.equal(priceLine({ item_name: 'x' }).price, 0)
  assert.equal(priceLine({ item_name: 'x', quantity: 'abc', unit_price: null }).price, 0)
})

// ── totals ───────────────────────────────────────────────────────────────────
const QUOTE = {
  guests: 120, vat_rate: 18, discount_pct: 10,
  items: [
    { item_name: 'מגש פירות', quantity: 4, unit: 'מגש', unit_price: 220 },
    { item_name: 'סלט יווני', quantity: 8, unit: 'ק"ג', unit_price: 55 },
    { item_name: 'לחמניות', quantity: 240, unit: "יח'", unit_price: 3.5 },
  ],
}

test('totals run lines → discount → VAT → per guest', () => {
  const t = quoteTotals(QUOTE)
  assert.equal(t.subtotal, 880 + 440 + 840)        // 2160
  assert.equal(t.discount, 216)
  assert.equal(t.net, 1944)
  assert.equal(t.vat, 349.92)
  assert.equal(t.total, 2293.92)
  assert.equal(t.per_guest, 19.12)                  // 2293.92 / 120
})

test('no guest count means no per-guest figure, not a division by zero', () => {
  const t = quoteTotals({ ...QUOTE, guests: 0 })
  assert.equal(t.per_guest, null)
  assert.equal(t.guests, null)
})

test('an empty quote totals to zero cleanly', () => {
  const t = quoteTotals({ items: [] })
  assert.equal(t.total, 0)
  assert.equal(t.fully_costed, false)
  assert.equal(t.margin_pct, null)
})

test('margin is reported only when EVERY line is costed', () => {
  const partly = quoteTotals({
    ...QUOTE,
    items: QUOTE.items.map((l, i) => i === 0 ? { ...l, cost_per_base_unit: 90 } : l),
  })
  // One costed line out of three would read as a huge margin — refuse to show it.
  assert.equal(partly.fully_costed, false)
  assert.equal(partly.cost, null)
  assert.equal(partly.margin_pct, null)
})

test('a fully costed quote reports cost, profit and margin on the net', () => {
  const t = quoteTotals({
    guests: 100, vat_rate: 18, discount_pct: 0,
    items: [
      { item_name: 'סלט', quantity: 10, unit: 'ק"ג', unit_price: 60, cost_per_base_unit: 24 },
      { item_name: 'לחמניות', quantity: 100, unit: "יח'", unit_price: 4, cost_per_base_unit: 1.5 },
    ],
  })
  assert.equal(t.net, 1000)                         // 600 + 400
  assert.equal(t.cost, 390)                         // 10kg×24 + 100×1.5
  assert.equal(t.profit, 610)
  assert.equal(t.margin_pct, 61)
})

// ── suggested pricing ────────────────────────────────────────────────────────
test('margin is on the selling price, not a markup on cost', () => {
  // ₪24/kg at a 40% margin sells for ₪40/kg — NOT ₪33.60 (cost × 1.4), which
  // would be a 28.6% margin and quietly under-charge on every quote.
  assert.equal(suggestUnitPrice(24, 'ק"ג', 40), 40)
  const p = suggestUnitPrice(24, 'ק"ג', 40)
  assert.equal(Math.round(((p - 24) / p) * 100), 40)
})

test('the suggestion is per the unit being SOLD, not per base unit', () => {
  // ₪24/kg quoted in grams is ₪0.04/gram at cost, ₪0.05 at a 20% margin.
  assert.equal(suggestUnitPrice(24, 'גרם', 20), 0.03)
  assert.equal(suggestUnitPrice(24, 'ק"ג', 0), 24)
})

test('a zero or unknown cost gives no suggestion rather than a wrong one', () => {
  assert.equal(suggestUnitPrice(0, 'ק"ג', 30), null)
  assert.equal(suggestUnitPrice(null, 'ק"ג', 30), null)
  assert.equal(suggestUnitPrice(24, 'בליטש', 30), null)
})

test('an absurd margin is clamped instead of dividing by zero', () => {
  assert.ok(Number.isFinite(suggestUnitPrice(24, 'ק"ג', 100)))
  assert.ok(suggestUnitPrice(24, 'ק"ג', 100) > 24)
})

// ── costing a line from purchase history ─────────────────────────────────────
import { costFromHistory } from '../../functions/api/_lib/quotes.js'

const HISTORY = [
  { name: 'עגבניה אשכולות', price_per_base_unit: 7.5, base_unit: 'kg' },
  { name: 'עגבניה אשכולות', price_per_base_unit: 8.0, base_unit: 'kg' },
  { name: 'עגבניה אשכולות', price_per_base_unit: 900, base_unit: 'kg' },  // mis-scan
  { name: 'לחמניות', price_per_base_unit: 1.5, base_unit: 'unit' },
]

test('a single mis-scanned price cannot drag the suggested cost', () => {
  const c = costFromHistory(HISTORY, 'עגבניה אשכולות')
  assert.equal(c.base_unit, 'kg')
  assert.equal(c.samples, 3)
  assert.equal(c.cost, 8)          // median of 7.5 / 8 / 900 — the mean would be 305
})

test('costs are never mixed across base units', () => {
  const mixed = [
    ...HISTORY.filter(h => h.name === 'לחמניות'),
    { name: 'לחמניות', price_per_base_unit: 90, base_unit: 'kg' },
    { name: 'לחמניות', price_per_base_unit: 1.6, base_unit: 'unit' },
  ]
  const c = costFromHistory(mixed, 'לחמניות')
  assert.equal(c.base_unit, 'unit')   // the majority basis, not an average of both
  assert.equal(c.samples, 2)
})

test('an unknown product yields no suggestion', () => {
  assert.equal(costFromHistory(HISTORY, 'קוויאר'), null)
  assert.equal(costFromHistory([], 'עגבניה'), null)
  assert.equal(costFromHistory(HISTORY, ''), null)
})
