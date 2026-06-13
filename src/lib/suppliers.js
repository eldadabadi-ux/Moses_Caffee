/**
 * suppliers — contact info (Supabase `suppliers` table) + derived spend stats
 * from receipts. A "supplier" = a vendor_name; costs are derived, contact is stored.
 */
import { supabase } from './supabase'
import { flattenItems, vendorComposition } from './itemAggregation'

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100

// ── Contact CRUD (graceful if the table doesn't exist yet) ───────────────────
export async function loadSuppliers(userId) {
  const { data, error } = await supabase.from('suppliers').select('*').eq('user_id', userId).order('name')
  if (error) return []                       // table not created yet → no contacts
  return data || []
}

export async function upsertSupplier(userId, s) {
  const row = {
    user_id: userId, name: (s.name || '').trim(),
    phone: s.phone || null, email: s.email || null, address: s.address || null,
    whatsapp: s.whatsapp || null, supplies: s.supplies || null, notes: s.notes || null,
    updated_at: new Date().toISOString(),
  }
  if (!row.name) throw new Error('שם ספק חסר')
  const { data, error } = await supabase.from('suppliers').upsert(row, { onConflict: 'user_id,name' }).select().single()
  if (error) throw error
  return data
}

export async function deleteSupplier(id) {
  const { error } = await supabase.from('suppliers').delete().eq('id', id)
  if (error) throw error
}

// ── Derived per-vendor spend stats (from receipts; amounts are ILS) ──────────
export function deriveVendorStats(receipts) {
  const now = new Date()
  const curY = now.getFullYear()
  const curYM = `${curY}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const active = (receipts || []).filter(r => !r.archived_at)
  const flat = flattenItems(active)

  const map = {}
  for (const r of active) {
    const name = (r.vendor_name || '').trim() || 'לא ידוע'
    const amt = parseFloat(r.amount) || 0
    const d = r.receipt_date || (r.created_at || '').slice(0, 10)
    if (!map[name]) map[name] = { name, total: 0, count: 0, thisMonth: 0, thisYear: 0, dates: [] }
    const v = map[name]
    v.total += amt; v.count += 1
    if (d) v.dates.push(d)
    if ((d || '').slice(0, 7) === curYM) v.thisMonth += amt
    if ((d || '').startsWith(`${curY}`)) v.thisYear += amt
  }

  return Object.values(map).map(v => {
    const dates = v.dates.sort()
    const first = dates[0], last = dates[dates.length - 1]
    const spanDays = first && last ? Math.max(1, (new Date(last) - new Date(first)) / 86400000 + 1) : 1
    const perDay = v.total / spanDays
    const comp = vendorComposition(flat, v.name)
    const cats = {}
    flat.forEach(f => { if (f.vendor === v.name) cats[f.l1] = (cats[f.l1] || 0) + f.price })
    const topCategories = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, total]) => ({ name, total: r2(total) }))
    return {
      name: v.name, total: r2(v.total), count: v.count, thisMonth: r2(v.thisMonth), thisYear: r2(v.thisYear),
      firstDate: first || null, lastDate: last || null,
      perDay: r2(perDay), perWeek: r2(perDay * 7), perMonth: r2(perDay * 30.44), perYear: r2(perDay * 365),
      topProducts: comp.rows.slice(0, 6), topCategories,
    }
  }).sort((a, b) => b.total - a.total)
}

// ── WhatsApp / tel link helpers ──────────────────────────────────────────────
export function normalizePhoneIntl(phone) {
  let p = String(phone || '').replace(/[^\d+]/g, '')
  if (!p) return ''
  if (p.startsWith('+')) return p.slice(1)
  if (p.startsWith('00')) return p.slice(2)
  if (p.startsWith('972')) return p
  if (p.startsWith('0')) return '972' + p.slice(1)   // Israeli local → intl
  return p
}
export const waLink  = (phone) => { const p = normalizePhoneIntl(phone); return p ? `https://wa.me/${p}` : null }
export const telLink = (phone) => { const p = String(phone || '').replace(/[^\d+]/g, ''); return p ? `tel:${p}` : null }
