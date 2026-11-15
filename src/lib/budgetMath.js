/**
 * budgetMath (client) — re-export of the ONE implementation in
 * functions/api/_lib/budgetMath.js (guardrail 2 — SSOT). Moved server-side
 * 15.11.26 so the assistant's budget_status tool prices budgets with exactly
 * the math the UI shows.
 */
export { BUDGET_PERIODS, periodLabel, periodWindow, budgetStatus } from '../../functions/api/_lib/budgetMath.js'
