/**
 * EventQuotesPage — price quotes for catering events (client request #17).
 *
 * The revenue side of the events book. A quote is what Moses charges; it shares
 * units with the expense side so a line priced per ק"ג means the same ק"ג as the
 * purchase it came from — which is what makes "did this event make money?"
 * answerable rather than a guess.
 *
 * Costing is offered, never assumed: a line is costed from purchase history at
 * the MEDIAN price, and the margin figure appears only when every line is
 * costed, because a partial one flatters.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import CheckDropdown from '../components/CheckDropdown'
import { loadEventItems, saveEventItem, deleteEventItem, rememberQuoteLines } from '../lib/eventItems'
import ItemNameCombo from '../components/events/ItemNameCombo'
import MonthlyBars, { YEAR_COLORS } from '../components/charts/MonthlyBars'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useTenant } from '../hooks/useTenant'
import { useSettings } from '../hooks/useSettings'
import { flattenItems } from '../lib/itemAggregation'
import { QUOTE_UNITS, quoteTotals, suggestUnitPrice, costFromHistory } from '../lib/quotes'
import { unitLabel } from '../../functions/api/_lib/units.js'
import Modal from '../components/ui/Modal'
import DateInput from '../components/ui/DateInput'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { FileText, Plus, Trash2, Pencil, Users, Calendar, Wand2, X , List } from 'lucide-react'
import toast from 'react-hot-toast'

const fmt = n => `₪${(Number(n) || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDate = d => d ? d.split('-').reverse().join('.') : '—'

const STATUS = [
  { value: 'draft',    label: 'טיוטה',   color: 'var(--text-mute)' },
  { value: 'sent',     label: 'נשלחה',   color: '#2563eb' },
  { value: 'accepted', label: 'אושרה',   color: 'var(--ok)' },
  { value: 'declined', label: 'נדחתה',   color: 'var(--danger)' },
]
const statusOf = v => STATUS.find(s => s.value === v) || STATUS[0]

const HEB_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר']

const emptyQuote = (vatRate) => ({
  title: '', customer_name: '', customer_phone: '', event_date: '', guests: '',
  items: [{ item_name: '', quantity: 1, unit: 'unit', unit_price: '' }],
  vat_rate: vatRate, discount_pct: '', margin_pct: 35, status: 'draft', notes: '',
})

export default function EventQuotesPage() {
  const { user } = useAuth()
  const { orgId } = useTenant()
  const { settings } = useSettings()
  const isMobile = window.innerWidth < 768

  const [quotes, setQuotes]   = useState([])
  const [history, setHistory] = useState([])     // flattened purchase lines, for costing
  // The catering catalogue — what is SOLD at an event, priced to sell. Kept
  // apart from the scanned products, which are raw material at cost.
  const [catalog, setCatalog] = useState([])
  const [showCatalog, setShowCatalog] = useState(false)
  const [showNotes, setShowNotes]     = useState(false)
  const [loading, setLoading] = useState(true)
  const [edit, setEdit]       = useState(null)
  const [deleteId, setDeleteId] = useState(null)
  // Same scope rule as the receipts list (19.11.26): open on the current month,
  // widen on demand, and roll over by itself at each month and year boundary.
  const [perYears, setPerYears]   = useState(() => [new Date().getFullYear()])
  const [perMonths, setPerMonths] = useState(() => [new Date().getMonth() + 1])
  const [saving, setSaving]   = useState(false)

  const vatRate = settings?.vatRate ?? 18

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const [{ data: qs }, { data: recs }] = await Promise.all([
        supabase.from('event_quotes').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
        // Purchase history drives the cost suggestion. Café purchases are the
        // right basis — that is what the ingredients actually cost.
        supabase.from('receipts').select('vendor_name, items, receipt_date').eq('user_id', user.id).eq('book', 'cafe'),
      ])
      setQuotes(qs || [])
      setCatalog(await loadEventItems(user.id))
      setHistory(flattenItems(recs || []).map(f => ({
        name: f.name, price_per_base_unit: f.price_per_base_unit ?? null, base_unit: f.base_unit ?? null,
      })))
    } catch (e) { toast.error('שגיאה בטעינה') }
    finally { setLoading(false) }
  }, [user])

  useEffect(() => { load() }, [load])

  const yearOf  = q => parseInt(String(q.event_date || '').slice(0, 4), 10) || null
  const monthOf = q => parseInt(String(q.event_date || '').slice(5, 7), 10) || null

  const availYears = useMemo(() => {
    const ys = new Set([new Date().getFullYear()])
    for (const q of quotes) { const y = yearOf(q); if (y) ys.add(y) }
    return [...ys].sort((a, b) => b - a)
  }, [quotes])

  // A quote with no date yet is not scheduled anywhere — it must stay visible
  // in every scope, otherwise a draft would vanish the moment it is created.
  const visible = useMemo(() => quotes.filter(q => {
    if (!q.event_date) return true
    const y = yearOf(q), m = monthOf(q)
    if (perYears.length && !perYears.includes(y)) return false
    if (perMonths.length && !perMonths.includes(m)) return false
    return true
  }), [quotes, perYears, perMonths])

  const isDefaultPeriod = perYears.length === 1 && perYears[0] === new Date().getFullYear() &&
                          perMonths.length === 1 && perMonths[0] === new Date().getMonth() + 1
  const periodLabel = useMemo(() => {
    const ys = perYears.length ? [...perYears].sort((a, b) => b - a).join(' + ') : 'כל השנים'
    if (!perMonths.length) return ys
    return `${[...perMonths].sort((a, b) => a - b).map(m => HEB_MONTHS[m - 1]).join(', ')} ${ys}`
  }, [perYears, perMonths])

  // Events per month, one series per year. The chart always spans twelve
  // months — a month filter would leave a single bar — but it does follow the
  // year selection, so "2025 + 2026" compares exactly those two.
  const chartYears = useMemo(() => {
    const ys = perYears.length ? [...perYears] : [...new Set(quotes.map(yearOf).filter(Boolean))]
    return ys.sort((a, b) => a - b)
  }, [perYears, quotes])
  const monthlySeries = useMemo(() => chartYears.map(y => ({
    year: y,
    data: Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      total: quotes.filter(q => yearOf(q) === y && monthOf(q) === i + 1).length,
      count: quotes.filter(q => yearOf(q) === y && monthOf(q) === i + 1).length,
    })),
  })), [chartYears, quotes])
  const hasEventsInChart = monthlySeries.some(sr => sr.data.some(d => d.total > 0))

  const catalogByName = useMemo(
    () => new Map(catalog.map(c => [String(c.name || '').trim().toLowerCase(), c])),
    [catalog])

  /** Typing or picking a catalogue name fills in its unit and selling price. */
  function applyCatalogName(i, name) {
    const hit = catalogByName.get(String(name || '').trim().toLowerCase())
    if (!hit) { setLine(i, { item_name: name, cost_per_base_unit: undefined }); return }
    setLine(i, {
      item_name: name,
      unit: hit.unit || "יח'",
      unit_price: hit.unit_price ?? '',
      cost_per_base_unit: undefined,
    })
  }

  async function removeCatalogItem(it) {
    const before = catalog
    setCatalog(c => c.filter(x => x.id !== it.id))      // disappear immediately
    try {
      await deleteEventItem(it.id)
      toast.success(`"${it.name}" הוסר מהרשימה`)
    } catch (e) {
      setCatalog(before)                                 // put it back if the server refused
      toast.error(e?.message || 'ההסרה נכשלה')
    }
  }

  async function addCatalogItem(name, unit, price) {
    try {
      const saved = await saveEventItem(user.id, orgId, { name, unit, unit_price: price })
      if (saved) setCatalog(c => [...c.filter(x => x.id !== saved.id), saved].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'he')))
      return true
    } catch (e) { toast.error(e?.message || 'השמירה נכשלה'); return false }
  }

  /** A name typed straight into a line joins the catalogue — no extra step. */
  async function rememberTypedName(line) {
    const name = String(line?.item_name || '').trim()
    if (!name || catalogByName.has(name.toLowerCase())) return
    await addCatalogItem(name, line.unit, line.unit_price === '' || line.unit_price == null ? null : Number(line.unit_price))
  }

  const totals = useMemo(() => edit ? quoteTotals(edit) : null, [edit])

  // ── line editing ───────────────────────────────────────────────────────────
  const setLine = (i, patch) => setEdit(q => ({
    ...q, items: q.items.map((l, j) => j === i ? { ...l, ...patch } : l),
  }))
  const addLine = () => setEdit(q => ({ ...q, items: [...q.items, { item_name: '', quantity: 1, unit: 'unit', unit_price: '' }] }))
  const removeLine = (i) => setEdit(q => ({ ...q, items: q.items.filter((_, j) => j !== i) }))

  /** Price this line from what the product has actually cost, at the target margin. */
  function priceFromCost(i) {
    const line = edit.items[i]
    const found = costFromHistory(history, line.item_name)
    if (!found) { toast.error('לא נמצאה היסטוריית רכישה למוצר הזה'); return }
    const suggested = suggestUnitPrice(found.cost, line.unit, Number(edit.margin_pct) || 0)
    if (suggested == null) { toast.error('לא ניתן לתמחר ביחידה הזו'); return }
    setLine(i, { unit_price: suggested, cost_per_base_unit: found.cost })
    toast.success(`עלות ${fmt(found.cost)}/${unitLabel(found.base_unit)} · ${found.samples} רכישות`)
  }

  async function save() {
    if (!edit.title.trim()) { toast.error('צריך שם לאירוע'); return }
    setShowNotes(false)
    setSaving(true)
    try {
      const payload = {
        user_id: user.id, org_id: orgId || null,
        title: edit.title.trim(),
        customer_name: edit.customer_name || null,
        customer_phone: edit.customer_phone || null,
        event_date: edit.event_date || null,
        guests: edit.guests === '' ? null : Number(edit.guests),
        items: edit.items.filter(l => (l.item_name || '').trim()),
        vat_rate: Number(edit.vat_rate) || 18,
        discount_pct: edit.discount_pct === '' ? null : Number(edit.discount_pct),
        margin_pct: edit.margin_pct === '' ? null : Number(edit.margin_pct),
        status: edit.status, notes: edit.notes || null,
        updated_at: new Date().toISOString(),
      }
      const { error } = edit.id
        ? await supabase.from('event_quotes').update(payload).eq('id', edit.id)
        : await supabase.from('event_quotes').insert(payload)
      if (error) throw error
      // The catalogue learns from the work: a line typed here is available
      // next time, with the price that was actually quoted.
      await rememberQuoteLines(user.id, orgId, payload.items, catalog)
      toast.success(edit.id ? 'ההצעה עודכנה' : 'ההצעה נוצרה')
      setEdit(null); load()
    } catch (e) { toast.error('שגיאה בשמירה: ' + (e.message || '')) }
    finally { setSaving(false) }
  }

  async function remove() {
    const { error } = await supabase.from('event_quotes').delete().eq('id', deleteId)
    if (error) { toast.error('שגיאה במחיקה'); return }
    toast.success('ההצעה נמחקה'); setDeleteId(null); load()
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="animate-fade-in" dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: isMobile ? 23 : 26, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileText size={24} color="var(--accent)" /> הצעות מחיר לאירועים
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 14.5, color: 'var(--text-mute)', maxWidth: '62ch', lineHeight: 1.6 }}>
            מתומחר לפי יחידות מידה — יח', ק"ג, גרם, ליטר, קופסה, מגש. אפשר לתמחר שורה לפי מה
            שהמוצר באמת עלה בקבלות, עם אחוז רווח.
          </p>
        </div>
        <button onClick={() => setEdit(emptyQuote(vatRate))}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 'var(--r-btn)', border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-main)' }}>
          <Plus size={16} /> הצעה חדשה
        </button>
      </div>

      {/* ── Period scope ───────────────────────────────────────────────────── */}
      {true && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <CheckDropdown icon={Calendar} allLabel="כל השנים" width={isMobile ? 150 : 170}
            options={availYears.map(y => ({ value: y, label: String(y) }))}
            values={perYears} onChange={setPerYears} />
          <CheckDropdown icon={Calendar} allLabel="כל השנה" width={isMobile ? 150 : 170}
            options={HEB_MONTHS.map((lbl, i) => ({ value: i + 1, label: lbl }))}
            values={perMonths} onChange={setPerMonths} />
          <span style={{ fontSize: 12.5, color: 'var(--text-mute)', whiteSpace: 'nowrap' }}>
            {quotes.length === 0 ? 'התצוגה מתחילה בחודש הנוכחי' : `מוצג: ${periodLabel} · ${visible.length} אירועים`}
          </span>
          {!isDefaultPeriod && (
            <button onClick={() => { setPerYears([new Date().getFullYear()]); setPerMonths([new Date().getMonth() + 1]) }}
              style={{ padding: '6px 12px', background: 'none', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, color: 'var(--text-mute)', cursor: 'pointer', fontFamily: 'var(--font-main)', whiteSpace: 'nowrap' }}>
              חזרה לחודש הנוכחי
            </button>
          )}
        </div>
      )}

      {/* ── Events per month, split by year ────────────────────────────────── */}
      {true && (
        <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px', boxShadow: 'var(--shadow-card)' }}>
          <div style={{ margin: '0 0 6px', fontSize: 14.5, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 7 }}>
            <Calendar size={15} color="var(--accent)" /> מספר אירועים בכל חודש
          </div>
          <MonthlyBars data={monthlySeries[0]?.data || []} series={monthlySeries.length > 1 ? monthlySeries : null}
            year={chartYears.join(' + ')} unit="count" countNoun="אירועים"
            color={YEAR_COLORS[0]} />
          {monthlySeries.length === 1 && (
            <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-dim)', paddingTop: 4 }}>{chartYears[0]}</div>
          )}
          {!hasEventsInChart && (
            <div style={{ textAlign: 'center', fontSize: 12.5, color: 'var(--text-mute)', paddingTop: 6, lineHeight: 1.6 }}>
              הגרף יתמלא מעצמו: כל הצעה שתקבל תאריך אירוע תיספר בחודש שלה, וכל שנה תקבל צבע משלה.
            </div>
          )}
        </div>
      )}

      {quotes.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-mute)', background: 'var(--panel)', border: '1px dashed var(--border)', borderRadius: 'var(--r-card)' }}>
          <FileText size={34} style={{ opacity: 0.35 }} />
          <p style={{ fontWeight: 600, color: 'var(--text)', margin: '10px 0 4px' }}>אין עדיין הצעות מחיר</p>
          <p style={{ fontSize: 14, margin: 0 }}>צור הצעה ראשונה לאירוע קייטרינג — היא תופיע כאן ותיספר בגרף שלמעלה</p>
        </div>
      )}

      {quotes.length > 0 && visible.length === 0 && (
        <div style={{ textAlign: 'center', padding: '36px 20px', color: 'var(--text-mute)', background: 'var(--panel)', border: '1px dashed var(--border)', borderRadius: 'var(--r-card)' }}>
          <p style={{ fontWeight: 600, color: 'var(--text)', margin: '0 0 4px' }}>אין אירועים ב{periodLabel}</p>
          <p style={{ fontSize: 14, margin: 0 }}>ההצעות הקודמות שמורות — ניתן להרחיב את התצוגה</p>
          <button onClick={() => setPerMonths([])}
            style={{ marginTop: 12, padding: '9px 18px', borderRadius: 10, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-main)' }}>
            הצג את כל השנה
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(330px, 1fr))', gap: 14 }}>
        {visible.map(q => {
          const t = quoteTotals(q)
          const st = statusOf(q.status)
          return (
            <div key={q.id} style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: 'var(--shadow-card)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.title}</span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: st.color, border: `1px solid ${st.color}`, borderRadius: 999, padding: '2px 9px', whiteSpace: 'nowrap' }}>{st.label}</span>
              </div>

              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 13, color: 'var(--text-mute)' }}>
                {q.event_date && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Calendar size={13} /> {fmtDate(q.event_date)}</span>}
                {q.guests > 0 && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Users size={13} /> {q.guests} אורחים</span>}
                {q.customer_name && <span>{q.customer_name}</span>}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: t.per_guest ? '1fr 1fr' : '1fr', gap: 6, background: 'var(--panel-2)', borderRadius: 10, padding: '9px 10px' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 10.5, color: 'var(--text-mute)' }}>סה"כ כולל מע"מ</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ok)' }}>{fmt(t.total)}</div>
                </div>
                {t.per_guest && (
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 10.5, color: 'var(--text-mute)' }}>לאורח</div>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{fmt(t.per_guest)}</div>
                  </div>
                )}
              </div>

              {t.fully_costed && (
                <div style={{ fontSize: 12.5, color: 'var(--text-mute)' }}>
                  עלות {fmt(t.cost)} · רווח <strong style={{ color: 'var(--ok)' }}>{fmt(t.profit)}</strong> ({t.margin_pct}%)
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                <button onClick={() => setEdit({ ...q, guests: q.guests ?? '', discount_pct: q.discount_pct ?? '', margin_pct: q.margin_pct ?? 35, items: q.items?.length ? q.items : [{ item_name: '', quantity: 1, unit: 'unit', unit_price: '' }] })}
                  style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '8px', borderRadius: 'var(--r-btn)', border: '1px solid var(--accent)', background: 'var(--accent-bg)', color: 'var(--accent)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-main)' }}>
                  <Pencil size={14} /> ערוך
                </button>
                <button onClick={() => setDeleteId(q.id)} title="מחק"
                  style={{ padding: '8px 11px', borderRadius: 'var(--r-btn)', border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--danger)', cursor: 'pointer' }}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Editor ─────────────────────────────────────────────────────────── */}
      {edit && (
        <Modal isOpen onClose={() => setEdit(null)} title={edit.id ? 'עריכת הצעת מחיר' : 'הצעת מחיר חדשה'} size="lg">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} dir="rtl">

            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr', gap: 10 }}>
              <Field label="שם האירוע">
                <input value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })} style={inp} placeholder="חתונה של דנה" dir="auto" />
              </Field>
              <Field label="סטטוס">
                <select value={edit.status} onChange={e => setEdit({ ...edit, status: e.target.value })} style={inp}>
                  {STATUS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </Field>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(4, 1fr)', gap: 10 }}>
              <Field label="לקוח"><input value={edit.customer_name} onChange={e => setEdit({ ...edit, customer_name: e.target.value })} style={inp} dir="auto" /></Field>
              <Field label="טלפון"><input value={edit.customer_phone} onChange={e => setEdit({ ...edit, customer_phone: e.target.value })} style={inp} dir="ltr" /></Field>
              <Field label="תאריך האירוע"><DateInput value={edit.event_date} onChange={e => setEdit({ ...edit, event_date: e.target.value })} style={{ height: 44 }} /></Field>
              <Field label="מספר אורחים"><input type="number" min="0" value={edit.guests} onChange={e => setEdit({ ...edit, guests: e.target.value })} style={inp} /></Field>
            </div>

            {/* Lines */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <label style={lbl}>פריטים</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-mute)' }}>
                  אחוז רווח לתמחור אוטומטי
                  <input type="number" min="0" max="95" value={edit.margin_pct}
                    onChange={e => setEdit({ ...edit, margin_pct: e.target.value })}
                    style={{ ...inp, height: 32, width: 66, fontSize: 14 }} />%
                </label>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {edit.items.map((l, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2.2fr 0.8fr 1fr 1fr auto auto', gap: 7, alignItems: 'center' }}>
                    <ItemNameCombo
                      value={l.item_name}
                      onChange={name => setLine(i, { item_name: name, cost_per_base_unit: undefined })}
                      onPick={it => setLine(i, { item_name: it.name, unit: it.unit || 'unit', unit_price: it.unit_price ?? '', cost_per_base_unit: undefined })}
                      catalog={catalog}
                      onDelete={removeCatalogItem}
                      onAddNew={name => addCatalogItem(name, l.unit, l.unit_price === '' ? null : Number(l.unit_price))}
                      onCommit={() => rememberTypedName(l)}
                      unitLabel={u => (QUOTE_UNITS.find(x => x.value === u) || {}).label || u}
                      style={{ ...inp, height: 38 }} />
                    <input type="number" min="0" step="any" value={l.quantity} onChange={e => setLine(i, { quantity: e.target.value })}
                      style={{ ...inp, height: 40 }} placeholder="כמות" />
                    <select value={l.unit} onChange={e => setLine(i, { unit: e.target.value })} style={{ ...inp, height: 40 }}>
                      {QUOTE_UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
                    </select>
                    <input type="number" min="0" step="any" value={l.unit_price} onChange={e => setLine(i, { unit_price: e.target.value, cost_per_base_unit: undefined })}
                      style={{ ...inp, height: 40 }} placeholder="מחיר ליחידה" />
                    <button onClick={() => priceFromCost(i)} title="תמחר לפי העלות בפועל + אחוז רווח"
                      style={{ height: 40, padding: '0 11px', borderRadius: 'var(--r-btn)', border: '1px solid var(--accent)', background: 'var(--accent-bg)', color: 'var(--accent)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                      <Wand2 size={15} />
                    </button>
                    <button onClick={() => removeLine(i)} title="הסר"
                      style={{ height: 40, padding: '0 10px', borderRadius: 'var(--r-btn)', border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text-mute)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                      <X size={15} />
                    </button>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 7, flexWrap: 'wrap' }}>
                <button onClick={addLine}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 'var(--r-btn)', border: '1px dashed var(--border)', background: 'none', color: 'var(--text-mute)', fontSize: 13.5, cursor: 'pointer', fontFamily: 'var(--font-main)' }}>
                  <Plus size={14} /> הוסף שורה
                </button>
                <button onClick={() => setShowCatalog(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 'var(--r-btn)', border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text-dim)', fontSize: 13.5, cursor: 'pointer', fontFamily: 'var(--font-main)' }}>
                  <List size={14} /> רשימת הפריטים ({catalog.length})
                </button>
                <span style={{ fontSize: 12, color: 'var(--text-mute)' }}>פריט חדש נשמר לרשימה בעת שמירת ההצעה</span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', fontSize: 13, color: 'var(--text-mute)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                הנחה
                <input type="number" min="0" max="100" value={edit.discount_pct} onChange={e => setEdit({ ...edit, discount_pct: e.target.value })}
                  style={{ ...inp, height: 32, width: 66, fontSize: 14 }} />%
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                מע"מ
                <input type="number" min="0" value={edit.vat_rate} onChange={e => setEdit({ ...edit, vat_rate: e.target.value })}
                  style={{ ...inp, height: 32, width: 66, fontSize: 14 }} />%
              </label>
            </div>

            {/* Live totals */}
            {totals && (
              <div style={{ background: 'var(--panel-2)', borderRadius: 12, padding: '9px 12px', display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', columnGap: 18, rowGap: 2, fontSize: 13.5 }}>
                <Row label="סכום ביניים" value={fmt(totals.subtotal)} />
                {totals.discount > 0 && <Row label={`הנחה ${totals.discount_pct}%`} value={`− ${fmt(totals.discount)}`} />}
                <Row label={`מע"מ ${totals.vat_rate}%`} value={fmt(totals.vat)} />
                <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
                <Row label="סה״כ לתשלום" value={fmt(totals.total)} bold />
                {totals.per_guest && <Row label={`לאורח (${totals.guests})`} value={fmt(totals.per_guest)} />}
                {totals.fully_costed
                  ? <Row label={`עלות ${fmt(totals.cost)} · רווח`} value={`${fmt(totals.profit)} (${totals.margin_pct}%)`} />
                  : <div style={{ fontSize: 12.5, color: 'var(--text-mute)', marginTop: 2 }}>
                      תמחר את כל השורות לפי עלות (הכפתור עם השרביט) כדי לראות רווח
                    </div>}
              </div>
            )}

            {(showNotes || edit.notes) ? (
              <Field label="הערות"><textarea value={edit.notes} onChange={e => setEdit({ ...edit, notes: e.target.value })} style={{ ...inp, height: 44, paddingTop: 7, resize: 'vertical' }} dir="auto" autoFocus={showNotes && !edit.notes} /></Field>
            ) : (
              <button onClick={() => setShowNotes(true)}
                style={{ alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0, color: 'var(--accent)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-main)' }}>
                + הוספת הערה
              </button>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setEdit(null)} style={{ flex: 1, padding: 10, borderRadius: 'var(--r-btn)', border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text-dim)', fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font-main)' }}>ביטול</button>
              <button onClick={save} disabled={saving} style={{ flex: 2, padding: 10, borderRadius: 'var(--r-btn)', border: 'none', background: saving ? 'var(--border)' : 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: saving ? 'default' : 'pointer', fontFamily: 'var(--font-main)' }}>
                {saving ? 'שומר…' : 'שמור הצעה'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── The catering catalogue ─────────────────────────────────────────── */}
      {showCatalog && (
        <Modal isOpen onClose={() => setShowCatalog(false)} title="רשימת הפריטים לאירועים" size="sm">
          <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-mute)', lineHeight: 1.6 }}>
              אלה הפריטים שאתה מוכר באירוע, עם מחיר המכירה שלהם. הם נפרדים מהמוצרים שנסרקו
              מהקבלות — שם מופיעים חומרי הגלם במחירי העלות.
            </p>

            <CatalogAdd onAdd={addCatalogItem} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '46dvh', overflowY: 'auto' }}>
              {catalog.length === 0 && (
                <div style={{ fontSize: 13.5, color: 'var(--text-mute)', padding: '10px 2px' }}>
                  הרשימה ריקה. הוסף פריט כאן, או פשוט רשום אותו בהצעת מחיר — הוא יישמר אוטומטית.
                </div>
              )}
              {catalog.map(it => (
                <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel-2)' }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
                  <span style={{ fontSize: 13, color: 'var(--text-mute)', whiteSpace: 'nowrap' }}>
                    {it.unit_price != null ? fmt(it.unit_price) : '—'} / {(QUOTE_UNITS.find(u => u.value === it.unit) || {}).label || it.unit}
                  </span>
                  <button onClick={() => removeCatalogItem(it)} title="הסר מהרשימה"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 4, display: 'flex' }}>
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </Modal>
      )}

      {deleteId && (
        <ConfirmDialog isOpen title="למחוק את ההצעה?" message="הפעולה אינה הפיכה."
          confirmText="מחק" onConfirm={remove} onCancel={() => setDeleteId(null)} danger />
      )}
    </div>
  )
}

const inp = { display: 'block', width: '100%', boxSizing: 'border-box', height: 44, padding: '0 12px', borderRadius: 'var(--r-btn)', border: '1.5px solid var(--border)', background: 'var(--panel)', color: 'var(--text)', fontSize: 15, fontFamily: 'var(--font-main)', outline: 'none' }
const lbl = { display: 'block', fontSize: 13.5, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 6 }

/** Add one catalogue entry — its own state, so typing here never re-renders the quote. */
function CatalogAdd({ onAdd }) {
  const [name, setName]   = useState('')
  const [unit, setUnit]   = useState('unit')
  const [price, setPrice] = useState('')
  const [busy, setBusy]   = useState(false)
  async function submit() {
    if (!name.trim() || busy) return
    setBusy(true)
    const ok = await onAdd(name.trim(), unit, price === '' ? null : Number(price))
    setBusy(false)
    if (ok) { setName(''); setPrice('') }
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 0.9fr 0.9fr auto', gap: 6, alignItems: 'center' }}>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="מגש פירות" dir="auto"
        onKeyDown={e => { if (e.key === 'Enter') submit() }}
        style={{ ...inp, height: 38 }} />
      <select value={unit} onChange={e => setUnit(e.target.value)} style={{ ...inp, height: 38 }}>
        {QUOTE_UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
      </select>
      <input type="number" min="0" step="any" value={price} onChange={e => setPrice(e.target.value)} placeholder="מחיר"
        onKeyDown={e => { if (e.key === 'Enter') submit() }}
        style={{ ...inp, height: 38 }} />
      <button onClick={submit} disabled={busy || !name.trim()}
        style={{ height: 38, padding: '0 14px', borderRadius: 'var(--r-btn)', border: 'none', background: (busy || !name.trim()) ? 'var(--border)' : 'var(--accent)', color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: (busy || !name.trim()) ? 'default' : 'pointer', fontFamily: 'var(--font-main)' }}>
        הוסף
      </button>
    </div>
  )
}

function Field({ label, children }) {
  return <div><label style={lbl}>{label}</label>{children}</div>
}
function Row({ label, value, bold }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: bold ? 700 : 400, fontSize: bold ? 16 : 14 }}>
      <span style={{ color: bold ? 'var(--text)' : 'var(--text-mute)' }}>{label}</span>
      <span style={{ color: bold ? 'var(--ok)' : 'var(--text)' }}>{value}</span>
    </div>
  )
}
