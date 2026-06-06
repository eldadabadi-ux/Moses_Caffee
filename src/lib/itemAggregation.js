/**
 * itemAggregation — flattens receipt items and aggregates them by an ADAPTIVE
 * hierarchy (L1 → L2 → L3 → product name) and time bucket. Powers the dashboard
 * drill-down. "Adaptive" = empty levels are skipped, so you can always drill all
 * the way down to the individual product even when L2/L3 weren't filled in.
 */

const HEB_MONTHS_SHORT = ['ינו','פבר','מרץ','אפר','מאי','יוני','יול','אוג','ספט','אוק','נוב','דצמ']
const DIMS = ['l1', 'l2', 'l3', 'name']
export const DIM_LABEL = { l1: 'קטגוריה', l2: 'תת-קטגוריה', l3: 'תת-תת-קטגוריה', name: 'מוצר' }

/**
 * Flatten all receipts' items into line items: { date, l1, l2, l3, name, price, vendor }.
 * Receipts without items contribute one synthetic item (category_text + amount).
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
        date, l1: (r.category_text || 'שונות').trim(), l2: '', l3: '',
        name: (r.vendor_name || '').trim() || 'כללי', price: parseFloat(r.amount) || 0, vendor,
      })
    }
  }
  return out
}

/** Filter by a drill path: [{ dim, value }]. */
export function filterByPath(items, path) {
  return items.filter(it => path.every(p => (it[p.dim] || '') === p.value))
}

/**
 * The next dimension to group by, given the current path. Skips dimensions that
 * are already in the path or that have no non-empty values in the current scope.
 * Returns null when there's nothing deeper (we're at a leaf product).
 */
export function nextDim(items, path) {
  const used = new Set(path.map(p => p.dim))
  const scoped = filterByPath(items, path)
  for (const dim of DIMS) {
    if (used.has(dim)) continue
    // need at least one non-empty value, and more than just a single repeated value
    const vals = new Set(scoped.map(it => (it[dim] || '').trim()).filter(Boolean))
    if (vals.size >= 1 && (dim === 'name' || vals.size >= 1)) {
      // skip a dim where every scoped item is empty
      if ([...vals].some(Boolean)) return dim
    }
  }
  return null
}

/** Children breakdown for the current path. { dim, rows:[{name,total,count}] }. */
export function childrenBreakdown(items, path) {
  const dim = nextDim(items, path)
  if (!dim) return { dim: null, rows: [] }
  const scoped = filterByPath(items, path)
  const map = {}
  for (const it of scoped) {
    const name = (it[dim] || '').trim()
    if (!name) continue
    if (!map[name]) map[name] = { name, total: 0, count: 0 }
    map[name].total += it.price
    map[name].count += 1
  }
  return { dim, rows: Object.values(map).sort((a, b) => b.total - a.total) }
}

/** Vendor breakdown for the current scope — to compare suppliers of a product. */
export function vendorBreakdown(items, path) {
  const scoped = filterByPath(items, path)
  const map = {}
  for (const it of scoped) {
    const v = it.vendor || 'לא ידוע'
    if (!map[v]) map[v] = { name: v, total: 0, count: 0 }
    map[v].total += it.price
    map[v].count += 1
  }
  return Object.values(map).sort((a, b) => b.total - a.total)
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

export function bucketOf(dateStr, granularity) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, (m || 1) - 1, d || 1)
  switch (granularity) {
    case 'day':   return { key: dateStr, label: `${d}.${m}`, sort: dateStr }
    case 'week': {
      const { year, week } = isoWeek(dt)
      const k = `${year}-W${String(week).padStart(2, '0')}`
      return { key: k, label: `ש'${week}`, sort: k }
    }
    case 'quarter': {
      const q = Math.floor((m - 1) / 3) + 1
      return { key: `${y}-Q${q}`, label: `Q${q} ${y}`, sort: `${y}-${q}` }
    }
    case 'year':  return { key: String(y), label: String(y), sort: String(y) }
    case 'month':
    default:      return { key: `${y}-${String(m).padStart(2,'0')}`, label: `${HEB_MONTHS_SHORT[(m||1)-1]} ${String(y).slice(2)}`, sort: `${y}-${String(m).padStart(2,'0')}` }
  }
}

/** Time series for items matching `path`, optionally also filtered by vendor. */
export function timeSeries(items, path, granularity, vendor = null) {
  let scoped = filterByPath(items, path)
  if (vendor) scoped = scoped.filter(it => it.vendor === vendor)
  const map = {}
  for (const it of scoped) {
    const b = bucketOf(it.date, granularity)
    if (!map[b.key]) map[b.key] = { key: b.key, label: b.label, sort: b.sort, total: 0, count: 0 }
    map[b.key].total += it.price
    map[b.key].count += 1
  }
  return Object.values(map).sort((a, b) => a.sort.localeCompare(b.sort))
}
