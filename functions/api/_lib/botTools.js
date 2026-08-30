/**
 * botTools — the assistant's access to the business's own data (audit R2,
 * client requests #1, #10, #11, #15).
 *
 * BEFORE: chat.js flattened everything into one Hebrew string — the last 30
 * receipts as one line each, the top 25 comparable products, 5 products per
 * supplier — and pasted it into the prompt. The bot could not see line items, or
 * any receipt outside that window, which is exactly what Moses reported: "אין
 * לבוט גישה לכל הקבלות". It also silently truncated as the data grew.
 *
 * NOW: the bot gets tools and pulls what a question actually needs, at any
 * depth. Each tool scopes the tenant explicitly (service role — RLS is not doing
 * the scoping here, guardrail 3), caps its result set, and says so when a cap is
 * hit, so an answer is never quietly built on partial data.
 *
 * Archived receipts are INCLUDED by default: archiving means "sent to the
 * accountant", not "forget it" — statistics and period comparisons must still
 * see them (client request #10).
 */
import { normalizeVendor, vendorSimilarity, ASK_THRESHOLD } from './supplierMatch.js'
import { unitLabel } from './units.js'
import { docTypeOf, isExpenseDoc } from './docTypes.js'

const MAX_ROWS = 4000          // hard cap on receipts pulled for one tool call
const MAX_LIST = 60            // rows returned to the model in a listing

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null }
const ils = (n) => `₪${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('he-IL')}`
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100

const RECEIPT_FIELDS =
  'id,vendor_name,supplier_id,receipt_date,amount,currency,category_text,items,doc_type,archived_at,created_at'

// ── data access ──────────────────────────────────────────────────────────────

function scopeOf({ orgId, userId }) {
  return orgId ? `org_id=eq.${orgId}` : `user_id=eq.${userId}`
}

async function sbGet(url, key, path) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (!res.ok) throw new Error(`supabase ${res.status}`)
  return res.json()
}

/** Receipts for the tenant, optionally narrowed by date, capped and flagged. */
async function loadReceipts(ctx, { from, to } = {}) {
  const filters = [scopeOf(ctx)]
  if (from) filters.push(`receipt_date=gte.${from}`)
  if (to) filters.push(`receipt_date=lte.${to}`)
  const rows = await sbGet(ctx.url, ctx.key,
    `receipts?${filters.join('&')}&select=${RECEIPT_FIELDS}&order=receipt_date.desc.nullslast&limit=${MAX_ROWS + 1}`)
  const truncated = rows.length > MAX_ROWS
  return { rows: truncated ? rows.slice(0, MAX_ROWS) : rows, truncated }
}

/** Canonical supplier catalogue, id → name. */
async function loadSuppliers(ctx) {
  try {
    return await sbGet(ctx.url, ctx.key,
      `suppliers?${scopeOf(ctx)}&merged_into=is.null&select=id,name,phone,email,whatsapp,supplies&order=name`)
  } catch { return [] }
}

// ── shared shaping ───────────────────────────────────────────────────────────

/** Display name for a receipt's supplier — canonical when linked. */
const supplierNameOf = (r, byId) =>
  (r.supplier_id && byId[r.supplier_id]) || (r.vendor_name || '').trim() || 'לא ידוע'

/**
 * Resolve a user-typed supplier name to the canonical rows it covers.
 *
 * Uses the same matcher as the scan pipeline, so "מיזן" finds "מייזן סחר…" — but
 * at the LOWER (ask) threshold, because this is a lookup, not an identity
 * decision: someone asking about "קטיף" means "קטיף ירקות קצוצים בע\"מ", and the
 * cost of a near miss here is a wrong answer, not a corrupted record. The best
 * match wins rather than the first one found.
 */
