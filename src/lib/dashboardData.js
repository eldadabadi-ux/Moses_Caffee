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
import { expandInstallments, yearsSpanned } from './installments'

const COLS = 'id, amount, amount_before_vat, receipt_date, category_id, category_text, vendor_name, supplier_id, items, doc_type, book, archived_at, installments'

/**
 * Café-book expense receipts of one calendar year, cached under dashyr:<year>.
 * Installment documents are returned SPREAD: one virtual slice per month that
 * falls inside the year (see installments.js). A document bought late last
 * year in 10 payments must show its slices THIS year, so a second query pulls
 * earlier installment rows whose spread can reach this window (≤60 payments —
 * the DB constraint — means at most 5 years back).
 */
export async function loadYearReceipts(userId, year) {
  const key = 'dashyr:' + year
  const cached = getCached(key)
  if (cached) return cached
  // doc_type is selected so summary invoices (חשבונית מרכזת) can be EXCLUDED
  // from all totals — they aggregate delivery notes that are already counted.
  // Pre-migration the columns don't exist → retry without them.
  let { data: recs, error } = await supabase
    .from('receipts')
    .select(COLS)
    .eq('user_id', userId)
    .gte('receipt_date', `${year}-01-01`)
    .lte('receipt_date', `${year}-12-31`)
    .order('receipt_date')
  let spill = []
  if (!error) {
    ;({ data: spill } = await supabase
      .from('receipts')
      .select(COLS)
      .eq('user_id', userId)
      .gt('installments', 1)
      .gte('receipt_date', `${year - 5}-01-01`)
      .lt('receipt_date', `${year}-01-01`))
  } else {
    ;({ data: recs } = await supabase
      .from('receipts')
      .select('id, amount, receipt_date, category_id, category_text, vendor_name, items')
      .eq('user_id', userId)
      .gte('receipt_date', `${year}-01-01`)
      .lte('receipt_date', `${year}-12-31`)
      .order('receipt_date'))
  }
  // Catering events are a separate book — the café dashboard never shows them.
  const rows = [...(recs || []), ...(spill || [])].filter(r => isExpenseDoc(r) && isCafeBook(r))
  const spread = expandInstallments(rows, { from: `${year}-01-01`, to: `${year}-12-31` })
    .sort((a, b) => (a.receipt_date || '').localeCompare(b.receipt_date || ''))
  setCached(key, spread)
  return spread
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
    supabase.from('receipts').select('receipt_date, installments').eq('user_id', userId).not('receipt_date', 'is', null),
  ])
  // A year exists the moment money lands in it — including a FUTURE year that
  // only installment slices reach (client request 18.11.26).
  const years = yearsSpanned(allDates || [])
  const meta = { categories: cats || [], suppliers: sups || [], availYears: years.length ? years : [fallbackYear] }
  setCached('dash:meta', meta)
  return meta
}
