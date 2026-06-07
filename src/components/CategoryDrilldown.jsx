import { useState, useMemo } from 'react'
import { Store, ChevronDown } from 'lucide-react'
import { timeSeries, vendorBreakdown, vendorComposition } from '../lib/itemAggregation'
import TimeSeriesChart from './charts/TimeSeriesChart'
import ChartTypeToggle from './charts/ChartTypeToggle'

const COLORS = ['#2563eb','#7c3aed','#16a34a','#d97706','#dc2626','#0891b2','#c2410c','#0d9488','#be185d','#6366f1','#65a30d','#9333ea']
const fmtILS = n => `₪${Math.round(n).toLocaleString('he-IL')}`

const GRANS = [
  { id: 'day',     label: 'יומי' },
  { id: 'week',    label: 'שבועי' },
  { id: 'month',   label: 'חודשי' },
  { id: 'quarter', label: 'רבעוני' },
  { id: 'year',    label: 'שנתי' },
]

// ── Stacked composition bar: a vendor's spend split into product rectangles ──────
function CompositionBar({ rows, total }) {
  const [active, setActive] = useState(null)  // hovered / tapped segment index
  if (!rows.length) return null
  return (
    <div style={{ position: 'relative', marginTop: 4 }}>
      {/* Tooltip */}
      {active != null && rows[active] && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 7px)', left: '50%', transform: 'translateX(-50%)',
          background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, padding: '7px 12px',
          boxShadow: 'var(--shadow-modal)', zIndex: 10, textAlign: 'center', direction: 'rtl',
          maxWidth: '92%', whiteSpace: 'nowrap', pointerEvents: 'none',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: COLORS[active % COLORS.length], flexShrink: 0 }} />
            <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{rows[active].name}</span>
          </div>
          <div style={{ color: 'var(--ok)', fontWeight: 700, fontSize: 15, marginTop: 2 }}>{fmtILS(rows[active].total)}</div>
          <div style={{ color: 'var(--text-mute)', fontSize: 11.5 }}>
            {Math.round((rows[active].total / total) * 100)}% · {rows[active].count} פריטים
          </div>
        </div>
      )}
      {/* Bar */}
      <div style={{ display: 'flex', width: '100%', height: 30, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
        {rows.map((r, i) => {
          const frac = r.total / total
          const pct = frac * 100
          const isActive = active === i
          const showLabel = frac >= 0.16
          return (
            <div key={r.name}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(a => (a === i ? null : a))}
              onClick={() => setActive(a => (a === i ? null : i))}
              title={`${r.name} · ${fmtILS(r.total)}`}
              style={{
                width: `${pct}%`, minWidth: 3, height: '100%', background: COLORS[i % COLORS.length],
                opacity: active == null || isActive ? 1 : 0.45, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                transition: 'opacity 120ms', borderInlineStart: i ? '1px solid rgba(255,255,255,0.5)' : 'none',
              }}>
              {showLabel && (
                <span style={{ color: '#fff', fontSize: 11.5, fontWeight: 600, padding: '0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-main)' }}>{r.name}</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function CategoryDrilldown({ items }) {
  const [gran, setGran]   = useState('month')
  const [chartType, setChartType] = useState('bar')
  const [openVendor, setOpenVendor] = useState(null)  // expanded vendor name

  const vendors = useMemo(() => vendorBreakdown(items, []), [items])
  const series  = useMemo(() => timeSeries(items, [], gran), [items, gran])
  const compositions = useMemo(() => {
    const m = {}
    for (const v of vendors) m[v.name] = vendorComposition(items, v.name)
    return m
  }, [vendors, items])

  const maxVendor = Math.max(...vendors.map(v => v.total), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 }} dir="rtl">

      {/* Granularity + chart type */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: '8px' }}>
        <ChartTypeToggle value={chartType} onChange={setChartType} />
        <div style={{ display: 'flex', gap: '4px', background: 'var(--panel-2)', borderRadius: '9px', padding: '3px', flexWrap: 'wrap' }}>
          {GRANS.map(g => (
            <button key={g.id} onClick={() => setGran(g.id)}
              style={{ padding: '6px 12px', borderRadius: '7px', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-main)', fontSize: '13.5px', fontWeight: gran === g.id ? 700 : 500,
                background: gran === g.id ? 'var(--accent)' : 'transparent', color: gran === g.id ? 'white' : 'var(--text-dim)' }}>
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {/* Overall spend over time */}
      {series.length > 0
        ? <TimeSeriesChart data={series} color="#2563eb" chartType={chartType} />
        : <p style={{ textAlign: 'center', color: 'var(--text-mute)', padding: '20px 0', fontSize: '15px' }}>אין נתונים לתקופה</p>}

      {/* Vendors — click a vendor to split its bar into product rectangles */}
      {vendors.length > 0 && (
        <div>
          <p style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: 600, color: 'var(--text-mute)' }}>
            <Store size={13} style={{ verticalAlign: '-2px', marginInlineEnd: 4, color: 'var(--accent)' }} />
            ספקים · לחץ על ספק כדי לפרק את העמודה שלו למוצרים (מעבר עכבר/לחיצה מציג ערך)
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {vendors.map((v) => {
              const open = openVendor === v.name
              const comp = compositions[v.name]
              const pct = (v.total / maxVendor) * 100
              return (
                <div key={v.name} style={{ border: `1px solid ${open ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 11, background: open ? 'var(--accent-bg)' : 'var(--panel-2)', padding: '10px 14px', transition: 'background 120ms' }}>
                  {/* Header row — click to toggle */}
                  <button onClick={() => setOpenVendor(open ? null : v.name)}
                    style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', minWidth: 0, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-main)', textAlign: 'right', padding: 0 }}>
                    <Store size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: '15px', fontWeight: open ? 700 : 600, color: open ? 'var(--accent)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.name}</span>
                    <span style={{ fontSize: '12.5px', color: 'var(--text-mute)', flexShrink: 0, whiteSpace: 'nowrap' }}>{v.count} רכישות</span>
                    <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--ok)', flexShrink: 0, whiteSpace: 'nowrap' }}>{fmtILS(v.total)}</span>
                    <ChevronDown size={16} style={{ color: 'var(--text-mute)', flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 160ms' }} />
                  </button>
                  {/* Collapsed: proportional single bar. Expanded: product composition. */}
                  {open && comp
                    ? <CompositionBar rows={comp.rows} total={comp.total || 1} />
                    : (
                      <div style={{ marginTop: 8, height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: '#60a5fa', borderRadius: 3 }} />
                      </div>
                    )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
