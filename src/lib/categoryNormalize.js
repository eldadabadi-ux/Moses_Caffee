/**
 * categoryNormalize — canonicalises category names so the tree stays clean:
 * correct Hebrew spelling, no near-duplicates, one canonical name per concept.
 *
 * Applied EVERYWHERE a category name is created or stored (scan, edit, manual
 * add, re-classify, and the Categories-tab reconcile). The reconcile also uses
 * it to MERGE existing duplicates (e.g. the garbled "מוצון ומכולת" → the real
 * "מוצרי מזון ומכולת").
 *
 * The map keys are lower-cased, whitespace-collapsed variants → canonical name.
 * Anything not in the map is returned cleaned (trimmed / de-punctuated) as-is, so
 * legitimate new categories are never blocked — only known variants are merged.
 */

// Canonical café category set (L1) — variants on the left → canonical on the right.
const CANON_MAP = {
  // מוצרי מזון ומכולת (the cluster that caused the duplicate / typo)
  'מכולת': 'מוצרי מזון ומכולת',
  'מזון': 'מוצרי מזון ומכולת',
  'מוצון': 'מוצרי מזון ומכולת',
  'מזון ומכולת': 'מוצרי מזון ומכולת',
  'מוצון ומכולת': 'מוצרי מזון ומכולת',
  'מוצרי מזון': 'מוצרי מזון ומכולת',
  'מצרכי מזון': 'מוצרי מזון ומכולת',
  'מוצרי מכולת': 'מוצרי מזון ומכולת',
  'מכולת ומזון': 'מוצרי מזון ומכולת',
  'מוצרי מזון ומכלת': 'מוצרי מזון ומכולת',
  'מוצרי מזון ומכולת': 'מוצרי מזון ומכולת',

  // ירקות ופירות
  'ירקות': 'ירקות ופירות',
  'פירות': 'ירקות ופירות',
  'פירות וירקות': 'ירקות ופירות',
  'ירקות ופירות': 'ירקות ופירות',

  // קפה ומשקאות
  'קפה': 'קפה ומשקאות',
  'משקאות': 'קפה ומשקאות',
  'קפה ומשקאות': 'קפה ומשקאות',

  // ניקיון וחומרי ניקוי
  'ניקיון': 'ניקיון וחומרי ניקוי',
  'נקיון': 'ניקיון וחומרי ניקוי',
  'חומרי ניקוי': 'ניקיון וחומרי ניקוי',
  'ניקיון וחומרי ניקוי': 'ניקיון וחומרי ניקוי',
  'נקיון וחומרי ניקוי': 'ניקיון וחומרי ניקוי',

  // ציוד וכלים
  'ציוד': 'ציוד וכלים',
  'כלים': 'ציוד וכלים',
  'ציוד וכלים': 'ציוד וכלים',

  // גינון ותחזוקה
  'גינון': 'גינון ותחזוקה',
  'גינון ותחזוקה': 'גינון ותחזוקה',

  // חד פעמי ואריזות
  'חד פעמי': 'חד פעמי ואריזות',
  'חד-פעמי': 'חד פעמי ואריזות',
  'אריזות': 'חד פעמי ואריזות',
  'חד פעמי ואריזות': 'חד פעמי ואריזות',
  'חד-פעמי ואריזות': 'חד פעמי ואריזות',

  // תחבורה ודלק
  'דלק': 'תחבורה ודלק',
  'תחבורה': 'תחבורה ודלק',
  'תחבורה ודלק': 'תחבורה ודלק',

  // מסעדות ואירוח
  'מסעדה': 'מסעדות ואירוח',
  'מסעדות': 'מסעדות ואירוח',
  'אירוח': 'מסעדות ואירוח',
  'מסעדות ואירוח': 'מסעדות ואירוח',

  // שירותים ותקשורת
  'תקשורת': 'שירותים ותקשורת',
  'שירותים': 'שירותים ותקשורת',
  'שרותים': 'שירותים ותקשורת',
  'שירותים ותקשורת': 'שירותים ותקשורת',
  'שרותים ותקשורת': 'שירותים ותקשורת',

  // ציוד משרדי
  'משרדי': 'ציוד משרדי',
  'ציוד משרדי': 'ציוד משרדי',
  'ציוד למשרד': 'ציוד משרדי',

  // אחזקה ותיקונים
  'אחזקה': 'אחזקה ותיקונים',
  'תיקונים': 'אחזקה ותיקונים',
  'אחזקה ותיקונים': 'אחזקה ותיקונים',
  'תחזוקה ותיקונים': 'אחזקה ותיקונים',

  // שונות
  'אחר': 'שונות',
  'כללי': 'שונות',
  'שונות': 'שונות',
}

/** Clean a raw category name: trim, collapse inner whitespace, strip stray
 *  edge punctuation. Returns '' for empty. Does NOT apply the L1 canon map — use
 *  for L2/L3 sub-category names (a sub "דלק" must NOT become its parent). */
export function cleanCategoryName(name) {
  return String(name || '')
    .replace(/[‎‏ ]/g, ' ')   // strip bidi marks / nbsp
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^["'`.,;:·\-–—\s]+|["'`.,;:·\-–—\s]+$/g, '')
    .trim()
}

/** Canonical category name (correct spelling, de-duplicated concept). */
export function normalizeCategoryName(name) {
  const s = cleanCategoryName(name)
  if (!s) return s
  return CANON_MAP[s.toLowerCase()] || s
}

/** Comparison key — two names that map to the same key are the SAME category. */
export function categoryKey(name) {
  return normalizeCategoryName(name).toLowerCase()
}

/** True if two category names refer to the same canonical category. */
export function sameCategory(a, b) {
  return categoryKey(a) === categoryKey(b)
}
