/**
 * productCompare — cross-supplier price comparison by ₪ per base unit
 * (client request #4). Groups flattened line items into products (productMatch),
 * normalizes each line to ₪/kg · ₪/l · ₪/unit (units.js — SSOT, same figures as
 * the scan pipeline), and reports, per product, what each supplier charges and
 * who is cheapest.
 *
 * Legacy rows scanned before the unit-pricing work carry no price_per_base_unit;
 * it is recomputed here on the fly from the stored line fields, so the report
 * needs no database backfill.
 */
import { pricePerBaseUnit, unitLabel } from '../../functions/api/_lib/units.js'
import { normalizeProduct, productKey } from './productMatch.js'

const r2 = n => Math.round(n * 100) / 100

function median(nums) {
  if (!nums.length) return null
  const s = [...nums].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : r2((s[m - 1] + s[m]) / 2)
}

/** ₪ per base unit for a flattened item — stored value, else recomputed. */
function perBaseOf(it) {
  if (it.price_per_base_unit != null && it.base_unit) {
    return { value: it.price_per_base_unit, base: it.base_unit }
  }
  const p = pricePerBaseUnit({
    item_name: it.name, quantity: it.quantity, unit: it.unit,
    unit_price: it.unit_price, price: it.price, pack_size: it.extra?.pack_size,
  })
  return p ? { value: p.value, base: p.base } : null
}

/**
 * Build the comparison model from flattened line items (itemAggregation.flattenItems).
 *
 * @param {Array} flatItems
 * @param {{minSuppliers?:number}} opts  only keep products sold by ≥ minSuppliers (default 2)
 * @returns {Array<{
 *   key, label, base_unit, unitLabel, supplierCount,
 *   suppliers: Array<{ vendor, price, count, lastDate }>,
 *   cheapest: {vendor,price}, dearest: {vendor,price}, spreadPct, savingPct,
 * }>} sorted by savings potential (widest spread first).
 */
export function buildProductComparison(flatItems, { minSuppliers = 2 } = {}) {
  // 1. bucket lines by product key, collecting each line's ₪/base and base unit
  const groups = new Map()
  for (const it of flatItems || []) {
    const key = productKey(it)
    if (!key) continue
    const pb = perBaseOf(it)
    if (!pb) continue
    let g = groups.get(key)
    if (!g) { g = { key, names: new Map(), bases: new Map(), lines: [] }; groups.set(key, g) }
    g.lines.push({ vendor: it.vendor, value: pb.value, base: pb.base, date: it.date })
    g.bases.set(pb.base, (g.bases.get(pb.base) || 0) + 1)
    const nm = (it.name || '').trim()
    if (nm) g.names.set(nm, (g.names.get(nm) || 0) + 1)
  }

  // 2. for each product, pick the dominant base unit and compare suppliers in it
  const out = []
  for (const g of groups.values()) {
    const base_unit = [...g.bases.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    if (!base_unit) continue
    const perVendor = new Map()
    for (const ln of g.lines) {
      if (ln.base !== base_unit) continue   // only compare like-for-like units
      let v = perVendor.get(ln.vendor)
      if (!v) { v = { vendor: ln.vendor, values: [], lastDate: '' }; perVendor.set(ln.vendor, v) }
      v.values.push(ln.value)
      if ((ln.date || '') > v.lastDate) v.lastDate = ln.date || ''
    }
    const suppliers = [...perVendor.values()]
      .map(v => ({ vendor: v.vendor, price: median(v.values), count: v.values.length, lastDate: v.lastDate }))
      .filter(v => v.price != null)
      .sort((a, b) => a.price - b.price)
    if (suppliers.length < minSuppliers) continue

    const label = [...g.names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || g.key
    const cheapest = suppliers[0]
    const dearest = suppliers[suppliers.length - 1]
    const spreadPct = cheapest.price > 0 ? r2(((dearest.price - cheapest.price) / cheapest.price) * 100) : 0
    out.push({
      key: g.key, label, base_unit, unitLabel: unitLabel(base_unit),
      supplierCount: suppliers.length, suppliers,
      cheapest: { vendor: cheapest.vendor, price: cheapest.price },
      dearest: { vendor: dearest.vendor, price: dearest.price },
      spreadPct,
      savingPct: spreadPct,   // overpaying at the dearest vs the cheapest
    })
  }
  // widest spread first — the biggest savings opportunities on top
  return out.sort((a, b) => b.spreadPct - a.spreadPct || a.label.localeCompare(b.label, 'he'))
}

/** CSV (UTF-8) of the comparison, one row per supplier per product. */
export function comparisonCsv(model) {
  const head = ['מוצר', 'יחידה', 'ספק', 'מחיר ליחידה', 'הכי זול?', 'מס׳ רכישות', 'נרכש לאחרונה']
  const rows = [head]
  for (const p of model) {
    for (const s of p.suppliers) {
      rows.push([
        p.label, `₪/${p.unitLabel}`, s.vendor, String(s.price),
        s.vendor === p.cheapest.vendor ? 'כן' : '', String(s.count), s.lastDate || '',
      ])
    }
  }
  return '﻿' + rows
    .map(r => r.map(c => /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(','))
    .join('\r\n')
}
