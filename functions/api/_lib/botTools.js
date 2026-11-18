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
 *
 * Catering events are EXCLUDED by default: they are a separate book of account
 * and must not colour the café's numbers (client request #17). A caller has to
 * ask for them by name.
 */
import { normalizeVendor, vendorSimilarity, ASK_THRESHOLD } from './supplierMatch.js'
import { unitLabel } from './units.js'
import { docTypeOf, isExpenseDoc } from './docTypes.js'
import { bookOf, DEFAULT_BOOK, bookLabel } from './books.js'
import { quoteTotals } from './quotes.js'
import { budgetStatus, periodLabel } from './budgetMath.js'
import { expandInstallments, countsAsDoc, installmentsOf } from './installments.js'

const MAX_ROWS = 4000          // hard cap on receipts pulled for one tool call
const MAX_LIST = 60            // rows returned to the model in a listing

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null }
const ils = (n) => `₪${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('he-IL')}`
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100

const RECEIPT_FIELDS =
  'id,vendor_name,supplier_id,receipt_date,amount,currency,category_text,items,doc_type,book,archived_at,created_at,' +
  'doc_number,matched_invoice_id,reconciliation,amount_before_vat,vat_amount,installments,status,source'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Server-side book predicate, matching bookOf()'s semantics exactly:
 * a NULL book counts as the café, so the café filter must accept both. Pushing
 * this into the query means the MAX_ROWS cap applies to the book we actually
 * want — otherwise a tenant with >MAX_ROWS rows across both books could lose
 * café rows to the cap before the client-side filter ever ran.
 */
function bookPredicate(book) {
  if (book === 'all') return null
  if (book === 'events') return 'book=eq.events'
  return 'or=(book.is.null,book.eq.cafe)'   // café (default) — NULL included
}

// ── data access ──────────────────────────────────────────────────────────────

/**
 * Encode a value before it enters a PostgREST query string. The date filters
 * below come from the MODEL, which means ultimately from user text — a '#' in
 * one would truncate the URL and drop the tenant predicate from a service-role
 * request (guardrail 3).
 */
const q = (v) => encodeURIComponent(String(v ?? ''))

function scopeOf({ orgId, userId }) {
  return orgId ? `org_id=eq.${q(orgId)}` : `user_id=eq.${q(userId)}`
}

async function sbGet(url, key, path) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (!res.ok) throw new Error(`supabase ${res.status}`)
  return res.json()
}

/**
 * Receipts for the tenant, optionally narrowed by date, capped and flagged.
 *
 * `book` defaults to the café: catering events are a separate ledger and must
 * never leak into the café's numbers. Pass book:'events' for the catering book,
 * or book:'all' to deliberately span both.
 */
async function loadReceipts(ctx, { from, to, book } = {}) {
  const filters = [scopeOf(ctx)]
  // Only well-formed dates reach the query at all — anything else is dropped
  // rather than passed through as a filter fragment. A malformed date is reported
  // back (badDates) so the tool can SAY it ignored the filter, instead of
  // silently answering over all time.
  const badDates = []
  if (from != null && String(from).trim()) {
    if (DATE_RE.test(String(from))) filters.push(`receipt_date=gte.${q(from)}`)
    else badDates.push(String(from))
  }
  if (to != null && String(to).trim()) {
    if (DATE_RE.test(String(to))) filters.push(`receipt_date=lte.${q(to)}`)
    else badDates.push(String(to))
  }
  const wanted = book === 'all' ? null : (book === 'events' ? 'events' : DEFAULT_BOOK)
  const bookPred = bookPredicate(book)
  if (bookPred) filters.push(bookPred)
  const rows = await sbGet(ctx.url, ctx.key,
    `receipts?${filters.join('&')}&select=${RECEIPT_FIELDS}&order=receipt_date.desc.nullslast&limit=${MAX_ROWS + 1}`)
  const truncated = rows.length > MAX_ROWS
  // Keep the client-side book filter too: a belt-and-suspenders guard, and the
  // only line that scopes the book in tests that stub the REST layer.
  const scoped = wanted ? rows.filter(r => bookOf(r) === wanted) : rows
  return { rows: truncated ? scoped.slice(0, MAX_ROWS) : scoped, truncated, book: wanted, badDates }
}

