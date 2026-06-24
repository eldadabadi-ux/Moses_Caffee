/**
 * archive — soft-archive helpers (shared by ReceiptsPage export + ArchivePage).
 *
 * Archiving = setting receipts.archived_at. Archived receipts are hidden from the
 * Receipts tab (which filters `archived_at IS NULL`) but are STILL included in the
 * dashboard / statistics (those queries don't filter archived_at). Permanent
 * delete removes the row entirely.
 */
import { supabase } from './supabase'

export async function archiveReceipts(ids) {
  if (!ids?.length) return
  const { error } = await supabase
    .from('receipts').update({ archived_at: new Date().toISOString() }).in('id', ids)
  if (error) throw error
}

export async function restoreReceipts(ids) {
  if (!ids?.length) return
  const { error } = await supabase
    .from('receipts').update({ archived_at: null }).in('id', ids)
  if (error) throw error
}

export async function permanentDeleteReceipts(ids) {
  if (!ids?.length) return
  const { error } = await supabase.from('receipts').delete().in('id', ids)
  if (error) throw error
}

export async function loadArchivedReceipts() {
  const { data, error } = await supabase
    .from('receipts').select('*')
    .not('archived_at', 'is', null)
    .order('archived_at', { ascending: false })
  if (error) throw error
  return data || []
}
