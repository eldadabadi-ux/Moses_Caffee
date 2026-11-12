/**
 * budgets — CRUD for the supplier_budgets table (client requirement 11.11.26 §1).
 * One budget per supplier per user (UNIQUE user_id+supplier_id): changing the
 * amount or period updates the same row. All math lives in budgetMath.js.
 */
import { supabase } from './supabase'

export { BUDGET_PERIODS, periodLabel, periodWindow, budgetStatus } from './budgetMath'

export async function loadBudget(userId, supplierId) {
  const { data, error } = await supabase.from('supplier_budgets')
    .select('*').eq('user_id', userId).eq('supplier_id', supplierId).maybeSingle()
  if (error) { console.warn('[budgets] load failed:', error.message); return null }
  return data
}

export async function saveBudget(userId, supplierId, { period, amount, alert_pct, note }) {
  const row = {
    user_id: userId, supplier_id: supplierId,
    period, amount: Number(amount),
    alert_pct: Math.min(100, Math.max(1, Math.round(Number(alert_pct) || 80))),
    note: note || null,
    updated_at: new Date().toISOString(),
  }
  if (!(row.amount > 0)) throw new Error('נא להזין סכום תקציב חיובי')
  const { data, error } = await supabase.from('supplier_budgets')
    .upsert(row, { onConflict: 'user_id,supplier_id' }).select().single()
  if (error) throw error
  return data
}

export async function deleteBudget(id) {
  const { error } = await supabase.from('supplier_budgets').delete().eq('id', id)
  if (error) throw error
}
