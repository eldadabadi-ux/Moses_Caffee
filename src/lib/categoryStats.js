/**
 * categoryStats — analytics helpers for the Categories insight panel.
 * Pure functions over flattened items (see itemAggregation.flattenItems).
 */
import { filterByPath, bucketOf } from './itemAggregation.js'

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/**
 * Build a drill path [{dim,value}] for a category tree node by walking parent_id
 * up to the root. level 1→l1, 2→l2, 3→l3 (matches flattenItems' dimensions).
 */
export function nodePath(categories, node) {
  if (!node) return []
  const byId = new Map((categories || []).map(c => [c.id, c]))
  const chain = []
  let cur = node, guard = 0
  while (cur && guard++ < 12) { chain.unshift(cur); cur = cur.parent_id ? byId.get(cur.parent_id) : null }
  const dimByLevel = { 1: 'l1', 2: 'l2', 3: 'l3' }
  return chain.map(c => ({ dim: dimByLevel[c.level] || 'l1', value: c.name }))
}

/** Human breadcrumb names for a path. */
export function pathNames(path) { return (path || []).map(p => p.value) }

/**
 * KPIs for an already-scoped item list.
 * { total, items, receipts, suppliers, avg, lastDate, sharePct }.
 */
export function nodeKpis(scopedItems, totalAll) {
  const items = scopedItems || []
  const total = items.reduce((s, it) => s + (it.price || 0), 0)
  const receipts = new Set(items.map(it => it.rid).filter(Boolean)).size
  const suppliers = new Set(items.map(it => it.vendor).filter(Boolean)).size
  const lastDate = items.reduce((m, it) => (it.date > m ? it.date : m), '')
  return {
    total: r2(total),
    items: items.length,
    receipts,
    suppliers,
    avg: receipts ? r2(total / receipts) : 0,
    lastDate: lastDate || null,
    sharePct: totalAll > 0 ? r2((total / totalAll) * 100) : 0,
  }
}

// Weighted average unit price for a vendor's lines of one product.
function unitPriceOf({ qty, total, uprices, count }) {
  if (qty > 0) return r2(total / qty)                 // weighted by quantity
  if (uprices.length) return r2(uprices.reduce((s, x) => s + x, 0) / uprices.length)
  return count ? r2(total / count) : 0                // fallback: avg per line
}

/**
 * Products (by item name) in scope that are supplied by ≥2 vendors, with each
 * vendor's cost so the user can buy cheaper. Sorted by savings potential desc.
 * [{ product, vendors:[{name,total,count,unitPrice}], cheapest, priciest,
 *    savingsPct, savingsAbs }]
 */
export function multiSupplierProducts(scopedItems, { minVendors = 2 } = {}) {
  const prod = {}
  for (const it of scopedItems || []) {
    const name = (it.name || '').trim()
    if (!name) continue
    const p = (prod[name] ||= { product: name, vendors: {} })
    const v = (p.vendors[it.vendor] ||= { name: it.vendor, total: 0, count: 0, qty: 0, uprices: [] })
    v.total += it.price || 0
    v.count += 1
    if (it.quantity != null) v.qty += it.quantity
    if (it.unit_price != null) v.uprices.push(it.unit_price)
  }
  const out = []
  for (const p of Object.values(prod)) {
    const vendors = Object.values(p.vendors)
      .map(v => ({ name: v.name, total: r2(v.total), count: v.count, unitPrice: unitPriceOf(v) }))
      .sort((a, b) => a.unitPrice - b.unitPrice)
    if (vendors.length < minVendors) continue
    const cheapest = vendors[0]
    const priciest = vendors[vendors.length - 1]
    const savingsPct = priciest.unitPrice > 0 ? r2(((priciest.unitPrice - cheapest.unitPrice) / priciest.unitPrice) * 100) : 0
    out.push({
      product: p.product, vendors,
      cheapest: cheapest.name, priciest: priciest.name,
      savingsPct, savingsAbs: r2(priciest.unitPrice - cheapest.unitPrice),
    })
  }
  return out.sort((a, b) => b.savingsPct - a.savingsPct)
}

/**
 * Unit-price-over-time for one product → [{ key,label,sort,total,count }] where
 * `total` is the (weighted) unit price in that bucket — so it feeds TimeSeriesChart.
 */
export function productPriceTrend(scopedItems, product, granularity = 'month') {
  const buckets = {}
  for (const it of scopedItems || []) {
    if ((it.name || '').trim() !== product) continue
    const b = bucketOf(it.date, granularity)
    const acc = (buckets[b.key] ||= { key: b.key, label: b.label, sort: b.sort, qty: 0, total: 0, uprices: [], count: 0 })
    acc.total += it.price || 0
    acc.count += 1
    if (it.quantity != null) acc.qty += it.quantity
    if (it.unit_price != null) acc.uprices.push(it.unit_price)
  }
  return Object.values(buckets)
    .map(b => ({ key: b.key, label: b.label, sort: b.sort, count: b.count, total: unitPriceOf(b) }))
    .sort((a, b) => a.sort.localeCompare(b.sort))
}

/** Filter flattened items to a time range: 'all' | 'year' | 'month'. */
export function filterByRange(items, range) {
  if (range === 'all' || !range) return items || []
  const now = new Date()
  const prefix = range === 'month'
    ? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    : String(now.getFullYear())
  return (items || []).filter(it => (it.date || '').startsWith(prefix))
}

// Re-export for callers that scope by path then compute stats.
export { filterByPath }
