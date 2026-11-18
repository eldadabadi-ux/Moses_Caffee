/**
 * pageCache — invalidateReceiptData must clear every receipts-derived key
 * (dashboard years, dashboard meta, the lists) and nothing else, so a receipt
 * mutation can never leave a page showing pre-mutation numbers.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setCached, getCached, hasCached, invalidateReceiptData, clearPageCache } from '../../src/lib/pageCache.js'

test('invalidateReceiptData clears every receipts-derived key', () => {
  clearPageCache()
  setCached('receipts', [1])
  setCached('archive', [2])
  setCached('dash:meta', { suppliers: [] })
  setCached('dashyr:2025', [3])
  setCached('dashyr:2026', [4])
  setCached('categories', { categories: [5] })   // not receipt-derived — must survive

  invalidateReceiptData()

  for (const k of ['receipts', 'archive', 'dash:meta', 'dashyr:2025', 'dashyr:2026']) {
    assert.equal(hasCached(k), false, k + ' should be cleared')
  }
  assert.deepEqual(getCached('categories'), { categories: [5] })
})

test('invalidateReceiptData on an empty cache is a no-op', () => {
  clearPageCache()
  invalidateReceiptData()
  assert.equal(hasCached('receipts'), false)
})
