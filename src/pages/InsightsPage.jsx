/**
 * InsightsPage — "תובנות" (client request #5): one periodic report pulling
 * together spend trends, savings opportunities, price alerts, document gaps,
 * budget utilization and a VAT summary. Every figure is computed by the pure
 * insights lib from the loaded receipts — the page only renders.
 */
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { getCached, setCached, hasCached } from '../lib/pageCache'
import { loadSuppliers } from '../lib/suppliers'
import { loadAllBudgets } from '../lib/budgets'
import { buildInsights, INSIGHT_PERIODS } from '../lib/insights'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import toast from 'react-hot-toast'
import { Lightbulb, TrendingUp, TrendingDown, PiggyBank, AlertTriangle, ArrowLeftRight, Wallet, Receipt, Trophy, Percent } from 'lucide-react'

const fmtILS = n => `₪${Math.round(Number(n) || 0).toLocaleString('he-IL')}`

const card = { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px', boxShadow: 'var(--shadow-card)' }
const h2 = { margin: '0 0 12px', fontSize: 15, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }
const empty = { fontSize: 13.5, color: 'var(--text-mute)' }

function Row({ children, tone }) {
  const bg = tone === 'bad' ? '#fef2f2' : tone === 'warn' ? 'var(--warn-tint-1)' : tone === 'good' ? '#f0fdf4' : 'var(--panel-2)'
  return <div style={{ padding: '9px 12px', borderRadius: 9, background: bg, fontSize: 13.5, color: 'var(--text)', lineHeight: 1.6 }}>{children}</div>
}

export default function InsightsPage() {
  const { user } = useAuth()
  const isMobile = window.innerWidth < 768
  const [receipts, setReceipts] = useState(() => getCached('receipts') || [])
  const [suppliers, setSuppliers] = useState([])
  const [budgets, setBudgets] = useState([])
  const [loading, setLoading] = useState(() => !hasCached('receipts'))
  const [period, setPeriod] = useState('month')

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const [{ data, error }, sup, bud] = await Promise.all([
          supabase.from('receipts').select('*').order('receipt_date', { ascending: false }),
          user?.id ? loadSuppliers(user.id) : Promise.resolve([]),
          user?.id ? loadAllBudgets(user.id) : Promise.resolve([]),
        ])
        if (!alive) return
        if (error) throw error
        setReceipts(data || []); setCached('receipts', data || [])
        setSuppliers(sup || []); setBudgets(bud || [])
      } catch (err) { toast.error('שגיאה בטעינה: ' + (err?.message || '')) }
      finally { if (alive) setLoading(false) }
    }
    load()
    return () => { alive = false }
  }, [user?.id])

  const report = useMemo(
    () => buildInsights(receipts, { suppliers, budgets, period }),
    [receipts, suppliers, budgets, period])

  if (loading && receipts.length === 0) return <LoadingSpinner />

  const { spend, topSuppliers, savings, priceAlerts, docGaps, budgetAlerts, vat } = report
  const up = spend.changePct != null && spend.changePct > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }} dir="rtl">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: isMobile ? 20 : 23, fontWeight: 800, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 9 }}>
          <Lightbulb size={22} style={{ color: 'var(--accent)' }} /> תובנות
        </h1>
        <div style={{ marginInlineStart: 'auto', display: 'flex', gap: 6, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, padding: 4 }}>
          {INSIGHT_PERIODS.map(p => (
            <button key={p.value} onClick={() => setPeriod(p.value)}
              style={{ padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-main)', fontSize: 13, fontWeight: 700,
                background: period === p.value ? 'var(--accent)' : 'transparent', color: period === p.value ? 'white' : 'var(--text-dim)' }}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Spend headline */}
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 46, height: 46, borderRadius: 12, background: 'var(--accent-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {spend.changePct == null ? <Wallet size={22} style={{ color: 'var(--accent)' }} />
            : up ? <TrendingUp size={22} style={{ color: '#dc2626' }} /> : <TrendingDown size={22} style={{ color: '#16a34a' }} />}
        </div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>{fmtILS(spend.total)}</div>
          <div style={{ fontSize: 13, color: 'var(--text-mute)', marginTop: 2 }}>{spend.headline}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
        {/* Top suppliers */}
        <div style={card}>
          <h2 style={h2}><Trophy size={17} style={{ color: 'var(--accent)' }} /> ספקים מובילים ({report.window.label})</h2>
          {topSuppliers.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {topSuppliers.map((s, i) => (
                <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
                  <span style={{ color: 'var(--text-mute)', width: 18 }}>{i + 1}.</span>
                  <span style={{ color: 'var(--text)', fontWeight: 600 }}>{s.name}</span>
                  <span style={{ marginInlineStart: 'auto', fontWeight: 700, color: 'var(--text)' }}>{fmtILS(s.total)}</span>
                </div>
              ))}
            </div>
          ) : <div style={empty}>אין הוצאות בתקופה זו</div>}
        </div>

        {/* VAT summary */}
        <div style={card}>
          <h2 style={h2}><Percent size={17} style={{ color: 'var(--accent)' }} /> סיכום מע"מ לרו"ח</h2>
          <Row>{vat.headline}</Row>
        </div>

        {/* Savings opportunities */}
        <div style={card}>
          <h2 style={h2}><PiggyBank size={17} style={{ color: '#16a34a' }} /> הזדמנויות חיסכון</h2>
          {savings.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {savings.map(s => <Row key={s.product} tone="good">{s.headline}</Row>)}
            </div>
          ) : <div style={empty}>אין מוצרים שנקנו מכמה ספקים עם פער מחיר משמעותי</div>}
        </div>

        {/* Price alerts */}
        <div style={card}>
          <h2 style={h2}><AlertTriangle size={17} style={{ color: '#d97706' }} /> התראות מחיר ({report.window.label})</h2>
          {priceAlerts.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {priceAlerts.map((a, i) => <Row key={i} tone="warn">{a.headline}</Row>)}
            </div>
          ) : <div style={empty}>לא נמצאו התייקרויות משמעותיות בתקופה</div>}
        </div>

        {/* Document gaps */}
        <div style={card}>
          <h2 style={h2}><ArrowLeftRight size={17} style={{ color: 'var(--accent)' }} /> פערי מסמכים</h2>
          <Row tone={(docGaps.pendingInvoices || docGaps.mismatchInvoices || docGaps.openNotes) ? 'warn' : 'good'}>{docGaps.headline}</Row>
        </div>

        {/* Budgets */}
        <div style={card}>
          <h2 style={h2}><Wallet size={17} style={{ color: 'var(--accent)' }} /> תקציבים</h2>
          {budgetAlerts.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {budgetAlerts.map(b => <Row key={b.supplier} tone={b.state === 'over' ? 'bad' : 'warn'}>{b.headline}</Row>)}
            </div>
          ) : <div style={empty}>כל התקציבים בתחום — אין חריגות</div>}
        </div>
      </div>
    </div>
  )
}