function resolveSupplierFilter(name, suppliers, receipts) {
  const q = normalizeVendor(name)
  if (!q) return null

  const exact = suppliers.find(s => normalizeVendor(s.name) === q)
  if (exact) return { id: exact.id, name: exact.name }

  let best = null, bestScore = 0
  for (const s of suppliers) {
    const v = vendorSimilarity(s.name, name)
    if (v > bestScore) { best = s; bestScore = v }
  }
  if (best && bestScore >= ASK_THRESHOLD) return { id: best.id, name: best.name }

  // Not in the catalogue yet — fall back to the raw scanned names, gathering
  // every spelling that plausibly refers to the same business.
  const raw = [...new Set(receipts.map(r => (r.vendor_name || '').trim()).filter(Boolean))]
    .filter(v => vendorSimilarity(v, name) >= ASK_THRESHOLD)
  return raw.length ? { id: null, name: raw[0], rawNames: raw } : null
}

const matchesSupplier = (r, filter) => {
  if (!filter) return true
  if (filter.id) return r.supplier_id === filter.id
  const v = (r.vendor_name || '').trim()
  return filter.rawNames ? filter.rawNames.includes(v) : v === filter.name
}

/** Flatten line items, carrying the canonical supplier and unit pricing. */
function flatten(receipts, byId) {
  const out = []
  for (const r of receipts) {
    if (!isExpenseDoc(r)) continue          // summary invoices double-count
    const date = r.receipt_date || (r.created_at || '').slice(0, 10)
    const supplier = supplierNameOf(r, byId)
    for (const it of (Array.isArray(r.items) ? r.items : [])) {
      out.push({
        date, supplier,
        name: (it.item_name || it.category_l3 || 'מוצר').trim(),
        category: (it.category_l1 || r.category_text || 'שונות').trim(),
        qty: num(it.quantity), unit: (it.unit || '').trim(),
        unitPrice: num(it.unit_price), price: num(it.price) || 0,
        perBase: num(it.price_per_base_unit),
        base: it.base_unit || null,
      })
    }
  }
  return out
}

const periodKey = (date, granularity) => {
  const d = String(date || '')
  if (granularity === 'year') return d.slice(0, 4)
  if (granularity === 'quarter') {
    const m = parseInt(d.slice(5, 7), 10)
    return m ? `${d.slice(0, 4)}-Q${Math.ceil(m / 3)}` : ''
  }
  return d.slice(0, 7)                      // month
}

// ── tool definitions (Anthropic tool-use schema) ─────────────────────────────

export const TOOL_DEFS = [
  {
    name: 'query_receipts',
    description:
      'שליפת קבלות/תעודות משלוח/חשבוניות מרכזות לפי מסננים, כולל שורות המוצרים. ' +
      'השתמש כשצריך לראות מסמכים ספציפיים או לענות "מה קניתי מ-X בתאריך Y". ' +
      'כולל קבלות בארכיון כברירת מחדל.',
    input_schema: {
      type: 'object',
      properties: {
        supplier: { type: 'string', description: 'שם ספק (גם איות חלקי או שונה)' },
        from: { type: 'string', description: 'תאריך התחלה YYYY-MM-DD' },
        to: { type: 'string', description: 'תאריך סיום YYYY-MM-DD' },
        product: { type: 'string', description: 'סינון לפי שם מוצר (התאמה חלקית)' },
        category: { type: 'string', description: 'קטגוריה ראשית' },
        doc_type: { type: 'string', enum: ['receipt', 'delivery_note', 'summary_invoice'] },
        include_items: { type: 'boolean', description: 'להחזיר את שורות המוצרים (ברירת מחדל: false)' },
        limit: { type: 'integer', description: `מקסימום מסמכים להחזרה (ברירת מחדל ${MAX_LIST})` },
      },
    },
  },
  {
    name: 'compare_product_prices',
    description:
      'השוואת מחיר של מוצר בין ספקים לפי מחיר ליחידת בסיס (₪ לק"ג / לליטר / ליחידה) — ' +
      'לא לפי סה"כ. השתמש לשאלות "אצל מי זול יותר" ולהמלצות חיסכון.',
    input_schema: {
      type: 'object',
      properties: {
        product: { type: 'string', description: 'שם המוצר; השאר ריק לקבלת כל המוצרים שנקנו מ-2+ ספקים' },
        from: { type: 'string' }, to: { type: 'string' },
        limit: { type: 'integer' },
      },
    },
  },
  {
    name: 'supplier_report',
    description:
      'דו"ח ספק מסכם לפי תקופות — חודש / רבעון / שנה — עם סכומים, מספר מסמכים ופירוט ' +
      'קטגוריות ומוצרים מובילים. השתמש לשאלות "כמה הוצאתי אצל X" ולדו"חות תקופתיים.',
    input_schema: {
      type: 'object',
      properties: {
        supplier: { type: 'string', description: 'שם ספק; ריק = כל הספקים' },
        granularity: { type: 'string', enum: ['month', 'quarter', 'year'], description: 'ברירת מחדל: month' },
        from: { type: 'string' }, to: { type: 'string' },
      },
    },
  },
  {
    name: 'price_changes',
    description:
      'איתור שינויי מחיר: מוצרים שהמחיר ליחידת בסיס שלהם עלה או ירד אצל ספק לאורך זמן, ' +
      'או שנקנים במחירים שונים אצל ספקים שונים. השתמש לתובנות והתראות.',
    input_schema: {
      type: 'object',
      properties: {
        supplier: { type: 'string' },
        min_change_pct: { type: 'number', description: 'שינוי מינימלי באחוזים (ברירת מחדל 8)' },
        from: { type: 'string' }, to: { type: 'string' },
        limit: { type: 'integer' },
      },
    },
  },
]

