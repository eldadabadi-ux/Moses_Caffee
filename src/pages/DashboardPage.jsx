import { useState, useEffect, useMemo, useCallback } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useSettings } from '../hooks/useSettings'
import { getCached, hasCached } from '../lib/pageCache'
import { loadYearReceipts, loadDashMeta } from '../lib/dashboardData'
import { countsAsDoc } from '../lib/installments'
import { BarChart2, TrendingUp, TrendingDown, Calendar, Tag, X, Store } from 'lucide-react'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import MonthlyBars   from '../components/charts/MonthlyBars'
import RevenueVsExpenses from '../components/RevenueVsExpenses'
import { useFeatureFlags } from '../lib/flags'
import CategoryDonut, { COLORS } from '../components/charts/CategoryDonut'
import CategoryDrilldown from '../components/CategoryDrilldown'
import ChartTypeToggle from '../components/charts/ChartTypeToggle'
import CheckDropdown from '../components/CheckDropdown'
import ShekelSign from '../components/icons/ShekelSign'
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
        {Icon && <div style={{
          width: 34, height: 34, borderRadius: '8px', flexShrink: 0,
          // color-mix works with both CSS-variable colors (var(--ok)/var(--accent))
          // and hex, so EVERY KPI icon gets the same framed background + border.
          background: `color-mix(in srgb, ${color} 14%, transparent)`,
          border: `1px solid color-mix(in srgb, ${color} 32%, transparent)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={18} color={color} />
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

  // The top filters select SEVERAL values at once (client request 15.11.26):
  // years, categories and suppliers are each a checkbox multi-select, and the
  // combined selection drives the WHOLE dashboard — KPIs, every chart, drill-down.
  const flags = useFeatureFlags()
  const [years,         setYears]         = useState([thisYear])
  const [filterCats,    setFilterCats]    = useState([])   // L1 category names
  const [filterVendors, setFilterVendors] = useState([])   // keys: supplier_id or "name:<raw>"

  const [receipts,       setReceipts]       = useState(() => getCached('dashyr:' + thisYear) || [])
  const [prevReceipts,   setPrevReceipts]   = useState([])  // the single selected year − 1, for YoY
  const [compareReceipts, setCompareReceipts] = useState([])
  const [categories,     setCategories]     = useState(() => getCached('dash:meta')?.categories || [])
  const [supplierRows,   setSupplierRows]   = useState(() => getCached('dash:meta')?.suppliers || [])
  const [loading,        setLoading]        = useState(() => !hasCached('dashyr:' + thisYear))
  // Comparison years — ALSO a checkbox multi-select (client request 15.11.26
  // round 3): any year(s), the current year included, against the main selection.
  const [compareYears,   setCompareYears]   = useState([])
  const [distMode,       setDistMode]       = useState('cat') // distribution donut: 'cat' | 'vendor'
  const [selVendor,      setSelVendor]      = useState(null)  // highlighted vendor slice (local)
  const [selCat,         setSelCat]         = useState(null)  // highlighted category slice (local — NO filtering)
  const [availYears,     setAvailYears]     = useState(() => getCached('dash:meta')?.availYears || [thisYear])
  const [chartType,      setChartType]      = useState('bar') // 'bar' | 'line' for time charts

  // ── Load data ────────────────────────────────────────────────────────────────
  // One cached fetch per calendar year (shared with SupplierComparePage), so a
  // multi-year selection combines already-loaded years instantly and only
  // fetches the missing ones.
  const fetchYearReceipts = useCallback((y) => loadYearReceipts(user.id, y), [user?.id])

  const yearsKey = useMemo(() => [...years].sort((a, b) => a - b).join(','), [years])

  useEffect(() => {
    if (!user) return
    let alive = true
    async function load() {
      const allCached = years.every(y => hasCached('dashyr:' + y)) && hasCached('dash:meta')
      if (!allCached && receipts.length === 0) setLoading(true)
      try {
        const perYear = await Promise.all(years.map(fetchYearReceipts))
        const combined = perYear.flat()
          .sort((a, b) => (a.receipt_date || '').localeCompare(b.receipt_date || ''))

        const meta = await loadDashMeta(user.id, thisYear)

        // YoY needs the preceding year — only meaningful for a single-year view.
        const prev = years.length === 1 ? await fetchYearReceipts(years[0] - 1) : []

        if (!alive) return
        setReceipts(combined)
        setPrevReceipts(prev)
        setCategories(meta.categories)
        setSupplierRows(meta.suppliers)
        setAvailYears([...new Set([...meta.availYears, ...years])].sort((a, b) => b - a))
      } catch (err) {
        console.error('Dashboard load error:', err)
      } finally { if (alive) setLoading(false) }
    }
    load()
    return () => { alive = false }
  }, [user, yearsKey, fetchYearReceipts])  // eslint-disable-line react-hooks/exhaustive-deps

  const compareKey = useMemo(() => [...compareYears].sort((a, b) => a - b).join(','), [compareYears])
  useEffect(() => {
    if (!user || !compareYears.length) { setCompareReceipts([]); return }
    let alive = true
    Promise.all(compareYears.map(fetchYearReceipts))
      .then(perYear => { if (alive) setCompareReceipts(perYear.flat()) })
      .catch(err => console.error('Compare load error:', err))
    return () => { alive = false }
  }, [user, compareKey, fetchYearReceipts])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Category resolution (L1) ─────────────────────────────────────────────────
  const l1Cats = useMemo(() => categories.filter(c => c.level === 1), [categories])

  // Resolve a receipt's L1 category name (walk up the tree if it points to L2/L3).
  const resolveL1 = useCallback((r) => {
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
  }, [categories])

  // Display name for a receipt's supplier: the canonical one when the receipt is
  // linked, otherwise whatever the scan wrote. Without this the dashboard shows a
  // merged supplier as N separate slices while SuppliersPage shows it as one —
  // two different numbers for the same supplier in the same app.
  const canonicalById = useMemo(
    () => Object.fromEntries((supplierRows || []).map(s => [s.id, (s.name || '').trim()])),
    [supplierRows])
  const supplierNameOf = useCallback((r) => {
    const raw = (r.vendor_name || '').trim()
    return (r.supplier_id && canonicalById[r.supplier_id]) || raw
  }, [canonicalById])

  // Supplier options for the dashboard filter — one entry per canonical supplier
  // (falling back to the scanned name for receipts not yet linked). Options come
  // from the UNfiltered receipts so a selection never hides the other choices.
  const vendorFilterOptions = useMemo(() => {
    const map = new Map()
    for (const r of receipts) {
      const name = supplierNameOf(r)
      if (!name) continue
      const key = r.supplier_id || `name:${name}`
      if (!map.has(key)) map.set(key, { key, id: r.supplier_id || null, name })
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'he'))
  }, [receipts, supplierNameOf])
  const selectedVendorOpts = useMemo(
    () => vendorFilterOptions.filter(o => filterVendors.includes(o.key)),
    [vendorFilterOptions, filterVendors])

  // ── The one filter predicate the whole dashboard obeys ───────────────────────
  // The supplier filter matches on the canonical supplier_id once a receipt has
  // been linked, and on the scanned name for rows that predate the merge.
  const passesFilters = useCallback((r) => {
    if (filterCats.length && !filterCats.includes(resolveL1(r))) return false
    if (selectedVendorOpts.length) {
      const hit = selectedVendorOpts.some(o =>
        (o.id && r.supplier_id === o.id) ||
        (!r.supplier_id && (r.vendor_name || '').trim() === o.name))
      if (!hit) return false
    }
    return true
  }, [filterCats, selectedVendorOpts, resolveL1])

  const active = useMemo(() => receipts.filter(passesFilters), [receipts, passesFilters])

  const total     = useMemo(() => active.reduce((s, r) => s + amt(r), 0), [active, settings.showWithVat])
  // The comparison year must obey the SAME filters as the current one. Comparing
  // one filtered supplier's ₪12k against the whole previous year's ₪400k
  // rendered "-97% מהשנה הקודמת" next to a correctly filtered number.
  const activePrev = useMemo(() => prevReceipts.filter(passesFilters), [prevReceipts, passesFilters])
  const totalPrev = useMemo(() => activePrev.reduce((s, r) => s + amt(r), 0), [activePrev, settings.showWithVat])
  const yoy       = years.length === 1 && totalPrev > 0 ? ((total - totalPrev) / totalPrev) * 100 : null

  // Flattened line-items for the drill-down (item-level L1→L2→L3 over time)
  const flatItems = useMemo(() => flattenItems(active), [active])

  const avgMonthly = useMemo(() => {
    const months = new Set(active.map(r => r.receipt_date?.slice(0, 7)).filter(Boolean))
    return months.size > 0 ? total / months.size : 0
  }, [active, total])

  // ── Monthly aggregation ───────────────────────────────────────────────────────
  // Obeys the top filters like everything else (client request 15.11.26: a
  // supplier/category selection reshapes ALL the charts). With several years
  // selected, each calendar month sums across the chosen years.
  const monthlyOf = useCallback((list) => {
    const map = {}
    list.forEach(r => {
      if (!r.receipt_date) return
      const m = parseInt(r.receipt_date.slice(5, 7))
      if (!map[m]) map[m] = { month: m, total: 0, count: 0 }
      map[m].total += amt(r)
      if (countsAsDoc(r)) map[m].count += 1
    })
    return Array.from({ length: 12 }, (_, i) => map[i + 1] || { month: i + 1, total: 0, count: 0 })
  }, [settings.showWithVat])  // eslint-disable-line react-hooks/exhaustive-deps

  const monthlyData = useMemo(() => monthlyOf(active), [active, monthlyOf])
  // With more than one year selected the chart shows ONE column per month,
  // segmented by year (client request 18.11.26) — side-by-side year columns
  // read as unrelated bars. Oldest year first so the stack grows forward in
  // time from the baseline up.
  const monthlySeries = useMemo(() => {
    if (years.length < 2) return null
    return [...years].sort((a, b) => a - b).map(y => ({
      year: y,
      data: monthlyOf(active.filter(r => String(r.receipt_date || '').startsWith(String(y)))),
    }))
  }, [active, years, monthlyOf])
  const compareMonthly = useMemo(() => {
    if (!compareYears.length) return null
    return monthlyOf(compareReceipts.filter(passesFilters))
  }, [compareYears.length, compareReceipts, passesFilters, monthlyOf])

  // ── Distribution aggregations (over the FILTERED receipts) ───────────────────
  function aggregateL1(list) {
    const map = {}
    list.forEach(r => {
      const n = resolveL1(r)
      if (!map[n]) map[n] = { name: n, total: 0, count: 0 }
      map[n].total += amt(r); if (countsAsDoc(r)) map[n].count += 1
    })
    return Object.values(map).sort((a, b) => b.total - a.total)
      .map(d => ({ ...d, id: l1Cats.find(c => c.name === d.name)?.id }))
  }

  // Dropdown options + stable colours come from ALL receipts, so selecting a
  // category never removes the other checkboxes or reshuffles the palette.
  const l1Options = useMemo(() => aggregateL1(receipts), [receipts, categories, l1Cats, settings.showWithVat])
  const catColor = useMemo(() => {
    const m = {}; l1Options.forEach((c, i) => { m[c.name] = COLORS[i % COLORS.length] }); return m
  }, [l1Options])

  // The donut + ranking show the FILTERED picture.
  const l1Data  = useMemo(() => aggregateL1(active), [active, categories, l1Cats, settings.showWithVat])
  const totalL1 = useMemo(() => l1Data.reduce((s, c) => s + c.total, 0), [l1Data])

  // ── Vendor aggregation — powers the "by vendor" distribution ─────────────────
  const vendorDist = useMemo(() => {
    const map = {}
    active.forEach(r => {
      const name = supplierNameOf(r) || 'לא ידוע'
      if (!map[name]) map[name] = { name, total: 0, count: 0 }
      map[name].total += amt(r)
      if (countsAsDoc(r)) map[name].count += 1
    })
    return Object.values(map).sort((a, b) => b.total - a.total)
  }, [active, supplierNameOf, settings.showWithVat])
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

  const hasFilters = filterCats.length > 0 || filterVendors.length > 0
  const yearsLabel = useMemo(() => [...years].sort((a, b) => b - a).join(' + '), [years])
  const compareLabel = useMemo(() => [...compareYears].sort((a, b) => b - a).join(' + '), [compareYears])

  // ── Distribution donut/ranking: switchable between category and vendor ────────
  const isVendorDist = distMode === 'vendor'
  const distDonut = isVendorDist ? vendorDonutData : l1Data   // capped for donut
  const distRank  = isVendorDist ? vendorDist : l1Data        // full list for ranking
  const distTotal = isVendorDist ? vendorTotal : totalL1
  // The distribution selection is a LOCAL highlight in BOTH modes (it greys the
  // other slices) — it does NOT filter the rest of the dashboard, so a category
  // click never carries over to the supplier view.
  const distSel   = isVendorDist ? selVendor : selCat
  const distSetSel = isVendorDist ? setSelVendor : setSelCat
  const distColorOf = (name) => { const i = distRank.findIndex(d => d.name === name); return i >= 0 ? COLORS[i % COLORS.length] : 'var(--accent)' }

  // Only blank to a spinner on the very first load (nothing to show yet). On
  // year switches / background refreshes we keep the current data on screen.
  if (loading && receipts.length === 0) return <LoadingSpinner />

  return (
    <div className="animate-fade-in" dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? '14px' : '20px' }}>

      {/* ── Header + Filters ──────────────────────────────────────────────────── */}
      {/* The filter bar lives on its OWN row (never sharing a line with the
          title): sharing meant that any width change — the clear button
          appearing, the subtitle numbers changing — could flip the flex wrap
          and teleport the whole bar (QA 15.11.26 round 4). Stacked rows +
          fixed-width dropdowns + an always-reserved clear slot = nothing moves. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: isMobile ? '23px' : '26px', fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <BarChart2 size={24} color="var(--accent)" />
            דשבורד
          </h1>
          <p style={{ margin: '2px 0 0', fontSize: '15px', color: 'var(--text-mute)' }}>
            {active.filter(countsAsDoc).length} קבלות · {fmtILSFull(total)} · {settings.showWithVat ? 'כולל מע"מ' : 'ללא מע"מ'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            {/* VAT display toggle */}
            <button onClick={toggleVatDisplay}
              style={{ height: 36, padding: '0 12px', borderRadius: 8, border: `1px solid ${settings.showWithVat ? 'var(--border)' : 'var(--accent)'}`, background: settings.showWithVat ? 'var(--panel)' : 'var(--accent-bg)', color: settings.showWithVat ? 'var(--text-dim)' : 'var(--accent)', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-main)', display: 'flex', alignItems: 'center', gap: 5 }}
              title='החלף בין כולל / ללא מע"מ'>
              <ShekelSign size={14} /> {settings.showWithVat ? 'כולל מע"מ' : 'ללא מע"מ'}
            </button>
            {/* Years — multi-select (at least one stays selected) */}
            <CheckDropdown icon={Calendar} minOne allLabel="שנה"
              options={availYears.map(y => ({ value: y, label: String(y) }))}
              values={years} onChange={setYears} />
            {/* Compare years — checkbox multi-select over ALL years (the current
                one included): any year(s) against any year(s) */}
            {!isMobile && (
              <CheckDropdown icon={TrendingUp} allLabel="השוואה: ללא"
                options={availYears.map(y => ({ value: y, label: String(y) }))}
                values={compareYears} onChange={setCompareYears} />
            )}
            {/* Categories — multi-select */}
            <CheckDropdown icon={Tag} allLabel="כל הקטגוריות"
              options={l1Options.map(c => ({ value: c.name, label: c.name }))}
              values={filterCats} onChange={setFilterCats} />
            {/* Suppliers — multi-select */}
            <CheckDropdown icon={Store} allLabel="כל הספקים"
              options={vendorFilterOptions.map(o => ({ value: o.key, label: o.name }))}
              values={filterVendors} onChange={setFilterVendors} />
            {/* Clear filters — ALWAYS rendered (hidden when idle) so the row's
                composition never changes and the dropdowns never shift */}
            <button onClick={() => { setFilterCats([]); setFilterVendors([]) }}
              style={{ height: 36, padding: '0 12px', borderRadius: 8, border: '1px solid var(--danger)', background: '#fef2f2', color: 'var(--danger)', fontSize: '12.5px', cursor: 'pointer', fontFamily: 'var(--font-main)', display: 'flex', alignItems: 'center', gap: 5,
                visibility: hasFilters ? 'visible' : 'hidden' }}>
              <X size={12} /> נקה
            </button>
          </div>

        {/* Active filter pills */}
        {hasFilters && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {filterCats.map(c => (
              <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999, background: 'var(--accent-bg)', border: '1px solid var(--accent)', fontSize: '12px', color: 'var(--accent)' }}>
                <Tag size={10} /> {c}
                <button onClick={() => setFilterCats(filterCats.filter(x => x !== c))} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--accent)', padding: 0, display: 'flex' }}><X size={10} /></button>
              </span>
            ))}
            {selectedVendorOpts.map(o => (
              <span key={o.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999, background: 'var(--accent-bg)', border: '1px solid var(--accent)', fontSize: '12px', color: 'var(--accent)' }}>
                <Store size={10} /> {o.name}
                <button onClick={() => setFilterVendors(filterVendors.filter(k => k !== o.key))} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--accent)', padding: 0, display: 'flex' }}><X size={10} /></button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── KPI Cards ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: isMobile ? '10px' : '14px', flexWrap: 'wrap' }}>
        <KpiCard label="סה״כ הוצאות" value={fmtILS(total)} sub={`שנת ${yearsLabel}`} icon={ShekelSign} color="var(--ok)" trend={yoy} />
        <KpiCard label="ממוצע חודשי" value={fmtILS(avgMonthly)} sub={bestMonth ? `חודש שיא: ${bestMonth}` : undefined} icon={Calendar} color="var(--accent)" />
        <KpiCard label="מספר קבלות" value={active.filter(countsAsDoc).length} sub={`${active.filter(r => countsAsDoc(r) && r.ai_extracted).length} נסרקו ב-AI`} icon={BarChart2} color="#7c3aed" />
        {!isMobile && <KpiCard label="קטגוריות פעילות" value={l1Data.length} sub={`${vendorDist.length} ספקים`} icon={Tag} color="#d97706" />}
      </div>

      {/* Income side — only for a tenant that bought the module (flag OFF by default) */}
      {flags.sales && (
        <RevenueVsExpenses years={years} expenses={total} expenseMonthly={monthlyData}
          filtersActive={filterCats.length > 0 || filterVendors.length > 0} isMobile={isMobile} />
      )}

      {/* ── Empty state ───────────────────────────────────────────────────────── */}
      {active.length === 0 && (
        <div style={{ textAlign: 'center', padding: '64px 16px', color: 'var(--text-mute)' }}>
          <BarChart2 size={44} style={{ margin: '0 auto 14px', display: 'block', opacity: 0.25 }} />
          <p style={{ fontWeight: 600, color: 'var(--text)', fontSize: '15px' }}>אין נתונים לתצוגה</p>
          <p style={{ fontSize: '13px', marginTop: 6 }}>{hasFilters ? 'אין קבלות התואמות את הסינון' : 'הוסף קבלות כדי לראות את הדשבורד'}</p>
        </div>
      )}

      {active.length > 0 && (<>

        {/* ── Monthly chart ─────────────────────────────────────────────────────── */}
        <Section
          id="dash-monthly"
          title={`הוצאות חודשיות — ${yearsLabel}${compareLabel ? ` מול ${compareLabel}` : ''}`}
          sub={compareLabel ? undefined : `סה"כ: ${fmtILS(total)}`}
          action={
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {/* In stacked mode MonthlyBars draws its own per-year legend. */}
              {compareLabel && !isMobile && !monthlySeries && (
                <div style={{ display: 'flex', gap: 12, fontSize: '12px' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: '#2563eb', display: 'inline-block' }} />{yearsLabel}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: '#f59e0b', display: 'inline-block' }} />{compareLabel}
                  </span>
                </div>
              )}
              <ChartTypeToggle value={chartType} onChange={setChartType} />
            </div>
          }
        >
          <MonthlyBars data={monthlyData} series={monthlySeries} compareData={compareMonthly} year={yearsLabel} compareYear={compareLabel || null} chartType={chartType} color="#2563eb" />
        </Section>

        {/* ── Distribution donut + ranking (by category OR by vendor) ───────────── */}
        <div id="dash-categories" style={{ scrollMarginTop: '76px', display: 'flex', flexDirection: 'column', gap: isMobile ? '12px' : '14px' }}>
          {/* Mode toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text-mute)' }}>התפלגות לפי:</span>
            <div style={{ display: 'flex', gap: 4, background: 'var(--panel-2)', borderRadius: 9, padding: 3 }}>
              {[{ id: 'cat', label: 'קטגוריה' }, { id: 'vendor', label: 'ספק' }].map(o => (
                <button key={o.id} onClick={() => { setDistMode(o.id); setSelVendor(null); setSelCat(null) }}
                  style={{ padding: '6px 16px', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-main)', fontSize: '13.5px', fontWeight: distMode === o.id ? 700 : 500,
                    background: distMode === o.id ? 'var(--accent)' : 'transparent', color: distMode === o.id ? '#fff' : 'var(--text-dim)' }}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1.6fr', gap: isMobile ? '14px' : '20px' }}>
            {/* Donut */}
            <Section title={`התפלגות לפי ${isVendorDist ? 'ספק' : 'קטגוריה'}`} sub="לחץ על פלח להדגשה · לחיצה במרכז מבטלת">
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

      </>)}
    </div>
  )
}
