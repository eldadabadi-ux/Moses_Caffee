/**
 * eventItems — the catering catalogue: what the business SELLS at an event,
 * with its own selling price (client request 19.11.26).
 *
 * Deliberately separate from the products scanned off receipts: those are raw
 * materials at cost. A quote line still stores its own name/price in the quote
 * jsonb, so editing the catalogue later never rewrites a quote already sent.
 */
import { supabase } from './supabase'

const clean = (s) => String(s || '').trim()

/** The catalogue, alphabetical. */
export async function loadEventItems(userId) {
  const { data, error } = await supabase.from('event_items')
    .select('id, name, unit, unit_price')
    .eq('user_id', userId)
  if (error) { console.warn('[event-items] load failed:', error.message); return [] }
  return (data || []).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'he'))
}

/**
 * Add or update one catalogue entry. The unique index is on the trimmed,
 * lower-cased name, so saving "מגש פירות" twice updates the price instead of
 * creating a twin.
 */
export async function saveEventItem(userId, orgId, { id, name, unit, unit_price }) {
  const row = {
    user_id: userId,
    org_id: orgId || null,
    name: clean(name),
    unit: clean(unit) || "יח'",
    unit_price: unit_price === '' || unit_price == null ? null : Number(unit_price),
    updated_at: new Date().toISOString(),
  }
  if (!row.name) throw new Error('נא להזין שם פריט')
  const q = id
    ? supabase.from('event_items').update(row).eq('id', id).select().single()
    : supabase.from('event_items').insert(row).select().single()
  const { data, error } = await q
  if (error) {
    // A duplicate name is not a failure — the catalogue already holds it.
    if (/duplicate key/i.test(error.message)) return null
    throw error
  }
  return data
}

export async function deleteEventItem(id) {
  const { error } = await supabase.from('event_items').delete().eq('id', id)
  if (error) throw error
}

/**
 * Remember the lines of a saved quote, so the catalogue fills itself as the
 * business works instead of demanding data entry up front. Existing names are
 * refreshed with the price that was actually quoted; blank lines are skipped.
 */
export async function rememberQuoteLines(userId, orgId, lines, known = []) {
  const byName = new Map(known.map(k => [clean(k.name).toLowerCase(), k]))
  const out = []
  for (const l of lines || []) {
    const name = clean(l.item_name)
    if (!name) continue
    const price = l.unit_price === '' || l.unit_price == null ? null : Number(l.unit_price)
    const hit = byName.get(name.toLowerCase())
    // Nothing to do when the catalogue already says exactly this.
    if (hit && Number(hit.unit_price) === price && hit.unit === l.unit) continue
    try {
      const saved = await saveEventItem(userId, orgId, { id: hit?.id, name, unit: l.unit, unit_price: price })
      if (saved) out.push(saved)
    } catch (e) { console.warn('[event-items] remember failed:', e?.message) }
  }
  return out
}
