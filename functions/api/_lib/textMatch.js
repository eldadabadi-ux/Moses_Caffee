/**
 * textMatch — word-boundary matching that actually works for Hebrew.
 *
 * WHY THIS EXISTS: JavaScript's `\b` is defined over [A-Za-z0-9_], so it never
 * fires next to a Hebrew letter — every regex built with it silently fails or
 * matches too much. The usual workaround, a plain `includes()`, is worse: it
 * matches short words inside longer ones.
 *
 * That cost real money in this app. `classifyReceipt` matched the substring
 * "מונית" (taxi) inside "לימונית" (lemon verbena), so a ₪2,138 dairy delivery
 * note from המתוקיה של בני was filed under "תחבורה ודלק › מוניות" — every item
 * on it relabelled as a taxi ride.
 *
 * `containsWord()` treats a match as a word only when neither neighbouring
 * character is a letter or digit, in Hebrew OR Latin.
 */

// Hebrew letters + Latin letters + digits. A match touching any of these on
// either side is part of a longer word, not a word of its own.
const LETTER_OR_DIGIT = /[֐-׿A-Za-z0-9]/

// Hebrew attaches its one-letter particles to the FRONT of a word — "במונית"
// (in a taxi), "לחניון" (to the parking lot), "מהתחנה" (from the station). A
// single one of these before the term still leaves it a word of its own.
// Crucially "לימונית" is NOT covered: the letter before "מונית" there is "י",
// which is not a particle.
const PREFIX_LETTERS = new Set(['ב', 'ל', 'מ', 'ה', 'ו', 'כ', 'ש'])

const isBoundary = (ch) => ch === undefined || !LETTER_OR_DIGIT.test(ch)

/** Boundary, or exactly one Hebrew particle sitting on a boundary. */
const startsWord = (hay, i) =>
  isBoundary(hay[i - 1]) || (PREFIX_LETTERS.has(hay[i - 1]) && isBoundary(hay[i - 2]))

/**
 * Does `haystack` contain `term` as a whole word (or whole phrase)?
 * Case-insensitive. Works for multi-word phrases too — only the characters
 * immediately outside the match are checked.
 */
export function containsWord(haystack, term) {
  const hay = String(haystack || '').toLowerCase()
  const t = String(term || '').toLowerCase().trim()
  if (!hay || !t) return false
  let from = 0
  for (;;) {
    const i = hay.indexOf(t, from)
    if (i === -1) return false
    if (startsWord(hay, i) && isBoundary(hay[i + t.length])) return true
    from = i + 1
  }
}

/** True when ANY of the terms appears as a whole word. */
export const containsAnyWord = (haystack, terms = []) =>
  terms.some(t => containsWord(haystack, t))
