/**
 * books (client) — re-export of the ONE implementation in
 * functions/api/_lib/books.js.
 *
 * The café/events split decides what counts in every statistic, so the scan
 * pipeline, the bot's tools and the UI must agree exactly (guardrail 2 — SSOT).
 */
export {
  BOOKS,
  DEFAULT_BOOK,
  bookLabel,
  bookIcon,
  bookOf,
  isCafeBook,
  inBook,
} from '../../functions/api/_lib/books.js'
