/**
 * supplierMatch — unit tests over the REAL vendor names found in the live
 * Moses_Caffee database (30 Aug 2026), where one supplier appears under many
 * OCR spellings. Run: node --test tests/unit/supplierMatch.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeVendor, vendorSkeleton, vendorSimilarity, matchVendor, clusterVendors,
  isJunkVendor, AUTO_THRESHOLD, ASK_THRESHOLD,
} from '../../functions/api/_lib/supplierMatch.js'

// ── normalizeVendor ──────────────────────────────────────────────────────────
test('normalizeVendor strips legal suffixes, quotes and initials', () => {
  assert.equal(normalizeVendor('י.י. אגס בע"מ'), 'אגס')
  assert.equal(normalizeVendor('אגס בע"מ'), 'אגס')
  assert.equal(normalizeVendor('י. אגס בע״מ'), 'אגס')
  assert.equal(normalizeVendor('  קטיף   ירקות  קצוצים בעמ '), 'קטיף ירקות קצוצים')
  assert.equal(normalizeVendor('Anthropic, PBC'), 'anthropic')
})

test('normalizeVendor never returns an empty name for a real input', () => {
  assert.equal(normalizeVendor('בע"מ'), 'בעמ')          // nothing but a legal form
  assert.equal(normalizeVendor('  '), '')
  assert.equal(normalizeVendor(null), '')
})

// ── vendorSkeleton ───────────────────────────────────────────────────────────
test('skeleton folds the OCR spellings of "המתוקיה של בני"', () => {
  const a = vendorSkeleton('המתוקיה של בני בע"מ')
  assert.equal(vendorSkeleton('המוטיקיה של בני בע"מ'), a)
  assert.equal(vendorSkeleton('המתווקיה של בני בע"מ'), a)
})

test('skeleton folds ט/ת and the matres lectionis', () => {
  assert.equal(vendorSkeleton('קטיף'), vendorSkeleton('קתוף'))
  assert.equal(vendorSkeleton('מיזן'), vendorSkeleton('מייזן'))
  assert.equal(vendorSkeleton('מיזן'), vendorSkeleton('מזון'))
})

test('skeleton keeps genuinely different names apart', () => {
  assert.notEqual(vendorSkeleton('אגס'), vendorSkeleton('אגם'))
  assert.notEqual(vendorSkeleton('קטיף'), vendorSkeleton('קמצוץ'))
  assert.notEqual(vendorSkeleton('אהרון שוק'), vendorSkeleton('צוקי ארסוף'))
})

// ── vendorSimilarity: the real duplicate groups ──────────────────────────────
const SAME = [
  ['המתוקיה של בני בע"מ', 'המוטיקיה של בני בע"מ'],
  ['המתוקיה של בני בע"מ', 'המתווקיה של בני בע"מ'],
  ['קטיף ירקות קצוצים בע"מ', 'קתוף ירקות קצוצים בע"מ'],
  ['קטיף ירקות קצוצים בע"מ', 'קמץ ירקות קצוצים בע"מ'],
  ['קטיף ירקות קצוצים בע"מ', 'קמצוץ ירקות קצוצים בע"מ'],
  ['קטיף ירקות קצוצים בע"מ', 'קמון ירקות קצוצים בע"מ'],
  ['י.י. אגס בע"מ', 'אגס בע"מ'],
  ['י.י. אגס בע"מ', 'י. אגס בע"מ'],
  ['י.י. אגס בע"מ', 'י.א. אגס בע"מ'],
  ['מיזן סחר ושיווק מזון איכותי בע"מ', 'מייזן סחר ושיווק מזון איכותי בע"מ'],
  ['מייזן', 'מיזן'],
]
for (const [a, b] of SAME) {
  test(`same supplier: "${a}" ≈ "${b}"`, () => {
    const s = vendorSimilarity(a, b)
    assert.ok(s >= ASK_THRESHOLD, `expected ≥ ${ASK_THRESHOLD}, got ${s}`)
  })
}

const DIFFERENT = [
  ['קטיף ירקות קצוצים בע"מ', 'המתוקיה של בני בע"מ'],
  ['אהרון שוק', 'צוקי ארסוף'],
  ['בנק מזרחי טפחות', 'חברת החשמל לישראל בע"מ'],
  ['Anthropic, PBC', 'Wizz Air Malta Limited'],
  ['מיקה תפעול תחנות דלק', 'מועצה אזורית גזר'],
]
for (const [a, b] of DIFFERENT) {
  test(`different suppliers stay apart: "${a}" ≠ "${b}"`, () => {
    const s = vendorSimilarity(a, b)
    assert.ok(s < ASK_THRESHOLD, `expected < ${ASK_THRESHOLD}, got ${s}`)
  })
}

test('near-miss pairs are asked about, never auto-linked', () => {
  // One letter apart and both plausible businesses — a human must decide.
  const s = vendorSimilarity('י.י. אגס בע"מ', 'י.י. אגם בע"מ')
  assert.ok(s >= ASK_THRESHOLD && s < AUTO_THRESHOLD,
    `expected an "ask", got ${s}`)
})

// ── matchVendor ──────────────────────────────────────────────────────────────
const SUPPLIERS = [
  { id: 's1', name: 'קטיף ירקות קצוצים בע"מ' },
  { id: 's2', name: 'המתוקיה של בני בע"מ' },
  { id: 's3', name: 'י.י. אגס בע"מ' },
  { id: 's4', name: 'מיזן סחר ושיווק מזון איכותי בע"מ', aliases: ['מייזן'] },
]

test('an exact repeat links automatically', () => {
  const r = matchVendor('קטיף ירקות קצוצים בע"מ', SUPPLIERS)
  assert.equal(r.decision, 'auto')
  assert.equal(r.supplier.id, 's1')
  assert.equal(r.score, 1)
})

test('an OCR variant links automatically or is asked about — never invented', () => {
  const r = matchVendor('קתוף ירקות קצוצים בע"מ', SUPPLIERS)
  assert.notEqual(r.decision, 'new')
  assert.equal(r.supplier.id, 's1')
})

test('a confirmed alias resolves the supplier', () => {
  const r = matchVendor('מייזן', SUPPLIERS)
  assert.equal(r.decision, 'auto')
  assert.equal(r.supplier.id, 's4')
})

test('a genuinely new supplier is not forced onto an existing one', () => {
  const r = matchVendor('צוקי ארסוף', SUPPLIERS)
  assert.equal(r.decision, 'new')
  assert.equal(r.supplier, null)
})

test('garbage vendor names never match a real supplier', () => {
  for (const junk of ['- ₪', 'יש |', '', '   ']) {
    const r = matchVendor(junk, SUPPLIERS)
    assert.equal(r.decision, 'new', `"${junk}" should not match`)
  }
})

test('an empty supplier list always yields "new"', () => {
  assert.equal(matchVendor('קטיף ירקות קצוצים בע"מ', []).decision, 'new')
})

// ── clusterVendors ───────────────────────────────────────────────────────────
test('clusters the live vendor list into real suppliers', () => {
  const rows = [
    { name: 'המתוקיה של בני בע"מ', count: 15 },
    { name: 'המוטיקיה של בני בע"מ', count: 1 },
    { name: 'המתווקיה של בני בע"מ', count: 1 },
    { name: 'קטיף ירקות קצוצים בע"מ', count: 9 },
    { name: 'קתוף ירקות קצוצים בע"מ', count: 2 },
    { name: 'קמצוץ ירקות קצוצים בע"מ', count: 1 },
    { name: 'י.י. אגס בע"מ', count: 4 },
    { name: 'אגס בע"מ', count: 3 },
    { name: 'י. אגס בע"מ', count: 2 },
    { name: 'בנק מזרחי טפחות', count: 1 },
    { name: 'חברת החשמל לישראל בע"מ', count: 1 },
  ]
  const clusters = clusterVendors(rows)
  const all = (c) => [...c.members, ...c.review]
  const find = (n) => clusters.find(c => all(c).some(m => m.name === n))

  assert.equal(find('המוטיקיה של בני בע"מ').canonical, 'המתוקיה של בני בע"מ')
  assert.equal(find('קתוף ירקות קצוצים בע"מ').canonical, 'קטיף ירקות קצוצים בע"מ')
  assert.equal(find('אגס בע"מ').canonical, 'י.י. אגס בע"מ')
  // The bank and the electric company are their own single-member clusters.
  assert.equal(all(find('בנק מזרחי טפחות')).length, 1)
  assert.equal(all(find('חברת החשמל לישראל בע"מ')).length, 1)
})

test('a truncated OCR fragment never becomes the canonical name', () => {
  const rows = [
    { name: 'מזון', count: 1 },
    { name: 'מייזן', count: 1 },
    { name: 'מיזן סחר ושיווק מזון איכותי בע"מ', count: 1 },
    { name: 'מייזן סחר ושיווק מזון איכותי בע"מ', count: 1 },
  ]
  const [c] = clusterVendors(rows)
  assert.ok(c.canonical.includes('סחר'), `got "${c.canonical}"`)
})

test('only near-certain members are pre-selected; the rest need review', () => {
  const rows = [
    { name: 'המתוקיה של בני בע"מ', count: 15 },
    { name: 'המוטיקיה של בני בע"מ', count: 1 },   // 0.97 → confident
    { name: 'המחלבה של בני בע"מ', count: 1 },     // ~0.71 → a human decides
  ]
  const [c] = clusterVendors(rows)
  assert.ok(c.members.some(m => m.name === 'המוטיקיה של בני בע"מ'))
  assert.ok(c.review.some(m => m.name === 'המחלבה של בני בע"מ'))
})

test('junk vendor names are flagged, not treated as businesses', () => {
  assert.equal(isJunkVendor('- ₪'), true)
  assert.equal(isJunkVendor('יש |'), false)   // "יש" is two letters — weak, but a word
  assert.equal(isJunkVendor('|||'), true)
  assert.equal(isJunkVendor(''), true)
  assert.equal(isJunkVendor('קטיף ירקות קצוצים בע"מ'), false)
  const [c] = clusterVendors([{ name: '- ₪', count: 1 }])
  assert.equal(c.junk, true)
})

test('"ספק לא ידוע" and other unknown sentinels are junk, never a merge anchor', () => {
  assert.equal(isJunkVendor('ספק לא ידוע'), true)
  assert.equal(isJunkVendor('לא ידוע'), true)
  assert.equal(isJunkVendor('unknown'), true)
  // A high-count "unknown" row must NOT pull real suppliers into a cluster with
  // it as the canonical (the live-café bug: "unknown" with 43 receipts). It still
  // appears as its OWN junk cluster (for manual correction), just never a target.
  const clusters = clusterVendors([
    { name: 'ספק לא ידוע', count: 43 },
    { name: 'ספקטרום מזון בע"מ', count: 3 },
    { name: 'ספקטרום מזון', count: 2 },
  ])
  const unknown = clusters.find(c => normalizeVendor(c.canonical) === normalizeVendor('ספק לא ידוע'))
  assert.ok(unknown && unknown.junk, 'unknown-supplier is its own cluster and flagged junk')
  assert.equal([...unknown.members, ...unknown.review].length, 1, 'no real supplier attached to unknown')
  // The two real spellings still cluster together on their own, non-junk.
  const real = clusters.find(c => c.canonical.includes('ספקטרום'))
  assert.ok(real && !real.junk && [...real.members, ...real.review].length === 2, 'real supplier spellings still group')
})

test('clustering is stable and loses nothing', () => {
  const rows = [
    { name: 'א', count: 1 }, { name: 'קטיף ירקות קצוצים בע"מ', count: 9 },
    { name: 'קתוף ירקות קצוצים בע"מ', count: 2 },
  ]
  const total = clusterVendors(rows).reduce((n, c) => n + c.members.length + c.review.length, 0)
  assert.equal(total, rows.length)
})
