import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check, X } from 'lucide-react'

const fmtILS = n => `₪${Math.round(n).toLocaleString('he-IL')}`

/**
 * MultiSelect — a dropdown checkbox list of products for one vendor.
 * `options` = [{ name, total }]. `value` = array of selected names.
 * Empty selection means "all products" (overall comparison).
 */
export default function MultiSelect({ label, options = [], value = [], onChange, accent = 'var(--accent)' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const set = new Set(value)
  const toggle = (name) => {
    const next = new Set(set)
    next.has(name) ? next.delete(name) : next.add(name)
    onChange([...next])
  }

  const summary = value.length === 0
    ? 'כל המוצרים (השוואה כללית)'
    : value.length === 1 ? value[0] : `${value.length} מוצרים נבחרו`

  return (
    <div ref={ref} style={{ position: 'relative', minWidth: 0 }}>
      {label && <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: accent, marginBottom: '6px' }}>{label}</label>}
      <button type="button" onClick={() => setOpen(o => !o)} disabled={!options.length}
        style={{ width: '100%', minWidth: 0, height: 42, padding: '0 12px', borderRadius: 8, cursor: options.length ? 'pointer' : 'not-allowed',
          border: `1px solid ${value.length ? accent : 'var(--border)'}`, background: value.length ? 'var(--accent-bg)' : 'var(--panel)',
          color: 'var(--text)', fontSize: '14px', fontFamily: 'var(--font-main)', display: 'flex', alignItems: 'center', gap: 8, opacity: options.length ? 1 : 0.5 }}>
        <span style={{ flex: 1, minWidth: 0, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: value.length ? accent : 'var(--text-dim)', fontWeight: value.length ? 600 : 400 }}>{summary}</span>
        {value.length > 0 && (
          <span onClick={(e) => { e.stopPropagation(); onChange([]) }} aria-label="נקה" style={{ display: 'flex', color: 'var(--text-mute)', flexShrink: 0 }}><X size={15} /></span>
        )}
        <ChevronDown size={16} style={{ color: 'var(--text-mute)', flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
      </button>

      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, left: 0, zIndex: 30,
          background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow-modal)',
          maxHeight: 280, overflowY: 'auto', padding: 6 }}>
          <button type="button" onClick={() => onChange([])}
            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 10px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-main)', textAlign: 'right', borderRadius: 7, color: value.length === 0 ? accent : 'var(--text-dim)', fontWeight: value.length === 0 ? 700 : 500, fontSize: 13.5 }}>
            <span style={{ width: 16, display: 'flex', flexShrink: 0 }}>{value.length === 0 && <Check size={15} />}</span>
            כל המוצרים (השוואה כללית)
          </button>
          <div style={{ height: 1, background: 'var(--border)', margin: '4px 2px' }} />
          {options.map((o) => {
            const sel = set.has(o.name)
            return (
              <button key={o.name} type="button" onClick={() => toggle(o.name)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', minWidth: 0, padding: '8px 10px', background: sel ? 'var(--accent-bg)' : 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-main)', textAlign: 'right', borderRadius: 7 }}
                onMouseEnter={e => { if (!sel) e.currentTarget.style.background = 'var(--panel-2)' }}
                onMouseLeave={e => { if (!sel) e.currentTarget.style.background = 'none' }}>
                <span style={{ width: 16, display: 'flex', flexShrink: 0, color: accent }}>{sel && <Check size={15} />}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: sel ? 600 : 400 }}>{o.name}</span>
                <span style={{ fontSize: 12.5, color: 'var(--text-mute)', flexShrink: 0, whiteSpace: 'nowrap' }}>{fmtILS(o.total)}</span>
              </button>
            )
          })}
          {options.length === 0 && <p style={{ textAlign: 'center', color: 'var(--text-mute)', fontSize: 13, padding: 10, margin: 0 }}>אין מוצרים</p>}
        </div>
      )}
    </div>
  )
}
