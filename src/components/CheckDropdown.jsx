import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { ChevronDown, Check, X } from 'lucide-react'

/**
 * CheckDropdown — compact multi-select for the dashboard filter bar
 * (client request 15.11.26: years / categories / suppliers pick several at once).
 * `options` = [{ value, label }]. `values` = array of selected value keys.
 * Empty selection means "everything" (`allLabel`). `minOne` keeps at least one
 * value selected (the year filter must never be empty).
 */
const PANEL_MAX_W = 280
const EDGE = 8

export default function CheckDropdown({ icon: Icon, options = [], values = [], onChange, allLabel, minOne = false, width }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const panelRef = useRef(null)
  // The panel hangs off the button's RIGHT edge (RTL) and grows left — near the
  // viewport's left edge that clips it. Instead of guessing with a threshold
  // (the first-open miss of QA 15.11.26 round 3), measure the REAL panel rect
  // before paint and translate it back inside the viewport, whichever edge it
  // crossed. useLayoutEffect = corrected position on the very first frame.
  const [shift, setShift] = useState(0)
  useLayoutEffect(() => {
    if (!open) { setShift(0); return }
    const p = panelRef.current?.getBoundingClientRect()
    if (!p) return
    const vw = document.documentElement.clientWidth
    // The rect is measured WITH the current shift applied, so corrections add up.
    let dx = 0
    if (p.left < EDGE) dx = EDGE - p.left
    else if (p.right > vw - EDGE) dx = (vw - EDGE) - p.right
    if (dx !== 0) setShift(s => s + dx)
  }, [open, options.length, shift])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  const set = new Set(values)
  const toggle = (v) => {
    const next = new Set(set)
    next.has(v) ? next.delete(v) : next.add(v)
    if (minOne && next.size === 0) return
    onChange([...next])
  }

  const labelOf = (v) => options.find(o => o.value === v)?.label ?? String(v)
  const active = values.length > 0
  const summary = !active ? allLabel
    : values.length === 1 ? labelOf(values[0])
    : `${labelOf(values[0])} +${values.length - 1}`

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button type="button" onClick={() => setOpen(o => !o)} disabled={!options.length}
        style={{ height: 36, padding: '0 10px', borderRadius: 8, cursor: options.length ? 'pointer' : 'not-allowed',
          border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
          background: active ? 'var(--accent-bg)' : 'var(--panel)',
          color: active ? 'var(--accent)' : 'var(--text)', fontSize: '13px', fontFamily: 'var(--font-main)',
          display: 'flex', alignItems: 'center', gap: 6, maxWidth: width || 190, opacity: options.length ? 1 : 0.5 }}>
        {Icon && <Icon size={13} style={{ color: active ? 'var(--accent)' : 'var(--text-mute)', flexShrink: 0 }} />}
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: active ? 600 : 400 }}>{summary}</span>
        {active && !minOne && (
          <span onClick={(e) => { e.stopPropagation(); onChange([]) }} aria-label="נקה" style={{ display: 'flex', color: 'var(--text-mute)', flexShrink: 0 }}><X size={13} /></span>
        )}
        <ChevronDown size={14} style={{ color: 'var(--text-mute)', flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
      </button>

      {open && (
        <div ref={panelRef} style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, transform: `translateX(${shift}px)`, zIndex: 40, minWidth: '100%', width: 'max-content', maxWidth: `min(${PANEL_MAX_W}px, calc(100vw - ${EDGE * 2}px))`,
          background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow-modal)',
          maxHeight: 300, overflowY: 'auto', padding: 6 }}>
          {!minOne && (
            <>
              <button type="button" onClick={() => { onChange([]); setOpen(false) }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 10px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-main)', textAlign: 'right', borderRadius: 7, color: !active ? 'var(--accent)' : 'var(--text-dim)', fontWeight: !active ? 700 : 500, fontSize: 13.5 }}>
                <span style={{ width: 16, display: 'flex', flexShrink: 0 }}>{!active && <Check size={15} />}</span>
                {allLabel}
              </button>
              <div style={{ height: 1, background: 'var(--border)', margin: '4px 2px' }} />
            </>
          )}
          {options.map((o) => {
            const sel = set.has(o.value)
            return (
              <button key={o.value} type="button" onClick={() => toggle(o.value)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', minWidth: 0, padding: '8px 10px', background: sel ? 'var(--accent-bg)' : 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-main)', textAlign: 'right', borderRadius: 7 }}
                onMouseEnter={e => { if (!sel) e.currentTarget.style.background = 'var(--panel-2)' }}
                onMouseLeave={e => { if (!sel) e.currentTarget.style.background = 'none' }}>
                <span style={{ width: 16, height: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: `1.5px solid ${sel ? 'var(--accent)' : 'var(--border-strong, var(--border))'}`, borderRadius: 4,
                  background: sel ? 'var(--accent)' : 'transparent', color: '#fff' }}>{sel && <Check size={12} />}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: sel ? 600 : 400 }}>{o.label}</span>
              </button>
            )
          })}
          {options.length === 0 && <p style={{ textAlign: 'center', color: 'var(--text-mute)', fontSize: 13, padding: 10, margin: 0 }}>אין אפשרויות</p>}
        </div>
      )}
    </div>
  )
}
