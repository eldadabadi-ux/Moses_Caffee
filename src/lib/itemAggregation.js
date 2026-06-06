/**
 * itemAggregation — flattens receipt items and aggregates them by category
 * hierarchy (L1→L2→L3) and time bucket (day/week/month/quarter/year).
 * Powers the dashboard drill-down.
 */

const HEB_MONTHS_SHORT = ['ינו','פבר','מרץ','אפר','מאי','יוני','יול','אוג','ספט','אוק','נוב','דצמ']

/**
 * Flatten all receipts' items into a flat list of line items.
 * Each entry: { date, l1, l2, l3, name, price, vendor }.
 * Receipts without an items array contribute a single synthetic item using
 * the receipt's category_text + amount, so they still appear at L1.
 */
export function flattenItems(receipts) {
  const out = []
  for (const r of receipts || []) {
    const date = r.receipt_date || (r.created_at || '').slice(0, 10)
    if (!date) continue
    const vendor = (r.vendor_name || '').trim() || 'לא ידוע'
    const items = Array.isArray(r.items) ? r.items : []
    if (items.length > 0) {
      for (const it of items) {
        out.push({
          date,
          l1: (it.category_l1 || r.category_text || 'שונות').trim(),
          l2: (it.category_l2 || '').trim(),
          l3: (it.category_l3 || '').trim(),
          name: (it.item_name || '').trim(),
          price: parseFloat(it.price) || 0,
          vendor,
        })
      }
    } else {
      out.push({
        date,
        l1: (r.category_text || 'שונות').trim(),
        l2: '', l3: '',
        name: vendor,
        price: parseFloat(r.amount) || 0,
        vendor,
      })
    }
  }
  return out
}

/** Filter flattened items by a drill path [l1?, l2?, l3?]. */
export function filterByPath(items, path) {
  return items.filter(it => {
    if (path[0] != null && it.l1 !== path[0]) return false
    if (path[1] != null && it.l2 !== path[1]) return false
    if (path[2] != null && it.l3 !== path[2]) return false
    return true
  })
}

/**
 * Children breakdown for the current path. Returns [{ name, total, count }]
 * sorted desc. The child level is determined by path length (0→L1, 1→L2, 2→L3).
 */
export function childrenBreakdown(items, path) {
  const level = path.length // 0,1,2 → group by l1,l2,l3
  if (level >= 3) return []
  const key = ['l1', 'l2', 'l3'][level]
  const scoped = filterByPath(items, path)
  const map = {}
  for (const it of scoped) {
    const name = it[key] || '(ללא)'
    if (!map[name]) map[name] = { name, total: 0, count: 0 }
    map[name].total += it.price
    map[name].count += 1
  }
  return Object.values(map).filter(c => c.name !== '(ללא)' || c.total > 0).sort((a, b) => b.total - a.total)
}

// ── Date bucketing ─────────────────────────────────────────────────────────────
function isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7)
  return { year: date.getUTCFullYear(), week }
}

/** Returns { key, label, sort } for a date string under the chosen granularity. */
export function bucketOf(dateStr, granularity) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, (m || 1) - 1, d || 1)
  switch (granularity) {
    case 'day':
      return { key: dateStr, label: `${d}.${m}`, sort: dateStr }
    case 'week': {
      const { year, week } = isoWeek(dt)
      const k = `${year}-W${String(week).padStart(2, '0')}`
      return { key: k, label: `ש'${week}`, sort: k }
    }
    case 'quarter': {
      const q = Math.floor((m - 1) / 3) + 1
      return { key: `${y}-Q${q}`, label: `Q${q} ${y}`, sort: `${y}-${q}` }
    }
    case 'year':
      return { key: String(y), label: String(y), sort: String(y) }
    case 'month':
    default:
      return { key: `${y}-${String(m).padStart(2, '0')}`, label: `${HEB_MONTHS_SHORT[(m||1)-1]} ${String(y).slice(2)}`, sort: `${y}-${String(m).padStart(2,'0')}` }
  }
}

/**
 * Build a time series for the items matching `path` at the given granularity.
 * Returns [{ key, label, total, count }] sorted chronologically.
 */
export function timeSeries(items, path, granularity) {
  const scoped = filterByPath(items, path)
  const map = {}
  for (const it of scoped) {
    const b = bucketOf(it.date, granularity)
    if (!map[b.key]) map[b.key] = { key: b.key, label: b.label, sort: b.sort, total: 0, count: 0 }
    map[b.key].total += it.price
    map[b.key].count += 1
  }
  return Object.values(map).sort((a, b) => a.sort.localeCompare(b.sort))
}
