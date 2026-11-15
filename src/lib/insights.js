/**
 * insights — the smart periodic report (client request #5). Pure composition of
 * the existing derivations (spend, product comparison, reconciliation gaps,
 * budgets, VAT) into one structured report with Hebrew headlines. No I/O and no
 * LLM: every number is computed here from the receipts, so the report is
 * deterministic, free and testable (guardrail 2 — one financial truth).
 *
 * Bundles (all four the client asked for): price alerts & savings, document gaps,
 * budget utilization, spend trends + a VAT summary for the accountant.
 */
import { flattenItems } from './itemAggregation.js'
import { buildProductComparison } from './productCompare.js'
import { normalizeProduct } from './productMatch.js'
import { openIssues } from './reconciliation.js'
import { budgetStatus, periodLabel } from './budgetMath.js'
import { isExpenseDoc, docTypeOf } from './docTypes.js'
import { isCafeBook } from './books.js'

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const ils = (n) => `₪${Math.round(Number(n) || 0).toLocaleString('he-IL')}`
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

export const INSIGHT_PERIODS = [
  { value: 'month',   label: 'חודשי'  },
  { value: 'quarter', label: 'רבעוני' },
  { value: 'year',    label: 'שנתי'   },
]

/** Calendar window for a period, and the window immediately before it. */
export function insightWindow(period, now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth() + 1
  if (period === 'year') {
    return { cur: { from: iso(y, 1, 1), to: iso(y, 12, 31), label: `שנת ${y}` },
             prev: { from: iso(y - 1, 1, 1), to: iso(y - 1, 12, 31), label: `שנת ${y - 1}` } }
  }
  if (period === 'quarter') {
    const q = Math.ceil(m / 3)
    const win = (yy, qq) => {
      const fromM = (qq - 1) * 3 + 1, toM = qq * 3
      return { from: iso(yy, fromM, 1), to: iso(yy, toM, new Date(yy, toM, 0).getDate()), label: `רבעון ${qq} · ${yy}` }
    }
    const pq = q === 1 ? 4 : q - 1, py = q === 1 ? y - 1 : y
    return { cur: win(y, q), prev: win(py, pq) }
  }
  const win = (yy, mm) => ({ from: iso(yy, mm, 1), to: iso(yy, mm, new Date(yy, mm, 0).getDate()), label: `${String(mm).padStart(2, '0')}/${yy}` })
  const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y
  return { cur: win(y, m), prev: win(py, pm) }
}

const inWindow = (r, w) => { const d = r.receipt_date || ''; return d >= w.from && d <= w.to }
const cafeExpense = (r) => !r.archived_at && isExpenseDoc(r) && isCafeBook(r)
const vatOf = (r) => Number(r.vat_amount ?? r.ai_summary?.vat_amount) || 0

/** Spend in a window (café expense docs). */
const spendIn = (receipts, w) => r2(receipts.filter(r => cafeExpense(r) && inWindow(r, w)).reduce((s, r) => s + (parseFloat(r.amount) || 0), 0))

/** Per-base price rises within the window, per product+supplier. */
function priceAlerts(flat, w, minPct = 10) {
  const series = {}
  for (const f of flat) {
    if (f.price_per_base_unit == null || !f.base_unit) continue
    if (!(f.date >= w.from && f.date <= w.to)) continue
    const key = `${normalizeProduct(f.name)}|||${f.vendor}`
    ;(series[key] ||= { product: f.name, vendor: f.vendor, base: f.base_unit, pts: [] })
      .pts.push({ date: f.date, price: f.price_per_base_unit })
  }
  const out = []
  for (const s of Object.values(series)) {
    if (s.pts.length < 2) continue
    s.pts.sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    const first = s.pts[0], last = s.pts[s.pts.length - 1]
    if (!(first.price > 0)) continue
    const pct = Math.round(((last.price - first.price) / first.price) * 100)
    if (pct < minPct) continue
    out.push({ product: s.product, vendor: s.vendor, from_price: first.price, to_price: last.price, change_pct: pct,
      headline: `${s.product} אצל ${s.vendor} התייקר ב-${pct}% (מ-${ils(first.price)} ל-${ils(last.price)} ליחידה)` })
  }
  return out.sort((a, b) => b.change_pct - a.change_pct).slice(0, 8)
}

/**
 * Build the full insights report for a period.
 * @param {Array} receipts  raw receipt rows (all books; filtered to café here)
 * @param {{suppliers?:Array, budgets?:Array, period?:string, now?:Date}} opts
 *   budgets: supplier_budgets rows (each with supplier_id); suppliers: contacts.
 */
