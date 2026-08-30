/**
 * sanitizeReceiptDate — a mis-read year must never be filed silently.
 * Run: node --test tests/unit/dates.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeReceiptDate } from '../../functions/api/_lib/extractReceipt.js'

const NOW = new Date('2026-08-30T12:00:00Z')

test('a plausible date passes through untouched', () => {
  assert.equal(sanitizeReceiptDate('2026-08-25', NOW), '2026-08-25')
  assert.equal(sanitizeReceiptDate('2025-12-03', NOW), '2025-12-03')
})

test('REGRESSION: the 2020 receipt in the live data is rejected', () => {
  // Live row: "ירקות קצוצים בע\"מ" dated 2020-08-02 — really a 2026 delivery note.
  assert.equal(sanitizeReceiptDate('2020-08-02', NOW), '')
})

test('a far-future date is rejected', () => {
  assert.equal(sanitizeReceiptDate('2027-05-01', NOW), '')
  assert.equal(sanitizeReceiptDate('2126-08-30', NOW), '')
})

test('a few days ahead is allowed (clock skew, post-dated invoices)', () => {
  assert.equal(sanitizeReceiptDate('2026-09-10', NOW), '2026-09-10')
})

test('impossible calendar dates are rejected, not rolled over', () => {
  assert.equal(sanitizeReceiptDate('2026-02-31', NOW), '')
  assert.equal(sanitizeReceiptDate('2026-13-01', NOW), '')
})

test('malformed input yields an empty string, never a crash', () => {
  for (const v of ['', null, undefined, 'לא ידוע', '25/08/2026', '2026-8-5', 42]) {
    assert.equal(sanitizeReceiptDate(v, NOW), '')
  }
})

test('the window is 3 years, not a decade', () => {
  assert.equal(sanitizeReceiptDate('2024-01-15', NOW), '2024-01-15')   // inside
  assert.equal(sanitizeReceiptDate('2022-01-15', NOW), '')             // outside
})
