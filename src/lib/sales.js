/**
 * sales — reading and writing the revenue side (client request 20.11.26).
 *
 * Every query is scoped by user_id on top of RLS, exactly like budgets.js and
 * suppliers.js. All arithmetic lives in salesMath.js — this file only moves
 * rows.
 */
import { supabase } from './supabase'
import { DEFAULT_BOOK } from './books'

const DAY_COLS = 'id, business_date, gross, vat, transactions, by_payment, source, storage_path, book, notes'
const LINE_COLS = 'id, day_id, business_date, hour, product_name, product_key, qty, unit, unit_price, line_total, category_text, book'

/** Days of one calendar year, oldest first. */
export async function loadSalesDays(userId, year, book = DEFAULT_BOOK) {
  const { data, error } = await supabase.from('sales_days')
    .select(DAY_COLS)
    .eq('user_id', userId).eq('book', book)
    .gte('business_date', `${year}-01-01`).lte('business_date', `${year}-12-31`)
    .order('business_date')
  if (error) { console.warn('[sales] days load failed:', error.message); return [] }
  return data || []
}

/** Sold-item detail for the same window — absent for manually entered days. */
export async function loadSalesLines(userId, year, book = DEFAULT_BOOK) {
  const { data, error } = await supabase.from('sales_lines')
    .select(LINE_COLS)
    .eq('user_id', userId).eq('book', book)
    .gte('business_date', `${year}-01-01`).lte('business_date', `${year}-12-31`)
  if (error) { console.warn('[sales] lines load failed:', error.message); return [] }
  return data || []
}

/**
 * Save one business day. The unique index is (user_id, business_date, book),
 * so entering the same date twice corrects it instead of adding a second day's
 * takings to the month.
 */
export async function saveSalesDay(userId, orgId, day) {
  const gross = Number(day.gross)
  if (!(gross >= 0)) throw new Error('נא להזין מחזור')
  if (!day.business_date) throw new Error('נא לבחור תאריך')
  const row = {
    user_id: userId,
    org_id: orgId || null,
    business_date: day.business_date,
    gross,
    vat: day.vat === '' || day.vat == null ? null : Number(day.vat),
    transactions: day.transactions === '' || day.transactions == null ? null : Math.round(Number(day.transactions)),
    by_payment: day.by_payment || {},
    source: day.source || 'manual',
    book: day.book || DEFAULT_BOOK,
    notes: day.notes || null,
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await supabase.from('sales_days')
    .upsert(row, { onConflict: 'user_id,business_date,book' })
    .select(DAY_COLS).single()
  if (error) throw error
  return data
}

/** Remove a day. Its lines go with it (ON DELETE CASCADE). */
export async function deleteSalesDay(id) {
  const { error } = await supabase.from('sales_days').delete().eq('id', id)
  if (error) throw error
}

/** The years that already carry takings, newest first, plus this one. */
export async function loadSalesYears(userId) {
  const { data, error } = await supabase.from('sales_days')
    .select('business_date').eq('user_id', userId)
  if (error) return [new Date().getFullYear()]
  const ys = new Set([new Date().getFullYear()])
  for (const r of data || []) { const y = parseInt(String(r.business_date).slice(0, 4), 10); if (y) ys.add(y) }
  return [...ys].sort((a, b) => b - a)
}
