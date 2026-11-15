/**
 * SupplierComparePage — "השוואת ספקים" in its own clean screen (client request
 * 15.11.26: the comparison moved out of the dashboard's bottom scroll into a
 * dedicated page that contains only it). Pick two suppliers, optionally focus on
 * specific products, and compare monthly spend / product spend side by side.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useSettings } from '../hooks/useSettings'
import { getCached, hasCached } from '../lib/pageCache'
import { loadYearReceipts, loadDashMeta } from '../lib/dashboardData'
import { flattenItems, vendorComposition } from '../lib/itemAggregation'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import MonthlyBars from '../components/charts/MonthlyBars'
import ProductCompareChart from '../components/charts/ProductCompareChart'
import ChartTypeToggle from '../components/charts/ChartTypeToggle'
import MultiSelect from '../components/MultiSelect'
import { Equal, Calendar } from 'lucide-react'

const fmtILS = n => `₪${Math.round(n).toLocaleString('he-IL')}`

export default function SupplierComparePage() {
  const { user } = useAuth()
  const { settings, displayAmount } = useSettings()
  const isMobile = window.innerWidth < 768
  const thisYear = new Date().getFullYear()
  const amt = (r) => displayAmount(parseFloat(r.amount) || 0, r.amount_before_vat)

  const [year, setYear] = useState(thisYear)
  const [receipts, setReceipts] = useState(() => getCached('dashyr:' + thisYear) || [])
  const [supplierRows, setSupplierRows] = useState(() => getCached('dash:meta')?.suppliers || [])
  const [availYears, setAvailYears] = useState(() => getCached('dash:meta')?.availYears || [thisYear])
  const [loading, setLoading] = useState(() => !hasCached('dashyr:' + thisYear))
  const [vendorA, setVendorA] = useState('')
  const [vendorB, setVendorB] = useState('')
  const [selProdsA, setSelProdsA] = useState([])
  const [selProdsB, setSelProdsB] = useState([])
  const [chartType, setChartType] = useState('bar')

  useEffect(() => {
    if (!user) return
    let alive = true
    async function load() {
      if (!hasCached('dashyr:' + year) && receipts.length === 0) setLoading(true)
      try {
        const [recs, meta] = await Promise.all([loadYearReceipts(user.id, year), loadDashMeta(user.id, thisYear)])
        if (!alive) return
        setReceipts(recs)
        setSupplierRows(meta.suppliers)
        setAvailYears(meta.availYears.includes(year) ? meta.availYears : [...meta.availYears, year].sort((a, b) => b - a))
      } catch (err) { console.error('Supplier compare load error:', err) }
      finally { if (alive) setLoading(false) }
    }
    load()
    return () => { alive = false }
  }, [user, year])  // eslint-disable-line react-hooks/exhaustive-deps

  // Display name for a receipt's supplier: the canonical one when the receipt is
  // linked, otherwise whatever the scan wrote (same rule as the dashboard).
  const canonicalById = useMemo(
    () => Object.fromEntries((supplierRows || []).map(s => [s.id, (s.name || '').trim()])),
    [supplierRows])
  const supplierNameOf = useCallback((r) => {
    const raw = (r.vendor_name || '').trim()
    return (r.supplier_id && canonicalById[r.supplier_id]) || raw
  }, [canonicalById])

  const allVendors = useMemo(() => {
    const set = new Set(receipts.map(supplierNameOf).filter(Boolean))
    return [...set].sort((a, b) => a.localeCompare(b, 'he'))
  }, [receipts, supplierNameOf])

  // Flattened items for the whole year — drives product picking.
  const flatAll = useMemo(() => flattenItems(receipts), [receipts])

  // Line items still carry the RAW scanned vendor string, so a merged supplier's
  // composition has to gather every spelling filed under it.
  const rawNamesFor = useCallback((displayName) => {
    const set = new Set([displayName])
    for (const r of receipts) if (supplierNameOf(r) === displayName) set.add((r.vendor_name || '').trim())
    return [...set].filter(Boolean)
  }, [receipts, supplierNameOf])

  const compA = useMemo(() => vendorA ? vendorComposition(flatAll, vendorA, rawNamesFor(vendorA)) : null, [vendorA, flatAll, rawNamesFor])
  const compB = useMemo(() => vendorB ? vendorComposition(flatAll, vendorB, rawNamesFor(vendorB)) : null, [vendorB, flatAll, rawNamesFor])

  function monthlyForVendor(name) {
    const map = {}
    receipts.filter(r => supplierNameOf(r) === name).forEach(r => {
      if (!r.receipt_date) return
      const m = parseInt(r.receipt_date.slice(5, 7))
      if (!map[m]) map[m] = { month: m, total: 0, count: 0 }
      map[m].total += amt(r); map[m].count += 1
    })
    return Array.from({ length: 12 }, (_, i) => map[i + 1] || { month: i + 1, total: 0, count: 0 })
  }
  function vendorStats(name) {
    const rows = receipts.filter(r => supplierNameOf(r) === name)
    const total = rows.reduce((s, r) => s + amt(r), 0)
    return { total, count: rows.length, avg: rows.length ? total / rows.length : 0 }
  }
  const cmpA = useMemo(() => vendorA ? monthlyForVendor(vendorA) : null, [vendorA, receipts, settings.showWithVat])  // eslint-disable-line react-hooks/exhaustive-deps
  const cmpB = useMemo(() => vendorB ? monthlyForVendor(vendorB) : null, [vendorB, receipts, settings.showWithVat])  // eslint-disable-line react-hooks/exhaustive-deps

  // Products chosen for comparison (union of A's and B's picks). Empty = overall.
  const compareProducts = useMemo(() => {
    const names = [...new Set([...selProdsA, ...selProdsB])]
    const aMap = Object.fromEntries((compA?.rows || []).map(r => [r.name, r.total]))
    const bMap = Object.fromEntries((compB?.rows || []).map(r => [r.name, r.total]))
    return names
      .map(n => ({ name: n, a: aMap[n] || 0, b: bMap[n] || 0 }))
      .sort((x, y) => (y.a + y.b) - (x.a + x.b))
  }, [selProdsA, selProdsB, compA, compB])

  if (loading && receipts.length === 0) return <LoadingSpinner />

  return (
    <div className="animate-fade-in" dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: isMobile ? '23px' : '26px', fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Equal size={24} color="var(--accent)" /> השוואת ספקים
          </h1>
          <p style={{ margin: '2px 0 0', fontSize: '15px', color: 'var(--text-mute)' }}>
            בחר שני ספקים. תחת כל אחד בחר מוצרים להשוואה ממוקדת — או השאר ריק להשוואת הוצאה כללית.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Year picker */}
          <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
            <Calendar size={13} style={{ position: 'absolute', right: 10, color: 'var(--text-mute)', pointerEvents: 'none' }} />
            <select value={year} onChange={e => setYear(+e.target.value)}
              style={{ height: 36, paddingRight: 30, paddingLeft: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text)', fontSize: '13px', fontFamily: 'var(--font-main)', outline: 'none', cursor: 'pointer' }}>
              {availYears.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <ChartTypeToggle value={chartType} onChange={setChartType} />
        </div>
      </div>

      <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '16px', boxShadow: 'var(--shadow-card)', padding: isMobile ? '16px 14px' : '20px 22px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '14px', marginBottom: '16px' }}>
          {/* Vendor A */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#2563eb', marginBottom: '6px' }}>ספק א'</label>
              <select value={vendorA} onChange={e => { setVendorA(e.target.value); setSelProdsA([]) }}
                style={{ width: '100%', height: 42, padding: '0 12px', borderRadius: 8, border: `1px solid ${vendorA ? '#2563eb' : 'var(--border)'}`, background: 'var(--panel)', color: 'var(--text)', fontSize: '15px', fontFamily: 'var(--font-main)' }}>
                <option value="">בחר ספק…</option>
                {allVendors.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            {vendorA && <MultiSelect label="מוצרים מספק א'" options={compA?.rows || []} value={selProdsA} onChange={setSelProdsA} accent="#2563eb" />}
          </div>
          {/* Vendor B */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#f59e0b', marginBottom: '6px' }}>ספק ב'</label>
              <select value={vendorB} onChange={e => { setVendorB(e.target.value); setSelProdsB([]) }}
                style={{ width: '100%', height: 42, padding: '0 12px', borderRadius: 8, border: `1px solid ${vendorB ? '#f59e0b' : 'var(--border)'}`, background: 'var(--panel)', color: 'var(--text)', fontSize: '15px', fontFamily: 'var(--font-main)' }}>
                <option value="">בחר ספק…</option>
                {allVendors.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            {vendorB && <MultiSelect label="מוצרים מספק ב'" options={compB?.rows || []} value={selProdsB} onChange={setSelProdsB} accent="#f59e0b" />}
          </div>
        </div>

        {(vendorA || vendorB) ? (
          <>
            {compareProducts.length > 0 ? (
              /* Focused product comparison */
              <ProductCompareChart products={compareProducts} labelA={vendorA || "ספק א'"} labelB={vendorB || "ספק ב'"} colorA="#2563eb" colorB="#f59e0b" chartType={chartType} />
            ) : (
              /* Overall monthly comparison */
              <MonthlyBars
                data={cmpA || Array.from({ length: 12 }, (_, i) => ({ month: i + 1, total: 0, count: 0 }))}
                compareData={cmpB || Array.from({ length: 12 }, (_, i) => ({ month: i + 1, total: 0, count: 0 }))}
                year={vendorA || 'ספק א'} compareYear={vendorB || 'ספק ב'} chartType={chartType}
              />
            )}
            {/* Comparison stats table */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '16px' }}>
              {[{ n: vendorA, c: '#2563eb' }, { n: vendorB, c: '#f59e0b' }].map(({ n, c }, idx) => {
                if (!n) return <div key={idx} style={{ minWidth: 0, padding: '14px', borderRadius: 12, border: '1px dashed var(--border)', color: 'var(--text-mute)', fontSize: '14px', textAlign: 'center' }}>לא נבחר ספק</div>
                const s = vendorStats(n)
                return (
                  <div key={idx} style={{ minWidth: 0, padding: '14px 16px', borderRadius: 12, border: `1px solid var(--border)`, borderTop: `3px solid ${c}`, background: 'var(--panel-2)' }}>
                    <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text)', marginBottom: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={n}>{n}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: 'var(--text-dim)', marginBottom: '4px' }}><span>סה"כ</span><strong style={{ color: 'var(--ok)' }}>{fmtILS(s.total)}</strong></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: 'var(--text-dim)', marginBottom: '4px' }}><span>קבלות</span><strong>{s.count}</strong></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: 'var(--text-dim)' }}><span>ממוצע לקבלה</span><strong>{fmtILS(s.avg)}</strong></div>
                  </div>
                )
              })}
            </div>
          </>
        ) : (
          <p style={{ textAlign: 'center', color: 'var(--text-mute)', padding: '24px 0', fontSize: '15px' }}>בחר ספק אחד או שניים כדי להשוות</p>
        )}
      </div>
    </div>
  )
}
