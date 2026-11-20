/**
 * salesMath — every revenue figure in the product is derived here (client
 * request 20.11.26). Pure: no I/O, no Supabase, no React.
 *
 * The one rule that keeps revenue honest: a day's takings are the SUM OF ITS
 * LINES when lines exist, and the manually entered figure otherwise. A day is
 * never counted twice, and a detailed day never disagrees with its own detail
 * (the same stance installments.js takes for spread payments).
 *
 * Profit is deliberately conservative: a product contributes profit only when
 * its purchase cost is actually known. Guessing a cost would produce a margin
 * that reads like a fact.
 */

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const num = (v) => (v === '' || v == null ? 0 : Number(v) || 0)

/** Gross takings of one day: its lines if it has any, else what was entered. */
export function dayTotal(day, lines = []) {
  const mine = (lines || []).filter(l => l.business_date === day?.business_date)
  if (mine.length) return r2(mine.reduce((s, l) => s + num(l.line_total), 0))
  return r2(num(day?.gross))
}

/**
 * Totals over a set of days.
 * @returns {{gross:number, vat:number, net:number, transactions:number,
 *            days:number, avgTicket:number|null, avgDay:number|null}}
 */
export function rangeTotals(days = [], lines = []) {
  const byDate = new Map()
  for (const l of lines || []) {
    if (!byDate.has(l.business_date)) byDate.set(l.business_date, [])
    byDate.get(l.business_date).push(l)
  }
  let gross = 0, vat = 0, transactions = 0
  for (const d of days || []) {
    gross += dayTotal(d, byDate.get(d.business_date) || [])
    vat += num(d.vat)
    transactions += num(d.transactions)
  }
  gross = r2(gross); vat = r2(vat)
  const count = (days || []).length
  return {
    gross,
    vat,
    net: r2(gross - vat),
    transactions,
    days: count,
    avgTicket: transactions > 0 ? r2(gross / transactions) : null,
    avgDay: count > 0 ? r2(gross / count) : null,
  }
}

/**
 * Revenue against expenses for the same period.
 * `expenses` is a plain number — the caller already computes it the one way
 * this product computes expenses (dashboardData + isCafeBook + installments).
 * Margin is measured on revenue NET of VAT: VAT is collected for the state.
 */
export function profitSummary(totals, expenses = 0) {
  const net = r2(totals?.net ?? totals?.gross ?? 0)
  const cost = r2(expenses)
  const profit = r2(net - cost)
  return { revenue: r2(totals?.gross ?? 0), net, expenses: cost, profit, margin: net > 0 ? Math.round((profit / net) * 100) : null }
}

/** Twelve monthly buckets of gross takings for one year — chart-shaped. */
export function monthlySeries(days = [], lines = [], year) {
  const byDate = new Map()
  for (const l of lines || []) {
    if (!byDate.has(l.business_date)) byDate.set(l.business_date, [])
    byDate.get(l.business_date).push(l)
  }
  const sums = Array.from({ length: 12 }, () => ({ total: 0, count: 0 }))
  for (const d of days || []) {
    const date = String(d.business_date || '')
    if (year != null && Number(date.slice(0, 4)) !== Number(year)) continue
    const m = Number(date.slice(5, 7))
    if (!m) continue
    sums[m - 1].total += dayTotal(d, byDate.get(date) || [])
    sums[m - 1].count += 1
  }
  return sums.map((s, i) => ({ month: i + 1, total: r2(s.total), count: s.count }))
}

/** What sells most, by revenue or by quantity. */
export function bestSellers(lines = [], { by = 'revenue', limit = 10 } = {}) {
  const map = new Map()
  for (const l of lines || []) {
    const key = l.product_key || String(l.product_name || '').trim().toLowerCase()
    if (!key) continue
    const hit = map.get(key) || { key, name: l.product_name, revenue: 0, qty: 0, lines: 0 }
    hit.revenue += num(l.line_total)
    hit.qty += num(l.qty)
    hit.lines += 1
    map.set(key, hit)
  }
  return [...map.values()]
    .map(p => ({ ...p, revenue: r2(p.revenue), qty: r2(p.qty) }))
    .sort((a, b) => (by === 'qty' ? b.qty - a.qty : b.revenue - a.revenue))
    .slice(0, limit)
}

/** Takings per hour of the day — only lines that carry an hour can answer. */
export function hourHistogram(lines = []) {
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, total: 0, qty: 0 }))
  let known = 0
  for (const l of lines || []) {
    if (l.hour == null) continue
    const h = Number(l.hour)
    if (!(h >= 0 && h <= 23)) continue
    hours[h].total += num(l.line_total)
    hours[h].qty += num(l.qty)
    known++
  }
  return { hours: hours.map(h => ({ ...h, total: r2(h.total), qty: r2(h.qty) })), known }
}

/**
 * Profit per product: what it sold for, against what it cost to buy.
 *
 * @param lines    sales lines
 * @param costByKey Map|object of product_key → cost per ONE sold unit
 * @returns rows sorted by contribution, with `costKnown` false where the
 *          purchase cost is unknown — such a row contributes revenue and NO
 *          profit, and is never silently treated as 100% margin.
 */
export function profitByProduct(lines = [], costByKey = {}) {
  const get = (k) => (costByKey instanceof Map ? costByKey.get(k) : costByKey[k])
  const map = new Map()
  for (const l of lines || []) {
    const key = l.product_key || String(l.product_name || '').trim().toLowerCase()
    if (!key) continue
    const hit = map.get(key) || { key, name: l.product_name, revenue: 0, qty: 0, cost: 0, costKnown: false }
    const qty = num(l.qty)
    const unitCost = get(key)
    hit.revenue += num(l.line_total)
    hit.qty += qty
    if (unitCost != null && Number.isFinite(Number(unitCost))) {
      hit.cost += Number(unitCost) * qty
      hit.costKnown = true
    }
    map.set(key, hit)
  }
  return [...map.values()].map(p => {
    const revenue = r2(p.revenue)
    const cost = p.costKnown ? r2(p.cost) : null
    const profit = p.costKnown ? r2(revenue - cost) : null
    return {
      ...p,
      revenue,
      qty: r2(p.qty),
      cost,
      profit,
      margin: p.costKnown && revenue > 0 ? Math.round((profit / revenue) * 100) : null,
    }
  }).sort((a, b) => (b.profit ?? -Infinity) - (a.profit ?? -Infinity))
}
