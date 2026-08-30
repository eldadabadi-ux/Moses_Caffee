/**
 * reconciliation — matching engine for summary invoices (חשבונית מרכזת) against
 * the supplier's delivery notes (תעודות משלוח). Pure client-side under RLS:
 * the user only ever reads/writes their own receipts.
 *
 * Linkage model (supabase_doctype.sql): a confirmed match sets
 * `matched_invoice_id` on each included delivery note, and stores a snapshot of
 * the comparison in the invoice row's `reconciliation` jsonb — so the
 * accountant document is regenerable and the state survives reloads.
 */
import { docTypeOf } from './docTypes'
// Vendor-name normalization is SSOT in supplierMatch (guardrail 2).
import { normalizeVendor } from './supplierMatch'
export { normalizeVendor }

const r2 = n => Math.round((Number(n) || 0) * 100) / 100

/** Rounding tolerance (₪): differences up to this count as 'rounding', not a mismatch. */
export const TOLERANCE = 1.0

/** Doc numbers compare by digits only ("ת. 00123" === "123"). */
export function normalizeDocNum(s) {
  return String(s || '').replace(/\D+/g, '').replace(/^0+/, '')
}

/** Delivery-note refs itemized on the invoice (extracted by the OCR). */
export function docRefsOf(invoice) {
  const refs = invoice?.ai_summary?.doc_refs
  return Array.isArray(refs) ? refs : []
}

/** Effective doc number of a row (column → ai_summary mirror). */
export const docNumberOf = r => r?.doc_number || r?.ai_summary?.doc_number || ''

/**
 * Candidate delivery notes for a summary invoice: same supplier (normalized),
 * not archived, not matched to any invoice yet, dated on/before the invoice
 * and within `windowDays` back (default 60 ≈ a month of notes + slack).
 */
export function findCandidates(receipts, invoice, { windowDays = 60 } = {}) {
  const vendor = normalizeVendor(invoice.vendor_name)
  const invDate = invoice.receipt_date || ''
  const minDate = invDate
    ? new Date(new Date(invDate).getTime() - windowDays * 86400000).toISOString().slice(0, 10)
    : ''
  return (receipts || [])
    .filter(r =>
      r.id !== invoice.id &&
      !r.archived_at &&
      docTypeOf(r) === 'delivery_note' &&
      !r.matched_invoice_id &&
      normalizeVendor(r.vendor_name) === vendor &&
      (!invDate || ((r.receipt_date || '') <= invDate && (r.receipt_date || '') >= minDate)))
    .sort((a, b) => (a.receipt_date || '').localeCompare(b.receipt_date || ''))
}

/**
 * Compare a summary invoice against a set of delivery notes.
 * When the invoice itemizes its notes (doc_refs) each note is matched
 * note-by-note — by printed number first, then by amount (±TOLERANCE).
 * The grand total is always compared.
 *
 * Returns { invoiceId, vendor, invoiceTotal, notes:[{id,date,doc_number,amount,
 * ref_amount,matchedBy,diff}], refsUnmatched, notesTotal, delta, status }
 * where status ∈ 'matched' | 'rounding' | 'mismatch'.
 */
