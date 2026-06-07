import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useSettings } from '../hooks/useSettings'
import { BarChart2, TrendingUp, TrendingDown, Receipt, Calendar, Tag, X, ChevronDown } from 'lucide-react'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import MonthlyBars   from '../components/charts/MonthlyBars'
import CategoryDonut, { COLORS } from '../components/charts/CategoryDonut'
import CategoryDrilldown from '../components/CategoryDrilldown'
import ChartTypeToggle from '../components/charts/ChartTypeToggle'
import MultiSelect from '../components/MultiSelect'
import ProductCompareChart from '../components/charts/ProductCompareChart'
import { flattenItems, vendorComposition } from '../lib/itemAggregation'

const HEB_MONTHS_FULL = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר']
const fmtILS = n => `₪${Math.round(n).toLocaleString('he-IL')}`
const fmtILSFull = n => `₪${parseFloat(n || 0).toLocaleString('he-IL', { minimumFractionDigits: 2 })}`

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, icon: Icon, color, trend }) {
  const isMobile = window.innerWidth < 768
  return (
    <div style={{
      background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '14px',
      padding: isMobile ? '14px 16px' : '18px 22px', boxShadow: 'var(--shadow-card)',
      display: 'flex', flexDirection: 'column', gap: '6px',
      flex: '1 1 140px', minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
        {Icon && <div style={{ width: 34, height: 34, borderRadius: '8px', background: color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={17} color={color} />
        </div>}
      </div>
      <div style={{ fontSize: isMobile ? '26px' : '30px', fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.02em', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: '14px', color: 'var(--text-mute)' }}>{sub}</div>}
      {trend != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '15px', fontWeight: 600, color: trend >= 0 ? 'var(--ok)' : 'var(--danger)' }}>
          {trend >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
          {trend >= 0 ? '+' : ''}{Math.round(trend)}% מהשנה הקודמת
        </div>
      )}
    </div>
  )
}

// ── Section wrapper ───────────────────────────────────────────────────────────
function Section({ title, sub, children, action, id }) {
  return (
    <div id={id} style={{ scrollMarginTop: '76px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '16px', boxShadow: 'var(--shadow-card)', overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--text)' }}>{title}</h3>
          {sub && <p style={{ margin: '2px 0 0', fontSize: '14px', color: 'var(--text-mute)' }}>{sub}</p>}
        </div>
        {action}
      </div>
      <div style={{ padding: '18px 20px' }}>{children}</div>
    </div>
  )
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { user } = useAuth()
  const { settings, displayAmount, toggleVatDisplay } = useSettings()
  const isMobile = window.innerWidth < 768
  const thisYear = new Date().getFullYear()
  // Amount of a receipt respecting the with/without-VAT display preference
  const amt = (r) => displayAmount(parseFloat(r.amount) || 0, r.amount_before_vat)

  const [receipts,    setReceipts]    = useState([])
  const [prevReceipts,setPrevReceipts]= useState([])
  const [categories,  setCategories]  = useState([])
  const [loading,     setLoading]     = useState(true)
  const [year,        setYear]        = useState(thisYear)
  const [compareYear, setCompareYear] = useState(null)
  const [filterCat,   setFilterCat]   = useState(null)  // L1 category name filter
  const [distMode,    setDistMode]    = useState('cat') // distribution donut: 'cat' | 'vendor'
  const [selVendor,   setSelVendor]   = useState(null)  // highlighted vendor slice (local)
  const [availYears,  setAvailYears]  = useState([thisYear])
  const [vendorA,     setVendorA]     = useState('')    // vendor comparison
  const [vendorB,     setVendorB]     = useState('')
  const [selProdsA,   setSelProdsA]   = useState([])    // products picked for vendor A
  const [selProdsB,   setSelProdsB]   = useState([])    // products picked for vendor B
  const [chartType,   setChartType]   = useState('bar') // 'bar' | 'line' for time charts

  // ── Load data ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return
    async function load() {
      setLoading(true)
      try {
        // Current year (include items for drill-down)
        const { data: recs } = await supabase
          .from('receipts')
          .select('id, amount, receipt_date, category_id, category_text, vendor_name, items')
          .eq('user_id', user.id)
          .gte('receipt_date', `${year}-01-01`)
          .lte('receipt_date', `${year}-12-31`)
          .order('receipt_date')

        // Previous year (for YoY)
        const { data: prevRecs } = await supabase
          .from('receipts')
          .select('id, amount, receipt_date, category_id, category_text, vendor_name')
          .eq('user_id', user.id)
          .gte('receipt_date', `${year - 1}-01-01`)
          .lte('receipt_date', `${year - 1}-12-31`)

        // Categories
        const { data: cats } = await supabase
          .from('categories')
          .select('id, name, parent_id, level, sort_order')
          .order('level').order('sort_order')

        // Available years
        const { data: allDates } = await supabase
          .from('receipts')
          .select('receipt_date')
          .eq('user_id', user.id)
          .not('receipt_date', 'is', null)
        const years = [...new Set((allDates || []).map(r => parseInt(r.receipt_date.slice(0, 4))))].filter(Boolean).sort((a, b) => b - a)
        if (!years.includes(year)) years.unshift(year)

        setReceipts(recs || [])
        setPrevReceipts(prevRecs || [])
        setCategories(cats || [])
        setAvailYears(years.length ? years : [thisYear])
      } catch (err) {
        console.error('Dashboard load error:', err)
      } finally { setLoading(false) }
    }
    load()
  }, [user, year])

  // ── Active receipts (applying the category filter) ───────────────────────────
  const active = useMemo(() => receipts.filter(r => {
    if (filterCat && r.category_text !== filterCat) return false
    return true
  }), [receipts, filterCat])

  const total     = useMemo(() => active.reduce((s, r) => s + amt(r), 0), [active, settings.showWithVat])
  const totalPrev = useMemo(() => prevReceipts.reduce((s, r) => s + amt(r), 0), [prevReceipts, settings.showWithVat])
  const yoy       = totalPrev > 0 ? ((total - totalPrev) / totalPrev) * 100 : null

  // Flattened line-items for the drill-down (item-level L1→L2→L3 over time)
  const flatItems = useMemo(() => flattenItems(active), [active])

  const avgMonthly = useMemo(() => {
    const months = new Set(active.map(r => r.receipt_date?.slice(0, 7)).filter(Boolean))
    return months.size > 0 ? total / months.size : 0
  }, [active, total])

  // ── Monthly aggregation ───────────────────────────────────────────────────────
  const monthlyData = useMemo(() => {
    const map = {}
    active.forEach(r => {
      if (!r.receipt_date) return
      const m = parseInt(r.receipt_date.slice(5, 7))
      if (!map[m]) map[m] = { month: m, total: 0, count: 0 }
      map[m].total += amt(r)
      map[m].count += 1
    })
    return Array.from({ length: 12 }, (_, i) => map[i + 1] || { month: i + 1, total: 0, count: 0 })
  }, [active, settings.showWithVat])

  const prevMonthlyData = useMemo(() => {
    if (!compareYear) return null
    const src = compareYear === year - 1 ? prevReceipts : []
    const map = {}
    src.forEach(r => {
      if (!r.receipt_date) return
      const m = parseInt(r.receipt_date.slice(5, 7))
      if (!map[m]) map[m] = { month: m, total: 0, count: 0 }
      map[m].total += amt(r)
      map[m].count += 1
    })
    return Array.from({ length: 12 }, (_, i) => map[i + 1] || { month: i + 1, total: 0, count: 0 })
  }, [compareYear, prevReceipts, year, settings.showWithVat])

  // ── Category aggregation (L1) ────────────────────────────────────────────────
  const l1Cats = useMemo(() => categories.filter(c => c.level === 1), [categories])

  // Resolve a receipt's L1 category name (walk up the tree if it points to L2/L3).
  function resolveL1(r) {
    let catName = r.category_text || 'שונות'
    if (r.category_id) {
      const cat = categories.find(c => c.id === r.category_id)
      if (cat) {
        if (cat.level === 1) catName = cat.name
        else if (cat.level === 2) { const p = categories.find(c => c.id === cat.parent_id); if (p) catName = p.name }
        else if (cat.level === 3) { const p2 = categories.find(c => c.id === cat.parent_id); const p1 = p2 ? categories.find(c => c.id === p2.parent_id) : null; if (p1) catName = p1.name }
      }
    }
    return catName
  }
  function aggregateL1(list) {
    const map = {}
    list.forEach(r => {
      const n = resolveL1(r)
      if (!map[n]) map[n] = { name: n, total: 0, count: 0 }
      map[n].total += amt(r); map[n].count += 1
    })
    return Object.values(map).sort((a, b) => b.total - a.total)
      .map(d => ({ ...d, id: l1Cats.find(c => c.name === d.name)?.id }))
  }

  // Filtered view (both category + vendor filters) — used by the tree.
  const l1Data = useMemo(() => aggregateL1(active), [active, categories, l1Cats, settings.showWithVat])

  // ALL categories (ignores the category filter) — used by the donut + ranking +
  // dropdown, so selecting a category greys the others out instead of hiding them.
  const catScope = receipts
  const l1DataAll = useMemo(() => aggregateL1(catScope), [catScope, categories, l1Cats, settings.showWithVat])
  const totalAll  = useMemo(() => l1DataAll.reduce((s, c) => s + c.total, 0), [l1DataAll])

  // Stable colour per category — matches the donut's colour order.
  const catColor = useMemo(() => {
    const m = {}; l1DataAll.forEach((c, i) => { m[c.name] = COLORS[i % COLORS.length] }); return m
  }, [l1DataAll])
  // When a category is selected, the time charts adopt its colour.
  const selColor = filterCat ? (catColor[filterCat] || '#2563eb') : '#2563eb'

  // ── Vendor aggregation (full) — powers the optional "by vendor" distribution ──
  const vendorDist = useMemo(() => {
    const map = {}
    active.forEach(r => {
      const name = (r.vendor_name || '').trim() || 'לא ידוע'
      if (!map[name]) map[name] = { name, total: 0, count: 0 }
      map[name].total += amt(r)
      map[name].count += 1
    })
    return Object.values(map).sort((a, b) => b.total - a.total)
  }, [active, settings.showWithVat])
  const vendorTotal = useMemo(() => vendorDist.reduce((s, v) => s + v.total, 0), [vendorDist])
  // Cap to top 8 + "אחר" so the donut stays readable
  const vendorDonutData = useMemo(() => {
    if (vendorDist.length <= 9) return vendorDist
    const top = vendorDist.slice(0, 8)
    const rest = vendorDist.slice(8)
    return [...top, { name: 'אחר', total: rest.reduce((s, v) => s + v.total, 0), count: rest.reduce((s, v) => s + v.count, 0) }]
  }, [vendorDist])

  // ── Best month ────────────────────────────────────────────────────────────────
  const bestMonth = useMemo(() => {
    const m = monthlyData.reduce((best, d) => d.total > best.total ? d : best, { month: 0, total: 0 })
    return m.total > 0 ? HEB_MONTHS_FULL[m.month - 1] : null
  }, [monthlyData])

  // ── Vendor comparison (independent of the category/vendor dashboard filters) ───
  const allVendors = useMemo(() => {
    const set = new Set(receipts.map(r => (r.vendor_name || '').trim()).filter(Boolean))
    return [...set].sort((a, b) => a.localeCompare(b, 'he'))
  }, [receipts])

  // Flattened items for the whole year (ignores filters) — drives product picking.
  const flatAll = useMemo(() => flattenItems(receipts), [receipts])
  const compA = useMemo(() => vendorA ? vendorComposition(flatAll, vendorA) : null, [vendorA, flatAll])
  const compB = useMemo(() => vendorB ? vendorComposition(flatAll, vendorB) : null, [vendorB, flatAll])

  function monthlyForVendor(name) {
    const map = {}
    receipts.filter(r => (r.vendor_name || '').trim() === name).forEach(r => {
      if (!r.receipt_date) return
      const m = parseInt(r.receipt_date.slice(5, 7))
      if (!map[m]) map[m] = { month: m, total: 0, count: 0 }
      map[m].total += amt(r); map[m].count += 1
    })
    return Array.from({ length: 12 }, (_, i) => map[i + 1] || { month: i + 1, total: 0, count: 0 })
  }
  function vendorStats(name) {
    const rows = receipts.filter(r => (r.vendor_name || '').trim() === name)
    const total = rows.reduce((s, r) => s + amt(r), 0)
    return { total, count: rows.length, avg: rows.length ? total / rows.length : 0 }
  }
  const cmpA = useMemo(() => vendorA ? monthlyForVendor(vendorA) : null, [vendorA, receipts, settings.showWithVat])
  const cmpB = useMemo(() => vendorB ? monthlyForVendor(vendorB) : null, [vendorB, receipts, settings.showWithVat])

  // Products chosen for comparison (union of A's and B's picks). Empty = overall.
  const compareProducts = useMemo(() => {
    const names = [...new Set([...selProdsA, ...selProdsB])]
    const aMap = Object.fromEntries((compA?.rows || []).map(r => [r.name, r.total]))
    const bMap = Object.fromEntries((compB?.rows || []).map(r => [r.name, r.total]))
    return names
      .map(n => ({ name: n, a: aMap[n] || 0, b: bMap[n] || 0 }))
      .sort((x, y) => (y.a + y.b) - (x.a + x.b))
  }, [selProdsA, selProdsB, compA, compB])

  const hasFilters = filterCat

  // ── Distribution donut/ranking: switchable between category and vendor ────────
  const isVendorDist = distMode === 'vendor'
  const distDonut = isVendorDist ? vendorDonutData : l1DataAll   // capped for donut
  const distRank  = isVendorDist ? vendorDist : l1DataAll        // full list for ranking
  const distTotal = isVendorDist ? vendorTotal : totalAll
  const distSel   = isVendorDist ? selVendor : filterCat
  const distSetSel = isVendorDist ? setSelVendor : setFilterCat
  const distColorOf = (name) => { const i = distRank.findIndex(d => d.name === name); return i >= 0 ? COLORS[i % COLORS.length] : 'var(--accent)' }

  if (loading) return <LoadingSpinner />

  return (
    <div className="animate-fade-in" dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? '14px' : '20px' }}>

      {/* ── Header + Filters ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: isMobile ? '23px' : '26px', fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <BarChart2 size={24} color="var(--accent)" />
              דשבורד
            </h1>
            <p style={{ margin: '2px 0 0', fontSize: '15px', color: 'var(--text-mute)' }}>
              {active.length} קבלות · {fmtILSFull(total)} · {settings.showWithVat ? 'כולל מע"מ' : 'ללא מע"מ'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            {/* VAT display toggle */}
            <button onClick={toggleVatDisplay}
              style={{ height: 36, padding: '0 12px', borderRadius: 8, border: `1px solid ${settings.showWithVat ? 'var(--border)' : 'var(--accent)'}`, background: settings.showWithVat ? 'var(--panel)' : 'var(--accent-bg)', color: settings.showWithVat ? 'var(--text-dim)' : 'var(--accent)', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-main)', display: 'flex', alignItems: 'center', gap: 5 }}
              title='החלף בין כולל / ללא מע"מ'>
              <Receipt size={13} /> {settings.showWithVat ? 'כולל מע"מ' : 'ללא מע"מ'}
            </button>
            {/* Year picker */}
            <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
              <Calendar size={13} style={{ position: 'absolute', right: 10, color: 'var(--text-mute)', pointerEvents: 'none' }} />
              <select value={year} onChange={e => { setYear(+e.target.value); setFilterCat(null) }}
                style={{ height: 36, paddingRight: 30, paddingLeft: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text)', fontSize: '13px', fontFamily: 'var(--font-main)', outline: 'none', cursor: 'pointer' }}>
                {availYears.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            {/* Compare year */}
            {!isMobile && (
              <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                <select value={compareYear || ''} onChange={e => setCompareYear(e.target.value ? +e.target.value : null)}
                  style={{ height: 36, paddingRight: 12, paddingLeft: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text)', fontSize: '13px', fontFamily: 'var(--font-main)', outline: 'none', cursor: 'pointer' }}>
                  <option value="">השוואה: ללא</option>
                  {availYears.filter(y => y !== year).map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            )}
            {/* Category filter */}
            <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
              <Tag size={13} style={{ position: 'absolute', right: 10, color: 'var(--text-mute)', pointerEvents: 'none' }} />
              <select value={filterCat || ''} onChange={e => { setFilterCat(e.target.value || null) }}
                style={{ height: 36, paddingRight: 30, paddingLeft: 12, borderRadius: 8, border: `1px solid ${filterCat ? 'var(--accent)' : 'var(--border)'}`, background: filterCat ? 'var(--accent-bg)' : 'var(--panel)', color: filterCat ? 'var(--accent)' : 'var(--text)', fontSize: '13px', fontFamily: 'var(--font-main)', outline: 'none', cursor: 'pointer' }}>
                <option value="">כל הקטגוריות</option>
                {l1DataAll.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            </div>
            {/* Clear filters */}
            {hasFilters && (
              <button onClick={() => { setFilterCat(null) }}
                style={{ height: 36, padding: '0 12px', borderRadius: 8, border: '1px solid var(--danger)', background: '#fef2f2', color: 'var(--danger)', fontSize: '12.5px', cursor: 'pointer', fontFamily: 'var(--font-main)', display: 'flex', alignItems: 'center', gap: 5 }}>
                <X size={12} /> נקה
              </button>
            )}
          </div>
        </div>

        {/* Active filter pill */}
        {filterCat && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999, background: 'var(--accent-bg)', border: '1px solid var(--accent)', fontSize: '12px', color: 'var(--accent)' }}>
              <Tag size={10} /> {filterCat}
              <button onClick={() => setFilterCat(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--accent)', padding: 0, display: 'flex' }}><X size={10} /></button>
            </span>
          </div>
        )}
      </div>

      {/* ── KPI Cards ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: isMobile ? '10px' : '14px', flexWrap: 'wrap' }}>
        <KpiCard label="סה״כ הוצאות" value={fmtILS(total)} sub={`שנת ${year}`} icon={Receipt} color="var(--ok)" trend={yoy} />
        <KpiCard label="ממוצע חודשי" value={fmtILS(avgMonthly)} sub={bestMonth ? `חודש שיא: ${bestMonth}` : undefined} icon={Calendar} color="var(--accent)" />
        <KpiCard label="מספר קבלות" value={active.length} sub={`${active.filter(r => r.ai_extracted).length} נסרקו ב-AI`} icon={BarChart2} color="#7c3aed" />
        {!isMobile && <KpiCard label="קטגוריות פעילות" value={l1DataAll.length} sub={`${vendorDist.length} ספקים`} icon={Tag} color="#d97706" />}
      </div>

      {/* ── Empty state ───────────────────────────────────────────────────────── */}
      {active.length === 0 && (
        <div style={{ textAlign: 'center', padding: '64px 16px', color: 'var(--text-mute)' }}>
          <BarChart2 size={44} style={{ margin: '0 auto 14px', display: 'block', opacity: 0.25 }} />
          <p style={{ fontWeight: 600, color: 'var(--text)', fontSize: '15px' }}>אין נתונים לתצוגה</p>
          <p style={{ fontSize: '13px', marginTop: 6 }}>הוסף קבלות כדי לראות את הדשבורד</p>
        </div>
      )}

      {active.length > 0 && (<>

        {/* ── Monthly chart ─────────────────────────────────────────────────────── */}
        <Section
          id="dash-monthly"
          title={`הוצאות חודשיות — ${year}${compareYear ? ` מול ${compareYear}` : ''}`}
          sub={compareYear ? undefined : `סה"כ: ${fmtILS(total)}`}
          action={
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {compareYear && !isMobile && (
                <div style={{ display: 'flex', gap: 12, fontSize: '12px' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: '#2563eb', display: 'inline-block' }} />{year}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: '#f59e0b', display: 'inline-block' }} />{compareYear}
                  </span>
                </div>
              )}
              <ChartTypeToggle value={chartType} onChange={setChartType} />
            </div>
          }
        >
          <MonthlyBars data={monthlyData} compareData={prevMonthlyData} year={year} compareYear={compareYear} chartType={chartType} color={selColor} />
        </Section>

        {/* ── Distribution donut + ranking (by category OR by vendor) ───────────── */}
        <div id="dash-categories" style={{ scrollMarginTop: '76px', display: 'flex', flexDirection: 'column', gap: isMobile ? '12px' : '14px' }}>
          {/* Mode toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text-mute)' }}>התפלגות לפי:</span>
            <div style={{ display: 'flex', gap: 4, background: 'var(--panel-2)', borderRadius: 9, padding: 3 }}>
              {[{ id: 'cat', label: 'קטגוריה' }, { id: 'vendor', label: 'ספק' }].map(o => (
                <button key={o.id} onClick={() => { setDistMode(o.id); setSelVendor(null) }}
                  style={{ padding: '6px 16px', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-main)', fontSize: '13.5px', fontWeight: distMode === o.id ? 700 : 500,
                    background: distMode === o.id ? 'var(--accent)' : 'transparent', color: distMode === o.id ? '#fff' : 'var(--text-dim)' }}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1.6fr', gap: isMobile ? '14px' : '20px' }}>
            {/* Donut */}
            <Section title={`התפלגות לפי ${isVendorDist ? 'ספק' : 'קטגוריה'}`} sub={isVendorDist ? 'לחץ על פלח להדגשה · לחיצה במרכז מבטלת' : 'לחץ על פלח לסינון · לחיצה במרכז מבטלת'}>
              {/* Selected slice title — so it's clear which slice was clicked */}
              {distSel && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12 }}>
                  <span style={{ width: 11, height: 11, borderRadius: '50%', background: distColorOf(distSel), flexShrink: 0 }} />
                  <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>{distSel}</span>
                  <button onClick={() => distSetSel(null)} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 13, color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-main)' }}>
                    <X size={13} /> בטל
                  </button>
                </div>
              )}
              {distDonut.length > 0
                ? <CategoryDonut data={distDonut} total={distTotal} selected={distSel} onSelect={distSetSel} />
                : <p style={{ textAlign: 'center', color: 'var(--text-mute)', padding: '24px 0' }}>{isVendorDist ? 'אין ספקים' : 'אין קטגוריות'}</p>
              }
            </Section>

            {/* Ranking */}
            <Section title={`דירוג ${isVendorDist ? 'ספקים' : 'קטגוריות'}`} sub={`${distRank.length} ${isVendorDist ? 'ספקים' : 'קטגוריות פעילות'}`}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: 420, overflowY: 'auto', overflowX: 'hidden' }}>
                {distRank.map((row, i) => {
                  const pct  = distTotal > 0 ? (row.total / distTotal) * 100 : 0
                  const clr  = COLORS[i % COLORS.length]
                  const isSel = distSel === row.name
                  const dim  = distSel && !isSel
                  return (
                    <div key={row.name}
                      onClick={() => distSetSel(row.name === distSel ? null : row.name)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px',
                        borderRadius: '9px', cursor: 'pointer', transition: 'background 120ms, opacity 120ms',
                        background: isSel ? 'var(--accent-bg)' : 'var(--panel-2)',
                        border: `1px solid ${isSel ? 'var(--accent)' : 'var(--border)'}`,
                        opacity: dim ? 0.5 : 1,
                      }}
                      onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = 'var(--panel)' }}
                      onMouseLeave={e => e.currentTarget.style.background = isSel ? 'var(--accent-bg)' : 'var(--panel-2)'}
                    >
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: dim ? 'var(--border-strong)' : clr, flexShrink: 0 }} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: '15px', fontWeight: isSel ? 700 : 500, color: isSel ? 'var(--accent)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</span>
                      <span style={{ fontSize: '12.5px', color: 'var(--text-mute)', whiteSpace: 'nowrap', flexShrink: 0 }}>{row.count}</span>
                      {!isMobile && (
                        <div style={{ width: 60, flexShrink: 0 }}>
                          <div style={{ height: 5, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${pct}%`, background: dim ? 'var(--border-strong)' : clr, borderRadius: 3, transition: 'width 500ms ease' }} />
                          </div>
                          <div style={{ fontSize: '10px', color: 'var(--text-mute)', textAlign: 'left', marginTop: 1 }}>{Math.round(pct)}%</div>
                        </div>
                      )}
                      <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--ok)', minWidth: 72, textAlign: 'left', whiteSpace: 'nowrap', flexShrink: 0 }}>{fmtILS(row.total)}</span>
                    </div>
                  )
                })}
              </div>
            </Section>
          </div>
        </div>

        {/* ── Interactive drill-down (category → sub → product, over time) ───────── */}
        <Section id="dash-drilldown" title="ניתוח מעמיק לאורך זמן" sub="הוצאה לאורך זמן (בחר גרנולריות) · לחץ על ספק כדי לפרק את העמודה שלו למוצרים, ומעבר עכבר/לחיצה על מלבן מציג את הערך הכספי">
          <CategoryDrilldown items={flatItems} />
        </Section>

        {/* ── Vendor comparison ─────────────────────────────────────────────────── */}
        <Section id="dash-compare" title="השוואת ספקים"
          sub="בחר שני ספקים. תחת כל אחד בחר מוצרים להשוואה ממוקדת — או השאר ריק להשוואת הוצאה כללית."
          action={<ChartTypeToggle value={chartType} onChange={setChartType} />}>

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
                  if (!n) return <div key={idx} style={{ padding: '14px', borderRadius: 12, border: '1px dashed var(--border)', color: 'var(--text-mute)', fontSize: '14px', textAlign: 'center' }}>לא נבחר ספק</div>
                  const s = vendorStats(n)
                  return (
                    <div key={idx} style={{ padding: '14px 16px', borderRadius: 12, border: `1px solid var(--border)`, borderTop: `3px solid ${c}`, background: 'var(--panel-2)' }}>
                      <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text)', marginBottom: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n}</div>
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
        </Section>

      </>)}
    </div>
  )
}
