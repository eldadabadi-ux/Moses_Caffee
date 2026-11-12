/**
 * SupplierMergePage — the one-off cleanup that turns free-text vendor names into
 * canonical suppliers (audit R1, client requests #2 #3 #4 #7 #8).
 *
 * Nothing is merged without a human: the server proposes groups, this screen
 * shows every spelling with its confidence, and only what the user leaves
 * checked is applied. `vendor_name` is never rewritten — applying only stamps
 * `receipts.supplier_id`, so the operation is reversible and re-runnable.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Store, Merge, AlertTriangle, ChevronLeft, Check, RefreshCw } from 'lucide-react'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import toast from 'react-hot-toast'

const fmtILS = n => `₪${Math.round(Number(n) || 0).toLocaleString('he-IL')}`

async function authFetch(path, init = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error('נדרשת כניסה מחדש')
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.message || err?.error || `שגיאת שרת ${res.status}`)
  }
  return res.json()
}

export default function SupplierMergePage() {
  const navigate = useNavigate()
  const isMobile = window.innerWidth < 768
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState(false)
  // { [canonicalName]: { canonical, picked: Set<name> } }
  const [choices, setChoices] = useState({})
  // Ask-band suggestions the user explicitly accepted: { [canonicalName]: supplierId }
  const [accepted, setAccepted] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await authFetch('/api/suppliers/merge')
      setData(d)
      // Keyed by the cluster's CANONICAL NAME, not its index. Keying by index
      // broke as soon as a junk cluster sat between two real ones: the render
      // loop filters junk out and re-indexes, so slot i showed one cluster while
      // reading and writing another cluster's choices — every checkbox click and
      // rename went to the wrong place, silently.
      const init = {}
      d.clusters.forEach(c => {
        init[c.canonical] = { canonical: c.canonical, picked: new Set(c.members.map(m => m.name)) }
      })
      setChoices(init)
    } catch (e) { toast.error(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const toggle = (key, name) => setChoices(prev => {
    const cur = prev[key]
    if (!cur) return prev
    const picked = new Set(cur.picked)
    picked.has(name) ? picked.delete(name) : picked.add(name)
    return { ...prev, [key]: { ...cur, picked } }
  })

  const setCanonical = (key, canonical) => setChoices(prev => ({ ...prev, [key]: { ...prev[key], canonical } }))

  // Only clusters where something is actually being grouped or linked.
  const pending = useMemo(() => {
    if (!data) return []
    return data.clusters.map(c => ({ c, key: c.canonical, picked: choices[c.canonical]?.picked || new Set() }))
      .filter(({ c, picked }) => !c.junk && picked.size > 0)
  }, [data, choices])

  const stats = useMemo(() => {
    const groups = pending.length
    const names = pending.reduce((n, p) => n + p.picked.size, 0)
    const merges = pending.filter(p => p.picked.size > 1).length
    return { groups, names, merges }
  }, [pending])

  async function apply() {
    if (!pending.length) { toast.error('לא נבחר דבר'); return }
    setBusy(true)
    try {
      const groups = pending.map(({ c, key, picked }) => ({
        canonical: choices[key].canonical,
        supplier_id: c.existing_supplier?.id || accepted[key] || undefined,
        aliases: [...picked],
        // Echo back the EXACT spellings stored on the rows, so trimming
        // differences don't leave receipts unlinked.
        stored: c.stored,
      }))
      const r = await authFetch('/api/suppliers/merge', { method: 'POST', body: JSON.stringify({ groups }) })
      toast.success(`${r.suppliers_created} ספקים נוצרו · ${r.receipts_linked} קבלות קושרו`)
      if (r.problems?.length) toast.error(`${r.problems.length} בעיות — ראה קונסול`)
      if (r.deferred) toast(`נותרו ${r.deferred} קבוצות — לחץ "מזג" שוב כדי להשלים`, { icon: 'ℹ️', duration: 7000 })
      await load()
    } catch (e) { toast.error(e.message) }
    finally { setBusy(false) }
  }

  if (loading) return <LoadingSpinner />
  if (!data) return null

  const junk = data.clusters.filter(c => c.junk)

  return (
    <div className="animate-fade-in" dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 96 }}>

      {/* Header */}
      <div>
        <button onClick={() => navigate('/suppliers')}
          style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: 'var(--text-mute)', cursor: 'pointer', fontSize: 14, fontFamily: 'var(--font-main)', padding: 0, marginBottom: 8 }}>
          <ChevronLeft size={15} /> חזרה לספקים
        </button>
        <h1 style={{ margin: 0, fontSize: isMobile ? 23 : 26, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Merge size={24} color="var(--accent)" /> איחוד ספקים
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 15, color: 'var(--text-mute)', maxWidth: '62ch', lineHeight: 1.6 }}>
          הסריקה כותבת את שם הספק מחדש בכל קבלה, ולכן אותו ספק מופיע בכמה איותים.
          כאן מאחדים אותם לספק אחד. שם הקבלה עצמו לא משתנה — רק נוצר קישור, וניתן להריץ שוב.
        </p>
      </div>

      {/* Summary */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {[
          { label: 'שמות בקבלות', value: data.total_names },
          { label: 'ספקים אחרי איחוד', value: data.total_suppliers_after },
          { label: 'קבלות עדיין לא מקושרות', value: data.unlinked },
        ].map(k => (
          <div key={k.label} style={{ flex: '1 1 140px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', padding: '12px 14px' }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)' }}>{k.value}</div>
            <div style={{ fontSize: 13, color: 'var(--text-mute)' }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Clusters */}
      {data.clusters.filter(c => !c.junk).map(c => {
        const key = c.canonical
        const picked = choices[key]?.picked || new Set()
        const isMerge = [...c.members, ...c.review].length > 1
        return (
          <div key={key} style={{ background: 'var(--panel)', border: `1px solid ${isMerge ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 'var(--r-card)', padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: isMerge ? 10 : 0, flexWrap: 'wrap' }}>
              <Store size={16} color="var(--accent)" style={{ flexShrink: 0 }} />
              <input value={choices[key]?.canonical ?? c.canonical} onChange={e => setCanonical(key, e.target.value)}
                aria-label="שם הספק"
                style={{ flex: '1 1 220px', minWidth: 0, fontSize: 15.5, fontWeight: 700, color: 'var(--text)', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', fontFamily: 'var(--font-main)' }} />
              <span style={{ fontSize: 13, color: 'var(--text-mute)', whiteSpace: 'nowrap' }}>
                {c.receipts} קבלות · {fmtILS(c.total)}
              </span>
              {c.existing_supplier && (
                <span title={`יקושר לספק קיים: ${c.existing_supplier.name}`}
                  style={{ fontSize: 11.5, fontWeight: 600, background: 'var(--accent-bg)', color: 'var(--accent)', borderRadius: 999, padding: '2px 9px', whiteSpace: 'nowrap' }}>
                  ספק קיים
                </span>
              )}
            </div>

            {/* A plausible-but-uncertain match with an existing supplier. Offered,
                never applied on its own — a 65% match linked silently would fold
                one business into another permanently. */}
            {!c.existing_supplier && c.possible_supplier && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--panel-2)' }}>
                <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                  ייתכן שזה הספק הקיים <strong>{c.possible_supplier.name}</strong> ({Math.round(c.possible_supplier.score * 100)}%)
                </span>
                <button onClick={() => setAccepted(a => ({ ...a, [key]: a[key] ? undefined : c.possible_supplier.id }))}
                  style={{ padding: '4px 12px', borderRadius: 999, border: `1px solid ${accepted[key] ? 'var(--accent)' : 'var(--border)'}`, background: accepted[key] ? 'var(--accent-bg)' : 'var(--panel)', color: accepted[key] ? 'var(--accent)' : 'var(--text-mute)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-main)' }}>
                  {accepted[key] ? 'כן — אותו ספק ✓' : 'כן, אותו ספק'}
                </button>
              </div>
            )}

            {isMerge && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {[...c.members, ...c.review].map(m => {
                  const on = picked.has(m.name)
                  const needsReview = c.review.some(r => r.name === m.name)
                  return (
                    <label key={m.name}
                      style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 8px', borderRadius: 8, cursor: 'pointer', background: on ? 'var(--accent-bg)' : 'transparent' }}>
                      <input type="checkbox" checked={on} onChange={() => toggle(key, m.name)} style={{ width: 16, height: 16, accentColor: 'var(--accent)', flexShrink: 0 }} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: 14.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                      {needsReview && (
                        <span title={`ודאות ${Math.round(m.score * 100)}% — כדאי לוודא`}
                          style={{ fontSize: 11, fontWeight: 700, background: 'var(--warn-bg, #fef3c7)', color: 'var(--warn, #92400e)', borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap' }}>
                          לבדיקה {Math.round(m.score * 100)}%
                        </span>
                      )}
                      <span style={{ fontSize: 12.5, color: 'var(--text-mute)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{m.count}×</span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      {/* Junk names — an OCR failure, not a business */}
      {junk.length > 0 && (
        <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <AlertTriangle size={16} style={{ color: 'var(--danger)' }} />
            <strong style={{ fontSize: 15 }}>שמות שלא נקראו כראוי ({junk.length})</strong>
          </div>
          <p style={{ margin: '0 0 8px', fontSize: 13.5, color: 'var(--text-mute)' }}>
            אלה כשלי סריקה ולא ספקים. פתח את הקבלה ותקן את שם הספק ידנית — הן לא ייכללו באיחוד.
          </p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {junk.map(c => (
              <span key={c.canonical} style={{ fontSize: 13, background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 9px', fontFamily: 'monospace' }}>
                {c.canonical || '(ריק)'}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Sticky apply bar */}
      <div style={{ position: 'fixed', bottom: 0, insetInlineStart: 0, insetInlineEnd: 0, zIndex: 50, background: 'var(--panel)', borderTop: '1px solid var(--border)', padding: '12px 16px calc(12px + env(safe-area-inset-bottom))', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, boxShadow: '0 -4px 16px rgba(0,0,0,0.08)' }}>
        <span style={{ fontSize: 14, color: 'var(--text-mute)' }}>
          {stats.merges} איחודים · {stats.names} שמות → {stats.groups} ספקים
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} disabled={busy} title="רענן"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 12px', borderRadius: 'var(--r-btn)', border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text-mute)', cursor: busy ? 'default' : 'pointer', fontFamily: 'var(--font-main)', fontSize: 14 }}>
            <RefreshCw size={15} />
          </button>
          <button onClick={apply} disabled={busy || !pending.length}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 'var(--r-btn)', border: 'none', background: busy || !pending.length ? 'var(--border)' : 'var(--accent)', color: '#fff', fontWeight: 700, fontSize: 15, cursor: busy || !pending.length ? 'default' : 'pointer', fontFamily: 'var(--font-main)' }}>
            <Check size={16} /> {busy ? 'מאחד…' : 'אשר איחוד'}
          </button>
        </div>
      </div>
    </div>
  )
}
