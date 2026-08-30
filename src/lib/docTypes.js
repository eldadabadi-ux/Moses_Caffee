/**
 * docTypes (client) — re-export of the ONE implementation in
 * functions/api/_lib/docTypes.js.
 *
 * Document classification decides what counts as an expense, so the scan
 * pipeline, the bot's tools and the UI must agree exactly (guardrail 2 — SSOT).
 */
export {
  DOC_TYPES,
  docTypeLabel,
  docTypeIcon,
  docTypeOf,
  isExpenseDoc,
  DOC_COL_RE,
} from '../../functions/api/_lib/docTypes.js'