const dateNote = (badDates) =>
  badDates && badDates.length
    ? `התעלמתי מתאריך לא תקין: ${badDates.join(', ')} (נדרש פורמט YYYY-MM-DD)`
    : undefined

/** Canonical supplier catalogue, id → name. */
async function loadSuppliers(ctx) {
  try {
    return await sbGet(ctx.url, ctx.key,
      `suppliers?${scopeOf(ctx)}&merged_into=is.null&select=id,name,phone,email,whatsapp,supplies&order=name`)
  } catch { return [] }
}

/** The tenant's category tree rows (L1→L3). */
async function loadCategories(ctx) {
  try {
    return await sbGet(ctx.url, ctx.key,
      `categories?${scopeOf(ctx)}&select=id,name,parent_id,level&order=level.asc,sort_order.asc`)
  } catch { return [] }
}

/** The tenant's supplier budgets. */
async function loadBudgets(ctx) {
  try {
    return await sbGet(ctx.url, ctx.key,
      `supplier_budgets?${scopeOf(ctx)}&select=supplier_id,period,amount,alert_pct,note`)
  } catch { return [] }
}

// ── shared shaping ───────────────────────────────────────────────────────────

/** Display name for a receipt's supplier — canonical when linked. */
const supplierNameOf = (r, byId) =>
  (r.supplier_id && byId[r.supplier_id]) || (r.vendor_name || '').trim() || 'לא ידוע'

/**
 * Reconciliation state of a document, in words the model can report directly
 * (client request #3). A summary invoice is matched/rounding/mismatch once
 * confirmed, otherwise pending; a delivery note is matched to an invoice or open;
 * a plain receipt has no reconciliation dimension.
 */
function reconStatusOf(r) {
  const type = docTypeOf(r)
  if (type === 'summary_invoice') {
    const st = r.reconciliation?.status
    if (st === 'matched' || st === 'rounding') return 'מותאמת'
    if (st === 'mismatch') return 'מותאמת עם פער'
    return 'ממתינה להתאמה'
  }
  if (type === 'delivery_note') return r.matched_invoice_id ? 'מותאמת לחשבונית' : 'פתוחה (ללא חשבונית מרכזת)'
  return null
}

