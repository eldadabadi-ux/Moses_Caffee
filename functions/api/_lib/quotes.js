/**
 * quotes — pricing for catering event quotes (client request #17, second half:
 * "הצעות מחיר עם פרמטרים ליחידות מידה").
 *
 * A quote is the revenue side: what Moses charges. It shares one thing with the
 * expense side — units. A line priced per ק"ג has to mean the same ק"ג as the
 * purchase it came from, or costing an event is guesswork. So the same units
 * module prices both, and a quote line can be costed directly from what that
 * product actually cost per base unit.
 *
 * Pure functions — no I/O — so the page, any future export and the tests all
 * compute identically.
 */
import { normalizeUnit, pricePerBaseUnit, unitLabel } from './units.js'

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }

/** Units a quote line may be sold in — exactly the list the client named. */
export const QUOTE_UNITS = [
  { value: 'unit', label: "יח'" },
  { value: 'kg',   label: 'ק"ג' },
  { value: 'g',    label: 'גרם' },
  { value: 'l',    label: 'ליטר' },
  { value: 'pack', label: 'קופסה' },
  { value: 'tray', label: 'מגש' },
]

/**
 * One priced line.
 * `unit_price` is per the line's OWN unit (per tray, per kilo), which is how a
 * caterer quotes; the base-unit figure is derived for comparison against cost.
 */
export function priceLine(line) {
  const quantity = num(line?.quantity)
  const unitPrice = num(line?.unit_price)
  const total = r2(quantity * unitPrice)
  const u = normalizeUnit(line?.unit)
  const perBase = pricePerBaseUnit({ ...line, price: total })
  return {
    ...line,
    quantity, unit_price: unitPrice, price: total,
    unit_canonical: u?.unit || null,
    price_per_base_unit: perBase?.value ?? null,
    base_unit: perBase?.base || null,
  }
}

/**
 * Totals for a whole quote, in the order a customer reads them:
 * lines → discount → VAT → what they pay, plus the per-guest figure that
 * actually decides a catering deal.
 */
export function quoteTotals(quote) {
  const lines = (quote?.items || []).map(priceLine)
  const subtotal = r2(lines.reduce((s, l) => s + l.price, 0))
  const discountPct = num(quote?.discount_pct)
  const discount = r2(subtotal * discountPct / 100)
  const net = r2(subtotal - discount)
  const vatRate = quote?.vat_rate == null ? 18 : num(quote.vat_rate)
  const vat = r2(net * vatRate / 100)
  const total = r2(net + vat)
  const guests = Math.max(0, Math.trunc(num(quote?.guests)))

  // Cost is only meaningful when EVERY line has one — a partial figure would
  // read as a margin and be wrong in the flattering direction.
  const costs = lines.map(l => (l.cost_per_base_unit != null && l.base_unit)
    ? r2(num(l.cost_per_base_unit) * (num(l.quantity) * (normalizeUnit(l.unit)?.toBase ?? 1)))
    : null)
  const fullyCosted = costs.length > 0 && costs.every(c => c != null)
  const cost = fullyCosted ? r2(costs.reduce((s, c) => s + c, 0)) : null
  const profit = cost == null ? null : r2(net - cost)
  const marginPct = (cost == null || net <= 0) ? null : Math.round((profit / net) * 1000) / 10

  return {
    lines, subtotal,
    discount_pct: discountPct, discount,
    net, vat_rate: vatRate, vat, total,
    guests: guests || null,
    per_guest: guests > 0 ? r2(total / guests) : null,
    cost, profit, margin_pct: marginPct,
    fully_costed: fullyCosted,
  }
}

/**
 * Suggest a selling price for a line from what the product actually cost.
 *
 * @param {number} costPerBaseUnit ₪ per kg / l / unit, from purchase history
 * @param {string} unit            the unit this line is sold in
 * @param {number} marginPct       target margin ON THE SELLING PRICE
 * @returns {number|null} suggested unit_price, per the line's own unit
 *
 * Margin is on the selling price, not a markup on cost — a caterer quoting "35%
 * margin" means 35% of what the customer pays. Marking cost up by 35% yields
 * only a 26% margin, and quietly under-charging on every quote is exactly the
 * kind of error this is meant to prevent.
 */
export function suggestUnitPrice(costPerBaseUnit, unit, marginPct = 0) {
  const cost = num(costPerBaseUnit)
  if (!(cost > 0)) return null
  const u = normalizeUnit(unit)
  if (!u) return null
  const costForThisUnit = cost * u.toBase          // ₪/kg → ₪ per gram, per litre…
  const m = Math.min(Math.max(num(marginPct), 0), 95)
  return r2(costForThisUnit / (1 - m / 100))
}

/**
 * What this product has actually cost, per base unit, from purchase history.
 *
 * Uses the MEDIAN rather than the mean: one mis-scanned line (a ₪900/kg tomato
 * from a decimal in the wrong place) would drag an average far enough to price a
 * whole event wrong, and those exist in the live data.
 *
 * @param {Array} history flattened purchase lines
 *                        [{ name, price_per_base_unit, base_unit }]
 * @param {string} productName
 * @returns {{ cost:number, base_unit:string, samples:number }|null}
 */
export function costFromHistory(history, productName) {
  const want = String(productName || '').trim().toLowerCase()
  if (!want) return null

  const hits = (history || []).filter(h => {
    const n = String(h?.name || '').trim().toLowerCase()
    if (!n || h?.price_per_base_unit == null || !h?.base_unit) return false
    return n === want || n.includes(want) || want.includes(n)
  })
  if (!hits.length) return null

  // Only compare like with like — mixing ₪/kg and ₪/unit produces a number that
  // means nothing. The most common base unit among the matches wins.
  const byBase = {}
  for (const h of hits) (byBase[h.base_unit] ||= []).push(num(h.price_per_base_unit))
  const [base, values] = Object.entries(byBase).sort((a, b) => b[1].length - a[1].length)[0]

  const sorted = values.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return { cost: r2(median), base_unit: base, samples: values.length }
}

/** A short human summary of a line, for the quote document. */
export function lineLabel(line) {
  const u = normalizeUnit(line?.unit)
  const q = num(line?.quantity)
  return `${line?.item_name || ''} · ${q} ${u ? unitLabel(u.unit) : (line?.unit || '')}`.trim()
}
