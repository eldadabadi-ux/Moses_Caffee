import { useState, useEffect, useMemo } from 'react'
import { useSettings } from '../hooks/useSettings'
import { getCached, setCached, hasCached } from '../lib/pageCache'
import { loadArchivedReceipts, restoreReceipts, permanentDeleteReceipts } from '../lib/archive'
import toast from 'react-hot-toast'
import { Archive, RotateCcw, Trash2, Search, X, Check } from 'lucide-react'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import Modal from '../components/ui/Modal'

const fmtILS = n => `₪${Math.round(Number(n) || 0).toLocaleString('he-IL')}`
const fmtDate = d => d ? new Date(d).toLocaleDateString('he-IL') : '—'

export default function ArchivePage() {
  const { settings } = useSettings()
  const [rows, setRows]       = useState(() => getCached('archive') || [])
  const [loading, setLoading] = useState(() => !hasCached('archive'))
  const [search, setSearch]   = useState('')
  const [sel, setSel]         = useState(() => new Set())   // selected ids
  const [confirm, setConfirm] = useState(null)   // { ids[], kind:'restore'|'delete' }
  const [permText, setPermText] = useState('')
  const [busy, setBusy]       = useState(false)

  useEffect(() => { load() }, [])  // eslint-disable-line

  async function load() {
    if (!hasCached('archive')) setLoading(true)
    try {
      const data = await loadArchivedReceipts()
      setRows(data); setCached('archive', data)
    } catch (err) {
      toast.error('שגיאה בטעינת הארכיון: ' + (err?.message || ''))
    } finally { setLoading(false) }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r =>
      (r.vendor_name || '').toLowerCase().includes(q) ||
      (r.category_text || '').toLowerCase().includes(q))
  }, [rows, search])

  const total = useMemo(() => filtered.reduce((s, r) => s + (Number(r.amount) || 0), 0), [filtered])
  const allSelected = filtered.length > 0 && filtered.every(r => sel.has(r.id))

  function toggle(id) {
    setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAll() {
    setSel(prev => {
      if (filtered.every(r => prev.has(r.id))) return new Set()
      return new Set(filtered.map(r => r.id))
    })
  }

  function applyLocal(ids) {
    setRows(prev => { const next = prev.filter(r => !ids.includes(r.id)); setCached('archive', next); return next })
    setSel(prev => { const n = new Set(prev); ids.forEach(i => n.delete(i)); return n })
  }

  async function doRestore(ids) {
    if (!ids.length) return
    try {
      await restoreReceipts(ids)
      applyLocal(ids)
      // The Receipts tab will reload from the server next time it mounts.
      setCached('receipts', undefined)
      toast.success(`${ids.length} קבלות שוחזרו לקבלות`)
    } catch (err) { toast.error('שגיאה בשחזור: ' + (err?.message || '')) }
  }

  async function doPermDelete(ids) {
    if (!ids.length || busy) return
    setBusy(true)
    try {
      await permanentDeleteReceipts(ids)
      applyLocal(ids)
      toast.success(`${ids.length} קבלות נמחקו לצמיתות`)
      setConfirm(null); setPermText('')
    } catch (err) { toast.error('שגיאה במחיקה: ' + (err?.message || '')) }
    finally { setBusy(false) }
  }

  if (loading && rows.length === 0) return <LoadingSpinner />

  const selectedIds = [...sel].filter(id => filtered.some(r => r.id === id))

  return (
    <div className="animate-fade-in" dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 900 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: 'var(--text)', margin: 0, display: 'flex', alignItems: 'center', gap: 9 }}>
            <Archive size={24} color="var(--accent)" /> ארכיון
          </h1>
          <p style={{ fontSize: 15, color: 'var(--text-mute)', marginTop: 4 }}>
            {rows.length} קבלות בארכיון · {fmtILS(total)} · עדיין נכללות בדשבורד ובסטטיסטיקות
          </p>
        </div>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Search size={15} style={{ position: 'absolute', right: 10, color: 'var(--text-mute)', pointerEvents: 'none' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="חיפוש לפי ספק / קטגוריה" dir="auto"
            style={{ height: 38, paddingRight: 32, paddingLeft: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text)', fontSize: 14, fontFamily: 'var(--font-main)', outline: 'none', minWidth: 220 }} />
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedIds.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--accent-bg)', border: '1px solid var(--accent)', borderRadius: 'var(--r-card)', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, color: 'var(--accent)', fontSize: 14 }}>{selectedIds.length} נבחרו</span>
          <div style={{ flex: 1 }} />
          <button onClick={() => doRestore(selectedIds)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--r-btn)', color: 'var(--text)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-main)' }}>
            <RotateCcw size={15} /> שחזר נבחרים
          </button>
          <button onClick={() => setConfirm({ ids: selectedIds, kind: 'delete' })}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: '#fef2f2', border: '1px solid var(--danger)', borderRadius: 'var(--r-btn)', color: 'var(--danger)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-main)' }}>
            <Trash2 size={15} /> מחק לצמיתות
          </button>
        </div>
      )}

      {/* List */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '64px 16px', color: 'var(--text-mute)' }}>
          <Archive size={44} style={{ margin: '0 auto 14px', display: 'block', opacity: 0.25 }} />
          <p style={{ fontWeight: 600, color: 'var(--text)', fontSize: 15 }}>{rows.length === 0 ? 'הארכיון ריק' : 'אין תוצאות'}</p>
          <p style={{ fontSize: 13, marginTop: 6 }}>קבלות שמועברות לארכיון (למשל אחרי ייצוא) יופיעו כאן — ניתן לשחזר או למחוק לצמיתות.</p>
        </div>
      ) : (
        <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--r-hero)', boxShadow: 'var(--shadow-card)', overflow: 'hidden' }}>
          {/* Select-all header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: 'var(--panel-2)', borderBottom: '1px solid var(--border)' }}>
            <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ width: 17, height: 17, accentColor: 'var(--accent)', cursor: 'pointer' }} />
            <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>בחר הכל</span>
          </div>
          {filtered.map(r => {
            const isSel = sel.has(r.id)
            return (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderBottom: '1px solid var(--border)', background: isSel ? 'var(--accent-bg)' : 'transparent' }}>
                <input type="checkbox" checked={isSel} onChange={() => toggle(r.id)} style={{ width: 17, height: 17, accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.vendor_name || 'ללא ספק'}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-mute)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span>{fmtDate(r.receipt_date)}</span>
                    {r.category_text && <span>· {r.category_text}</span>}
                  </div>
                </div>
                <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ok)', whiteSpace: 'nowrap', flexShrink: 0 }}>{fmtILS(r.amount)}</span>
                <button onClick={() => doRestore([r.id])} title="שחזר לקבלות"
                  style={{ padding: '6px 8px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', display: 'flex', borderRadius: 6 }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--panel-2)'} onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                  <RotateCcw size={17} />
                </button>
                <button onClick={() => setConfirm({ ids: [r.id], kind: 'delete' })} title="מחק לצמיתות"
                  style={{ padding: '6px 8px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-mute)', display: 'flex', borderRadius: 6 }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#fef2f2'; e.currentTarget.style.color = 'var(--danger)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-mute)' }}>
                  <Trash2 size={16} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Permanent delete — type-to-confirm */}
      <Modal isOpen={!!confirm} onClose={() => { if (!busy) { setConfirm(null); setPermText('') } }} title="מחיקה לצמיתות" size="sm">
        {confirm && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }} dir="rtl">
            <p style={{ margin: 0, fontSize: 14, color: 'var(--text)' }}>
              פעולה זו תמחק <strong>{confirm.ids.length}</strong> קבלות <strong style={{ color: 'var(--danger)' }}>לצמיתות</strong> — ללא אפשרות שחזור, וגם יוסרו מהדשבורד והסטטיסטיקות.
            </p>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-mute)' }}>להמשך, הקלד <strong>מחק</strong> בתיבה:</p>
            <input autoFocus value={permText} onChange={e => setPermText(e.target.value)} placeholder="מחק" dir="auto"
              style={{ height: 42, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text)', fontSize: 15, fontFamily: 'var(--font-main)', outline: 'none' }} />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { setConfirm(null); setPermText('') }} disabled={busy}
                style={{ flex: 1, padding: 12, borderRadius: 'var(--r-btn)', border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text-dim)', fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font-main)' }}>ביטול</button>
              <button onClick={() => doPermDelete(confirm.ids)} disabled={busy || permText.trim() !== 'מחק'}
                style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: 12, borderRadius: 'var(--r-btn)', border: 'none', fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-main)', cursor: (busy || permText.trim() !== 'מחק') ? 'default' : 'pointer', background: (busy || permText.trim() !== 'מחק') ? 'var(--panel-2)' : 'var(--danger)', color: (busy || permText.trim() !== 'מחק') ? 'var(--text-mute)' : 'white' }}>
                <Trash2 size={15} /> {busy ? 'מוחק…' : 'מחק לצמיתות'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
