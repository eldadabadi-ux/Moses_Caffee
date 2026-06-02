/**
 * DatePickerDialog — custom Hebrew month calendar.
 *
 * Wraps a value of "YYYY-MM-DD" (the canonical format used everywhere in the
 * app and stored verbatim in <input type="date">). Renders a month grid with:
 *   • Today's date highlighted with a thin circular outline (the headline
 *     feature — native mobile pickers don't reliably show this).
 *   • Selected date painted with the brand accent color.
 *   • Hebrew month + weekday names via Intl APIs (no hard-coded strings).
 *   • Prev/next month navigation; "היום" shortcut jumps to today.
 *
 * Props
 *   isOpen   : boolean
 *   value    : 'YYYY-MM-DD' | '' | null
 *   onCancel : () => void
 *   onConfirm: (next: 'YYYY-MM-DD') => void
 *   onClear? : () => void           — optional "נקה" button
 *   min?     : 'YYYY-MM-DD'         — disable days before this
 *   title?   : string               — header title (default: "בחר תאריך")
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, ChevronRight, ChevronLeft } from 'lucide-react'

const HE_MONTH_FMT  = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric' })
// Intl gives the full localized weekday — we trim to a 1-letter Hebrew label.
const WEEKDAY_LABELS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש']

// ── Date helpers (work on local-time YYYY-MM-DD strings, not Date()
// timezone-shifted ISO. Mixing the two is the classic off-by-one). ──
function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function parseISO(s) {
  if (!s) return null
  const [y, m, d] = String(s).split('-').map(Number)
  if (!y || !m || !d) return null
  return { y, m, d } // m is 1-12
}
function formatISO({ y, m, d }) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
function daysInMonth(y, m /* 1-12 */) {
  return new Date(y, m, 0).getDate()
}
// Day-of-week of the 1st (0=Sunday … 6=Saturday) — matches our column order.
function firstDayOffset(y, m) {
  return new Date(y, m - 1, 1).getDay()
}

