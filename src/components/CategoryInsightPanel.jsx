import { useMemo, useState } from 'react'
import { filterByPath, childrenBreakdown, vendorBreakdown, timeSeries } from '../lib/itemAggregation'
import { nodeKpis, multiSupplierProducts, productPriceTrend, filterByRange, pathNames } from '../lib/categoryStats'
import CategoryDonut from './charts/CategoryDonut'
import TimeSeriesChart from './charts/TimeSeriesChart'
import { Store, Receipt, TrendingDown, ChevronDown, ChevronRight, ExternalLink, Layers } from 'lucide-react'

const fmtILS  = n => `₪${Math.round(Number(n) || 0).toLocaleString('he-IL')}`
const fmtILS2 = n => `₪${(Number(n) || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDate = d => d ? new Date(d).toLocaleDateString('he-IL') : '—'

const RANGES = [{ id: 'all', label: 'הכל' }, { id: 'year', label: 'השנה' }, { id: 'month', label: 'החודש' }]
const GRANS  = [{ id: 'month', label: 'חודשי' }, { id: 'quarter', label: 'רבעוני' }, { id: 'year', label: 'שנתי' }]
const LEVEL_LABEL = { 1: 'קטגוריה', 2: 'תת-קטגוריה', 3: 'תת-תת-קטגוריה' }

function Seg({ options, value, onChange }) {
  return (
    <div style={{ display: 'inline-flex', gap: 3, background: 'var(--panel-2)', borderRadius: 9, padding: 3 }}>
      {options.map(o => (
        <button key={o.id} onClick={() => onChange(o.id)}
          style={{ padding: '5px 12px', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-main)', fontSize: 12.5,
            fontWeight: value === o.id ? 700 : 500, background: value === o.id ? 'var(--accent)' : 'transparent', color: value === o.id ? '#fff' : 'var(--text-dim)' }}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Kpi({ label, value, sub }) {
  return (
    <div style={{ flex: '1 1 90px', minWidth: 0, background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '9px 11px' }}>
      <div style={{ fontSize: 11, color: 'var(--text-mute)', fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-main)', fontSize: 18, fontWeight: 700, color: 'var(--text)', lineHeight: 1.15, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-mute)', marginTop: 1 }}>{sub}</div>}
    </div>
  )
}

export default function CategoryInsightPanel({ node, path, flatItems, onJumpVendor, onJumpReceipts }) {
  const [range, setRange]   = useState('all')
  const [pieMode, setPieMode] = useState('sub')   // 'sub' | 'vendor'
  const [gran, setGran]     = useState('month')
  const [openProduct, setOpenProduct] = useState(null)

  const rangeItems = useMemo(() => filterByRange(flatItems, range), [flatItems, range])
  const totalAll   = useMemo(() => rangeItems.reduce((s, it) => s + it.price, 0), [rangeItems])
  const scoped     = useMemo(() => filterByPath(rangeItems, path || []), [rangeItems, path])
  const kpis       = useMemo(() => nodeKpis(scoped, totalAll), [scoped, totalAll])
  const subRows    = useMemo(() => childrenBreakdown(scoped, path || []).rows, [scoped, path])
  const vendorRows = useMemo(() => vendorBreakdown(scoped, path || []), [scoped, path])
  const multi      = useMemo(() => multiSupplierProducts(scoped), [scoped])
  const trend      = useMemo(() => timeSeries(rangeItems, path || [], gran), [rangeItems, path, gran])

  const pieData  = pieMode === 'vendor' ? vendorRows : subRows
  const pieTotal = useMemo(() => pieData.reduce((s, d) => s + d.total, 0), [pieData])

  if (!node) {
    return (
      <div style={{ fontFamily: 'var(--font-main)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: 'var(--text-mute)', padding: '48px 20px', height: '100%' }}>
        <Layers size={40} style={{ opacity: 0.25, marginBottom: 12 }} />
        <p style={{ fontWeight: 600, color: 'var(--text)', fontSize: 15, margin: 0 }}>בחר קטגוריה</p>
        <p style={{ fontSize: 13, marginTop: 6 }}>לחיצה על קטגוריה תציג כאן ניתוח הוצאות, התפלגות, והשוואת ספקים.</p>
      </div>
    )
  }

  const crumbs = pathNames(path)
  const subEmpty = childrenBreakdown(scoped, path || []).dim === null

  return (
    <div dir="rtl" style={{ fontFamily: 'var(--font-main)', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div>
        <div style={{ fontSize: 11.5, color: 'var(--text-mute)', marginBottom: 3 }}>
          {crumbs.length > 1 ? crumbs.slice(0, -1).join(' › ') + ' › ' : ''}
          <span style={{ background: 'var(--accent-bg)', color: 'var(--accent)', borderRadius: 999, padding: '1px 8px', fontWeight: 600 }}>{LEVEL_LABEL[node.level] || 'קטגוריה'}</span>
        </div>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-main)', fontSize: 21, fontWeight: 700, color: 'var(--text)' }}>{node.name}</h2>
      </div>

      {/* Range */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <Seg options={RANGES} value={range} onChange={setRange} />
        <button onClick={() => onJumpReceipts?.(node.name)}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text-dim)', fontSize: 12.5, cursor: 'pointer', fontFamily: 'var(--font-main)' }}>
          <Receipt size={13} /> קבלות
        </button>
      </div>

      {scoped.length === 0 ? (
        <p style={{ textAlign: 'center', color: 'var(--text-mute)', padding: '28px 0', fontSize: 14 }}>אין נתונים בטווח הזמן שנבחר</p>
      ) : (<>
        {/* KPIs */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Kpi label="סה״כ" value={fmtILS(kpis.total)} sub={`${kpis.sharePct}% מההוצאות`} />
          <Kpi label="קבלות" value={kpis.receipts} sub={`${kpis.items} פריטים`} />
          <Kpi label="ספקים" value={kpis.suppliers} />
          <Kpi label="ממוצע/קבלה" value={fmtILS(kpis.avg)} />
          <Kpi label="רכישה אחרונה" value={fmtDate(kpis.lastDate)} />
        </div>

        {/* Pie */}
        <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 14px 6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>התפלגות</span>
            <Seg options={[{ id: 'sub', label: 'תתי-קטגוריות' }, { id: 'vendor', label: 'ספקים' }]} value={pieMode} onChange={setPieMode} />
          </div>
          {pieData.length > 0 && !(pieMode === 'sub' && subEmpty)
            ? <CategoryDonut data={pieData} total={pieTotal} selected={null}
                onSelect={name => { if (pieMode === 'vendor' && name) onJumpVendor?.(name) }} />
            : <p style={{ textAlign: 'center', color: 'var(--text-mute)', padding: '20px 0', fontSize: 13 }}>{pieMode === 'sub' ? 'אין תתי-קטגוריות לפילוח' : 'אין ספקים'}</p>}
        </div>

        {/* Multi-supplier products */}
        {multi.length > 0 && (
          <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 14, padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
              <TrendingDown size={16} color="var(--ok)" />
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>מוצרים מרובי-ספקים — איפה זול יותר</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {multi.slice(0, 8).map(p => {
                const isOpen = openProduct === p.product
                const priceTrend = isOpen ? productPriceTrend(scoped, p.product, gran) : null
                return (
                  <div key={p.product} style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                    <button onClick={() => setOpenProduct(isOpen ? null : p.product)}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', background: isOpen ? 'var(--panel-2)' : 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-main)', textAlign: 'right' }}>
                      {isOpen ? <ChevronDown size={14} color="var(--text-mute)" /> : <ChevronRight size={14} color="var(--text-mute)" />}
                      <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.product}</span>
                      {p.savingsPct > 0 && (
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ok)', background: 'rgba(22,163,74,0.12)', borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' }}>
                          חיסכון ~{p.savingsPct}%
                        </span>
                      )}
                    </button>
                    {/* recommendation */}
                    <div style={{ padding: '0 11px 9px', fontSize: 12.5, color: 'var(--text-dim)' }}>
                      הכי זול אצל <strong style={{ color: 'var(--accent)' }}>{p.cheapest}</strong>
                      {p.savingsAbs > 0 && <> — חוסך ~{fmtILS2(p.savingsAbs)} ליחידה לעומת {p.priciest}</>}
                    </div>
                    {/* vendor rows */}
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {p.vendors.map((v, i) => (
                        <button key={v.name} onClick={() => onJumpVendor?.(v.name)}
                          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 11px', borderTop: '1px solid var(--border)', background: i === 0 ? 'rgba(22,163,74,0.06)' : 'transparent', border: 'none', borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: 'var(--border)', cursor: 'pointer', fontFamily: 'var(--font-main)', textAlign: 'right' }}>
                          <Store size={13} color={i === 0 ? 'var(--ok)' : 'var(--text-mute)'} />
                          <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: i === 0 ? 700 : 500, color: i === 0 ? 'var(--ok)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.name}</span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>{fmtILS2(v.unitPrice)}<span style={{ fontSize: 10.5, color: 'var(--text-mute)', fontWeight: 400 }}> /יח׳</span></span>
                          <span style={{ fontSize: 11, color: 'var(--text-mute)', whiteSpace: 'nowrap', minWidth: 40, textAlign: 'left' }}>{v.count}×</span>
                          <ExternalLink size={11} color="var(--text-mute)" />
                        </button>
                      ))}
                    </div>
                    {/* price trend */}
                    {isOpen && priceTrend && priceTrend.length > 1 && (
                      <div style={{ padding: '8px 8px 4px', borderTop: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 11.5, color: 'var(--text-mute)', padding: '0 4px 4px' }}>מגמת מחיר ליחידה</div>
                        <TimeSeriesChart data={priceTrend} color="#7c3aed" chartType="line" />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Spend over time */}
        {trend.length > 1 && (
          <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 14, padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>הוצאה לאורך זמן</span>
              <Seg options={GRANS} value={gran} onChange={setGran} />
            </div>
            <TimeSeriesChart data={trend} color="#2563eb" chartType="bar" />
          </div>
        )}
      </>)}
    </div>
  )
}
