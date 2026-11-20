/**
 * salesMath (client) — re-export of the ONE implementation in
 * functions/api/_lib/salesMath.js (guardrail 2 — SSOT).
 *
 * The screen, the dashboard, the insights report and the assistant must all
 * state the same revenue; they do so by calling the same functions.
 */
export {
  dayTotal,
  rangeTotals,
  profitSummary,
  monthlySeries,
  bestSellers,
  hourHistogram,
  profitByProduct,
} from '../../functions/api/_lib/salesMath.js'
