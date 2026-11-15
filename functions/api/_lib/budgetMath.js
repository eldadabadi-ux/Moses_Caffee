/**
 * budgetMath — pure derivation of a supplier budget's utilization (client
 * requirement 11.11.26 §1). No I/O: the budget DEFINITION comes from
 * supplier_budgets, the SPEND is always derived from receipts at read time —
 * never stored — so there is exactly one source of financial truth (guardrail 2).
 */
import { isExpenseDoc } from './docTypes.js'
import { isCafeBook } from './books.js'

export const BUDGET_PERIODS = [
  { value: 'monthly',   label: 'חודשי'  },
  { value: 'quarterly', label: 'רבעוני' },
  { value: 'annual',    label: 'שנתי'   },
]
export const periodLabel = (p) => BUDGET_PERIODS.find(x => x.value === p)?.label || p

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/**
 * The calendar window the budget currently measures: the current month, the
 * current calendar quarter, or the current calendar year. Budgets are agreed
 * "at the start of the year/quarter/month" (the client's words), so calendar
 * periods — not rolling windows — are the business meaning.
 */
export function periodWindow(period, now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth() + 1
  if (period === 'annual') {
    return { from: iso(y, 1, 1), to: iso(y, 12, 31), label: `שנת ${y}` }
  }
  if (period === 'quarterly') {
    const q = Math.ceil(m / 3)
    const fromM = (q - 1) * 3 + 1, toM = q * 3
    return { from: iso(y, fromM, 1), to: iso(y, toM, new Date(y, toM, 0).getDate()), label: `רבעון ${q} · ${y}` }
  }
  return { from: iso(y, m, 1), to: iso(y, m, new Date(y, m, 0).getDate()), label: `${String(m).padStart(2, '0')}/${y}` }
}

/**
 * Utilization of one supplier's budget for the current period.
 *
 * @param {object} budget   supplier_budgets row ({ period, amount, alert_pct })
 * @param {Array}  receipts THIS supplier's receipts (already filtered to the supplier)
 * @returns {{used:number, pct:number, remaining:number,
 *            state:'ok'|'warn'|'over', window:object}|null}
 *
 * Spend counts exactly what every other statistic counts: unarchived expense
 * documents in the café book (summary invoices excluded — their delivery notes
 * are already counted; events book is a separate business).
 */
export function budgetStatus(budget, receipts, now = new Date()) {
  if (!budget || !(Number(budget.amount) > 0)) return null
  const w = periodWindow(budget.period, now)
  const used = r2((receipts || [])
    .filter(r => !r.archived_at && isExpenseDoc(r) && isCafeBook(r))
    .filter(r => { const d = r.receipt_date || ''; return d >= w.from && d <= w.to })
    .reduce((s, r) => s + (parseFloat(r.amount) || 0), 0))
  const amount = r2(budget.amount)
  const pct = Math.round((used / amount) * 100)
  const remaining = r2(amount - used)
  const alertPct = Number(budget.alert_pct) || 80
  const state = remaining < 0 ? 'over' : pct >= alertPct ? 'warn' : 'ok'
  return { used, pct, remaining, state, amount, window: w }
}
