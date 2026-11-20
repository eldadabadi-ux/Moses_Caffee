/**
 * RevenuePage — the income side (client request 20.11.26), behind the `sales`
 * module flag which ships OFF: a tenant that did not buy it never loads this
 * screen at all.
 *
 * Day one is deliberately a 15-second form: date, takings, transactions. That
 * alone answers "did I earn more than I spent this month". Product and hour
 * detail arrives later from the till's own end-of-day report, into the same
 * tables, and every figure here keeps coming from salesMath.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useTenant } from '../hooks/useTenant'
import { loadSalesDays, loadSalesLines, saveSalesDay, deleteSalesDay, loadSalesYears } from '../lib/sales'
import { rangeTotals, monthlySeries, dayTotal } from '../lib/salesMath'
import MonthlyBars from '../components/charts/MonthlyBars'
import CheckDropdown from '../components/CheckDropdown'
import DateInput from '../components/ui/DateInput'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import { TrendingUp, Plus, Trash2, Calendar, Check } from 'lucide-react'
import toast from 'react-hot-toast'

const HEB_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר']
const fmt = n => '₪' + (Number(n) || 0).toLocaleString('he-IL', { maximumFractionDigits: 0 })
const fmtDate = d => d ? String(d).split('-').reverse().join('.') : '—'
const todayISO = () => new Date().toISOString().slice(0, 10)

const emptyDay = () => ({ business_date: todayISO(), gross: '', transactions: '', cash: '', card: '' })

export default function RevenuePage() {
  const { user } = useAuth()
  const { orgId } = useTenant()
  const isMobile = window.innerWidth < 768

  const [days, setDays]       = useState([])
  const [lines, setLines]     = useState([])
  const [years, setYears]     = useState([new Date().getFullYear()])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [form, setForm]       = useState(emptyDay)

  // Same period rule as the receipts list: open on this month, widen on demand.
  const [perYears, setPerYears]   = useState(() => [new Date().getFullYear()])
  const [perMonths, setPerMonths] = useState(() => [new Date().getMonth() + 1])

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const yrs = await loadSalesYears(user.id)
      setYears(yrs)
      const wanted = perYears.length ? perYears : yrs
      const perYear = await Promise.all(wanted.map(y => Promise.all([loadSalesDays(user.id, y), loadSalesLines(user.id, y)])))
      setDays(perYear.flatMap(([d]) => d))
      setLines(perYear.flatMap(([, l]) => l))
    } catch (e) { console.error('[revenue] load', e?.message) }
    finally { setLoading(false) }
  }, [user, perYears])

  useEffect(() => { load() }, [load])

  const visibleDays = useMemo(() => days.filter(d => {
    const m = Number(String(d.business_date).slice(5, 7))
    return !perMonths.length || perMonths.includes(m)
  }).sort((a, b) => (b.business_date || '').localeCompare(a.business_date || '')), [days, perMonths])

  const totals = useMemo(() => rangeTotals(visibleDays, lines), [visibleDays, lines])
  const chartYears = useMemo(() => (perYears.length ? [...perYears] : years).sort((a, b) => a - b), [perYears, years])
  const series = useMemo(
    () => chartYears.map(y => ({ year: y, data: monthlySeries(days, lines, y) })),
    [chartYears, days, lines])
  const hasAny = series.some(s => s.data.some(d => d.total > 0))

  const isDefaultPeriod = perYears.length === 1 && perYears[0] === new Date().getFullYear() &&
                          perMonths.length === 1 && perMonths[0] === new Date().getMonth() + 1
  const periodLabel = useMemo(() => {
    const ys = perYears.length ? [...perYears].sort((a, b) => b - a).join(' + ') : 'כל השנים'
    if (!perMonths.length) return ys
    return `${[...perMonths].sort((a, b) => a - b).map(m => HEB_MONTHS[m - 1]).join(', ')} ${ys}`
  }, [perYears, perMonths])

  async function submit() {
    if (saving) return
    setSaving(true)
    try {
      const by_payment = {}
      if (form.cash !== '') by_payment.cash = Number(form.cash)
      if (form.card !== '') by_payment.card = Number(form.card)
      await saveSalesDay(user.id, orgId, { ...form, by_payment })
      toast.success(`המחזור של ${fmtDate(form.business_date)} נשמר`)
      setForm({ ...emptyDay(), business_date: form.business_date })
      load()
    } catch (e) { toast.error(e?.message || 'השמירה נכשלה') }
    finally { setSaving(false) }
  }

  async function remove(d) {
    if (!window.confirm(`למחוק את המחזור של ${fmtDate(d.business_date)}?`)) return
    try { await deleteSalesDay(d.id); setDays(x => x.filter(y => y.id !== d.id)); toast.success('נמחק') }
    catch (e) { toast.error(e?.message || 'המחיקה נכשלה') }
  }

  if (loading) return <LoadingSpinner />

  const IN = { height: 42, padding: '0 10px', borderRadius: 9, border: '1.5px solid var(--border)', background: 'var(--panel)', color: 'var(--text)', fontSize: 15, fontFamily: 'var(--font-main)', outline: 'none', boxSizing: 'border-box', width: '100%' }
  const LBL = { display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 5 }
  const card = { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px', boxShadow: 'var(--shadow-card)' }

  return (
    <div className="animate-fade-in" dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: isMobile ? 23 : 26, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <TrendingUp size={24} color="var(--accent)" /> הכנסות
        </h1>
        <p style={{ margin: '2px 0 0', fontSize: 14.5, color: 'var(--text-mute)', lineHeight: 1.6 }}>
          סגירת יום אחת ביום — וכבר אפשר לראות הכנסות מול הוצאות.
        </p>
      </div>

      {/* ── Period scope ───────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <CheckDropdown icon={Calendar} allLabel="כל השנים" width={isMobile ? 150 : 170}
          options={years.map(y => ({ value: y, label: String(y) }))}
          values={perYears} onChange={setPerYears} />
        <CheckDropdown icon={Calendar} allLabel="כל השנה" width={isMobile ? 150 : 170}
          options={HEB_MONTHS.map((lbl, i) => ({ value: i + 1, label: lbl }))}
          values={perMonths} onChange={setPerMonths} />
        <span style={{ fontSize: 12.5, color: 'var(--text-mute)' }}>
          מוצג: {periodLabel} · {totals.days === 1 ? 'יום אחד' : `${totals.days} ימים`}
        </span>
        {!isDefaultPeriod && (
          <button onClick={() => { setPerYears([new Date().getFullYear()]); setPerMonths([new Date().getMonth() + 1]) }}
            style={{ padding: '6px 12px', background: 'none', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, color: 'var(--text-mute)', cursor: 'pointer', fontFamily: 'var(--font-main)' }}>
            חזרה לחודש הנוכחי
          </button>
        )}
      </div>

      {/* ── Totals ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 10 }}>
        {[
          { label: 'מחזור', value: fmt(totals.gross), sub: periodLabel },
          { label: 'ממוצע ליום', value: totals.avgDay != null ? fmt(totals.avgDay) : '—', sub: `${totals.days} ימי פעילות` },
          { label: 'עסקאות', value: totals.transactions || '—', sub: totals.avgTicket != null ? `ממוצע לעסקה ${fmt(totals.avgTicket)}` : 'לא הוזן' },
          { label: 'מכירות לפי פריט', value: lines.length || '—', sub: lines.length ? 'מדוח הקופה' : 'יתמלא מדוח הקופה' },
        ].map(t => (
          <div key={t.label} style={{ ...card, padding: '12px 14px' }}>
            <div style={{ fontSize: 11.5, color: 'var(--text-mute)', fontWeight: 600 }}>{t.label}</div>
            <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--text)', marginTop: 2 }}>{t.value}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-mute)', marginTop: 2 }}>{t.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Close the day ──────────────────────────────────────────────────── */}
      <div style={card}>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 7 }}>
          <Plus size={15} color="var(--accent)" /> סגירת יום
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(5, 1fr)', gap: 10, alignItems: 'end' }}>
          <div>
            <label style={LBL}>תאריך</label>
            <DateInput value={form.business_date} onChange={e => setForm(f => ({ ...f, business_date: e.target.value }))} style={{ height: 42 }} />
          </div>
          <div>
            <label style={LBL}>מחזור (₪) *</label>
            <input type="number" min="0" step="any" value={form.gross} inputMode="decimal"
              onChange={e => setForm(f => ({ ...f, gross: e.target.value }))} style={IN} placeholder="0" dir="ltr" />
          </div>
          <div>
            <label style={LBL}>מספר עסקאות</label>
            <input type="number" min="0" value={form.transactions}
              onChange={e => setForm(f => ({ ...f, transactions: e.target.value }))} style={IN} placeholder="—" dir="ltr" />
          </div>
          <div>
            <label style={LBL}>מזה מזומן</label>
            <input type="number" min="0" step="any" value={form.cash}
              onChange={e => setForm(f => ({ ...f, cash: e.target.value }))} style={IN} placeholder="—" dir="ltr" />
          </div>
          <button onClick={submit} disabled={saving || form.gross === ''}
            style={{ height: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 9, border: 'none', background: (saving || form.gross === '') ? 'var(--border)' : 'var(--accent)', color: '#fff', fontSize: 14.5, fontWeight: 700, cursor: (saving || form.gross === '') ? 'default' : 'pointer', fontFamily: 'var(--font-main)' }}>
            <Check size={16} /> {saving ? 'שומר…' : 'שמור'}
          </button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: 8, lineHeight: 1.6 }}>
          הזנה חוזרת לאותו תאריך מתקנת את היום ואינה מוסיפה מחזור כפול.
        </div>
      </div>

      {/* ── Monthly revenue ────────────────────────────────────────────────── */}
      {hasAny && (
        <div style={card}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 7 }}>
            <TrendingUp size={15} color="var(--accent)" /> מחזור חודשי
          </div>
          <MonthlyBars data={series[0]?.data || []} series={series.length > 1 ? series : null}
            year={chartYears.join(' + ')} color="#16a34a" countNoun="ימים" />
          {series.length === 1 && (
            <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-dim)', paddingTop: 4 }}>{chartYears[0]}</div>
          )}
        </div>
      )}

      {/* ── The days themselves ────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {visibleDays.length === 0 && (
          <div style={{ ...card, textAlign: 'center', color: 'var(--text-mute)', padding: '34px 16px' }}>
            <p style={{ fontWeight: 600, color: 'var(--text)', margin: '0 0 4px' }}>אין עדיין מחזור ב{periodLabel}</p>
            <p style={{ fontSize: 14, margin: 0 }}>הזן את סגירת היום למעלה — זה ייקח רגע</p>
          </div>
        )}
        {visibleDays.map(d => {
          const total = dayTotal(d, lines)
          const detailed = lines.some(l => l.business_date === d.business_date)
          return (
            <div key={d.id} style={{ ...card, padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text)', minWidth: 96 }}>{fmtDate(d.business_date)}</span>
              <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--ok)' }}>{fmt(total)}</span>
              {d.transactions ? <span style={{ fontSize: 12.5, color: 'var(--text-mute)' }}>{d.transactions} עסקאות</span> : null}
              {detailed && <span style={{ fontSize: 11.5, color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 999, padding: '1px 8px' }}>לפי פריטים</span>}
              {d.source !== 'manual' && <span style={{ fontSize: 11.5, color: 'var(--text-mute)' }}>מקור: {d.source}</span>}
              <button onClick={() => remove(d)} title="מחק יום"
                style={{ marginInlineStart: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 4, display: 'flex' }}>
                <Trash2 size={15} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