export function buildInsights(receipts, { suppliers = [], budgets = [], period = 'month', now = new Date() } = {}) {
  const { cur, prev } = insightWindow(period, now)
  const all = Array.isArray(receipts) ? receipts : []
  const curRows = all.filter(r => cafeExpense(r) && inWindow(r, cur))

  // 1. spend trend
  const total = spendIn(all, cur), prevTotal = spendIn(all, prev)
  const changePct = prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : null
  const spend = {
    total, prevTotal, changePct, window: cur, prevWindow: prev,
    headline: changePct == null
      ? `סה"כ הוצאות ב-${cur.label}: ${ils(total)}`
      : `סה"כ הוצאות ב-${cur.label}: ${ils(total)} — ${changePct >= 0 ? 'עלייה' : 'ירידה'} של ${Math.abs(changePct)}% מול ${prev.label}`,
  }

  // 2. top suppliers this period — linked receipts under their canonical name,
  //    unlinked under the scanned spelling.
  const byId = Object.fromEntries((suppliers || []).map(s => [s.id, s.name]))
  const supMap = {}
  for (const r of curRows) {
    const name = (r.supplier_id && byId[r.supplier_id]) || (r.vendor_name || '').trim() || 'לא ידוע'
    supMap[name] = (supMap[name] || 0) + (parseFloat(r.amount) || 0)
  }
  const topSuppliers = Object.entries(supMap).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([name, total]) => ({ name, total: r2(total) }))

  // 3. savings opportunities — widest cross-supplier price spread (whole history,
  //    so a rarely-bought item still surfaces a better source)
  const flatAll = flattenItems(all.filter(r => isExpenseDoc(r) && isCafeBook(r)))
  const comparison = buildProductComparison(flatAll, { minSuppliers: 2 })
  const savings = comparison.filter(p => p.spreadPct >= 10).slice(0, 6).map(p => ({
    product: p.label, cheapest: p.cheapest, dearest: p.dearest, spreadPct: p.spreadPct, unitLabel: p.unitLabel,
    headline: `${p.label}: הזול ${p.cheapest.vendor} (${ils(p.cheapest.price)}/${p.unitLabel}) — חיסכון עד ${p.spreadPct}% מול ${p.dearest.vendor}`,
  }))

  // 4. price alerts — rises within the period
  const alerts = priceAlerts(flattenItems(all.filter(r => isExpenseDoc(r) && isCafeBook(r))), cur)

  // 5. document gaps (reconciliation)
  const issues = openIssues(all)
  const pendingInvoices = issues.filter(r => !r.reconciliation).length
  const mismatchInvoices = issues.filter(r => r.reconciliation?.status === 'mismatch').length
  const openNotes = all.filter(r => !r.archived_at && isCafeBook(r) && docTypeOf(r) === 'delivery_note' && !r.matched_invoice_id).length
  const docGaps = {
    pendingInvoices, mismatchInvoices, openNotes,
    headline: (pendingInvoices || mismatchInvoices || openNotes)
      ? `${pendingInvoices} חשבוניות ממתינות להתאמה · ${mismatchInvoices} עם פער · ${openNotes} תעודות משלוח פתוחות`
      : 'כל המסמכים מותאמים — אין פערים פתוחים',
  }

  // 6. budgets in warning/over
  const budgetAlerts = (budgets || []).map(b => {
    const supRows = all.filter(r => r.supplier_id && r.supplier_id === b.supplier_id)
    const st = budgetStatus(b, supRows, now)
    if (!st) return null
    const name = suppliers.find(s => s.id === b.supplier_id)?.name || 'ספק'
    return { supplier: name, period: periodLabel(b.period), ...st,
      headline: `${name}: ${st.pct}% מהתקציב (${ils(st.used)} מתוך ${ils(st.amount)})${st.state === 'over' ? ' — חריגה!' : st.state === 'warn' ? ' — מתקרב לסף' : ''}` }
  }).filter(Boolean).filter(b => b.state !== 'ok').sort((a, b) => b.pct - a.pct)

  // 7. VAT summary for the accountant
  const vatTotal = r2(curRows.reduce((s, r) => s + vatOf(r), 0))
  const vat = { total: vatTotal, window: cur, headline: `מע"מ תשומות ב-${cur.label}: ${ils(vatTotal)} (${curRows.length} מסמכים)` }

  return { period, window: cur, spend, topSuppliers, savings, priceAlerts: alerts, docGaps, budgetAlerts, vat }
}
