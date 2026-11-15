/**
 * reconciliation.test — supplier-identity matching (Phase 4, client issue #3).
 *
 * The exact-string matcher hid candidates whenever a supplier was spelled two
 * ways. Matching now keys on supplier_id (with the normalized spelling as a
 * fallback), so two spellings of one supplier find each other's notes, while
 * genuinely different suppliers stay apart.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSupplierIndex, supplierKeyOf, findCandidates } from '../../src/lib/reconciliation.js'

// A supplier stamped under two spellings, plus an unrelated supplier.
const S = '11111111-1111-1111-1111-111111111111'
const rows = () => [
  { id: 'inv', doc_type: 'summary_invoice', supplier_id: S, vendor_name: 'מידן סחר בע"מ', receipt_date: '2026-03-31', amount: 300 },
  { id: 'n1', doc_type: 'delivery_note', supplier_id: S, vendor_name: 'מידן סחר', receipt_date: '2026-03-05', amount: 100 },
  // same supplier, different spelling, never stamped (legacy row) — learned via index
  { id: 'n2', doc_type: 'delivery_note', supplier_id: null, vendor_name: 'מידן סחר', receipt_date: '2026-03-12', amount: 200 },
  // a different supplier, must NOT be pulled in
  { id: 'n3', doc_type: 'delivery_note', supplier_id: null, vendor_name: 'חברת חשמל', receipt_date: '2026-03-10', amount: 50 },
]

test('buildSupplierIndex learns spelling → supplier_id from stamped rows', () => {
  const idx = buildSupplierIndex(rows())
  assert.equal(idx.get('מידן סחר'), S)
  assert.equal(idx.get('חברת חשמל'), undefined, 'unstamped-only spellings are not in the index')
})

test('supplierKeyOf prefers supplier_id, falls back to learned id, then to spelling', () => {
  const idx = buildSupplierIndex(rows())
  assert.equal(supplierKeyOf({ supplier_id: S, vendor_name: 'x' }, idx), `id:${S}`)
  assert.equal(supplierKeyOf({ supplier_id: null, vendor_name: 'מידן סחר' }, idx), `id:${S}`, 'legacy row collapses onto its stamped sibling')
  assert.equal(supplierKeyOf({ supplier_id: null, vendor_name: 'חברת חשמל' }, idx), 'n:חברת חשמל')
})

test('findCandidates groups both spellings of one supplier and excludes others', () => {
  const data = rows()
  const cands = findCandidates(data, data[0])
  const ids = cands.map(c => c.id).sort()
  assert.deepEqual(ids, ['n1', 'n2'], 'both spellings matched; different supplier excluded')
})

test('findCandidates honors the date window and skips already-matched notes', () => {
  const data = rows()
  data.push({ id: 'old', doc_type: 'delivery_note', supplier_id: S, vendor_name: 'מידן סחר', receipt_date: '2025-12-01', amount: 10 })
  data.push({ id: 'taken', doc_type: 'delivery_note', supplier_id: S, vendor_name: 'מידן סחר', receipt_date: '2026-03-20', amount: 10, matched_invoice_id: 'other' })
  const cands = findCandidates(data, data[0]).map(c => c.id)
  assert.ok(!cands.includes('old'), 'note older than the 60-day window is excluded')
  assert.ok(!cands.includes('taken'), 'note already matched to another invoice is excluded')
})
