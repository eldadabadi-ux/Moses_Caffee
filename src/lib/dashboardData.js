/**
 * dashboardData — the shared per-year receipt loader behind the dashboard and
 * the supplier-comparison page (split out 15.11.26 when the comparison moved to
 * its own screen). One cached fetch per calendar year: a multi-year dashboard
 * selection combines already-loaded years instantly, and both pages reuse the
 * same cache entries instead of each fetching its own copy.
 */
import { supabase } from './supabase'
import { getCached, setCached } from './pageCache'
import { isExpenseDoc } from './docTypes'
import { isCafeBook } from './books'

/** Café-book expense receipts of one calendar year, cached under dashyr:<year>. */
export async function loadYearReceipts(userId, year) {
  const key = 'dashyr:' + year
  const cached = getCached(key)
  if (cached) return cached
  // doc_type is selected so summary invoices (חשבונית מרכזת) can be EXCLUDED
  // from all totals — they aggregate delivery notes that are already counted.
  // Pre-migration the column doesn't exist → retry without it.
  let { data: recs, error } = await supabase
    .from('receipts')
    .select('id, amount, amount_before_vat, receipt_date, category_id, category_text, vendor_name, supplier_id, items, doc_type, book, archived_at')
    .eq('user_id', userId)
    .gte('receipt_date', `${year}-01-01`)
    .lte('receipt_date', `${year}-12-31`)
    .order('receipt_date')
  if (error) {
    ;({ data: recs } = await supabase
      .from('receipts')
      .select('id, amount, receipt_date, category_id, category_text, vendor_name, items')
      .eq('user_id', userId)
      .gte('receipt_date', `${year}-01-01`)
      .lte('receipt_date', `${year}-12-31`)
      .order('receipt_date'))
  }
  // Catering events are a separate book — the café dashboard never shows them.
  const filtered = (recs || []).filter(r => isExpenseDoc(r) && isCafeBook(r))
  setCached(key, filtered)
  return filtered
}

/** Categories, canonical suppliers and the available years, cached under dash:meta. */
export async function loadDashMeta(userId, fallbackYear) {
  const cached = getCached('dash:meta')
  if (cached) return cached
  const [{ data: cats }, { data: sups }, { data: allDates }] = await Promise.all([
    supabase.from('categories').select('id, name, parent_id, level, sort_order').order('level').order('sort_order'),
    // Canonical supplier names — a merged supplier must appear once, not once
    // per OCR spelling.
    supabase.from('suppliers').select('id, name').eq('user_id', userId),
    supabase.from('receipts').select('receipt_date').eq('user_id', userId).not('receipt_date', 'is', null),
  ])
  const years = [...new Set((allDates || []).map(r => parseInt(r.receipt_date.slice(0, 4))))].filter(Boolean).sort((a, b) => b - a)
  const meta = { categories: cats || [], suppliers: sups || [], availYears: years.length ? years : [fallbackYear] }
  setCached('dash:meta', meta)
  return meta
}
