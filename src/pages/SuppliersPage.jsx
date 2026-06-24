import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useSettings } from '../hooks/useSettings'
import { loadSuppliers, upsertSupplier, deleteSupplier, deriveVendorStats, waLink, telLink, gmailComposeLink } from '../lib/suppliers'
import { getCached, setCached, hasCached } from '../lib/pageCache'
import { Store, Phone, Mail, MapPin, Pencil, Plus, Trash2, Package, CalendarDays, MessageCircle } from 'lucide-react'
import Modal from '../components/ui/Modal'
import SearchInput from '../components/ui/SearchInput'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import toast from 'react-hot-toast'

const fmtILS = n => `₪${Math.round(Number(n) || 0).toLocaleString('he-IL')}`
const fmtDate = d => d ? d.split('-').reverse().join('.') : '—'

export default function SuppliersPage() {
  const { user } = useAuth()
  const { settings } = useSettings()
  const isMobile = window.innerWidth < 768
  const [receipts, setReceipts] = useState(() => getCached('suppliers')?.receipts || [])
  const [contacts, setContacts] = useState(() => getCached('suppliers')?.contacts || [])
  const [loading, setLoading]   = useState(() => !hasCached('suppliers'))
  const [search, setSearch]     = useState('')
  const [edit, setEdit]         = useState(null)   // supplier being edited (form object) or null

  const loadAll = useCallback(async () => {
    if (!user) return
    if (!hasCached('suppliers')) setLoading(true)
    try {
      const [{ data: recs }, sup] = await Promise.all([
        supabase.from('receipts').select('id, vendor_name, receipt_date, amount, category_text, items, archived_at, created_at').eq('user_id', user.id),
        loadSuppliers(user.id),
      ])
      setReceipts(recs || [])
      setContacts(sup || [])
      setCached('suppliers', { receipts: recs || [], contacts: sup || [] })
    } catch (e) { console.error('[suppliers] load', e?.message) }
    finally { setLoading(false) }
  }, [user])

  useEffect(() => { loadAll() }, [loadAll])

  // Pre-fill search when arriving via ?focus= (e.g. from the Categories panel)
  useEffect(() => {
    const f = new URLSearchParams(window.location.search).get('focus')
    if (f) {
      setSearch(f)
      const u = new URL(window.location.href); u.searchParams.delete('focus')
      window.history.replaceState({}, '', u.toString())
    }
  }, [])

  // Sidebar "הוסף ספק" action
  useEffect(() => {
    const onAdd = () => setEdit({ name: '', phone: '', whatsapp: '', email: '', address: '', supplies: '', notes: '' })
    window.addEventListener('suppliers-add', onAdd)
    return () => window.removeEventListener('suppliers-add', onAdd)
  }, [])

  const stats = useMemo(() => deriveVendorStats(receipts), [receipts])
  const contactByName = useMemo(() => { const m = {}; contacts.forEach(c => { m[(c.name || '').trim()] = c }); return m }, [contacts])

  // Union of vendors-from-receipts + manual-only contacts
  const rows = useMemo(() => {
    const byName = {}
    stats.forEach(s => { byName[s.name] = { name: s.name, stats: s, contact: contactByName[s.name] || null } })
    contacts.forEach(c => { const n = (c.name || '').trim(); if (!byName[n]) byName[n] = { name: n, stats: null, contact: c } })
    let list = Object.values(byName)
    const q = search.trim().toLowerCase()
    if (q) list = list.filter(r => r.name.toLowerCase().includes(q) || (r.contact?.supplies || '').toLowerCase().includes(q))
    return list.sort((a, b) => (b.stats?.total || 0) - (a.stats?.total || 0))
  }, [stats, contacts, contactByName, search])

  async function saveEdit() {
    if (!edit?.name?.trim()) { toast.error('נא להזין שם ספק'); return }
    try {
      await upsertSupplier(user.id, edit)
      toast.success('פרטי הספק נשמרו ✓')
      setEdit(null)
      loadAll()
    } catch (e) {
      toast.error(/relation .*suppliers.* does not exist|42P01/.test(e?.message || '')
        ? 'יש להריץ קודם את supabase_suppliers.sql ב-Supabase'
        : 'שגיאה בשמירה: ' + (e?.message || ''))
    }
  }
  async function removeContact(id) {
    try { await deleteSupplier(id); toast.success('פרטי הקשר נמחקו'); loadAll() }
    catch (e) { toast.error('שגיאה במחיקה') }
  }

  if (loading && receipts.length === 0 && contacts.length === 0) return <LoadingSpinner />

  return (
    <div className="animate-fade-in" dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? '14px' : '18px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: isMobile ? '23px' : '26px', fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Store size={24} color="var(--accent)" /> ספקים
          </h1>
          <p style={{ margin: '2px 0 0', fontSize: '15px', color: 'var(--text-mute)' }}>{rows.length} ספקים · עלויות מחושבות מהקבלות</p>
        </div>
        <button onClick={() => setEdit({ name: '', phone: '', whatsapp: '', email: '', address: '', supplies: '', notes: '' })}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 'var(--r-btn)', border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-main)' }}>
          <Plus size={16} /> הוסף ספק
        </button>
      </div>

      <SearchInput value={search} onChange={setSearch} placeholder="חיפוש ספק / מה מספק…" />

      {rows.length === 0 && (
        <div style={{ textAlign: 'center', padding: '56px 16px', color: 'var(--text-mute)' }}>
          <Store size={42} style={{ margin: '0 auto 12px', display: 'block', opacity: 0.25 }} />
          <p style={{ fontWeight: 600, color: 'var(--text)' }}>אין ספקים עדיין</p>
          <p style={{ fontSize: 14, marginTop: 6 }}>סרוק קבלות או הוסף ספק ידנית</p>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(330px, 1fr))', gap: '14px' }}>
        {rows.map(({ name, stats: s, contact }) => (
          <div key={name} style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: 'var(--shadow-card)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
            {/* Title row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--accent-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Store size={18} color="var(--accent)" /></div>
              <span style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 16, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={name}>{name}</span>
              <button onClick={() => setEdit({ id: contact?.id, name, phone: contact?.phone || '', whatsapp: contact?.whatsapp || '', email: contact?.email || '', address: contact?.address || '', supplies: contact?.supplies || '', notes: contact?.notes || '' })}
                title="עריכת פרטי קשר" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-mute)', padding: 5, display: 'flex', flexShrink: 0 }}><Pencil size={15} /></button>
            </div>

            {/* Contact actions */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {contact?.phone && telLink(contact.phone) && (
                <a href={telLink(contact.phone)} style={chip('#2563eb')}><Phone size={14} /> התקשר</a>
              )}
              {(contact?.whatsapp || contact?.phone) && waLink(contact.whatsapp || contact.phone) && (
                <a href={waLink(contact.whatsapp || contact.phone)} target="_blank" rel="noreferrer" style={chip('#16a34a')}><MessageCircle size={14} /> וואטסאפ</a>
              )}
              {contact?.email && (
                <a href={gmailComposeLink(contact.email, user?.email, settings?.businessName)} target="_blank" rel="noreferrer" style={chip('#d97706')}><Mail size={14} /> מייל</a>
              )}
              {!contact?.phone && !contact?.whatsapp && !contact?.email && (
                <span style={{ fontSize: 12.5, color: 'var(--text-mute)' }}>אין פרטי קשר — לחץ על העיפרון להוספה</span>
              )}
            </div>
            {contact?.address && (
              <div style={{ fontSize: 12.5, color: 'var(--text-mute)', display: 'flex', alignItems: 'center', gap: 4 }}><MapPin size={13} /> {contact.address}</div>
            )}

            {/* What they supply */}
            {(contact?.supplies || s?.topCategories?.length) && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, flexWrap: 'wrap' }}>
                <Package size={14} style={{ color: 'var(--text-mute)', marginTop: 2, flexShrink: 0 }} />
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', minWidth: 0 }}>
                  {contact?.supplies
                    ? <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>{contact.supplies}</span>
                    : s.topCategories.map(c => <span key={c.name} style={catChip}>{c.name}</span>)}
                </div>
              </div>
            )}

            {/* Real spend — actual sums from receipts (no invented averages) */}
            {s ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, background: 'var(--panel-2)', borderRadius: 10, padding: '9px 8px' }}>
                {[['החודש', s.thisMonth], ['השנה', s.thisYear], ['סה"כ', s.total]].map(([lbl, val], i) => (
                  <div key={lbl} style={{ textAlign: 'center', minWidth: 0 }}>
                    <div style={{ fontSize: 10.5, color: 'var(--text-mute)' }}>{lbl}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: i === 2 ? 'var(--ok)' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fmtILS(val)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 12.5, color: 'var(--text-mute)' }}>ספק ידני — אין עדיין קבלות לחישוב עלויות</div>
            )}
            {s && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--text-mute)', flexWrap: 'wrap', gap: 6 }}>
                <span>{s.count} קבלות</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><CalendarDays size={12} /> רכישה אחרונה: {fmtDate(s.lastDate)}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Edit / Add modal */}
      {edit && (
        <Modal isOpen onClose={() => setEdit(null)} title={edit.id || contactByName[edit.name] ? 'עריכת ספק' : 'הוספת ספק'} size="sm">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }} dir="rtl">
            <Field label="שם הספק">
              <input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} style={inp} placeholder="שם הספק (כפי שמופיע בקבלות)" dir="auto" />
            </Field>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Field label="טלפון" style={{ flex: 1 }}><input value={edit.phone} onChange={e => setEdit({ ...edit, phone: e.target.value })} style={inp} dir="ltr" placeholder="050-1234567" /></Field>
              <Field label="וואטסאפ (אם שונה)" style={{ flex: 1 }}><input value={edit.whatsapp} onChange={e => setEdit({ ...edit, whatsapp: e.target.value })} style={inp} dir="ltr" placeholder="050-1234567" /></Field>
            </div>
            <Field label="אימייל"><input value={edit.email} onChange={e => setEdit({ ...edit, email: e.target.value })} style={inp} dir="ltr" placeholder="supplier@example.com" /></Field>
            <Field label="כתובת"><input value={edit.address} onChange={e => setEdit({ ...edit, address: e.target.value })} style={inp} dir="auto" placeholder="כתובת / אזור" /></Field>
            <Field label="מה הספק מספק"><input value={edit.supplies} onChange={e => setEdit({ ...edit, supplies: e.target.value })} style={inp} dir="auto" placeholder="למשל: חלב, גבינות, יוגורט" /></Field>
            <Field label="הערות"><textarea value={edit.notes} onChange={e => setEdit({ ...edit, notes: e.target.value })} style={{ ...inp, height: 64, paddingTop: 8, resize: 'vertical' }} dir="auto" /></Field>
            <div style={{ display: 'flex', gap: 10, paddingTop: 2 }}>
              {edit.id && <button onClick={() => { removeContact(edit.id); setEdit(null) }} style={{ padding: '11px 14px', borderRadius: 'var(--r-btn)', border: '1px solid var(--danger)', background: '#fef2f2', color: 'var(--danger)', fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font-main)', display: 'flex', alignItems: 'center', gap: 5 }}><Trash2 size={14} /> מחק פרטים</button>}
              <button onClick={() => setEdit(null)} style={{ flex: 1, padding: '12px', borderRadius: 'var(--r-btn)', border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text-dim)', fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font-main)' }}>ביטול</button>
              <button onClick={saveEdit} style={{ flex: 2, padding: '12px', borderRadius: 'var(--r-btn)', border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-main)' }}>שמור</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

const chip = (color) => ({ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 8, background: color + '14', border: `1px solid ${color}40`, color, fontSize: 13, fontWeight: 600, textDecoration: 'none', cursor: 'pointer' })
const catChip = { fontSize: 12, color: 'var(--text-dim)', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 8px', whiteSpace: 'nowrap' }
const inp = { display: 'block', width: '100%', boxSizing: 'border-box', height: 44, padding: '0 12px', borderRadius: 'var(--r-btn)', border: '1.5px solid var(--border)', background: 'var(--panel)', color: 'var(--text)', fontSize: 16, fontFamily: 'var(--font-main)', outline: 'none' }

function Field({ label, children, style }) {
  return (
    <div style={style}>
      <label style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  )
}
