/**
 * mergeGroups.test — the client's merge payload-building (client issue #2).
 *
 * The live E2E proves the server honors these payloads; this proves the client
 * produces the right one: everything pre-checked by default, and unticking a
 * spelling removes it from BOTH aliases and stored (so it is neither relinked nor
 * folded). That two-sided consistency is the fix for "the merge did nothing".
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initialChoices, buildMergeGroups } from '../../src/lib/mergeGroups.js'

// One cluster: canonical "מידן" with a near-certain member + a review-band spelling.
const clusters = () => [{
  canonical: 'מידן סחר',
  junk: false,
  members: [
    { name: 'מידן סחר', stored: ['מידן סחר'] },
    { name: 'מידן סחר בעמ', stored: ['מידן סחר בעמ'] },
  ],
  review: [
    { name: 'מיזן סחר', stored: ['מיזן סחר', 'מיזן סחר '] },  // two raw spellings on disk
  ],
}]

test('initialChoices pre-checks the near-certain members, NOT the review band', () => {
  const ch = initialChoices(clusters())
  const picked = ch['מידן סחר'].picked
  assert.equal(picked.size, 2, 'only the two members are pre-checked')
  assert.ok(!picked.has('מיזן סחר'), 'the uncertain review-band spelling must NOT be auto-selected')
})

test('members-only default → only members in aliases/stored (review excluded until ticked)', () => {
  const ch = initialChoices(clusters())
  const [g] = buildMergeGroups(clusters(), ch)
  assert.deepEqual(g.aliases.sort(), ['מידן סחר', 'מידן סחר בעמ'].sort())
  assert.ok(!g.stored.includes('מיזן סחר'), 'review spelling is not merged by default')
})

test('after ticking the review spelling, it joins aliases and stored', () => {
  const ch = initialChoices(clusters())
  ch['מידן סחר'].picked.add('מיזן סחר')          // user confirms the duplicate
  const [g] = buildMergeGroups(clusters(), ch)
  assert.deepEqual(g.aliases.sort(), ['מידן סחר', 'מידן סחר בעמ', 'מיזן סחר'].sort())
  assert.deepEqual(g.stored.sort(), ['מידן סחר', 'מידן סחר בעמ', 'מיזן סחר', 'מיזן סחר '].sort())
})

test('unticking a member excludes it from BOTH aliases and stored (coherence)', () => {
  const ch = initialChoices(clusters())
  ch['מידן סחר'].picked.delete('מידן סחר בעמ')      // user unticks a pre-checked member
  const [g] = buildMergeGroups(clusters(), ch)
  assert.ok(!g.aliases.includes('מידן סחר בעמ'), 'unticked spelling must not be an alias')
  assert.ok(!g.stored.includes('מידן סחר בעמ'), 'unticked spelling must not be relinked either')
  assert.deepEqual(g.aliases, ['מידן סחר'])
})

test('a cluster with nothing picked is omitted', () => {
  const ch = initialChoices(clusters())
  ch['מידן סחר'].picked.clear()
  assert.equal(buildMergeGroups(clusters(), ch).length, 0)
})

test('junk clusters are never emitted', () => {
  const cs = clusters(); cs[0].junk = true
  assert.equal(buildMergeGroups(cs, initialChoices(cs)).length, 0)
})

test('an accepted "possible supplier" link rides through as supplier_id', () => {
  const cs = clusters()
  const g = buildMergeGroups(cs, initialChoices(cs), { 'מידן סחר': 'sup-123' })[0]
  assert.equal(g.supplier_id, 'sup-123')
})

test('an existing_supplier on the cluster wins over accepted', () => {
  const cs = clusters(); cs[0].existing_supplier = { id: 'existing-9' }
  const g = buildMergeGroups(cs, initialChoices(cs), { 'מידן סחר': 'sup-123' })[0]
  assert.equal(g.supplier_id, 'existing-9')
})
