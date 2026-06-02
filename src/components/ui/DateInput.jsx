/**
 * DateInput — drop-in replacement for <input type="date"> that always opens
 * our custom DatePickerDialog (with today highlighted by a circle outline).
 *
 * Why not native? Mobile browsers each render the calendar differently;
 * many don't draw any indicator on today, which the user explicitly asked
 * for. Owning the dialog is the only consistent fix.
 *
 * API mirrors the native input as closely as practical:
 *   value      : 'YYYY-MM-DD' or ''
 *   onChange   : ({ target: { value } }) => void   — same shape as <input>
 *                so callers using `e.target.value` keep working unchanged.
 *   min        : optional 'YYYY-MM-DD' lower bound
 *   placeholder: shown when value is empty (default: "בחר תאריך")
 *   disabled   : boolean
 *   style      : merges over the default button style (so the existing
 *                FS / cellStyle objects in the codebase keep their look)
 *   className  : passed through
 *   onFocus / onBlur : forwarded to the trigger button so existing
 *                       focus-ring code (border highlight) still works
 */
import { useState } from 'react'
import { Calendar } from 'lucide-react'
import DatePickerDialog from './DatePickerDialog'

function formatHe(iso) {
  if (!iso) return ''
  // Robust local parse — avoid `new Date(iso)` which interprets as UTC.
  const [y, m, d] = String(iso).split('-').map(Number)
  if (!y || !m || !d) return ''
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
}

export default function DateInput({
  value,
  onChange,
  min = null,
  placeholder = 'בחר תאריך',
  disabled = false,
  style,
  className,
  onFocus,
  onBlur,
  title = 'בחר תאריך',
  clearable = true,
  ...rest
}) {
  const [open, setOpen] = useState(false)

  function emit(next) {
    // Match the shape of a native input change event so callers can do
    // `e.target.value` without a special case for this component.
    onChange?.({ target: { value: next } })
  }

  const baseStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    boxSizing: 'border-box',
    height: '40px',
    padding: '0 12px',
    border: '1px solid var(--border)',
    borderRadius: 'var(--r-btn, 8px)',
    background: disabled ? 'var(--panel-2)' : 'var(--panel)',
    color: value ? 'var(--text)' : 'var(--text-mute)',
    fontFamily: 'var(--font-main)',
    fontSize: '13.5px',
    fontVariantNumeric: 'tabular-nums',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    direction: 'ltr',
    textAlign: 'right',
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => { if (!disabled) setOpen(true) }}
        onFocus={onFocus}
        onBlur={onBlur}
        className={className}
        style={{ ...baseStyle, ...style }}
        {...rest}
      >
        <Calendar size={14} strokeWidth={1.75}
          style={{ color: 'var(--text-mute)', flexShrink: 0 }} />
        <span style={{ flex: 1, textAlign: 'right' }}>
          {value ? formatHe(value) : placeholder}
        </span>
      </button>
      <DatePickerDialog
        isOpen={open}
        value={value || ''}
        title={title}
        min={min}
        onCancel={() => setOpen(false)}
        onConfirm={(iso) => { emit(iso); setOpen(false) }}
        onClear={clearable ? () => { emit(''); setOpen(false) } : undefined}
      />
    </>
  )
}
