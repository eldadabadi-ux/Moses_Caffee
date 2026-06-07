const fmtILS = n => `₪${Math.round(n).toLocaleString('he-IL')}`

/**
 * ProductCompareChart — horizontal grouped bars comparing two vendors across
 * a set of products. `products` = [{ name, a, b }]. Pure CSS (no overflow).
 */
export default function ProductCompareChart({ products = [], labelA, labelB, colorA = '#2563eb', colorB = '#f59e0b' }) {
  const max = Math.max(...products.flatMap(p => [p.a, p.b]), 1)

  const Bar = ({ tag, value, color }) => {
    const pct = (value / max) * 100
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span style={{ flexShrink: 0, width: 54, fontSize: 11.5, fontWeight: 700, color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tag}</span>
        <div style={{ flex: 1, minWidth: 0, height: 16, borderRadius: 4, background: 'var(--panel-2)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, minWidth: value > 0 ? 3 : 0, background: color, borderRadius: 4, transition: 'width 500ms ease' }} />
        </div>
        <span style={{ flexShrink: 0, width: 70, textAlign: 'left', fontSize: 13, fontWeight: 700, color: value > 0 ? 'var(--text)' : 'var(--text-mute)', whiteSpace: 'nowrap' }}>{fmtILS(value)}</span>
      </div>
    )
  }

  return (
    <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{ width: 11, height: 11, borderRadius: 3, background: colorA, flexShrink: 0 }} />
          <span style={{ fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{labelA}</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{ width: 11, height: 11, borderRadius: 3, background: colorB, flexShrink: 0 }} />
          <span style={{ fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{labelB}</span>
        </span>
      </div>

      {products.map((p) => {
        const both = p.a > 0 && p.b > 0
        const cheaper = both ? (p.a < p.b ? labelA : labelB) : null
        const diff = both ? Math.abs(p.a - p.b) : 0
        return (
          <div key={p.name} style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, padding: '10px 12px', borderRadius: 11, border: '1px solid var(--border)', background: 'var(--panel)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
              {both && (
                <span style={{ flexShrink: 0, fontSize: 11.5, color: 'var(--ok)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  פער {fmtILS(diff)} · זול יותר: {cheaper}
                </span>
              )}
            </div>
            <Bar tag={labelA} value={p.a} color={colorA} />
            <Bar tag={labelB} value={p.b} color={colorB} />
          </div>
        )
      })}

      {products.length === 0 && (
        <p style={{ textAlign: 'center', color: 'var(--text-mute)', padding: '18px 0', fontSize: 14 }}>אין מוצרים משותפים להשוואה</p>
      )}
    </div>
  )
}
