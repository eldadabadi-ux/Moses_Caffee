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

/** Effective book of a receipt row (column → default). */
export const bookOf = (r) => (r?.book === 'events' ? 'events' : DEFAULT_BOOK)

/**
 * Should this row appear in the café's numbers?
 * Every statistic, chart, comparison, insight and export filters through here.
 */
export const isCafeBook = (r) => bookOf(r) === DEFAULT_BOOK

/** Filter a list to one book. Pass null/undefined for "everything". */
export const inBook = (rows, book) =>
  book ? (rows || []).filter(r => bookOf(r) === book) : (rows || [])