// ── executors ────────────────────────────────────────────────────────────────

async function toolQueryReceipts(ctx, args) {
  const { rows, truncated } = await loadReceipts(ctx, args)
  const suppliers = await loadSuppliers(ctx)
  const byId = Object.fromEntries(suppliers.map(s => [s.id, s.name]))
  const filter = args.supplier ? resolveSupplierFilter(args.supplier, suppliers, rows) : null
  if (args.supplier && !filter) return { found: 0, note: `לא נמצא ספק בשם "${args.supplier}"` }

  const prod = (args.product || '').trim().toLowerCase()
  const cat = (args.category || '').trim()
  const limit = Math.min(Math.max(1, args.limit || MAX_LIST), MAX_LIST)

  const matched = rows.filter(r =>
    matchesSupplier(r, filter) &&
    (!cat || (r.category_text || '') === cat) &&
    (!args.doc_type || docTypeOf(r) === args.doc_type) &&
    (!prod || (Array.isArray(r.items) && r.items.some(i => (i.item_name || '').toLowerCase().includes(prod)))))

  const total = matched.filter(isExpenseDoc).reduce((s, r) => s + (num(r.amount) || 0), 0)
  return {
    found: matched.length,
    total_spend: ils(total),
    note: truncated ? `הוצגו ${MAX_ROWS} המסמכים האחרונים בלבד` : undefined,
    showing: Math.min(matched.length, limit),
    receipts: matched.slice(0, limit).map(r => ({
      date: r.receipt_date || '(חסר תאריך)',
      supplier: supplierNameOf(r, byId),
      amount: ils(r.amount),
      type: docTypeOf(r),
      category: r.category_text || '',
      archived: !!r.archived_at,
      items: args.include_items
        ? (Array.isArray(r.items) ? r.items : []).map(i => ({
            name: i.item_name, qty: i.quantity, unit: i.unit,
            price: ils(i.price),
            per_base: i.price_per_base_unit != null ? `${ils(i.price_per_base_unit)}/${unitLabel(i.base_unit)}` : null,
          }))
        : undefined,
    })),
  }
}

