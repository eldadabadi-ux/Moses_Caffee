/**
 * supplierMatch (client) — re-export of the ONE implementation that lives in
 * functions/api/_lib/supplierMatch.js.
 *
 * Vendor-name identity has to be decided identically on the server (during a
 * scan) and in the browser (the merge screen, the "same supplier?" prompt), so
 * there is exactly one copy of the logic and this file only points at it
 * (guardrail 2 — SSOT for domain logic).
 */
export {
  normalizeVendor,
  vendorSkeleton,
  vendorSimilarity,
  matchVendor,
  clusterVendors,
  isJunkVendor,
  levenshtein,
  AUTO_THRESHOLD,
  ASK_THRESHOLD,
} from '../../functions/api/_lib/supplierMatch.js'
