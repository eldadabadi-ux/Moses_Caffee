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
