/**
 * docTypes — single source of truth for document classification.
 *
 * doc_type values: 'receipt' (קבלה/חשבונית רגילה, ברירת מחדל) |
 * 'delivery_note' (תעודת משלוח) | 'summary_invoice' (חשבונית מרכזת).
 *
 * Delivery notes are the expense records (item detail, daily granularity);
 * a summary invoice aggregates a month of delivery notes, so it must NEVER be
 * summed as an expense — that would double-count. It stays visible in lists
 * and in the accountant export (it's the official tax document).
 *
 * Reads tolerate a DB that hasn't run supabase_doctype.sql yet: writes mirror
 * doc_type into ai_summary, and docTypeOf() falls back to that mirror.
 */

export const DOC_TYPES = [
  { value: 'receipt',         label: 'קבלה / חשבונית', icon: '🧾' },
  { value: 'delivery_note',   label: 'תעודת משלוח',    icon: '🚚' },
  { value: 'summary_invoice', label: 'חשבונית מרכזת',  icon: '📑' },
]

export const docTypeLabel = (v) => DOC_TYPES.find(t => t.value === v)?.label || ''
export const docTypeIcon  = (v) => DOC_TYPES.find(t => t.value === v)?.icon || ''

/** Effective doc type of a receipt row (column → ai_summary mirror → default). */
export const docTypeOf = (r) => r?.doc_type || r?.ai_summary?.doc_type || 'receipt'

/** Should this row be counted in expense totals / analytics? */
export const isExpenseDoc = (r) => docTypeOf(r) !== 'summary_invoice'

/** Matches PostgREST error messages for the doc columns (migration not run). */
export const DOC_COL_RE = /doc_type|doc_number|matched_invoice_id|reconciliation/