/** Printed VAT breakdown of a document when the scan captured one. */
function vatOf(r) {
  const before = num(r.amount_before_vat), vat = num(r.vat_amount)
  if (before == null && vat == null) return null
  return {
    before_vat: before != null ? ils(before) : null,
    vat: vat != null ? ils(vat) : null,
    total: ils(r.amount),
  }
}

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
    name: 'receipt_detail',
    description:
      'כל הפרטים של מסמך בודד — כל השדות, כל שורות הפריטים, פירוט מע"מ, סטטוס התאמה, ' +
      'תשלומים, מקור (סריקה/מייל, כולל מאיזו כתובת מייל הגיע) וסטטוס אישור. ' +
      'אתר לפי מספר מסמך, או לפי ספק + תאריך. השתמש כשנשאלת על מסמך ספציפי.',
    input_schema: {
      type: 'object',
      properties: {
        doc_number: { type: 'string', description: 'מספר המסמך/החשבונית' },
        supplier: { type: 'string', description: 'שם ספק (גם איות חלקי)' },
        date: { type: 'string', description: 'תאריך המסמך YYYY-MM-DD' },
        id: { type: 'string', description: 'מזהה פנימי (אם הוחזר מכלי אחר)' },
      },
    },
  },
  {
    name: 'search_items',
    description:
      'חיפוש בשורות הפריטים של כל המסמכים: כל הקניות של מוצר נתון — תאריך, ספק, כמות, ' +
      'מחיר ליחידה ולשורה ומחיר ליחידת בסיס. השתמש לשאלות "מתי קניתי X", "כמה X קנינו החודש", ' +
      '"באיזה מחיר קניתי X לאורך זמן".',
    input_schema: {
      type: 'object',
      properties: {
        product: { type: 'string', description: 'שם המוצר (התאמה חלקית) — חובה' },
        supplier: { type: 'string', description: 'סינון לפי ספק (אופציונלי)' },
        from: { type: 'string' }, to: { type: 'string' },
        book: { type: 'string', enum: ['cafe', 'events', 'all'], description: 'ברירת מחדל: cafe' },
        limit: { type: 'integer', description: 'מקסימום שורות (ברירת מחדל 40)' },
      },
      required: ['product'],
    },
  },
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
        book: { type: 'string', enum: ['cafe', 'events', 'all'], description: 'ספר החשבונות — cafe (ברירת מחדל) / events (קייטרינג) / all' },
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
        book: { type: 'string', enum: ['cafe', 'events', 'all'], description: 'ספר החשבונות — cafe (ברירת מחדל) / events (קייטרינג) / all' },
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
        book: { type: 'string', enum: ['cafe', 'events', 'all'], description: 'ספר החשבונות — cafe (ברירת מחדל) / events (קייטרינג) / all' },
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
        book: { type: 'string', enum: ['cafe', 'events', 'all'], description: 'ספר החשבונות — cafe (ברירת מחדל) / events (קייטרינג) / all' },
        from: { type: 'string' }, to: { type: 'string' },
        limit: { type: 'integer' },
      },
    },
  },
  {
    name: 'event_quotes',
    description:
      'הצעות מחיר לאירועי קייטרינג (ספר האירועים): רשימה וסינון לפי סטטוס, תאריך אירוע או לקוח, ' +
      'עם הסכום, הרווח והמחיר לאורח של כל הצעה. השתמש לשאלות "אילו הצעות פתוחות", ' +
      '"כמה הצעות התקבלו החודש", "מה ההצעה לאירוע של X".',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['draft', 'sent', 'accepted', 'declined'], description: 'סטטוס ההצעה' },
        customer: { type: 'string', description: 'סינון לפי שם לקוח או כותרת (התאמה חלקית)' },
        from: { type: 'string', description: 'תאריך אירוע מ- YYYY-MM-DD' },
        to: { type: 'string', description: 'תאריך אירוע עד YYYY-MM-DD' },
        limit: { type: 'integer' },
      },
    },
  },
  {
    name: 'category_tree',
    description:
      'עץ הקטגוריות המלא של העסק (עד 3 רמות) עם ההוצאה בכל קטגוריה ותת-קטגוריה. ' +
      'השתמש לשאלות "אילו קטגוריות יש", "כמה הוצאתי על תת-קטגוריה X", "פירוט הוצאות לפי מבנה הקטגוריות".',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'תאריך התחלה YYYY-MM-DD' },
        to: { type: 'string', description: 'תאריך סיום YYYY-MM-DD' },
        book: { type: 'string', enum: ['cafe', 'events', 'all'], description: 'ספר החשבונות — cafe (ברירת מחדל) / events / all' },
      },
    },
  },
  {
    name: 'budget_status',
    description:
      'מצב תקציבי הספקים לתקופה הנוכחית: סכום התקציב, הניצול, היתרה ומי חרג או מתקרב לחריגה. ' +
      'השתמש לשאלות "איך אנחנו מול התקציב", "מי חרג מהתקציב", "כמה נשאר בתקציב של X".',
    input_schema: {
      type: 'object',
      properties: {
        supplier: { type: 'string', description: 'שם ספק (גם איות חלקי); ריק = כל התקציבים' },
      },
    },
  },
  {
    name: 'supplier_info',
    description:
      'פרטי ספק: אנשי קשר (טלפון / אימייל / וואטסאפ), תחומי אספקה, כל האיותים שבהם הופיע, ' +
      'וסיכום פעילות (מספר מסמכים, סה"כ הוצאה, קנייה אחרונה). השאר ריק לרשימת כל הספקים. ' +
      'השתמש לשאלות "מה הטלפון של X", "ממי קונים ירקות", "מתי קנינו לאחרונה מ-X".',
    input_schema: {
      type: 'object',
      properties: {
        supplier: { type: 'string', description: 'שם ספק (גם איות חלקי); ריק = כל הספקים' },
        book: { type: 'string', enum: ['cafe', 'events', 'all'], description: 'ספר החשבונות — cafe (ברירת מחדל) / events / all' },
      },
    },
  },
]

