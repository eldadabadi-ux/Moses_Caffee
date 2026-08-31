/**
 * Feature-flag resolution. This decides what a live business sees, so the
 * precedence rules are tested rather than assumed.
 * Run: node --test tests/unit/flags.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveFlags, FLAG_DEFAULTS, FLAG_KEYS } from '../../functions/api/_lib/flags.js'

const ORG_A = 'org-a', ORG_B = 'org-b'

test('with no rows at all, every flag takes its code default', () => {
  const f = resolveFlags([], ORG_A)
  assert.deepEqual(f, FLAG_DEFAULTS)
  for (const k of FLAG_KEYS) assert.equal(typeof f[k], 'boolean')
})

test('a global row overrides the code default', () => {
  const f = resolveFlags([{ key: 'bot_tools', org_id: null, enabled: false }], ORG_A)
  assert.equal(f.bot_tools, false)
})

test('an org row beats the global row', () => {
  const rows = [
    { key: 'events_book', org_id: null,  enabled: false },   // off for everyone
    { key: 'events_book', org_id: ORG_A, enabled: true },    // …except this tenant
  ]
  assert.equal(resolveFlags(rows, ORG_A).events_book, true)
  assert.equal(resolveFlags(rows, ORG_B).events_book, false)
})

test("another tenant's override never applies to me", () => {
  // Rows for org B should not reach org A at all (RLS), but if one ever did it
  // must still be ignored rather than flipping A's behaviour.
  const rows = [{ key: 'price_alerts', org_id: ORG_B, enabled: false }]
  assert.equal(resolveFlags(rows, ORG_A).price_alerts, FLAG_DEFAULTS.price_alerts)
})

test('a user with no org still gets the global defaults', () => {
  const rows = [{ key: 'bot_tools', org_id: null, enabled: false }]
  assert.equal(resolveFlags(rows, null).bot_tools, false)
})

test('an unknown key in the table is ignored, not surfaced', () => {
  const f = resolveFlags([{ key: 'not_a_real_flag', org_id: null, enabled: true }], ORG_A)
  assert.equal(f.not_a_real_flag, undefined)
  assert.deepEqual(Object.keys(f).sort(), FLAG_KEYS.slice().sort())
})

test('the result is always complete — no missing key can read as undefined', () => {
  for (const rows of [[], null, undefined, [{ key: 'bot_tools', org_id: null, enabled: true }]]) {
    const f = resolveFlags(rows, ORG_A)
    for (const k of FLAG_KEYS) assert.equal(typeof f[k], 'boolean', `${k} missing`)
  }
})

test('malformed rows do not crash resolution', () => {
  const rows = [null, {}, { key: null }, { key: 'bot_tools' }, { key: 'bot_tools', org_id: ORG_A, enabled: 'yes' }]
  const f = resolveFlags(rows, ORG_A)
  assert.equal(f.bot_tools, true)         // "yes" coerces to true, and nothing threw
})
