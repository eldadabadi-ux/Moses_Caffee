/**
 * prefetch — warm the page cache for the OTHER tabs while the user is on the
 * home (dashboard) page, so the first switch to any tab is instant (no data
 * spinner). Writes the EXACT cache keys/shapes each page reads on mount, so the
 * pages initialise straight from cache.
 *
 * ⚠️ Keep these queries in sync with each page's own loadData():
 *   - 'receipts'   → ReceiptsPage   (array of non-archived receipts)
 *   - 'categories' → CategoriesPage ({ categories, expanded })
 *   - 'suppliers'  → SuppliersPage  ({ receipts, contacts })
 * The dashboard ('dash:<year>') is NOT prefetched here — it loads itself as the
 * home page.
 */
import { supabase } from './supabase'
import { setCached, hasCached } from './pageCache'
import { loadSuppliers } from './suppliers'

export async function prefetchAllPages(user) {
  if (!user) return
  await Promise.allSettled([
    // ReceiptsPage
    (async () => {
      if (hasCached('receipts')) return
      const { data, error } = await supabase
        .from('receipts').select('*').is('archived_at', null)
        .order('receipt_date', { ascending: false })
      if (!error) setCached('receipts', data || [])
    })(),

    // CategoriesPage
    (async () => {
      if (hasCached('categories')) return
      const { data, error } = await supabase
        .from('categories').select('*').order('level').order('sort_order')
      if (error) return
      const cats = data || []
      // Collapsed by default — the tree opens one level at a time on click.
      setCached('categories', { categories: cats, expanded: {} })
    })(),

    // SuppliersPage
    (async () => {
      if (hasCached('suppliers')) return
      const [{ data: recs, error }, sup] = await Promise.all([
        supabase.from('receipts').select('id, vendor_name, receipt_date, amount, category_text, items, archived_at, created_at').eq('user_id', user.id),
        loadSuppliers(user.id),
      ])
      if (!error) setCached('suppliers', { receipts: recs || [], contacts: sup || [] })
    })(),
  ])
}
