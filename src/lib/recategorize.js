/**
 * recategorizeAll — re-classifies all active receipts against the current
 * category tree (via /api/recategorize) and writes the updated categories back.
 * Called after the user changes the category tree.
 */
import { supabase } from './supabase'

export async function recategorizeAll() {
  // 1. Active receipts (id, vendor, items)
  const { data: receipts } = await supabase
    .from('receipts')
    .select('id, vendor_name, items, category_id, category_text')
    .is('archived_at', null)
  if (!receipts?.length) return { changed: 0, total: 0 }

  // 2. Auth + call the classifier (one batched call)
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('no session')

  const res = await fetch('/api/recategorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ receipts: receipts.map(r => ({ id: r.id, vendor_name: r.vendor_name, items: r.items || [] })) }),
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error(e.detail || e.error || `שגיאה ${res.status}`)
  }
  const { results } = await res.json()
  if (!Array.isArray(results)) return { changed: 0, total: receipts.length }

  // 3. Map L1 category name → id, creating any category the classifier assigned
  //    that doesn't exist yet — keeps the categories tree in full sync with what
  //    the receipts now use (so e.g. a new "תחבורה ודלק" shows in the Categories tab).
  const { data: cats } = await supabase.from('categories').select('id, name, level')
  const l1Id = {}
  ;(cats || []).filter(c => c.level === 1).forEach(c => { l1Id[c.name.trim().toLowerCase()] = c.id })

  const needed = [...new Set(results.map(r => (r.category_l1 || '').trim()).filter(Boolean))]
  const toCreate = needed.filter(n => !l1Id[n.toLowerCase()])
  if (toCreate.length) {
    const baseOrder = (cats || []).filter(c => c.level === 1).length
    const uid = session.user?.id
    const { data: created } = await supabase.from('categories')
      .insert(toCreate.map((name, i) => ({ user_id: uid, name, level: 1, parent_id: null, sort_order: baseOrder + i })))
      .select('id, name')
    ;(created || []).forEach(c => { l1Id[c.name.trim().toLowerCase()] = c.id })
  }

  // 4. Apply updates per receipt
  let changed = 0
  for (const r of receipts) {
    const result = results.find(x => x.id === r.id)
    if (!result || !result.category_l1) continue

    const newText = result.category_l1
    const newCatId = l1Id[newText.trim().toLowerCase()] || null

    // Merge item-level categories back into stored items (match by index, then name)
    let newItems = r.items
    if (Array.isArray(r.items) && Array.isArray(result.items) && result.items.length) {
      newItems = r.items.map((it, i) => {
        const m = result.items[i] && result.items[i].item_name === it.item_name
          ? result.items[i]
          : result.items.find(x => x.item_name === it.item_name)
        return m ? { ...it, category_l1: m.category_l1, category_l2: m.category_l2 || '', category_l3: m.category_l3 || '' } : it
      })
    }

    // Only write if something actually changed
    const catChanged = (r.category_text || '') !== newText || (r.category_id || null) !== newCatId
    const itemsChanged = JSON.stringify(newItems) !== JSON.stringify(r.items)
    if (!catChanged && !itemsChanged) continue

    const patch = { category_text: newText, category_id: newCatId, items: newItems }
    const { error } = await supabase.from('receipts').update(patch).eq('id', r.id)
    if (!error) changed++
  }

  return { changed, total: receipts.length }
}
