/**
 * textMatch + classifyReceipt — the deterministic category safety net.
 * Anchored on a real mis-classification found in the live data.
 * Run: node --test tests/unit/classify.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { containsWord, containsAnyWord } from '../../functions/api/_lib/textMatch.js'
import { classifyReceipt, applyReceiptCategory } from '../../functions/api/_lib/classifyReceipt.js'

// ── containsWord ─────────────────────────────────────────────────────────────
test('a Hebrew word inside a longer Hebrew word is NOT a match', () => {
  assert.equal(containsWord('תה ירוק לימונית ולואיזה', 'מונית'), false)
  assert.equal(containsWord('אבטיח', 'טיח'), false)
  assert.equal(containsWord('מלפפון', 'פפון'), false)
})

test('a standalone Hebrew word IS a match', () => {
  assert.equal(containsWord('נסיעה במונית לעבודה', 'מונית'), true)
  assert.equal(containsWord('מונית', 'מונית'), true)
  assert.equal(containsWord('חשבונית | מונית | 50', 'מונית'), true)
})

test('multi-word phrases match as phrases', () => {
  assert.equal(containsWord('סונול תחנת דלק רעננה', 'תחנת דלק'), true)
  assert.equal(containsWord('תחנתדלק', 'תחנת דלק'), false)
})

test('Latin words respect boundaries too, case-insensitively', () => {
  assert.equal(containsWord('Uber trip', 'uber'), true)
  assert.equal(containsWord('Ubermensch', 'uber'), false)
  assert.equal(containsWord('GETT | 42', 'gett'), true)
})

test('empty inputs never match', () => {
  assert.equal(containsWord('', 'מונית'), false)
  assert.equal(containsWord('מונית', ''), false)
  assert.equal(containsWord(null, null), false)
  assert.equal(containsAnyWord('מונית', []), false)
})

// ── classifyReceipt — the live regression ────────────────────────────────────
test('REGRESSION: a dairy invoice with lemon-verbena tea is not a taxi ride', () => {
  // Live receipt 3ffd0e9e (המתוקיה של בני, ₪2,138) was filed under
  // "תחבורה ודלק › מוניות" because "מונית" hides inside "לימונית".
  const receipt = {
    vendor_name: 'המתוקיה של בני בע"מ',
    items: [
      { item_name: 'חלב טרי בקרטון 1 ליטר 3% שומן/תנובה' },
      { item_name: 'תה ירוק לימונית ולואיזה' },
      { item_name: 'נס קפה עלית 200 גר בפח' },
      { item_name: 'מיונז היינץ לחיץ' },
    ],
  }
  assert.equal(classifyReceipt(receipt), null)
})

test('genuine transport receipts still classify', () => {
  assert.deepEqual(classifyReceipt({ vendor_name: 'גט מוניות' }), { l1: 'תחבורה ודלק', l2: 'מוניות' })
  assert.deepEqual(classifyReceipt({ vendor_name: 'סונול תחנת דלק' }), { l1: 'תחבורה ודלק', l2: 'דלק' })
  assert.deepEqual(classifyReceipt({ vendor_name: 'פנגו' }), { l1: 'תחבורה ודלק', l2: 'חניון' })
  assert.deepEqual(classifyReceipt({ vendor_name: 'מיקה תפעול תחנות דלק' }), { l1: 'תחבורה ודלק', l2: 'דלק' })
})

test('ordinary café suppliers are left to the AI', () => {
  for (const v of ['קטיף ירקות קצוצים בע"מ', 'לי-אור דגן שיווק מוצרי מאפה',
                   'מיזן סחר ושיווק מזון איכותי בע"מ', 'חברת החשמל לישראל בע"מ']) {
    assert.equal(classifyReceipt({ vendor_name: v }), null, v)
  }
})

test('applyReceiptCategory keeps the AI category when no rule matches', () => {
  const r = { vendor_name: 'קטיף ירקות קצוצים בע"מ', category: 'ירקות ופירות',
              items: [{ item_name: 'מלפפון', category_l1: 'ירקות ופירות' }] }
  applyReceiptCategory(r)
  assert.equal(r.category, 'ירקות ופירות')
  assert.equal(r.items[0].category_l1, 'ירקות ופירות')
})

test('applyReceiptCategory overrides an obviously wrong AI category', () => {
  const r = { vendor_name: 'סונול תחנת דלק', category: 'מוצרי מזון ומכולת',
              items: [{ item_name: 'סולר', category_l1: 'מוצרי מזון ומכולת' }] }
  applyReceiptCategory(r)
  assert.equal(r.category, 'תחבורה ודלק')
  assert.equal(r.items[0].category_l2, 'דלק')
})

test('a Hebrew one-letter particle still leaves a whole word', () => {
  assert.equal(containsWord('נסיעה במונית לעבודה', 'מונית'), true)   // ב + מונית
  assert.equal(containsWord('הגעתי לחניון', 'חניון'), true)          // ל + חניון
  assert.equal(containsWord('חזרתי מהחניון', 'חניון'), false)        // מה = two letters
  // …but a particle must not open the door back to the substring bug:
  assert.equal(containsWord('תה ירוק לימונית ולואיזה', 'מונית'), false)
  assert.equal(containsWord('לימונית', 'מונית'), false)
})