export default function DatePickerDialog({
  isOpen,
  value,
  onCancel,
  onConfirm,
  onClear,
  min = null,
  title = 'בחר תאריך',
}) {
  const today = todayISO()
  // The "draft" is what the user is currently selecting (only commits on
  // אישור). The "view" controls which month is rendered.
  const [draft, setDraft] = useState(value || today)
  const [view, setView]   = useState(() => {
    const seed = parseISO(value) || parseISO(today)
    return { y: seed.y, m: seed.m }
  })

  // Reset on open so the dialog always starts on the current value's month.
  useEffect(() => {
    if (!isOpen) return
    const seed = parseISO(value) || parseISO(today)
    setDraft(value || today)
    setView({ y: seed.y, m: seed.m })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, value])

  // Body lock + Escape close.
  useEffect(() => {
    if (!isOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape') onCancel?.() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [isOpen, onCancel])

  if (!isOpen) return null

  const monthLabel = HE_MONTH_FMT.format(new Date(view.y, view.m - 1, 1))
  const totalDays  = daysInMonth(view.y, view.m)
  const offset     = firstDayOffset(view.y, view.m)
  const draftP     = parseISO(draft)

  function gotoMonth(delta) {
    setView(v => {
      let m = v.m + delta
      let y = v.y
      while (m > 12) { m -= 12; y += 1 }
      while (m < 1)  { m += 12; y -= 1 }
      return { y, m }
    })
  }
  function pickDay(day) {
    const iso = formatISO({ y: view.y, m: view.m, d: day })
    if (min && iso < min) return
    setDraft(iso)
  }
  function jumpToToday() {
    const t = parseISO(today)
    setView({ y: t.y, m: t.m })
    setDraft(today)
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  const overlayStyle = {
    position: 'fixed', inset: 0, zIndex: 60,
    background: 'rgba(15,23,42,0.55)',
    backdropFilter: 'blur(4px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '12px',
  }
  const dialogStyle = {
    width: '100%', maxWidth: '340px',
    background: 'var(--panel)',
    borderRadius: '20px',
    boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
    padding: '18px 18px 14px',
    display: 'flex', flexDirection: 'column', gap: '10px',
    fontFamily: 'var(--font-main)',
    direction: 'rtl',
  }
  const headerRowStyle = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  }
  const titleStyle = {
    margin: 0, fontSize: '13.5px', fontWeight: 600, color: 'var(--text-mute)',
  }
  const closeBtnStyle = {
    background: 'transparent', border: 'none', cursor: 'pointer',
    color: 'var(--text-mute)', padding: '4px',
    display: 'grid', placeItems: 'center',
  }
  const monthNavStyle = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '6px 0',
  }
  const navBtnStyle = {
    background: 'var(--panel-2)',
    border: '1px solid var(--border)',
    width: '32px', height: '32px', borderRadius: '8px',
    cursor: 'pointer', color: 'var(--text-dim)',
    display: 'grid', placeItems: 'center',
  }
  const monthLabelStyle = {
    fontSize: '15px', fontWeight: 700, color: 'var(--text)',
    fontFamily: 'var(--font-main)',
  }
  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: '4px',
    padding: '4px 0 8px',
  }
  const weekdayStyle = {
    fontSize: '11px', fontWeight: 600, color: 'var(--text-mute)',
    textAlign: 'center', padding: '4px 0',
  }
  function dayCellStyle({ isToday, isSelected, isDisabled }) {
    return {
      height: '38px',
      display: 'grid', placeItems: 'center',
      borderRadius: '50%',
      cursor: isDisabled ? 'default' : 'pointer',
      fontSize: '14px',
      fontWeight: isSelected ? 700 : 500,
      fontVariantNumeric: 'tabular-nums',
      color: isDisabled ? 'var(--text-mute)'
           : isSelected ? 'white'
           : isToday    ? 'var(--accent)'
           :              'var(--text)',
      background:  isSelected ? 'var(--accent)' : 'transparent',
      // The headline feature — a thin outline circle around today, drawn
      // even when the cell is unselected so the user always knows where
      // "today" is.
      border: isToday && !isSelected
        ? '1.5px solid var(--accent)'
        : '1.5px solid transparent',
      opacity: isDisabled ? 0.4 : 1,
      transition: 'background 100ms, color 100ms',
      userSelect: 'none',
    }
  }
  const actionsStyle = {
    display: 'grid',
    gridTemplateColumns: onClear ? '1fr 1fr 1fr' : '1fr 1fr',
    gap: '8px',
    marginTop: '6px',
  }
  const actionBtn = {
    height: '40px',
    border: '1px solid var(--border)',
    borderRadius: '10px',
    fontSize: '13.5px', fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'var(--font-main)',
  }

  return createPortal(
    <div style={overlayStyle} onClick={() => onCancel?.()}>
      <div style={dialogStyle} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        {/* Header */}
        <div style={headerRowStyle}>
          <h3 style={titleStyle}>{title}</h3>
          <button type="button" onClick={() => onCancel?.()} style={closeBtnStyle} aria-label="close">
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {/* Month navigation */}
        <div style={monthNavStyle}>
          {/* In RTL, the visual "previous" arrow points right and lives on
              the visual right (which is the `start` side under direction rtl).
              We use the same component (ChevronRight = →) for prev and
              ChevronLeft for next; they look correct in RTL because the
              container flows right-to-left. */}
          <button type="button" onClick={() => gotoMonth(-1)} style={navBtnStyle} aria-label="חודש קודם">
            <ChevronRight size={16} />
          </button>
          <button
            type="button"
            onClick={jumpToToday}
            style={{ ...monthLabelStyle, background: 'transparent', border: 'none', cursor: 'pointer' }}
            title="חזור להיום"
          >
            {monthLabel}
          </button>
          <button type="button" onClick={() => gotoMonth(+1)} style={navBtnStyle} aria-label="חודש הבא">
            <ChevronLeft size={16} />
          </button>
        </div>

        {/* Weekday headers (Sunday-first to match Israeli convention) */}
        <div style={gridStyle}>
          {WEEKDAY_LABELS.map(w => (
            <div key={w} style={weekdayStyle}>{w}</div>
          ))}

          {/* Empty cells before the 1st of the month */}
          {Array.from({ length: offset }).map((_, i) => (
            <div key={`pad-${i}`} />
          ))}

          {/* Day cells */}
          {Array.from({ length: totalDays }, (_, i) => i + 1).map(day => {
            const iso = formatISO({ y: view.y, m: view.m, d: day })
            const isToday    = iso === today
            const isSelected = !!draftP && iso === draft
            const isDisabled = !!min && iso < min
            return (
              <div
                key={day}
                role="button"
                tabIndex={isDisabled ? -1 : 0}
                onClick={() => !isDisabled && pickDay(day)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    if (!isDisabled) pickDay(day)
                  }
                }}
                style={dayCellStyle({ isToday, isSelected, isDisabled })}
              >
                {day}
              </div>
            )
          })}
        </div>

        {/* Action buttons */}
        <div style={actionsStyle}>
          {onClear && (
            <button type="button" onClick={onClear}
              style={{ ...actionBtn, background: 'transparent', color: 'var(--danger)', borderColor: 'transparent' }}>
              נקה
            </button>
          )}
          <button type="button" onClick={onCancel}
            style={{ ...actionBtn, background: 'var(--panel-2)', color: 'var(--text-dim)' }}>
            ביטול
          </button>
          <button type="button" onClick={() => onConfirm?.(draft)}
            style={{ ...actionBtn, background: 'var(--accent)', color: 'white', borderColor: 'var(--accent)' }}>
            אישור
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
