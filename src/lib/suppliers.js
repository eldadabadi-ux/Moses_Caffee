/**
 * suppliers — contact info (Supabase `suppliers` table) + derived spend stats
 * from receipts. A "supplier" = a vendor_name; costs are derived, contact is stored.
 */
import { supabase } from './supabase'
import { flattenItems, vendorComposition } from './itemAggregation'
import { isExpenseDoc } from './docTypes'

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100

// ── Contact CRUD (graceful if the table doesn't exist yet) ───────────────────
export async function loadSuppliers(userId) {
  // Merged-away suppliers stay in the table for provenance but must never show
  // up as a supplier again.
  let { data, error } = await supabase.from('suppliers')
    .select('*').eq('user_id', userId).is('merged_into', null).order('name')
  if (error) {
    // Pre-migration DB (no merged_into column) → fall back to the plain list.
    ;({ data, error } = await supabase.from('suppliers').select('*').eq('user_id', userId).order('name'))
  }
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
/**
 * Per-supplier spend, derived from receipts.
 *
 * Grouping key is `supplier_id` when the receipt has been linked to a canonical
 * supplier (audit R1), and the raw `vendor_name` only for rows that predate the
 * merge. That is what stops one supplier appearing five times because the OCR
 * spelled it five ways.
 *
 * @param {Array} receipts
 * @param {Array} [contacts] supplier rows — supplies the canonical display name
 */
export function deriveVendorStats(receipts, contacts = []) {
  const now = new Date()
  const curY = now.getFullYear()
  const curYM = `${curY}-${String(now.getMonth() + 1).padStart(2, '0')}`
  // Summary invoices (חשבונית מרכזת) are excluded — they aggregate delivery
  // notes that are already counted, so including them would double the spend.
  const active = (receipts || []).filter(r => !r.archived_at && isExpenseDoc(r))
  const flat = flattenItems(active)

  const nameById = {}
  for (const c of contacts || []) if (c?.id) nameById[c.id] = (c.name || '').trim()

  // A linked receipt is filed under its supplier's canonical name; an unlinked
  // one under whatever the scan happened to write.
  const displayName = (r) =>
    (r.supplier_id && nameById[r.supplier_id]) || (r.vendor_name || '').trim() || 'לא ידוע'
  const keyOf = (r) => r.supplier_id || `name:${(r.vendor_name || '').trim() || 'לא ידוע'}`

  const map = {}
  for (const r of active) {
    const key = keyOf(r)
    const name = displayName(r)
    const amt = parseFloat(r.amount) || 0
    const d = r.receipt_date || (r.created_at || '').slice(0, 10)
    if (!map[key]) map[key] = { name, supplierId: r.supplier_id || null, total: 0, count: 0, thisMonth: 0, thisYear: 0, dates: [], rawNames: new Set() }
    const v = map[key]
    v.rawNames.add((r.vendor_name || '').trim())
    v.total += amt; v.count += 1
    if (d) v.dates.push(d)
    if ((d || '').slice(0, 7) === curYM) v.thisMonth += amt
    if ((d || '').startsWith(`${curY}`)) v.thisYear += amt
  }

  return Object.values(map).map(v => {
    const dates = v.dates.sort()
    const first = dates[0], last = dates[dates.length - 1]
    // Item-level stats are keyed by the raw scanned names, so a merged supplier
    // must gather the composition of ALL its spellings.
    const raws = [...v.rawNames].filter(Boolean)
    const comp = vendorComposition(flat, raws.length === 1 ? raws[0] : v.name, raws)
    const cats = {}
    flat.forEach(f => { if (raws.includes(f.vendor) || f.vendor === v.name) cats[f.l1] = (cats[f.l1] || 0) + f.price })
    const topCategories = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, total]) => ({ name, total: r2(total) }))
    // Only real, summed figures — never extrapolated daily/weekly/yearly averages
    // (a single receipt must not invent a "yearly" cost). Period sums grow as
    // more receipts come in.
    return {
      name: v.name, supplierId: v.supplierId,
      aliases: [...v.rawNames].filter(n => n && n !== v.name),
      total: r2(v.total), count: v.count, thisMonth: r2(v.thisMonth), thisYear: r2(v.thisYear),
      firstDate: first || null, lastDate: last || null,
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

/**
 * Gmail "compose" link — opens a new email TO the supplier, FROM the app
 * owner's Gmail account. We use this instead of a bare `mailto:` because
 * `mailto:` silently does nothing on devices without a configured desktop
 * mail client; the Gmail web composer always opens. `authuser` pins the
 * sender to the owner's address even when several Google accounts are
 * signed in on the browser.
 */
export function gmailComposeLink(to, ownerEmail, businessName) {
  const params = new URLSearchParams({
    view: 'cm', fs: '1', tf: '1',
    to: to || '',
    su: `פנייה מ${businessName ? '-' + businessName : 'בית הקפה'}`,
  })
  if (ownerEmail) params.set('authuser', ownerEmail)
  return `https://mail.google.com/mail/?${params.toString()}`
}