// ── executors ────────────────────────────────────────────────────────────────

async function toolQueryReceipts(ctx, args) {
  const loaded = await loadReceipts(ctx, args)
  const { rows, truncated } = loaded
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
    book: bookLabel(loaded.book) || 'הכל',
    found: matched.length,
    total_spend: ils(total),
    note: [truncated ? `הוצגו ${MAX_ROWS} המסמכים האחרונים בלבד` : null, dateNote(loaded.badDates)]
      .filter(Boolean).join(' · ') || undefined,
    showing: Math.min(matched.length, limit),
    receipts: matched.slice(0, limit).map(r => ({
      date: r.receipt_date || '(חסר תאריך)',
      supplier: supplierNameOf(r, byId),
      amount: ils(r.amount),
      type: docTypeOf(r),
      doc_number: r.doc_number || undefined,
      installments: installmentsOf(r) || undefined,
      pending: r.status === 'pending' ? true : undefined,
      source: r.source || undefined,
      reconciliation: reconStatusOf(r) || undefined,
      vat: vatOf(r) || undefined,
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
  const loaded = await loadReceipts(ctx, args)
  const { rows } = loaded
  const suppliers = await loadSuppliers(ctx)
  const byId = Object.fromEntries(suppliers.map(s => [s.id, s.name]))
  const gran = ['month', 'quarter', 'year'].includes(args.granularity) ? args.granularity : 'month'
  const filter = args.supplier ? resolveSupplierFilter(args.supplier, suppliers, rows) : null
  if (args.supplier && !filter) return { note: `לא נמצא ספק בשם "${args.supplier}"` }

  const docsOnly = rows.filter(r => matchesSupplier(r, filter) && isExpenseDoc(r))
  // Installment purchases contribute 1/n to each month they span (decision A).
  const win = { from: DATE_RE.test(String(args.from || '')) ? args.from : undefined,
                to:   DATE_RE.test(String(args.to || ''))   ? args.to   : undefined }
  const scoped = expandInstallments(docsOnly, win)
  const byPeriod = {}, byCategory = {}, byProduct = {}
  let total = 0, docs = 0

  for (const r of scoped) {
    const date = r.receipt_date || (r.created_at || '').slice(0, 10)
    const key = periodKey(date, gran) || '(חסר תאריך)'
    const amt = num(r.amount) || 0
    total += amt; if (countsAsDoc(r)) docs++
    ;(byPeriod[key] ||= { period: key, total: 0, documents: 0 })
    byPeriod[key].total += amt; if (countsAsDoc(r)) byPeriod[key].documents++
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
    book: bookLabel(loaded.book) || 'הכל',
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

async function toolSupplierInfo(ctx, args) {
  const loaded = await loadReceipts(ctx, args)
  const { rows } = loaded
  const suppliers = await loadSuppliers(ctx)
  const byId = Object.fromEntries(suppliers.map(s => [s.id, s.name]))

  // Stats accumulated from this book's receipts, keyed by canonical name.
  const stats = {}
  for (const r of rows) {
    if (!isExpenseDoc(r)) continue
    const name = supplierNameOf(r, byId)
    const s = (stats[name] ||= { name, documents: 0, total: 0, first: '', last: '', spellings: new Set(), categories: {} })
    const date = r.receipt_date || (r.created_at || '').slice(0, 10)
    s.documents++; s.total += num(r.amount) || 0
    if (date) { if (!s.first || date < s.first) s.first = date; if (date > s.last) s.last = date }
    const raw = (r.vendor_name || '').trim(); if (raw) s.spellings.add(raw)
    const cat = (r.category_text || 'שונות').trim(); s.categories[cat] = (s.categories[cat] || 0) + (num(r.amount) || 0)
  }
  const catalogByName = Object.fromEntries(suppliers.map(s => [s.name, s]))
  const topCats = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([name, v]) => ({ name, total: ils(v) }))

  const card = (name) => {
    const s = stats[name] || { documents: 0, total: 0, first: '', last: '', spellings: new Set(), categories: {} }
    const cat = catalogByName[name] || {}
    return {
      supplier: name,
      contact: { phone: cat.phone || null, email: cat.email || null, whatsapp: cat.whatsapp || null },
      supplies: cat.supplies || null,
      spellings: [...s.spellings].filter(v => v !== name),
      documents: s.documents,
      total_spend: ils(s.total),
      first_purchase: s.first || null,
      last_purchase: s.last || null,
      top_categories: topCats(s.categories),
    }
  }

  if (args.supplier) {
    const filter = resolveSupplierFilter(args.supplier, suppliers, rows)
    if (!filter) return { note: `לא נמצא ספק בשם "${args.supplier}"` }
    return { book: bookLabel(loaded.book) || 'הכל', ...card(filter.name) }
  }

  // No supplier → a directory: every catalogued supplier + anyone seen only on
  // receipts, ranked by spend, capped.
  const names = new Set([...suppliers.map(s => s.name), ...Object.keys(stats)])
  const list = [...names]
    .map(card)
    .sort((a, b) => (stats[b.supplier]?.total || 0) - (stats[a.supplier]?.total || 0))
    .slice(0, MAX_LIST)
  return { book: bookLabel(loaded.book) || 'הכל', count: names.size, showing: list.length, suppliers: list }
}

const QUOTE_STATUS_HE = { draft: 'טיוטה', sent: 'נשלחה', accepted: 'התקבלה', declined: 'נדחתה' }

async function toolEventQuotes(ctx, args) {
  const filters = [scopeOf(ctx)]
  const badDates = []
  if (args.status && Object.keys(QUOTE_STATUS_HE).includes(args.status)) filters.push(`status=eq.${q(args.status)}`)
  if (args.from != null && String(args.from).trim()) {
    if (DATE_RE.test(String(args.from))) filters.push(`event_date=gte.${q(args.from)}`)
    else badDates.push(String(args.from))
  }
  if (args.to != null && String(args.to).trim()) {
    if (DATE_RE.test(String(args.to))) filters.push(`event_date=lte.${q(args.to)}`)
    else badDates.push(String(args.to))
  }
  const rows = await sbGet(ctx.url, ctx.key,
    `event_quotes?${filters.join('&')}&select=*&order=event_date.desc.nullslast&limit=${MAX_LIST + 1}`)
  const cust = (args.customer || '').trim().toLowerCase()
  const matched = rows.filter(r =>
    !cust || `${r.customer_name || ''} ${r.title || ''}`.toLowerCase().includes(cust))
  const limit = Math.min(Math.max(1, args.limit || MAX_LIST), MAX_LIST)

  const byStatus = {}
  let acceptedTotal = 0
  const quotes = matched.slice(0, limit).map(qr => {
    const t = quoteTotals(qr)
    byStatus[qr.status] = (byStatus[qr.status] || 0) + 1
    if (qr.status === 'accepted') acceptedTotal += t.total
    return {
      title: qr.title,
      customer: qr.customer_name || null,
      event_date: qr.event_date || null,
      guests: qr.guests || null,
      status: QUOTE_STATUS_HE[qr.status] || qr.status,
      total: ils(t.total),
      per_guest: t.per_guest != null ? ils(t.per_guest) : null,
      // Profit only when every line carries a cost — a partial figure would
      // read as a margin and be wrong in the flattering direction.
      profit: t.fully_costed ? ils(t.profit) : null,
      margin_pct: t.fully_costed ? t.margin_pct : null,
      valid_until: qr.valid_until || null,
      notes: qr.notes || undefined,
    }
  })
  return {
    found: matched.length,
    showing: quotes.length,
    by_status: Object.fromEntries(Object.entries(byStatus).map(([k, v]) => [QUOTE_STATUS_HE[k] || k, v])),
    accepted_total: ils(acceptedTotal),
    note: [matched.length > limit ? `הוצגו ${limit} ההצעות האחרונות בלבד` : null, dateNote(badDates)]
      .filter(Boolean).join(' · ') || (matched.length ? undefined : 'לא נמצאו הצעות מחיר מתאימות'),
    quotes,
  }
}

async function toolCategoryTree(ctx, args) {
  const [cats, loaded] = await Promise.all([loadCategories(ctx), loadReceipts(ctx, args)])
  const { rows } = loaded
  const expense = rows.filter(isExpenseDoc)

  // Spend by name per level: L1 from the receipt's own category, L2/L3 from the
  // line items (the same sources the dashboard drill-down aggregates).
  const l1Spend = {}, l2Spend = {}, l3Spend = {}
  for (const r of expense) {
    const l1 = (r.category_text || 'שונות').trim()
    l1Spend[l1] = (l1Spend[l1] || 0) + (num(r.amount) || 0)
    for (const it of (Array.isArray(r.items) ? r.items : [])) {
      const p = num(it.price) || 0
      const c2 = (it.category_l2 || '').trim(), c3 = (it.category_l3 || '').trim()
      if (c2) l2Spend[c2] = (l2Spend[c2] || 0) + p
      if (c3) l3Spend[c3] = (l3Spend[c3] || 0) + p
    }
  }

  const spendOf = (cat) => (cat.level === 1 ? l1Spend : cat.level === 2 ? l2Spend : l3Spend)[cat.name] || 0
  const children = (id, lvl) => cats.filter(c => c.parent_id === id && c.level === lvl)
  const node = (cat) => {
    const kids = children(cat.id, cat.level + 1).map(node)
    const out = { name: cat.name, total: ils(spendOf(cat)) }
    if (kids.length) out.children = kids
    return out
  }
  const tree = cats.filter(c => c.level === 1).map(node)

  // Receipt categories that exist on documents but not in the tree.
  const inTree = new Set(cats.filter(c => c.level === 1).map(c => c.name))
  const orphans = Object.entries(l1Spend).filter(([name]) => !inTree.has(name))
    .map(([name, v]) => ({ name, total: ils(v) }))

  return {
    book: bookLabel(loaded.book) || 'הכל',
    categories: cats.filter(c => c.level === 1).length,
    subcategories: cats.filter(c => c.level > 1).length,
    note: dateNote(loaded.badDates),
    tree,
    uncategorized: orphans.length ? orphans : undefined,
  }
}

const BUDGET_STATE_HE = { over: 'חריגה', warn: 'קרוב לחריגה', ok: 'תקין' }

async function toolBudgetStatus(ctx, args) {
  const [budgets, suppliers, loaded] = await Promise.all([
    loadBudgets(ctx), loadSuppliers(ctx), loadReceipts(ctx),
  ])
  if (!budgets.length) return { note: 'לא הוגדרו תקציבי ספקים. מגדירים תקציב בדף הספק (ספקים ← בחירת ספק).' }
  const { rows } = loaded
  const byId = Object.fromEntries(suppliers.map(s => [s.id, s.name]))

  let wanted = budgets
  if (args.supplier) {
    const filter = resolveSupplierFilter(args.supplier, suppliers, rows)
    if (!filter || !filter.id) return { note: `לא נמצא ספק בשם "${args.supplier}" עם תקציב מוגדר` }
    wanted = budgets.filter(b => b.supplier_id === filter.id)
    if (!wanted.length) return { note: `לספק "${filter.name}" לא הוגדר תקציב` }
  }

  const order = { over: 0, warn: 1, ok: 2 }
  const items = wanted.map(b => {
    // Budget spend counts linked receipts only — the same rule the supplier page
    // shows, so the bot and the UI never disagree on utilization.
    const own = rows.filter(r => r.supplier_id === b.supplier_id)
    const st = budgetStatus(b, own)
    if (!st) return null
    return {
      supplier: byId[b.supplier_id] || '(ספק שנמחק)',
      period: periodLabel(b.period),
      window: st.window.label,
      budget: ils(st.amount),
      used: ils(st.used),
      used_pct: st.pct,
      remaining: ils(st.remaining),
      state: BUDGET_STATE_HE[st.state],
      _ord: order[st.state] ?? 3, _pct: st.pct,
    }
  }).filter(Boolean)
    .sort((a, b) => a._ord - b._ord || b._pct - a._pct)
    .map(({ _ord, _pct, ...rest }) => rest)

  return {
    budgets: items.length,
    over: items.filter(i => i.state === BUDGET_STATE_HE.over).length,
    near: items.filter(i => i.state === BUDGET_STATE_HE.warn).length,
    items,
  }
}


// Every field of one document — the assistant must be able to answer about the
// smallest detail of a specific receipt (client fixes 18.11.26 §3).
async function toolReceiptDetail(ctx, args) {
  const scope = scopeOf(ctx)
  const fullById = async (id) =>
    (await sbGet(ctx.url, ctx.key, `receipts?${scope}&id=eq.${q(id)}&select=*&limit=1`))[0] || null

  let row = null
  if (args.id) row = await fullById(args.id)
  if (!row && args.doc_number) {
    const rows = await sbGet(ctx.url, ctx.key,
      `receipts?${scope}&doc_number=eq.${q(args.doc_number)}&select=*&order=receipt_date.desc&limit=5`)
    // Client-side guard too (same belt-and-suspenders as the book filter — and
    // the only line that filters in tests that stub the REST layer).
    row = rows.find(r => String(r.doc_number || '') === String(args.doc_number)) || null
  }
  if (!row && (args.supplier || args.date)) {
    const { rows } = await loadReceipts(ctx, { book: 'all' })
    const suppliers = await loadSuppliers(ctx)
    const filter = args.supplier ? resolveSupplierFilter(args.supplier, suppliers, rows) : null
    if (args.supplier && !filter) return { found: false, note: `לא נמצא ספק בשם "${args.supplier}"` }
    const wantDate = DATE_RE.test(String(args.date || '')) ? args.date : null
    const hit = rows.find(r => matchesSupplier(r, filter) && (!wantDate || r.receipt_date === wantDate))
    if (hit) row = await fullById(hit.id)
  }
  if (!row) return { found: false, note: 'לא נמצא מסמך מתאים — נסה query_receipts לרשימה' }

  const suppliers = await loadSuppliers(ctx)
  const byId = Object.fromEntries(suppliers.map(s => [s.id, s.name]))
  const inst = installmentsOf(row)
  return {
    found: true,
    id: row.id,
    date: row.receipt_date || '(חסר תאריך)',
    supplier: supplierNameOf(row, byId),
    vendor_as_scanned: row.vendor_name || '',
    amount: ils(row.amount),
    before_vat: row.amount_before_vat != null ? ils(row.amount_before_vat) : undefined,
    vat: vatOf(row) || undefined,
    vat_rate: row.vat_rate || undefined,
    currency: row.currency || 'ILS',
    type: docTypeOf(row),
    doc_number: row.doc_number || undefined,
    book: bookLabel(bookOf(row)),
    status: row.status === 'pending' ? 'ממתין לאישור' : 'מאושר',
    source: row.source || 'ידני',
    email_from: row.source_meta?.from || undefined,
    email_subject: row.source_meta?.subject || undefined,
    archived: !!row.archived_at,
    installments: inst || undefined,
    monthly_part: inst ? ils((num(row.amount) || 0) / inst) : undefined,
    reconciliation: reconStatusOf(row) || undefined,
    category: row.category_text || '',
    items: (Array.isArray(row.items) ? row.items : []).map(i => ({
      name: i.item_name, qty: i.quantity, unit: i.unit || undefined,
      unit_price: i.unit_price ? ils(i.unit_price) : undefined,
      line_total: ils(i.price),
      per_base: i.price_per_base_unit != null ? `${ils(i.price_per_base_unit)}/${unitLabel(i.base_unit)}` : undefined,
      category: [i.category_l1, i.category_l2, i.category_l3].filter(Boolean).join(' › ') || undefined,
    })),
  }
}

// Item-level search across every document (client fixes 18.11.26 §3: the
// assistant must know every line ever bought, not just document totals).
async function toolSearchItems(ctx, args) {
  const want = (args.product || '').trim().toLowerCase()
  if (!want) return { matches: 0, note: 'נדרש שם מוצר לחיפוש (product)' }
  const loaded = await loadReceipts(ctx, args)
  const suppliers = await loadSuppliers(ctx)
  const byId = Object.fromEntries(suppliers.map(s => [s.id, s.name]))
  const filter = args.supplier ? resolveSupplierFilter(args.supplier, suppliers, loaded.rows) : null
  if (args.supplier && !filter) return { matches: 0, note: `לא נמצא ספק בשם "${args.supplier}"` }

  const flat = flatten(loaded.rows.filter(r => matchesSupplier(r, filter)), byId)
    .filter(f => f.name.toLowerCase().includes(want))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  const limit = Math.min(Math.max(1, args.limit || 40), 100)
  const spend = flat.reduce((s, f) => s + (f.price || 0), 0)
  return {
    book: bookLabel(loaded.book) || 'הכל',
    matches: flat.length,
    total_spend: ils(spend),
    note: [loaded.truncated ? `נסרקו ${MAX_ROWS} המסמכים האחרונים בלבד` : null, dateNote(loaded.badDates)]
      .filter(Boolean).join(' · ') || undefined,
    showing: Math.min(flat.length, limit),
    purchases: flat.slice(0, limit).map(f => ({
      date: f.date, supplier: f.supplier, name: f.name,
      qty: f.qty || undefined, unit: f.unit || undefined,
      unit_price: f.unitPrice ? ils(f.unitPrice) : undefined,
      line_total: ils(f.price),
      per_base: f.perBase != null ? `${ils(f.perBase)}/${unitLabel(f.base)}` : undefined,
    })),
  }
}

const EXECUTORS = {
  receipt_detail: toolReceiptDetail,
  search_items: toolSearchItems,
  query_receipts: toolQueryReceipts,
  compare_product_prices: toolComparePrices,
  supplier_report: toolSupplierReport,
  price_changes: toolPriceChanges,
  supplier_info: toolSupplierInfo,
  event_quotes: toolEventQuotes,
  category_tree: toolCategoryTree,
  budget_status: toolBudgetStatus,
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
  const [{ rows }, all, suppliers] = await Promise.all([
    loadReceipts(ctx), loadReceipts(ctx, { book: 'all' }), loadSuppliers(ctx),
  ])
  const expense = rows.filter(isExpenseDoc)
  const dates = rows.map(r => r.receipt_date).filter(Boolean).sort()
  const total = expense.reduce((s, r) => s + (num(r.amount) || 0), 0)
  const byId = Object.fromEntries(suppliers.map(s => [s.id, s.name]))

  const names = [...new Set(rows.map(r => supplierNameOf(r, byId)))].sort((a, b) => a.localeCompare(b, 'he'))
  const cats = [...new Set(rows.map(r => (r.category_text || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'he'))

  return {
    documents: rows.length,
    events_documents: all.rows.filter(r => bookOf(r) === 'events').length,
    archived: rows.filter(r => r.archived_at).length,
    delivery_notes: rows.filter(r => docTypeOf(r) === 'delivery_note').length,
    summary_invoices: rows.filter(r => docTypeOf(r) === 'summary_invoice').length,
    pending_documents: rows.filter(r => r.status === 'pending').length,
    installment_documents: rows.filter(r => installmentsOf(r)).length,
    date_range: dates.length ? `${dates[0]} … ${dates[dates.length - 1]}` : 'אין תאריכים',
    total_spend: ils(total),
    suppliers: names,
    categories: cats,
  }
}
