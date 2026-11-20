/**
 * RevenueVsExpenses — the income side on the dashboard (client request
 * 20.11.26). Rendered ONLY when the `sales` module is on for this tenant.
 *
 * Self-contained on purpose: it loads its own data, so a tenant without the
 * module never mounts it and never issues a single query against the sales
 * tables. That is the binding condition — a new module cannot touch an
 * existing customer (guardrail 7).
 *
 * Expenses are NOT recomputed here. The dashboard already derives them the one
 * way this product derives expenses, and hands the figure in.
 */
import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../hooks/useAuth'
import { loadSalesDays, loadSalesLines } from '../lib/sales'
import { rangeTotals, profitSummary, monthlySeries } from '../lib/salesMath'
import MonthlyBars, { YEAR_COLORS } from './charts/MonthlyBars'
import { TrendingUp, ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'

const fmt = n => '₪' + Math.round(Number(n) || 0).toLocaleString('he-IL')

export default function RevenueVsExpenses({ years = [], expenses = 0, expenseMonthly = [], filtersActive = false, isMobile = false }) {
  const { user } = useAuth()
  const [days, setDays] = useState([])
  const [lines, setLines] = useState([])
  const [loaded, setLoaded] = useState(false)

  const key = years.join(',')
  useEffect(() => {
    if (!user || !years.length) return
    let alive = true
    ;(async () => {
      const per = await Promise.all(years.map(y => Promise.all([loadSalesDays(user.id, y), loadSalesLines(user.id, y)])))
      if (!alive) return
      setDays(per.flatMap(([d]) => d))
      setLines(per.flatMap(([, l]) => l))
      setLoaded(true)
    })()
    return () => { alive = false }
  }, [user, key])   // eslint-disable-line react-hooks/exhaustive-deps

  const totals = useMemo(() => rangeTotals(days, lines), [days, lines])
  const summary = useMemo(() => profitSummary(totals, expenses), [totals, expenses])

  // One bar per month: takings beside spend, so the gap is the story.
  const series = useMemo(() => {
    const revenue = years.length === 1
      ? monthlySeries(days, lines, years[0])
      : Array.from({ length: 12 }, (_, i) => ({
          month: i + 1,
          total: years.reduce((s, y) => s + (monthlySeries(days, lines, y)[i]?.total || 0), 0),
          count: 0,
        }))
    return revenue
  }, [days, lines, years])

  if (!loaded) return null
  if (!days.length) {
    return (
      <div style={{ background: 'var(--panel)', border: '1px dashed var(--border)', borderRadius: 14, padding: '14px 16px', fontSize: 13.5, color: 'var(--text-mute)', lineHeight: 1.7 }}>
        <strong style={{ color: 'var(--text)' }}>הכנסות</strong> — עדיין לא הוזן מחזור.{' '}
        <Link to="/revenue" style={{ color: 'var(--accent)', fontWeight: 700 }}>הזן סגירת יום</Link>{' '}
        וכאן יופיעו הכנסות מול הוצאות ורווח גולמי.
      </div>
    )
  }

  const card = { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 14, padding: '12px 14px', boxShadow: 'var(--shadow-card)' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(3, 1fr)', gap: 10 }}>
        <div style={card}>
          <div style={{ fontSize: 11.5, color: 'var(--text-mute)', fontWeight: 600 }}>הכנסות</div>
          <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--text)', marginTop: 2 }}>{fmt(summary.revenue)}</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-mute)', marginTop: 2 }}>
            {totals.days === 1 ? 'יום אחד' : `${totals.days} ימים`}{totals.avgDay != null ? ` · ${fmt(totals.avgDay)} ליום` : ''}
          </div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 11.5, color: 'var(--text-mute)', fontWeight: 600 }}>רווח גולמי</div>
          <div style={{ fontSize: 19, fontWeight: 800, color: summary.profit >= 0 ? 'var(--ok)' : 'var(--danger)', marginTop: 2 }}>
            {fmt(summary.profit)}{summary.margin != null ? ` · ${summary.margin}%` : ''}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-mute)', marginTop: 2 }}>
            הכנסה ללא מע״מ {fmt(summary.net)} פחות הוצאות {fmt(summary.expenses)}
          </div>
        </div>
        {!isMobile && (
          <div style={card}>
            <div style={{ fontSize: 11.5, color: 'var(--text-mute)', fontWeight: 600 }}>ממוצע לעסקה</div>
            <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--text)', marginTop: 2 }}>
              {totals.avgTicket != null ? fmt(totals.avgTicket) : '—'}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-mute)', marginTop: 2 }}>
              {totals.transactions ? `${totals.transactions} עסקאות` : 'לא הוזן מספר עסקאות'}
            </div>
          </div>
        )}
      </div>

      <div style={{ ...card, padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 7 }}>
            <TrendingUp size={15} color="var(--accent)" /> הכנסות מול הוצאות
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-dim)' }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: '#16a34a', display: 'inline-block' }} /> הכנסות
            <span style={{ width: 10, height: 10, borderRadius: 3, background: YEAR_COLORS[0], display: 'inline-block', marginInlineStart: 8 }} /> הוצאות
          </span>
          <Link to="/revenue" style={{ marginInlineStart: 'auto', fontSize: 12.5, fontWeight: 700, color: 'var(--accent)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3 }}>
            סגירת יום <ArrowLeft size={13} />
          </Link>
        </div>
        {filtersActive && (
          <div style={{ fontSize: 12, color: '#d97706', marginBottom: 4 }}>
            שים לב: מסנן קטגוריה או ספק פעיל, ולכן ההוצאות המוצגות הן החלק המסונן בלבד.
          </div>
        )}
        <MonthlyBars data={series} compareData={expenseMonthly} year="הכנסות" compareYear="הוצאות"
          color="#16a34a" compareColor={YEAR_COLORS[0]} />
      </div>
    </div>
  )
}
