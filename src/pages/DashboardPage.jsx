import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useSettings } from '../hooks/useSettings'
import { BarChart2, TrendingUp, TrendingDown, Receipt, Calendar, Tag, X, ChevronDown } from 'lucide-react'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import MonthlyBars   from '../components/charts/MonthlyBars'
import CategoryDonut, { COLORS } from '../components/charts/CategoryDonut'
import TopVendors    from '../components/charts/TopVendors'
import CategoryTree  from '../components/charts/CategoryTree'
import CategoryDrilldown from '../components/CategoryDrilldown'
import ChartTypeToggle from '../components/charts/ChartTypeToggle'
import { flattenItems } from '../lib/itemAggregation'

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
function Section({ title, sub, children, action }) {
  return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '16px', boxShadow: 'var(--shadow-card)', overflow: 'hidden' }}>
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
  const [filterVendor,setFilterVendor]= useState(null)
  const [availYears,  setAvailYears]  = useState([thisYear])
  const [vendorA,     setVendorA]     = useState('')    // vendor comparison
  const [vendorB,     setVendorB]     = useState('')
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

  // ── Active receipts (applying category + vendor filters) ─────────────────────
  const active = useMemo(() => receipts.filter(r => {
    if (filterCat && r.category_text !== filterCat) return false
    if (filterVendor && r.vendor_name !== filterVendor) return false
    return true
  }), [receipts, filterCat, filterVendor])

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

  // ── Category aggregation (L1 only for donut) ─────────────────────────────────
  const l1Cats = useMemo(() => categories.filter(c => c.level === 1), [categories])

  const l1Data = useMemo(() => {
    const map = {}
    active.forEach(r => {
      // find which L1 this receipt belongs to
      let catName = r.category_text || 'שונות'
      // try to match by category_id → find L1 parent
      if (r.category_id) {
        const cat = categories.find(c => c.id === r.category_id)
        if (cat) {
          if (cat.level === 1) catName = cat.name
          else if (cat.level === 2) {
            const parent = categories.find(c => c.id === cat.parent_id)
            if (parent) catName = parent.name
          } else if (cat.level === 3) {
            const p2 = categories.find(c => c.id === cat.parent_id)
            const p1 = p2 ? categories.find(c => c.id === p2.parent_id) : null
            if (p1) catName = p1.name
          }
        }
      }
      if (!map[catName]) map[catName] = { name: catName, total: 0, count: 0 }
      map[catName].total += amt(r)
      map[catName].count += 1
    })
    // Also add categories from DB that have no match in receipts
    const sorted = Object.values(map).sort((a, b) => b.total - a.total)
    // Enrich with id from l1Cats
    return sorted.map(d => {
      const cat = l1Cats.find(c => c.name === d.name)
      return { ...d, id: cat?.id }
    })
  }, [active, categories, l1Cats, settings.showWithVat])

  // ── Vendor aggregation ────────────────────────────────────────────────────────
  const vendorData = useMemo(() => {
    const map = {}
    active.forEach(r => {
      const name = (r.vendor_name || '').trim() || 'לא ידוע'
      if (!map[name]) map[name] = { name, total: 0, count: 0 }
      map[name].total += amt(r)
      map[name].count += 1
    })
    return Object.values(map).sort((a, b) => b.total - a.total).slice(0, 10)
  }, [active, settings.showWithVat])

  // ── Best month ────────────────────────────────────────────────────────────────
  const bestMonth = useMemo(() => {
    const m = monthlyData.reduce((best, d) => d.total > best.total ? d : best, { month: 0, total: 0 })
    return m.total > 0 ? HEB_MONTHS_FULL[m.month - 1] : null
  }, [monthlyData])

  // ── Vendor comparison ──────────────────────────────────────────────────────────
  const allVendors = useMemo(() => {
    const set = new Set(active.map(r => (r.vendor_name || '').trim()).filter(Boolean))
    return [...set].sort((a, b) => a.localeCompare(b, 'he'))
  }, [active])

  function monthlyForVendor(name) {
    const map = {}
    active.filter(r => (r.vendor_name || '').trim() === name).forEach(r => {
      if (!r.receipt_date) return
      const m = parseInt(r.receipt_date.slice(5, 7))
      if (!map[m]) map[m] = { month: m, total: 0, count: 0 }
      map[m].total += amt(r); map[m].count += 1
    })
    return Array.from({ length: 12 }, (_, i) => map[i + 1] || { month: i + 1, total: 0, count: 0 })
  }
  function vendorStats(name) {
    const rows = active.filter(r => (r.vendor_name || '').trim() === name)
    const total = rows.reduce((s, r) => s + amt(r), 0)
    return { total, count: rows.length, avg: rows.length ? total / rows.length : 0 }
  }
  const cmpA = useMemo(() => vendorA ? monthlyForVendor(vendorA) : null, [vendorA, active, settings.showWithVat])
  const cmpB = useMemo(() => vendorB ? monthlyForVendor(vendorB) : null, [vendorB, active, settings.showWithVat])

  const hasFilters = filterCat || filterVendor

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
              <select value={year} onChange={e => { setYear(+e.target.value); setFilterCat(null); setFilterVendor(null) }}
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
              <select value={filterCat || ''} onChange={e => { setFilterCat(e.target.value || null); setFilterVendor(null) }}
                style={{ height: 36, paddingRight: 30, paddingLeft: 12, borderRadius: 8, border: `1px solid ${filterCat ? 'var(--accent)' : 'var(--border)'}`, background: filterCat ? 'var(--accent-bg)' : 'var(--panel)', color: filterCat ? 'var(--accent)' : 'var(--text)', fontSize: '13px', fontFamily: 'var(--font-main)', outline: 'none', cursor: 'pointer' }}>
                <option value="">כל הקטגוריות</option>
                {l1Data.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            </div>
            {/* Clear filters */}
            {hasFilters && (
              <button onClick={() => { setFilterCat(null); setFilterVendor(null) }}
                style={{ height: 36, padding: '0 12px', borderRadius: 8, border: '1px solid var(--danger)', background: '#fef2f2', color: 'var(--danger)', fontSize: '12.5px', cursor: 'pointer', fontFamily: 'var(--font-main)', display: 'flex', alignItems: 'center', gap: 5 }}>
                <X size={12} /> נקה
              </button>
            )}
          </div>
        </div>

        {/* Active filter pill */}
        {(filterCat || filterVendor) && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {filterCat && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999, background: 'var(--accent-bg)', border: '1px solid var(--accent)', fontSize: '12px', color: 'var(--accent)' }}>
                <Tag size={10} /> {filterCat}
                <button onClick={() => setFilterCat(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--accent)', padding: 0, display: 'flex' }}><X size={10} /></button>
              </span>
            )}
            {filterVendor && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999, background: '#faf5ff', border: '1px solid #e9d5ff', fontSize: '12px', color: '#7c3aed' }}>
                <Receipt size={10} /> {filterVendor}
                <button onClick={() => setFilterVendor(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#7c3aed', padding: 0, display: 'flex' }}><X size={10} /></button>
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── KPI Cards ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: isMobile ? '10px' : '14px', flexWrap: 'wrap' }}>
        <KpiCard label="סה״כ הוצאות" value={fmtILS(total)} sub={`שנת ${year}`} icon={Receipt} color="var(--ok)" trend={yoy} />
        <KpiCard label="ממוצע חודשי" value={fmtILS(avgMonthly)} sub={bestMonth ? `חודש שיא: ${bestMonth}` : undefined} icon={Calendar} color="var(--accent)" />
        <KpiCard label="מספר קבלות" value={active.length} sub={`${active.filter(r => r.ai_extracted).length} נסרקו ב-AI`} icon={BarChart2} color="#7c3aed" />
        {!isMobile && <KpiCard label="קטגוריות פעילות" value={l1Data.length} sub={`${vendorData.length} ספקים`} icon={Tag} color="#d97706" />}
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
          <MonthlyBars data={monthlyData} compareData={prevMonthlyData} year={year} compareYear={compareYear} chartType={chartType} />
        </Section>

        {/* ── Category donut + ranking ──────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1.6fr', gap: isMobile ? '14px' : '20px' }}>
          {/* Donut */}
          <Section title="התפלגות לפי קטגוריה" sub="לחץ על segment לסינון">
            {l1Data.length > 0
              ? <CategoryDonut data={l1Data} total={total} selected={filterCat} onSelect={setFilterCat} />
              : <p style={{ textAlign: 'center', color: 'var(--text-mute)', padding: '24px 0' }}>אין קטגוריות</p>
            }
          </Section>

          {/* Category ranking */}
          <Section title="דירוג קטגוריות" sub={`${l1Data.length} קטגוריות פעילות`}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {l1Data.map((cat, i) => {
                const pct  = total > 0 ? (cat.total / total) * 100 : 0
                const clr  = COLORS[i % COLORS.length]
                const isSel = filterCat === cat.name
                return (
                  <div key={cat.name}
                    onClick={() => setFilterCat(cat.name === filterCat ? null : cat.name)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px',
                      borderRadius: '9px', cursor: 'pointer', transition: 'background 120ms',
                      background: isSel ? 'var(--accent-bg)' : 'var(--panel-2)',
                      border: `1px solid ${isSel ? 'var(--accent)' : 'var(--border)'}`,
                    }}
                    onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = 'var(--panel)' }}
                    onMouseLeave={e => e.currentTarget.style.background = isSel ? 'var(--accent-bg)' : 'var(--panel-2)'}
                  >
                    <div style={{ width: 9, height: 9, borderRadius: '50%', background: clr, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: '13px', fontWeight: isSel ? 600 : 400, color: isSel ? 'var(--accent)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat.name}</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-mute)', whiteSpace: 'nowrap' }}>{cat.count} קבלות</span>
                    <div style={{ width: 60, flexShrink: 0 }}>
                      <div style={{ height: 5, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: clr, borderRadius: 3, transition: 'width 500ms ease' }} />
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--text-mute)', textAlign: 'left', marginTop: 1 }}>{Math.round(pct)}%</div>
                    </div>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ok)', minWidth: 70, textAlign: 'left' }}>{fmtILS(cat.total)}</span>
                  </div>
                )
              })}
            </div>
          </Section>
        </div>

        {/* ── Interactive drill-down (category → sub → product, over time) ───────── */}
        <Section title="ניתוח מעמיק לאורך זמן" sub="לחץ על קטגוריה → תת-קטגוריה → מוצר. בחר גרנולריות: יומי/שבועי/חודשי/רבעוני/שנתי">
          <CategoryDrilldown items={flatItems} />
        </Section>

        {/* ── Category tree ─────────────────────────────────────────────────────── */}
        {l1Data.some(c => c.id) && (
          <Section title="פירוט מלא לפי קטגוריות" sub="L1 → L2 → L3 — לחץ להרחבה">
            <CategoryTree l1Data={l1Data.filter(c => c.id)} categories={categories} receipts={active} total={total} amountOf={amt} />
          </Section>
        )}

        {/* ── Top vendors ───────────────────────────────────────────────────────── */}
        <Section
          title="ספקים מובילים"
          sub={`Top ${Math.min(10, vendorData.length)} ספקים${filterVendor ? ` · מסונן: ${filterVendor}` : ''}`}
        >
          <TopVendors data={vendorData} selected={filterVendor} onSelect={setFilterVendor} />
        </Section>

        {/* ── Vendor comparison ─────────────────────────────────────────────────── */}
        <Section title="השוואת ספקים" sub="בחר שני ספקים להשוואת הוצאה חודשית זה מול זה"
          action={<ChartTypeToggle value={chartType} onChange={setChartType} />}>

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
            <div style={{ flex: '1 1 200px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#2563eb', marginBottom: '6px' }}>ספק א'</label>
              <select value={vendorA} onChange={e => setVendorA(e.target.value)}
                style={{ width: '100%', height: 44, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text)', fontSize: '15px', fontFamily: 'var(--font-main)' }}>
                <option value="">בחר ספק…</option>
                {allVendors.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div style={{ flex: '1 1 200px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#f59e0b', marginBottom: '6px' }}>ספק ב'</label>
              <select value={vendorB} onChange={e => setVendorB(e.target.value)}
                style={{ width: '100%', height: 44, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text)', fontSize: '15px', fontFamily: 'var(--font-main)' }}>
                <option value="">בחר ספק…</option>
                {allVendors.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          </div>

          {(vendorA || vendorB) ? (
            <>
              <MonthlyBars
                data={cmpA || Array.from({ length: 12 }, (_, i) => ({ month: i + 1, total: 0, count: 0 }))}
                compareData={cmpB || Array.from({ length: 12 }, (_, i) => ({ month: i + 1, total: 0, count: 0 }))}
                year={vendorA || 'ספק א'} compareYear={vendorB || 'ספק ב'} chartType={chartType}
              />
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
