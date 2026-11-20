/**
 * ItemNameCombo — the item field of a quote line: type freely, or pick from the
 * catering catalogue in a dropdown where each entry can be removed with a small
 * ✕ (client request 20.11.26).
 *
 * A native <datalist> cannot do this — the browser owns that popup and will not
 * render a delete control inside it — so the list is ours: filtered as you
 * type, keyboard-dismissable, and closing on an outside click.
 */
import { useState, useRef, useEffect } from 'react'
import { Plus, X } from 'lucide-react'

const fmt = n => n == null ? '' : `₪${Number(n).toLocaleString('he-IL', { maximumFractionDigits: 2 })}`
const norm = s => String(s || '').trim().toLowerCase()

export default function ItemNameCombo({
  value, onChange, onPick, onCommit, catalog = [], onDelete, onAddNew,
  unitLabel = () => '', placeholder = 'שם הפריט', style,
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    // Clicking away ends the edit: that is when a freshly typed name joins the
    // catalogue, rather than on every keystroke.
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) { setOpen(false); onCommit?.() }
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open, onCommit])

  const q = norm(value)
  const matches = q ? catalog.filter(c => norm(c.name).includes(q)) : catalog
  const exact = catalog.some(c => norm(c.name) === q)
  const canAdd = !!q && !exact

  return (
    <div ref={wrapRef} style={{ position: 'relative', minWidth: 0 }}>
      <input
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => { if (e.key === 'Enter') { setOpen(false); onCommit?.() } }}
        placeholder={placeholder}
        dir="auto"
        style={style}
      />

      {open && (matches.length > 0 || canAdd) && (
        <div style={{
          position: 'absolute', insetInlineStart: 0, insetInlineEnd: 0, top: 'calc(100% + 4px)',
          zIndex: 30, background: 'var(--panel)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: '0 12px 30px rgba(0,0,0,0.16)',
          maxHeight: 230, overflowY: 'auto', padding: 4,
        }}>
          {matches.map(it => (
            <div key={it.id}
              style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 8, padding: '6px 8px' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--panel-2)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
              <button type="button" onClick={() => { onPick(it); setOpen(false) }}
                style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'start', fontFamily: 'var(--font-main)' }}>
                <span style={{ fontSize: 14, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
                <span style={{ fontSize: 12, color: 'var(--text-mute)', whiteSpace: 'nowrap', marginInlineStart: 'auto' }}>
                  {it.unit_price != null ? `${fmt(it.unit_price)} / ${unitLabel(it.unit)}` : unitLabel(it.unit)}
                </span>
              </button>
              {/* Removing an entry here is the whole point of owning the popup. */}
              <button type="button" title={`הסר את "${it.name}" מהרשימה`}
                onClick={(e) => { e.stopPropagation(); onDelete(it) }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-mute)', padding: 2, display: 'flex', flexShrink: 0, borderRadius: 4 }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--danger)' }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-mute)' }}>
                <X size={13} />
              </button>
            </div>
          ))}

          {canAdd && (
            <button type="button" onClick={() => { onAddNew(value); setOpen(false) }}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '7px 8px', marginTop: matches.length ? 4 : 0, borderTop: matches.length ? '1px solid var(--border)' : 'none', background: 'none', border: 'none', color: 'var(--accent)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-main)', textAlign: 'start' }}>
              <Plus size={14} /> הוסף "{value}" לרשימה
            </button>
          )}
        </div>
      )}
    </div>
  )
}
