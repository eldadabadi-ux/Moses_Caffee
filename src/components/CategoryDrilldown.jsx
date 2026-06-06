import { useState, useMemo } from 'react'
import { ChevronLeft, Home, Search, Users } from 'lucide-react'
import { childrenBreakdown, timeSeries, filterByPath, vendorBreakdown, nextDim, DIM_LABEL } from '../lib/itemAggregation'
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

export default function CategoryDrilldown({ items }) {
  const [path, setPath]   = useState([])   // [{ dim, value }]
  const [gran, setGran]   = useState('month')
  const [search, setSearch] = useState('')
  const [vendorFilter, setVendorFilter] = useState(null) // compare/isolate a vendor

  const { dim: childDim, rows: childrenRaw } = useMemo(() => childrenBreakdown(items, path), [items, path])
  const children = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? childrenRaw.filter(c => c.name.toLowerCase().includes(q)) : childrenRaw
  }, [childrenRaw, search])
  const vendors  = useMemo(() => vendorBreakdown(items, path), [items, path])
  const series   = useMemo(() => timeSeries(items, path, gran, vendorFilter), [items, path, gran, vendorFilter])
  const scopedTotal = useMemo(() => filterByPath(items, path).reduce((s, it) => s + it.price, 0), [items, path])

  const atLeaf = !childDim
  const maxChild = Math.max(...children.map(c => c.total), 1)
  const maxVendor = Math.max(...vendors.map(v => v.total), 1)
  const currentLabel = path.length ? path[path.length - 1].value : 'הכל'

  function drillInto(name) { if (childDim) { setPath([...path, { dim: childDim, value: name }]); setSearch(''); setVendorFilter(null) } }
  function goTo(idx) { setPath(path.slice(0, idx)); setSearch(''); setVendorFilter(null) }

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
              {p.value}
            </button>
          </span>
        ))}
      </div>

      {/* Scoped total + granularity */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ fontSize: '15px', color: 'var(--text-mute)' }}>
          {currentLabel}{vendorFilter ? ` · ${vendorFilter}` : ''} · <span style={{ color: 'var(--ok)', fontWeight: 700, fontSize: '17px' }}>{fmtILS(vendorFilter ? series.reduce((s,d)=>s+d.total,0) : scopedTotal)}</span>
        </div>
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

      {/* Time series */}
      {series.length > 0
        ? <TimeSeriesChart data={series} color={vendorFilter ? '#7c3aed' : COLORS[path.length % COLORS.length]} />
        : <p style={{ textAlign: 'center', color: 'var(--text-mute)', padding: '20px 0', fontSize: '15px' }}>אין נתונים לתקופה</p>}

      {/* Vendor breakdown / comparison — always available for the current scope */}
      {vendors.length > 0 && (
        <div style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: '12px', padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
            <Users size={15} style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)' }}>
              {vendors.length >= 2 ? `השוואת ספקים (${vendors.length})` : 'ספק'}
            </span>
            {vendorFilter && (
              <button onClick={() => setVendorFilter(null)} style={{ marginInlineStart: 'auto', fontSize: '12.5px', color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-main)' }}>
                הצג הכל
              </button>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            {vendors.map((v, i) => {
              const pct = (v.total / maxVendor) * 100
              const sel = vendorFilter === v.name
              return (
                <button key={v.name} onClick={() => setVendorFilter(sel ? null : v.name)}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: '9px', cursor: 'pointer', fontFamily: 'var(--font-main)', textAlign: 'right',
                    border: `1px solid ${sel ? 'var(--accent)' : 'var(--border)'}`, background: sel ? 'var(--accent-bg)' : 'var(--panel)' }}>
                  <span style={{ flex: 1, fontSize: '14px', fontWeight: sel ? 700 : 500, color: sel ? 'var(--accent)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.name}</span>
                  <span style={{ fontSize: '12.5px', color: 'var(--text-mute)' }}>{v.count} רכישות</span>
                  <div style={{ width: 70, flexShrink: 0 }}>
                    <div style={{ height: 5, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: sel ? 'var(--accent)' : '#60a5fa', borderRadius: 3 }} />
                    </div>
                  </div>
                  <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--ok)', minWidth: 72, textAlign: 'left' }}>{fmtILS(v.total)}</span>
                </button>
              )
            })}
          </div>
          {vendors.length >= 2 && <p style={{ margin: '8px 2px 0', fontSize: '12px', color: 'var(--text-mute)' }}>לחץ על ספק כדי לראות את הגרף שלו בלבד — להשוואה.</p>}
        </div>
      )}

      {/* Children — drill deeper. Adaptive level (category / sub / product). */}
      {!atLeaf && childrenRaw.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '8px', flexWrap: 'wrap' }}>
            <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--text-mute)' }}>
              {DIM_LABEL[childDim]} · לחץ כדי להעמיק
            </p>
            {childrenRaw.length > 6 && (
              <div style={{ position: 'relative', flex: '0 1 220px' }}>
                <Search size={14} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-mute)', pointerEvents: 'none' }} />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder={`חיפוש ${DIM_LABEL[childDim]}…`} dir="rtl"
                  style={{ width: '100%', height: 38, padding: '0 32px 0 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text)', fontSize: '14px', fontFamily: 'var(--font-main)', outline: 'none', boxSizing: 'border-box' }} />
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: 360, overflowY: 'auto' }}>
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
                  <span style={{ fontSize: '13px', color: 'var(--text-mute)' }}>{c.count}</span>
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
            {children.length === 0 && <p style={{ textAlign: 'center', color: 'var(--text-mute)', fontSize: '14px', padding: '10px' }}>אין תוצאות לחיפוש</p>}
          </div>
        </div>
      )}
    </div>
  )
}