export function matchInvoice(invoice, notes) {
  const refs = docRefsOf(invoice)
  const rows = (notes || []).map(n => ({
    id: n.id, date: n.receipt_date || '', doc_number: docNumberOf(n),
    amount: r2(n.amount), ref_amount: null, matchedBy: 'period', diff: null,
  }))
  const usedRefs = new Set()

  // Pass 1 — exact printed-number match
  for (const row of rows) {
    const nn = normalizeDocNum(row.doc_number)
    if (!nn) continue
    const i = refs.findIndex((ref, idx) => !usedRefs.has(idx) && normalizeDocNum(ref.note_number) === nn)
    if (i >= 0) {
      usedRefs.add(i)
      row.ref_amount = r2(refs[i].amount)
      row.matchedBy = 'number'
      row.diff = r2(row.amount - row.ref_amount)
    }
  }
  // Pass 2 — remaining refs matched by amount (nearest date wins)
  refs.forEach((ref, i) => {
    if (usedRefs.has(i)) return
    const refAmt = r2(ref.amount)
    const cands = rows.filter(row => row.matchedBy === 'period' && Math.abs(row.amount - refAmt) <= TOLERANCE)
    if (!cands.length) return
    let pick = cands[0]
    if (ref.note_date) {
      const t = new Date(ref.note_date).getTime()
      pick = cands.reduce((best, row) =>
        Math.abs(new Date(row.date || 0).getTime() - t) < Math.abs(new Date(best.date || 0).getTime() - t) ? row : best, cands[0])
    }
    usedRefs.add(i)
    pick.ref_amount = refAmt
    pick.matchedBy = 'amount'
    pick.diff = r2(pick.amount - refAmt)
  })

  const refsUnmatched = refs
    .filter((_, i) => !usedRefs.has(i))
    .map(ref => ({ note_number: ref.note_number || '', note_date: ref.note_date || '', amount: r2(ref.amount) }))

  const notesTotal = r2(rows.reduce((s, row) => s + row.amount, 0))
  const invoiceTotal = r2(invoice.amount)
  const delta = r2(invoiceTotal - notesTotal)
  const perNoteMismatch = rows.some(row => row.ref_amount != null && Math.abs(row.diff) > TOLERANCE)
  const status = (!perNoteMismatch && !refsUnmatched.length && Math.abs(delta) <= 0.009) ? 'matched'
    : (!perNoteMismatch && !refsUnmatched.length && Math.abs(delta) <= TOLERANCE) ? 'rounding'
    : 'mismatch'

  return { invoiceId: invoice.id, vendor: invoice.vendor_name || '', invoiceTotal, notes: rows, refsUnmatched, notesTotal, delta, status }
}

/**
 * Persist a confirmed match: link the included delivery notes to the invoice
 * and store the comparison snapshot on the invoice row. Throws an error with
 * `migrationMissing: true` when supabase_doctype.sql hasn't been run.
 */
export async function confirmMatch(supabase, invoice, result, includedIds) {
  const mark = (e) => { const err = new Error(e.message || 'update failed'); err.migrationMissing = /matched_invoice_id|reconciliation|doc_type/.test(e.message || ''); return err }
  if (includedIds.length) {
    const { error: e1 } = await supabase.from('receipts').update({ matched_invoice_id: invoice.id }).in('id', includedIds)
    if (e1) throw mark(e1)
  }
  const snapshot = {
    status: result.status, delta: result.delta,
    invoice_total: result.invoiceTotal, notes_total: result.notesTotal,
    invoice_number: docNumberOf(invoice) || null,
    period: (invoice.receipt_date || '').slice(0, 7),
    confirmed_at: new Date().toISOString(),
    notes: result.notes.map(n => ({ id: n.id, date: n.date, doc_number: n.doc_number, amount: n.amount, ref_amount: n.ref_amount, diff: n.diff })),
    refs_unmatched: result.refsUnmatched,
  }
  const { error: e2 } = await supabase.from('receipts').update({ reconciliation: snapshot }).eq('id', invoice.id)
  if (e2) throw mark(e2)
  return snapshot
}

/** Undo a confirmed match (frees the notes and clears the snapshot). */
export async function unconfirmMatch(supabase, invoiceId) {
  const { error: e1 } = await supabase.from('receipts').update({ matched_invoice_id: null }).eq('matched_invoice_id', invoiceId)
  if (e1) throw e1
  const { error: e2 } = await supabase.from('receipts').update({ reconciliation: null }).eq('id', invoiceId)
  if (e2) throw e2
}

/** Summary invoices that still need attention: unconfirmed, or confirmed with a mismatch. */
export function openIssues(receipts) {
  return (receipts || []).filter(r =>
    !r.archived_at &&
    docTypeOf(r) === 'summary_invoice' &&
    (!r.reconciliation || r.reconciliation.status === 'mismatch'))
}
