/**
 * receiptBooks — the user's own receipt types, on top of the two built-ins
 * (client request 20.11.26: "let me open new types, not only café and events").
 *
 * Only custom types live in the table; 'cafe' and 'events' stay in code so an
 * empty table behaves exactly like before. The business figures still count
 * the café alone — a new type is a separate ledger, like events.
 */
import { supabase } from './supabase'
import { BOOKS, isBuiltinBook } from './books'

/** A stable key from a Hebrew label: Hebrew cannot be a slug, so fall back. */
export function keyFromLabel(label, taken = []) {
  const base = String(label || '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20)
  let key = /^[a-z0-9_-]{2,24}$/.test(base) ? base : `book-${Math.random().toString(36).slice(2, 7)}`
  while (taken.includes(key)) key = `${key.slice(0, 18)}-${Math.random().toString(36).slice(2, 5)}`
  return key
}

export async function loadCustomBooks(userId) {
  const { data, error } = await supabase.from('receipt_books')
    .select('id, key, label, icon, sort_order')
    .eq('user_id', userId)
  if (error) {
    // Pre-migration the table does not exist — the two built-ins still work.
    if (!/does not exist|schema cache/i.test(error.message)) console.warn('[books] load failed:', error.message)
    return []
  }
  return (data || []).sort((a, b) => (a.sort_order - b.sort_order) || (a.label || '').localeCompare(b.label || '', 'he'))
}

/** Built-ins first, then the user's own — the order every screen shows. */
export function allBooks(custom = []) {
  return [...BOOKS, ...custom.map(c => ({ value: c.key, label: c.label, icon: c.icon || '📁', id: c.id, custom: true }))]
}

export async function createBook(userId, orgId, label, existingKeys = []) {
  const name = String(label || '').trim()
  if (!name) throw new Error('נא להזין שם לסוג')
  const key = keyFromLabel(name, [...existingKeys, 'cafe', 'events'])
  const { data, error } = await supabase.from('receipt_books')
    .insert({ user_id: userId, org_id: orgId || null, key, label: name, icon: '📁' })
    .select('id, key, label, icon, sort_order').single()
  if (error) throw error
  return data
}

/**
 * Remove a type. Refuses while documents still carry it — silently moving
 * someone's receipts into another ledger would change their numbers.
 */
export async function deleteBook(userId, book) {
  if (isBuiltinBook(book.key)) throw new Error('סוג מובנה אינו ניתן למחיקה')
  const { count } = await supabase.from('receipts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('book', book.key)
  if (count) throw new Error(`יש ${count} מסמכים מסוג "${book.label}" — העבר אותם לסוג אחר תחילה`)
  const { error } = await supabase.from('receipt_books').delete().eq('id', book.id)
  if (error) throw error
}
