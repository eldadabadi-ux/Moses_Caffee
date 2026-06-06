/**
 * TopVendors — robust, responsive vendor ranking (CSS flex, no fixed SVG widths).
 * Two-line rows: name + amount on top, full-width progress bar + count below.
 * Click a row to filter the dashboard by that vendor.
 */
const fmtILS = n => `₪${Math.round(n).toLocaleString('he-IL')}`

export default function TopVendors({ data, onSelect, selected }) {
  const top = (data || []).slice(0, 10)
  const max = Math.max(...top.map(d => d.total), 1)

  if (top.length === 0) {
    return <p style={{ textAlign: 'center', color: 'var(--text-mute)', padding: '20px 0', fontSize: '15px' }}>אין נתוני ספקים</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }} dir="rtl">
      {top.map(d => {
        const pct = (d.total / max) * 100
        const isSel = selected === d.name
        return (
          <button key={d.name} onClick={() => onSelect?.(d.name === selected ? null : d.name)}
            style={{
              display: 'flex', flexDirection: 'column', gap: '6px', width: '100%',
              padding: '10px 14px', borderRadius: '10px', cursor: 'pointer',
              border: `1px solid ${isSel ? 'var(--accent)' : 'var(--border)'}`,
              background: isSel ? 'var(--accent-bg)' : 'var(--panel-2)',
              fontFamily: 'var(--font-main)', textAlign: 'right',
            }}>
            {/* Line 1: name + amount */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: '15px', fontWeight: isSel ? 700 : 600, color: isSel ? 'var(--accent)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {d.name}
              </span>
              <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--ok)', whiteSpace: 'nowrap', flexShrink: 0 }}>{fmtILS(d.total)}</span>
            </div>
            {/* Line 2: progress bar + count */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: isSel ? 'var(--accent)' : '#60a5fa', borderRadius: 4, transition: 'width 500ms ease' }} />
              </div>
              <span style={{ fontSize: '12.5px', color: 'var(--text-mute)', whiteSpace: 'nowrap', flexShrink: 0 }}>{d.count} רכישות</span>
            </div>
          </button>
        )
      })}
    </div>
  )
}
