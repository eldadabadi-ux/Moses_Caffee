import { useState, useMemo } from 'react'
import { ChevronLeft, Home } from 'lucide-react'
import { childrenBreakdown, timeSeries, filterByPath } from '../lib/itemAggregation'
import TimeSeriesChart from './charts/TimeSeriesChart'

const COLORS = ['#2563eb','#7c3aed','#16a34a','#d97706','#dc2626','#0891b2','#c2410c','#0d9488','#be185d','#6366f1']
const fmtILS = n => `₪${Math.round(n).toLocaleString('he-IL')}`

const GRANS = [
  { id: 'day',     label: 'יומי' },
  { id: 'week',    label: 'שבועי' },
  { id: 'month',   label: 'חודשי' },
  { id: 'quarter', label: 'רבעוני' },
  { id: 'year',    label: 'שנתי' },
]
const LEVEL_LABEL = ['קטגוריות', 'תת-קטגוריות', 'תת-תת-קטגוריות']

export default function CategoryDrilldown({ items }) {
  const [path, setPath] = useState([])         // [l1, l2, l3]
  const [gran, setGran] = useState('month')

  const children = useMemo(() => childrenBreakdown(items, path), [items, path])
  const series   = useMemo(() => timeSeries(items, path, gran), [items, path, gran])
  const scopedTotal = useMemo(() => filterByPath(items, path).reduce((s, it) => s + it.price, 0), [items, path])

  const atLeaf = path.length >= 3
  const maxChild = Math.max(...children.map(c => c.total), 1)

  function drillInto(name) { if (path.length < 3) setPath([...path, name]) }
  function goTo(idx) { setPath(path.slice(0, idx)) }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} dir="rtl">

      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', fontSize: '14px' }}>
        <button onClick={() => goTo(0)} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: path.length === 0 ? 'var(--accent-bg)' : 'transparent', color: path.length === 0 ? 'var(--accent)' : 'var(--text-dim)', border: 'none', borderRadius: '7px', padding: '5px 10px', cursor: 'pointer', fontFamily: 'var(--font-main)', fontWeight: 600 }}>
          <Home size={14} /> הכל
        </button>
        {path.map((p, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <ChevronLeft size={14} style={{ color: 'var(--text-mute)' }} />
            <button onClick={() => goTo(i + 1)} style={{ background: i === path.length - 1 ? 'var(--accent-bg)' : 'transparent', color: i === path.length - 1 ? 'var(--accent)' : 'var(--text-dim)', border: 'none', borderRadius: '7px', padding: '5px 10px', cursor: 'pointer', fontFamily: 'var(--font-main)', fontWeight: 600, fontSize: '14px' }}>
              {p}
            </button>
          </span>
        ))}
      </div>

      {/* Scoped total + granularity selector */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ fontSize: '15px', color: 'var(--text-mute)' }}>
          {path.length === 0 ? 'סך הכל ההוצאות' : path[path.length - 1]} · <span style={{ color: 'var(--ok)', fontWeight: 700, fontSize: '17px' }}>{fmtILS(scopedTotal)}</span>
        </div>
        <div style={{ display: 'flex', gap: '4px', background: 'var(--panel-2)', borderRadius: '9px', padding: '3px' }}>
          {GRANS.map(g => (
            <button key={g.id} onClick={() => setGran(g.id)}
              style={{ padding: '6px 12px', borderRadius: '7px', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-main)', fontSize: '13.5px', fontWeight: gran === g.id ? 700 : 500,
                background: gran === g.id ? 'var(--accent)' : 'transparent', color: gran === g.id ? 'white' : 'var(--text-dim)' }}>
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {/* Time series for the current node */}
      {series.length > 0 ? (
        <TimeSeriesChart data={series} color={COLORS[(path.length) % COLORS.length]} />
      ) : (
        <p style={{ textAlign: 'center', color: 'var(--text-mute)', padding: '20px 0', fontSize: '15px' }}>אין נתונים לתקופה</p>
      )}

      {/* Children breakdown — clickable to drill deeper */}
      {!atLeaf && children.length > 0 && (
        <div>
          <p style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: 600, color: 'var(--text-mute)' }}>
            {LEVEL_LABEL[path.length]} · לחץ כדי להעמיק
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {children.map((c, i) => {
              const pct = (c.total / maxChild) * 100
              const color = COLORS[i % COLORS.length]
              return (
                <button key={c.name} onClick={() => drillInto(c.name)}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--panel-2)', cursor: 'pointer', fontFamily: 'var(--font-main)', textAlign: 'right', transition: 'background 120ms' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--panel)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'var(--panel-2)'}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: '15px', fontWeight: 500, color: 'var(--text)' }}>{c.name}</span>
                  <span style={{ fontSize: '13px', color: 'var(--text-mute)' }}>{c.count} פריטים</span>
                  <div style={{ width: 80, flexShrink: 0 }}>
                    <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3 }} />
                    </div>
                  </div>
                  <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--ok)', minWidth: 76, textAlign: 'left' }}>{fmtILS(c.total)}</span>
                  <ChevronLeft size={16} style={{ color: 'var(--text-mute)', flexShrink: 0 }} />
                </button>
              )
            })}
          </div>
        </div>
      )}
      {atLeaf && (
        <p style={{ fontSize: '13.5px', color: 'var(--text-mute)', textAlign: 'center' }}>
          זוהי הרמה המפורטת ביותר — הגרף מציג את ההוצאה על "{path[2]}" לאורך זמן.
        </p>
      )}
    </div>
  )
}
