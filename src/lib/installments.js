/**
 * installments (client) — re-export of the ONE implementation in
 * functions/api/_lib/installments.js (guardrail 2 — SSOT), so the dashboard
 * spreads a 10-payment purchase with exactly the math the budgets and the
 * assistant use server-side.
 */
export { installmentsOf, addMonths, sliceReceipt, countsAsDoc, expandInstallments } from '../../functions/api/_lib/installments.js'
