/**
 * installments — the analytic spread must be exact (slices sum to the original
 * to the agora), calendar-correct across month ends and year boundaries, and
 * must leave regular receipts untouched.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { installmentsOf, addMonths, sliceReceipt, countsAsDoc, expandInstallments } from '../../functions/api/_lib/installments.js'

const base = { id: 'r1', amount: 6790, amount_before_vat: 5753.39, vat_amount: 1036.61, receipt_date: '2026-11-17', items: [{ name: 'מקרר' }] }

test('a regular receipt passes through untouched (same reference)', () => {
  const out = sliceReceipt({ ...base, installments: null })
  assert.equal(out.length, 1)
  assert.equal(installmentsOf(base), null)
  assert.equal(installmentsOf({ installments: 1 }), null)
  assert.equal(installmentsOf({ installments: '10' }), 10)
})

test('10 payments: slices sum exactly, dates advance monthly, items only on slice 1', () => {
  const out = sliceReceipt({ ...base, installments: 10 })
  assert.equal(out.length, 10)
  const sum = (f) => Math.round(out.reduce((s, x) => s + x[f], 0) * 100) / 100
  assert.equal(sum('amount'), 6790)
  assert.equal(sum('amount_before_vat'), 5753.39)
  assert.equal(sum('vat_amount'), 1036.61)
  assert.equal(out[0].receipt_date, '2026-11-17')
  assert.equal(out[2].receipt_date, '2027-01-17')   // crosses the year boundary
  assert.equal(out[0].items.length, 1)
  assert.equal(out[1].items, null)
  assert.ok(countsAsDoc(out[0]))
  assert.ok(!countsAsDoc(out[1]))
})

test('day-of-month clamps at short months', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28')
  assert.equal(addMonths('2026-12-31', 2), '2027-02-28')
  assert.equal(addMonths('2027-12-15', 1), '2028-01-15')
})

test('expandInstallments drops slices outside the window', () => {
  const rows = [{ ...base, installments: 4 }]   // Nov,Dec 2026 + Jan,Feb 2027
  const in2026 = expandInstallments(rows, { from: '2026-01-01', to: '2026-12-31' })
  const in2027 = expandInstallments(rows, { from: '2027-01-01', to: '2027-12-31' })
  assert.equal(in2026.length, 2)
  assert.equal(in2027.length, 2)
  assert.equal(Math.round((in2026[0].amount + in2026[1].amount + in2027[0].amount + in2027[1].amount) * 100) / 100, 6790)
})

test('a 3-payment amount that does not divide evenly stays exact', () => {
  const out = sliceReceipt({ id: 'x', amount: 100, amount_before_vat: 85.47, vat_amount: 14.53, receipt_date: '2026-05-01', installments: 3 })
  assert.deepEqual(out.map(s => s.amount), [33.33, 33.33, 33.34])
})
