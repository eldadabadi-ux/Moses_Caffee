import { useState, useMemo } from 'react'
import { ChevronLeft, Home, Search, Store } from 'lucide-react'
import { childrenBreakdown, timeSeries, filterByPath, vendorBreakdown, DIM_LABEL } from '../lib/itemAggregation'
import TimeSeriesChart from './charts/TimeSeriesChart'
import ChartTypeToggle from './charts/ChartTypeToggle'

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
  const [path, setPath]   = useState([])   // [{ dim, value }] — dim can be l1/l2/l3/name OR 'vendor'
  const [gran, setGran]   = useState('month')
  const [search, setSearch] = useState('')
  const [chartType, setChartType] = useState('bar')

  const { dim: childDim, rows: childrenRaw } = useMemo(() => childrenBreakdown(items, path), [items, path])
  const children = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? childrenRaw.filter(c => c.name.toLowerCase().includes(q)) : childrenRaw
  }, [childrenRaw, search])
  const vendors  = useMemo(() => vendorBreakdown(items, path), [items, path])
  const series   = useMemo(() => timeSeries(items, path, gran), [items, path, gran])
  const scopedTotal = useMemo(() => filterByPath(items, path).reduce((s, it) => s + it.price, 0), [items, path])

  const hasVendor = path.some(p => p.dim === 'vendor')
  const atLeaf = !childDim
  const maxChild = Math.max(...children.map(c => c.total), 1)
  const maxVendor = Math.max(...vendors.map(v => v.total), 1)
  const currentLabel = path.length ? path[path.length - 1].value : 'הכל'

  function drillInto(name) { if (childDim) { setPath([...path, { dim: childDim, value: name }]); setSearch('') } }
  function drillVendor(name) { setPath([...path, { dim: 'vendor', value: name }]); setSearch('') }
  function goTo(idx) { setPath(path.slice(0, idx)); setSearch('') }

  // Show the vendor panel only while no vendor is chosen yet. At a product leaf
  // it becomes a price-comparison across the suppliers of that product.
  const showVendors = vendors.length > 0 && !hasVendor && (atLeaf ? vendors.length >= 1 : true)
  const vendorTitle = atLeaf
    ? (vendors.length >= 2 ? `מחיר אצל כל ספק (${vendors.length}) — לחץ לפירוט` : 'ספק')
    : (path.length === 0 ? 'כניסה לפי ספק — לחץ כדי לראות מה נרכש אצלו' : `ספקים בקטגוריה (${vendors.length}) — לחץ לכניסה`)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 }} dir="rtl">

      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', fontSize: '14px' }}>
        <button onClick={() => goTo(0)} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: path.length === 0 ? 'var(--accent-bg)' : 'transparent', color: path.length === 0 ? 'var(--accent)' : 'var(--text-dim)', border: 'none', borderRadius: '7px', padding: '5px 10px', cursor: 'pointer', fontFamily: 'var(--font-main)', fontWeight: 600 }}>
          <Home size={14} /> הכל
        </button>
        {path.map((p, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <ChevronLeft size={14} style={{ color: 'var(--text-mute)' }} />
            <button onClick={() => goTo(i + 1)} style={{ display: 'flex', alignItems: 'center', gap: '5px', background: i === path.length - 1 ? 'var(--accent-bg)' : 'transparent', color: i === path.length - 1 ? 'var(--accent)' : 'var(--text-dim)', border: 'none', borderRadius: '7px', padding: '5px 10px', cursor: 'pointer', fontFamily: 'var(--font-main)', fontWeight: 600, fontSize: '14px' }}>
              {p.dim === 'vendor' && <Store size={13} />}
              {p.value}
            </button>
          </span>
        ))}
      </div>

      {/* Scoped total + granularity */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ fontSize: '15px', color: 'var(--text-mute)' }}>
          {currentLabel} · <span style={{ color: 'var(--ok)', fontWeight: 700, fontSize: '17px' }}>{fmtILS(scopedTotal)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
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
      </div>

      {/* Time series */}
      {series.length > 0
        ? <TimeSeriesChart data={series} color={hasVendor ? '#7c3aed' : COLORS[path.length % COLORS.length]} chartType={chartType} />
        : <p style={{ textAlign: 'center', color: 'var(--text-mute)', padding: '20px 0', fontSize: '15px' }}>אין נתונים לתקופה</p>}

      {/* Vendor breakdown — click a vendor to ENTER it and see what was bought there.
          At a product leaf this is a price comparison across that product's suppliers. */}
      {showVendors && (
        <div style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: '12px', padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
            <Store size={15} style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)' }}>{vendorTitle}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {vendors.map((v) => {
              const pct = (v.total / maxVendor) * 100
              return (
                <button key={v.name} onClick={() => drillVendor(v.name)}
                  style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%', minWidth: 0, padding: '9px 12px', borderRadius: '9px', cursor: 'pointer', fontFamily: 'var(--font-main)', textAlign: 'right',
                    border: '1px solid var(--border)', background: 'var(--panel)', transition: 'background 120ms' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-bg)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'var(--panel)'}>
                  {/* name + amount */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                    <Store size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: '15px', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.name}</span>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--ok)', flexShrink: 0, whiteSpace: 'nowrap' }}>{fmtILS(v.total)}</span>
                    <ChevronLeft size={16} style={{ color: 'var(--text-mute)', flexShrink: 0 }} />
                  </div>
                  {/* bar + count */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                    <div style={{ flex: 1, minWidth: 0, height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: '#60a5fa', borderRadius: 3 }} />
                    </div>
                    <span style={{ fontSize: '12.5px', color: 'var(--text-mute)', flexShrink: 0, whiteSpace: 'nowrap' }}>{v.count} רכישות</span>
                  </div>
                </button>
              )
            })}
          </div>
          <p style={{ margin: '8px 2px 0', fontSize: '12px', color: 'var(--text-mute)' }}>
            {atLeaf ? 'לחץ על ספק כדי לראות את הרכישות של המוצר ממנו בלבד.' : 'לחץ על ספק כדי להיכנס ולראות אילו מוצרים נרכשו אצלו.'}
          </p>
        </div>
      )}

      {/* Children — drill deeper. Adaptive level (category / sub / product). */}
      {!atLeaf && childrenRaw.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '8px', flexWrap: 'wrap' }}>
            <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--text-mute)' }}>
              {hasVendor && <Store size={13} style={{ verticalAlign: '-2px', marginInlineEnd: 4, color: 'var(--accent)' }} />}
              {DIM_LABEL[childDim]}{hasVendor ? ` של ${path.find(p => p.dim === 'vendor').value}` : ''} · לחץ כדי להעמיק
            </p>
            {childrenRaw.length > 6 && (
              <div style={{ position: 'relative', flex: '0 1 220px' }}>
                <Search size={14} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-mute)', pointerEvents: 'none' }} />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder={`חיפוש ${DIM_LABEL[childDim]}…`} dir="rtl"
                  style={{ width: '100%', height: 38, padding: '0 32px 0 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text)', fontSize: '14px', fontFamily: 'var(--font-main)', outline: 'none', boxSizing: 'border-box' }} />
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: 380, overflowY: 'auto', overflowX: 'hidden' }}>
            {children.map((c, i) => {
              const pct = (c.total / maxChild) * 100
              const color = COLORS[i % COLORS.length]
              return (
                <button key={c.name} onClick={() => drillInto(c.name)}
                  style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%', minWidth: 0, padding: '10px 14px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--panel-2)', cursor: 'pointer', fontFamily: 'var(--font-main)', textAlign: 'right', transition: 'background 120ms' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--panel)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'var(--panel-2)'}>
                  {/* dot + name + amount + chevron */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '9px', minWidth: 0 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: '15px', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                    <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--ok)', flexShrink: 0, whiteSpace: 'nowrap' }}>{fmtILS(c.total)}</span>
                    <ChevronLeft size={16} style={{ color: 'var(--text-mute)', flexShrink: 0 }} />
                  </div>
                  {/* bar + count */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                    <div style={{ flex: 1, minWidth: 0, height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3 }} />
                    </div>
                    <span style={{ fontSize: '12.5px', color: 'var(--text-mute)', flexShrink: 0, whiteSpace: 'nowrap' }}>{c.count} פריטים</span>
                  </div>
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
