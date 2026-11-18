/**
 * pageCache — tiny in-memory stale-while-revalidate cache for page data.
 *
 * Problem: every page did `if (loading) return <LoadingSpinner/>` and refetched
 * on each mount, so switching tabs blanked the whole screen to a spinner every
 * time. With this cache a page keeps its last-loaded data and shows it INSTANTLY
 * on re-mount, while still refetching silently in the background (so data is
 * never more than one render stale).
 *
 * In-memory only (per tab/session) — cleared on sign-out via clearPageCache().
 */
const store = new Map()

export const getCached = (key) => store.get(key)
export const setCached = (key, value) => { store.set(key, value) }
export const hasCached = (key) => store.has(key)
export const clearPageCache = () => { store.clear() }

/**
 * Every cache key that is derived from the receipts table. Any mutation of a
 * receipt (create / edit / approve / archive / restore / delete / re-link /
 * re-categorize) MUST call invalidateReceiptData() so the dashboard, insights
 * and dropdowns never show pre-mutation numbers. The mutating page may re-seed
 * its own key afterwards; everyone else refetches on next mount.
 */
export const invalidateReceiptData = () => {
  for (const key of [...store.keys()]) {
    if (key === 'receipts' || key === 'archive' || key === 'dash:meta' || key.startsWith('dashyr:')) store.delete(key)
  }
}
