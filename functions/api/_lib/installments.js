/**
 * installments — pure spread math for documents paid in monthly installments
 * (client fixes 18.11.26 §2, decision A: ANALYTIC spread only).
 *
 * The receipt row stays one whole document — exports, VAT and reconciliation
 * keep the document date and total. Analytics (dashboard, insights, budgets,
 * bot) call expandInstallments() so a 10-payment purchase shows up as 1/10 of
 * the amount in each of the 10 months, which is the real cash flow.
 *
 * No I/O here (guardrail 2: one source of financial truth, shared by the
 * browser bundle via src/lib/installments.js and by Pages Functions directly).
 */

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/** Number of installments on a receipt (null when it's a regular payment). */
export function installmentsOf(r) {
  const n = parseInt(r?.installments, 10)
  return Number.isFinite(n) && n >= 2 ? Math.min(n, 60) : null
}

/** 'YYYY-MM-DD' advanced by `plus` calendar months, day clamped to month end. */
export function addMonths(dateStr, plus) {
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return dateStr
  const total = (m - 1) + plus
  const ny = y + Math.floor(total / 12), nm = (total % 12) + 1
  const nd = Math.min(d, new Date(ny, nm, 0).getDate())
  return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`
}

/**
 * Split one receipt into its monthly slices. A regular receipt returns itself
 * (same reference) in a one-element array. Slice i carries 1/n of amount /
 * amount_before_vat / vat_amount (the last slice absorbs rounding so the sum
 * is exact), a date advanced i months, and `_slice: { i, of, source_id }`.
 * Line items ride ONLY on the first slice so item-level drill-downs never
 * double-count; counting logic should count a document once via countsAsDoc().
 */
export function sliceReceipt(r) {
  const n = installmentsOf(r)
  if (!n) return [r]
  const per = (field) => {
    const total = r2(r[field])
    const part = r2(total / n)
    return (i) => (i === n - 1 ? r2(total - part * (n - 1)) : part)
  }
  const amount = per('amount'), before = per('amount_before_vat'), vat = per('vat_amount')
  return Array.from({ length: n }, (_, i) => ({
    ...r,
    amount: amount(i),
    amount_before_vat: before(i),
    vat_amount: vat(i),
    receipt_date: addMonths(r.receipt_date, i),
    items: i === 0 ? r.items : null,
    _slice: { i: i + 1, of: n, source_id: r.id },
  }))
}

/** True when a row should count as a document (whole rows and first slices). */
export const countsAsDoc = (r) => !r._slice || r._slice.i === 1

/**
 * Every calendar year the given rows touch — the document year, plus every
 * year an installment spread reaches into. This is what makes a future year
 * EXIST in year pickers the moment a payment lands in it.
 */
export function yearsSpanned(rows) {
  const years = new Set()
  for (const r of rows || []) {
    const y0 = parseInt(String(r.receipt_date || '').slice(0, 4), 10)
    if (!y0) continue
    years.add(y0)
    const n = installmentsOf(r)
    if (n) {
      const yEnd = parseInt(addMonths(r.receipt_date, n - 1).slice(0, 4), 10)
      for (let y = y0 + 1; y <= yEnd; y++) years.add(y)
    }
  }
  return [...years].sort((a, b) => b - a)
}

/**
 * Expand a list of receipts for analytics. Options:
 *   from / to — 'YYYY-MM-DD' bounds; slices OUTSIDE the window are dropped
 *               (pass the window you are displaying, e.g. the calendar year).
 */
export function expandInstallments(rows, { from, to } = {}) {
  const out = []
  for (const r of rows || []) {
    for (const s of sliceReceipt(r)) {
      const d = s.receipt_date || ''
      if (from && d < from) continue
      if (to && d > to) continue
      out.push(s)
    }
  }
  return out
}
