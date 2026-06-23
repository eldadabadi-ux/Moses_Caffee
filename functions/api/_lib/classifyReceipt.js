/**
 * classifyReceipt — deterministic receipt-type → category safety net.
 *
 * Runs AFTER the AI (used by /api/scan-receipt via extractReceipt, and by
 * /api/recategorize) so an UNAMBIGUOUS vendor type — above all FUEL / TRANSPORT
 * — is never mis-filed into a food category just because the model defaulted to
 * the café's food-heavy category tree.
 *
 * Returns a forced L1 category name, or null to keep the AI's own choice.
 *
 * Tokens are deliberately specific (real vendor names / domain words) to avoid
 * false positives. The scan flow also shows an editable review screen, so a rare
 * wrong guess is correctable before saving.
 */

// Standalone-token match (handles short ambiguous names like "פז" that we don't
// want to match as a substring of another word). The haystack joins fields with
// " | ", so a real token is bounded by spaces / pipes / string ends.
function hasToken(hay, token) {
  const t = token.toLowerCase()
  const re = new RegExp(`(?:^|[\\s|/,.\-])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[\\s|/,.\-]|$)`)
  return re.test(hay)
}

// Substring match — for distinctive multi-char tokens that are safe anywhere.
function hasSub(hay, token) { return hay.includes(token.toLowerCase()) }

// ── Rules, in priority order (first match wins) ───────────────────────────────
// FUEL + PARKING + TOLL + PUBLIC-TRANSPORT all roll up to one L1, as the owner
// grouped them ("תחבורה ודלק").
const FUEL_TRANSPORT = 'תחבורה ודלק'

// Distinctive substrings — safe to match anywhere in vendor/item text.
const FUEL_SUBSTRINGS = [
  'תחנת דלק', 'תחנת תדלוק', 'תדלוק', 'בנזין', 'סולר', 'דיזל', 'אוקטן',
  'סונול', 'דור אלון', 'דלקן', 'פזגז', 'פז דלק',
  'חניון', 'חנייה', 'פנגו', 'pango', 'סלופארק', 'cellopark', 'אחוזות החוף',
  'כביש 6', 'דרך ארץ', 'כביש אגרה', 'רב קו', 'רב-קו',
  'מטרופולין', 'דן תחבורה', 'רכבת ישראל', 'מונית', 'מוניות', 'טקסי',
  'sonol', 'delek', 'petrol', 'diesel', 'octane', 'gas station', 'fuel',
]
// Short / ambiguous tokens — only as standalone words.
const FUEL_TOKENS = ['דלק', 'פז', 'yellow', 'paz', 'אגד', 'gett', 'uber', 'סד"ש', 'סדש']

/**
 * Infer a forced category from a receipt's vendor + items.
 * @param {object} receipt { vendor_name, items:[{ item_name, category_l1 }] }
 * @returns {string|null} forced L1 category, or null to defer to the AI.
 */
export function inferReceiptCategory(receipt) {
  if (!receipt) return null
  const parts = [String(receipt.vendor_name || '')]
  for (const it of (receipt.items || [])) {
    parts.push(String(it?.item_name || ''))
    parts.push(String(it?.category_l1 || ''))
  }
  const hay = (' | ' + parts.join(' | ') + ' | ').toLowerCase()

  if (FUEL_SUBSTRINGS.some(s => hasSub(hay, s)) || FUEL_TOKENS.some(t => hasToken(hay, t))) {
    return FUEL_TRANSPORT
  }
  return null
}

/**
 * Apply the deterministic category to a receipt result IN PLACE: sets the
 * receipt-level `category` and re-labels item L1s so the breakdown matches.
 * Falls back to the AI's category / first item / "שונות" when no rule fires.
 * @returns {string} the chosen receipt category.
 */
export function applyReceiptCategory(result) {
  const forced = inferReceiptCategory(result)
  const aiCat  = (result?.category && String(result.category).trim()) || ''
  const firstItem = result?.items?.[0]?.category_l1
  const chosen = forced || aiCat || firstItem || 'שונות'

  if (forced) {
    // The whole receipt is this type — keep item names but roll them up under
    // the forced L1 so dashboards/drill-downs don't show contradictory food rows.
    result.items = (result.items || []).map(it => ({
      ...it,
      category_l1: forced,
      category_l2: '',
      category_l3: it.category_l3 || it.item_name || '',
      is_new_category: it.category_l1 !== forced ? true : it.is_new_category,
    }))
  }
  result.category = chosen
  return chosen
}