async function toolComparePrices(ctx, args) {
  const { rows } = await loadReceipts(ctx, args)
  const suppliers = await loadSuppliers(ctx)
  const byId = Object.fromEntries(suppliers.map(s => [s.id, s.name]))
  const flat = flatten(rows, byId)
  const want = (args.product || '').trim().toLowerCase()
  const limit = Math.min(Math.max(1, args.limit || 20), 40)

  // Group by product, then by supplier — comparing ₪ per BASE unit only, so a
  // 1-litre carton and a 12-pack are on the same footing.
  const products = {}
  for (const f of flat) {
    if (want && !f.name.toLowerCase().includes(want)) continue
    if (f.perBase == null || !f.base) continue
    const p = (products[f.name] ||= { name: f.name, base: f.base, suppliers: {}, spend: 0 })
    if (p.base !== f.base) continue          // never mix kg with litres
    p.spend += f.price
    const s = (p.suppliers[f.supplier] ||= { prices: [], spend: 0, last: '' })
    s.prices.push(f.perBase); s.spend += f.price
    if (f.date > s.last) s.last = f.date
  }

  const rowsOut = Object.values(products)
    .filter(p => Object.keys(p.suppliers).length >= 2)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, limit)
    .map(p => {
      const per = Object.entries(p.suppliers).map(([name, s]) => ({
        supplier: name,
        avg_per_base: r2(s.prices.reduce((x, y) => x + y, 0) / s.prices.length),
        purchases: s.prices.length,
        last_bought: s.last,
      })).sort((a, b) => a.avg_per_base - b.avg_per_base)
      const cheapest = per[0], dearest = per[per.length - 1]
      const savingPct = dearest.avg_per_base > 0
        ? Math.round(((dearest.avg_per_base - cheapest.avg_per_base) / dearest.avg_per_base) * 100) : 0
      return {
        product: p.name, unit: unitLabel(p.base),
        cheapest: `${cheapest.supplier} ${ils(cheapest.avg_per_base)}/${unitLabel(p.base)}`,
        most_expensive: `${dearest.supplier} ${ils(dearest.avg_per_base)}/${unitLabel(p.base)}`,
        difference_pct: savingPct,
        by_supplier: per,
      }
    })

  return {
    comparable_products: rowsOut.length,
    note: rowsOut.length ? undefined
      : 'אין מוצרים שנקנו מ-2+ ספקים עם יחידת מידה תואמת — אי אפשר להשוות מחיר',
    products: rowsOut,
  }
}

async function toolSupplierReport(ctx, args) {
  const { rows } = await loadReceipts(ctx, args)
  const suppliers = await loadSuppliers(ctx)
  const byId = Object.fromEntries(suppliers.map(s => [s.id, s.name]))
  const gran = ['month', 'quarter', 'year'].includes(args.granularity) ? args.granularity : 'month'
  const filter = args.supplier ? resolveSupplierFilter(args.supplier, suppliers, rows) : null
  if (args.supplier && !filter) return { note: `לא נמצא ספק בשם "${args.supplier}"` }

  const scoped = rows.filter(r => matchesSupplier(r, filter) && isExpenseDoc(r))
  const byPeriod = {}, byCategory = {}, byProduct = {}
  let total = 0, docs = 0

  for (const r of scoped) {
    const date = r.receipt_date || (r.created_at || '').slice(0, 10)
    const key = periodKey(date, gran) || '(חסר תאריך)'
    const amt = num(r.amount) || 0
    total += amt; docs++
    ;(byPeriod[key] ||= { period: key, total: 0, documents: 0 })
    byPeriod[key].total += amt; byPeriod[key].documents++
    byCategory[r.category_text || 'שונות'] = (byCategory[r.category_text || 'שונות'] || 0) + amt
    for (const it of (Array.isArray(r.items) ? r.items : [])) {
      const n = (it.item_name || '').trim()
      if (n) byProduct[n] = (byProduct[n] || 0) + (num(it.price) || 0)
    }
  }

  const top = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([name, v]) => ({ name, total: ils(v) }))

  return {
    supplier: filter?.name || 'כל הספקים',
    granularity: gran,
    documents: docs,
    total: ils(total),
    // Only real sums — never an extrapolated period average from a few receipts.
    periods: Object.values(byPeriod).sort((a, b) => a.period.localeCompare(b.period))
      .map(p => ({ period: p.period, total: ils(p.total), documents: p.documents })),
    top_categories: top(byCategory, 8),
    top_products: top(byProduct, 12),
  }
}

