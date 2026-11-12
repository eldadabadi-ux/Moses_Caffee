/**
 * merge.test — the pure helpers that batch the supplier-merge writes.
 *
 * The merge used to issue one request per alias and per spelling, which blew
 * Cloudflare's per-invocation subrequest limit on a real tenant and surfaced as
 * an opaque 500. These helpers collapse the writes into a few bulk calls; their
 * PostgREST encoding is what must be exactly right.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inList, chunk } from '../../functions/api/suppliers/merge.js'

test('inList double-quotes each value and URL-encodes the whole filter', () => {
  const f = inList(['מידן', 'מיזן'])
  // decoded form is in.("מידן","מיזן")
  assert.equal(decodeURIComponent(f.slice('in.'.length)), '("מידן","מיזן")')
})

test('inList keeps commas and spaces inside a name literal (quoted)', () => {
  const f = inList(['קפה אחים, בע"מ'])
  const decoded = decodeURIComponent(f.slice('in.'.length))
  // embedded double-quote doubled; comma is inside the quotes, not a separator
  assert.equal(decoded, '("קפה אחים, בע""מ")')
})

test('inList encodes reserved URL characters so the tenant predicate survives', () => {
  // A raw '#' would truncate the URL at the fragment and drop &org_id=… — the
  // exact class of bug guardrail 3 exists to prevent.
  const f = inList(['a#b'])
  assert.ok(!f.includes('#'), '# must be percent-encoded')
  assert.equal(decodeURIComponent(f.slice('in.'.length)), '("a#b")')
})

test('chunk splits into fixed-size batches, last one short', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
})

test('chunk returns [] for an empty list and one chunk when it fits', () => {
  assert.deepEqual(chunk([], 50), [])
  assert.deepEqual(chunk([1, 2], 50), [[1, 2]])
})
