/**
 * budgets.test — the pure budget math (client requirement 11.11.26 §1).
 * The definition lives in supplier_budgets; the spend is derived from receipts.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { periodWindow, budgetStatus } from '../../src/lib/budgetMath.js'

const NOW = new Date('2026-11-12T10:00:00')
const rec = (date, amount, extra = {}) => ({ receipt_date: date, amount, doc_type: 'receipt', ...extra })

// ── periodWindow ─────────────────────────────────────────────────────────────

test('monthly window is the current calendar month', () => {
  const w = periodWindow('monthly', NOW)
  assert.equal(w.from, '2026-11-01')
  assert.equal(w.to, '2026-11-30')
})

test('quarterly window is the current calendar quarter', () => {
  const w = periodWindow('quarterly', NOW)
  assert.equal(w.from, '2026-10-01')
  assert.equal(w.to, '2026-12-31')
})

test('annual window is the calendar year', () => {
  const w = periodWindow('annual', NOW)
  assert.equal(w.from, '2026-01-01')
  assert.equal(w.to, '2026-12-31')
})

test('quarter edges: February belongs to Q1 and gets the right month lengths', () => {
  const w = periodWindow('quarterly', new Date('2024-02-10T00:00:00'))
  assert.equal(w.from, '2024-01-01')
  assert.equal(w.to, '2024-03-31')
})

// ── budgetStatus ─────────────────────────────────────────────────────────────

test('spend inside the window is counted; outside is not', () => {
  const s = budgetStatus({ period: 'monthly', amount: 1000, alert_pct: 80 }, [
    rec('2026-11-03', 200), rec('2026-11-20', 300),
    rec('2026-10-28', 999),                      // last month — out
  ], NOW)
  assert.equal(s.used, 500)
  assert.equal(s.remaining, 500)
  assert.equal(s.pct, 50)
  assert.equal(s.state, 'ok')
})

test('crossing the alert threshold flips the state to warn', () => {
  const s = budgetStatus({ period: 'monthly', amount: 1000, alert_pct: 80 }, [
    rec('2026-11-05', 850),
  ], NOW)
  assert.equal(s.state, 'warn')
})

test('spending past the budget flips the state to over, remaining goes negative', () => {
  const s = budgetStatus({ period: 'monthly', amount: 1000, alert_pct: 80 }, [
    rec('2026-11-05', 1200),
  ], NOW)
  assert.equal(s.state, 'over')
  assert.equal(s.remaining, -200)
})

test('summary invoices, archived rows and the events book never consume budget', () => {
  const s = budgetStatus({ period: 'monthly', amount: 1000, alert_pct: 80 }, [
    rec('2026-11-05', 100),
    rec('2026-11-06', 500, { doc_type: 'summary_invoice' }),   // aggregates notes already counted
    rec('2026-11-07', 500, { archived_at: '2026-11-08' }),
    rec('2026-11-08', 500, { book: 'events' }),
  ], NOW)
  assert.equal(s.used, 100)
})

test('no budget (or a zero amount) yields null', () => {
  assert.equal(budgetStatus(null, [], NOW), null)
  assert.equal(budgetStatus({ period: 'monthly', amount: 0 }, [], NOW), null)
})