async function toolPriceChanges(ctx, args) {
  const { rows } = await loadReceipts(ctx, args)
  const suppliers = await loadSuppliers(ctx)
  const byId = Object.fromEntries(suppliers.map(s => [s.id, s.name]))
  const flat = flatten(rows, byId)
  const minPct = Number(args.min_change_pct) > 0 ? Number(args.min_change_pct) : 8
  const limit = Math.min(Math.max(1, args.limit || 20), 40)
  const supFilter = (args.supplier || '').trim()

  // Per product+supplier, ordered by date — compare the earliest and latest
  // price per base unit. Only base-unit prices; a raw line total would flag a
  // bigger order as a price rise.
  const series = {}
  for (const f of flat) {
    if (f.perBase == null || !f.base) continue
    if (supFilter && vendorSimilarity(f.supplier, supFilter) < ASK_THRESHOLD) continue
    const k = `${f.name}|||${f.supplier}`
    ;(series[k] ||= { product: f.name, supplier: f.supplier, base: f.base, points: [] })
      .points.push({ date: f.date, price: f.perBase })
  }

  const changes = []
  for (const s of Object.values(series)) {
    if (s.points.length < 2) continue
    s.points.sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    const first = s.points[0], last = s.points[s.points.length - 1]
    if (!(first.price > 0)) continue
    const pct = ((last.price - first.price) / first.price) * 100
    if (Math.abs(pct) < minPct) continue
    changes.push({
      product: s.product, supplier: s.supplier, unit: unitLabel(s.base),
      from: `${ils(first.price)} (${first.date})`,
      to: `${ils(last.price)} (${last.date})`,
      change_pct: Math.round(pct),
      direction: pct > 0 ? 'עלייה' : 'ירידה',
      observations: s.points.length,
    })
  }

  changes.sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct))
  return {
    found: changes.length,
    min_change_pct: minPct,
    note: changes.length ? undefined
      : 'לא נמצאו שינויי מחיר מעל הסף — ייתכן שאין מספיק רכישות חוזרות של אותו מוצר',
    changes: changes.slice(0, limit),
  }
}

const EXECUTORS = {
  query_receipts: toolQueryReceipts,
  compare_product_prices: toolComparePrices,
  supplier_report: toolSupplierReport,
  price_changes: toolPriceChanges,
}

/**
 * Run one tool call. Never throws — a failure comes back as data the model can
 * report honestly instead of an exception that kills the conversation.
 */
export async function runTool(name, args, ctx) {
  const fn = EXECUTORS[name]
  if (!fn) return { error: `כלי לא מוכר: ${name}` }
  try {
    return await fn(ctx, args || {})
  } catch (err) {
    console.error('[botTools]', name, err?.message)
    return { error: 'שליפת הנתונים נכשלה', detail: err?.message }
  }
}

/**
 * A small orientation block: what data EXISTS, so the model knows what it can
 * ask for. Deliberately not the data itself — that is what the tools are for.
 */
export async function buildOrientation(ctx) {
  const [{ rows }, suppliers] = await Promise.all([loadReceipts(ctx), loadSuppliers(ctx)])
  const expense = rows.filter(isExpenseDoc)
  const dates = rows.map(r => r.receipt_date).filter(Boolean).sort()
  const total = expense.reduce((s, r) => s + (num(r.amount) || 0), 0)
  const byId = Object.fromEntries(suppliers.map(s => [s.id, s.name]))

  const names = [...new Set(rows.map(r => supplierNameOf(r, byId)))].sort((a, b) => a.localeCompare(b, 'he'))
  const cats = [...new Set(rows.map(r => (r.category_text || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'he'))

  return {
    documents: rows.length,
    archived: rows.filter(r => r.archived_at).length,
    delivery_notes: rows.filter(r => docTypeOf(r) === 'delivery_note').length,
    summary_invoices: rows.filter(r => docTypeOf(r) === 'summary_invoice').length,
    date_range: dates.length ? `${dates[0]} … ${dates[dates.length - 1]}` : 'אין תאריכים',
    total_spend: ils(total),
    suppliers: names,
    categories: cats,
  }
}
