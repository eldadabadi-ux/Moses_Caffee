/**
 * books — separate ledgers of account (client request #17).
 *
 * Moses runs catering events alongside the café. Their documents must be
 * catalogued apart and must NOT feed the café's statistics, insights or
 * comparisons.
 *
 * This is a DIMENSION, deliberately not a category. A category named "אירועים"
 * would leak into every breakdown, donut, drill-down and supplier comparison —
 * precisely what the request rules out. `book` is also orthogonal to `doc_type`:
 * an events delivery note is still a delivery note.
 *
 * The default is 'cafe', so every existing row and every screen that does not
 * opt in keeps behaving exactly as before.
 */

export const BOOKS = [
  { value: 'cafe',   label: 'בית הקפה', icon: '☕' },
  { value: 'events', label: 'אירועים',  icon: '🎪' },
]

export const DEFAULT_BOOK = 'cafe'

export const bookLabel = (v) => BOOKS.find(b => b.value === v)?.label || ''
export const bookIcon  = (v) => BOOKS.find(b => b.value === v)?.icon || ''

/**
 * Effective book of a receipt row (column → default).
 *
 * Any key is accepted since 20.11.26: beyond the two built-ins a user can
 * define their own types (outside catering, a shop, one project). The DB
 * constrains the SHAPE of the key, not a fixed list.
 */
export const bookOf = (r) => {
  const k = typeof r?.book === 'string' ? r.book.trim() : ''
  return /^[a-z0-9_-]{2,24}$/.test(k) ? k : DEFAULT_BOOK
}

/** The two books that ship with the product and cannot be removed. */
export const isBuiltinBook = (k) => BOOKS.some(b => b.value === k)

/**
 * Should this row appear in the café's numbers?
 * Every statistic, chart, comparison, insight and export filters through here.
 * Only the default book counts — every other type, built-in or user-defined,
 * is kept out of the business figures (operator decision 20.11.26).
 */
export const isCafeBook = (r) => bookOf(r) === DEFAULT_BOOK

/** Filter a list to one book. Pass null/undefined for "everything". */
export const inBook = (rows, book) =>
  book ? (rows || []).filter(r => bookOf(r) === book) : (rows || [])
