/**
 * classifyReceipt — deterministic receipt-type → { l1, l2 } safety net.
 *
 * Runs AFTER the AI (used by /api/scan-receipt via extractReceipt, by
 * /api/recategorize, and by the Categories-tab tree reconcile) so an UNAMBIGUOUS
 * vendor type is never mis-filed — and so it always gets a sensible SUB-category
 * (L2), e.g. a parking receipt → "תחבורה ודלק" › "חניון".
 *
 * Returns { l1, l2 } or null (null → keep the AI's own choice).
 *
 * Tokens are deliberately specific (real vendor names / domain words) to avoid
 * false positives. The scan flow also shows an editable review screen.
 */

// Standalone-token match — for short ambiguous names (e.g. "פז", "דלק") that we
// don't want to match as a substring of another word. The haystack joins fields
// with " | ", so a real token is bounded by spaces / pipes / string ends.
function hasToken(hay, token) {
  const t = token.toLowerCase()
  const re = new RegExp(`(?:^|[\\s|/,.\-])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[\\s|/,.\-]|$)`)
  return re.test(hay)
}

// All of these roll up to one L1 ("תחבורה ודלק"), each with its own sub-category.
const L1_TRANSPORT = 'תחבורה ודלק'

// First matching rule wins → more specific types (parking/taxi) before the
// generic fuel fallback. `subs` = safe substrings, `toks` = standalone words.
const RULES = [
  { l2: 'חניון',           subs: ['חניון', 'חנייה', 'חניה', 'אחוזות החוף'],                              toks: ['פנגו', 'pango', 'סלופארק', 'cellopark'] },
  { l2: 'מוניות',          subs: ['מונית', 'מוניות', 'טקסי'],                                            toks: ['taxi', 'gett', 'uber', 'אובר', 'yango', 'יאנגו'] },
  { l2: 'תחבורה ציבורית',  subs: ['רב קו', 'רב-קו', 'רכבת ישראל', 'רכבת', 'מטרופולין', 'דן תחבורה'],      toks: ['אגד'] },
  { l2: 'כביש אגרה',        subs: ['כביש 6', 'כביש שש', 'דרך ארץ', 'כביש אגרה'],                          toks: [] },
  { l2: 'דלק',             subs: ['תחנת דלק', 'תחנת תדלוק', 'תדלוק', 'בנזין', 'סולר', 'דיזל', 'אוקטן', 'סונול', 'דור אלון', 'דלקן', 'פזגז', 'פז דלק', 'sonol', 'delek', 'petrol', 'diesel', 'octane', 'gas station', 'fuel'], toks: ['דלק', 'פז', 'yellow', 'paz'] },
]

/**
 * Infer { l1, l2 } from a receipt's vendor + items, or null.
 * @param {object} receipt { vendor_name, items:[{ item_name, category_l1, category_l2 }] }
 */
export function classifyReceipt(receipt) {
  if (!receipt) return null
  const parts = [String(receipt.vendor_name || '')]
  for (const it of (receipt.items || [])) {
    parts.push(String(it?.item_name || ''), String(it?.category_l1 || ''), String(it?.category_l2 || ''))
  }
  const hay = (' | ' + parts.join(' | ') + ' | ').toLowerCase()

  for (const rule of RULES) {
    if ((rule.subs || []).some(s => hay.includes(s.toLowerCase())) ||
        (rule.toks || []).some(t => hasToken(hay, t))) {
      return { l1: L1_TRANSPORT, l2: rule.l2 }
    }
  }
  return null
}

// Back-compat helper — some callers only need the forced L1 name.
export function inferReceiptCategory(receipt) {
  return classifyReceipt(receipt)?.l1 || null
}

/**
 * Apply the deterministic category to a scan result IN PLACE: sets the
 * receipt-level `category` (L1) and relabels items under L1 › L2 so the receipt
 * always carries a category AND a sub-category. When the receipt has no line
 * items, a single representative item (named after the sub-category) is added so
 * the L1 › L2 pair still gets created in the tree.
 * @returns {string} the chosen receipt category (L1).
 */
export function applyReceiptCategory(result) {
  const hit = classifyReceipt(result)
  const aiCat = (result?.category && String(result.category).trim()) || ''
  const firstItem = result?.items?.[0]?.category_l1
  const chosen = hit?.l1 || aiCat || firstItem || 'שונות'

  if (hit) {
    const base = (result.items && result.items.length)
      ? result.items
      : [{ item_name: hit.l2, price: Number(result.total_amount) || 0 }]
    result.items = base.map(it => ({
      ...it,
      category_l1: hit.l1,
      category_l2: hit.l2,
      category_l3: it.category_l3 || it.item_name || '',
      is_new_category: true,
    }))
  }
  result.category = chosen
  return chosen
}
