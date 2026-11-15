/**
 * productMatch — SSOT for deciding whether two line-item names are the SAME
 * product, so the same goods can be compared across suppliers (client request
 * #4). Pure functions, no I/O — the comparison page, the bot and any report
 * reason identically.
 *
 * The problem: `items[].item_name` is free OCR text, so one product arrives as
 * "עגבניה", "עגבניות", "עגבניות אשכולות 1 ק\"ג", "עגבניה אשכולות 5%". Pack sizes,
 * percentages and plural/feminine endings are noise for identity; the descriptive
 * words ("אשכולות") are the identity and are kept. Two names with the same normal
 * form ARE the same product; different descriptors stay apart on purpose, so a
 * comparison never silently pools unlike goods.
 *
 * Grouping key resolution (productKey): the normalized name when there is one,
 * otherwise the AI's own product-level category (category_l3) as a fallback.
 */

// Final (sofit) letters → base form, so "מלפפון" and "מלפפונים" fold together.
const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' }

// Number + measurement/pack word anywhere in the name ("1 ליטר", "500 גרם",
// "12 יח'", "4 קג", "2 מארז"). Mirrors units.SIZE_RE but also drops containers,
// since for identity the size is noise regardless of whether it is measurable.
const SIZE_RE = /(\d+(?:[.,]\d+)?)\s*(ק"?ג|קילוגרם|קילו|גרם|גר['׳]?|ליטר|ליט['׳]?|ל['׳]|מ"?ל|יחידות|יחידה|יח['׳]?|מארז|מארזים|קופסה|קופסא|קרטון|ארגז|מגש|שקית|חבילה|kg|gr|g|ml|lt|l|pcs|pc|units|unit)(?![֐-׿a-z])/gi

// Standalone container / packaging words that carry no product identity.
const PACK_WORDS = new Set([
  'מארז', 'מארזים', 'קופסה', 'קופסא', 'קופסאות', 'קרטון', 'ארגז', 'ארגזים',
  'מגש', 'מגשים', 'שקית', 'שקיות', 'חבילה', 'חבילות', 'גוש', 'יחידה', 'יחידות',
])

/** Strip one Hebrew plural / feminine suffix from a token, conservatively. */
function foldPlural(tok) {
  for (const suf of ['יות', 'ות', 'ים', 'יה', 'ה']) {
    if (tok.length > suf.length + 1 && tok.endsWith(suf)) return tok.slice(0, -suf.length)
  }
  return tok
}

/**
 * Conservative product normal form. Same normal form ⇒ same product.
 * Removes sizes, percentages, pack words and punctuation; folds plurals and
 * final letters; keeps descriptive words. Returns '' when nothing survives.
 */
export function normalizeProduct(name) {
  let s = String(name || '').normalize('NFC')
    .replace(/[֑-ׇ]/g, '')                 // niqqud
    .replace(SIZE_RE, ' ')                  // "1 ליטר", "500 גרם", "12 יח'"
    .replace(/\d+(?:[.,]\d+)?\s*%/g, ' ')  // fat / content percentages
    .replace(/["'`׳״‘’“”]/g, '')          // quotes, geresh, gershayim
    .replace(/[.,\-–—_/\\|()\[\]{}+*:;!?@#$%^~=<>]/g, ' ')
    .replace(/\d+/g, ' ')                    // any remaining bare numbers (brand codes, leftover sizes)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  if (!s) return ''

  const tokens = s.split(' ')
    .filter(Boolean)
    .filter(t => !PACK_WORDS.has(t))
    .map(t => {
      // Fold the plural suffix FIRST (while the final mem of "…ים" is intact),
      // then normalize any remaining final letter.
      const folded = foldPlural(t)
      return [...folded].map(ch => FINALS[ch] || ch).join('')
    })
    .filter(Boolean)
  return tokens.join(' ')
}

/**
 * Grouping key for a line item: its normalized product name, or — when the name
 * normalizes to nothing — the AI product-level category (category_l3 → l2 → l1).
 * Returns '' when there is no usable identity at all.
 */
export function productKey(item) {
  const norm = normalizeProduct(item?.item_name ?? item?.name)
  if (norm) return norm
  const cat = (item?.category_l3 || item?.l3 || item?.category_l2 || item?.l2 || item?.category_l1 || item?.l1 || '')
  return String(cat).trim().toLowerCase()
}

/** Do two line items name the same product? */
export const sameProduct = (a, b) => {
  const ka = productKey(a), kb = productKey(b)
  return !!ka && ka === kb
}
