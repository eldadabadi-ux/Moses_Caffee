/**
 * useReconcileAlerts — how many summary invoices (חשבונית מרכזת) still need
 * attention (not yet reconciled, or reconciled with a mismatch). Drives the
 * badge on the sidebar "התאמות" entry and the ReceiptsPage banner.
 *
 * Lightweight query; fails silently to 0 before supabase_doctype.sql runs.
 */
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { openIssues } from '../lib/reconciliation'

export function useReconcileAlerts() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let alive = true
    async function check() {
      try {
        const { data, error } = await supabase
          .from('receipts')
          .select('id, doc_type, reconciliation, archived_at, book')
          .eq('doc_type', 'summary_invoice')
          .eq('book', 'cafe')
          .is('archived_at', null)
        if (error || !alive) return
        setCount(openIssues(data || []).length)
      } catch { /* pre-migration or offline → keep 0 */ }
    }
    check()
    // Re-check when another part of the app announces a reconciliation change.
    window.addEventListener('reconcile-changed', check)
    return () => { alive = false; window.removeEventListener('reconcile-changed', check) }
  }, [])

  return count
}
