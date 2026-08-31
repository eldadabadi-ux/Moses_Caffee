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
import { FileText, Plus, Trash2, Pencil, Users, Calendar, Wand2, X } from 'lucide-react'
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
  const [loading, setLoading] = useState(true)
  const [edit, setEdit]       = useState(null)
  const [deleteId, setDeleteId] = useState(null)
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
      setHistory(flattenItems(recs || []).map(f => ({
        name: f.name, price_per_base_unit: f.price_per_base_unit ?? null, base_unit: f.base_unit ?? null,
      })))
    } catch (e) { toast.error('שגיאה בטעינה') }
    finally { setLoading(false) }
  }, [user])

  useEffect(() => { load() }, [load])

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

      {quotes.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-mute)', background: 'var(--panel)', border: '1px dashed var(--border)', borderRadius: 'var(--r-card)' }}>
          <FileText size={34} style={{ opacity: 0.35 }} />
          <p style={{ fontWeight: 600, color: 'var(--text)', margin: '10px 0 4px' }}>אין עדיין הצעות מחיר</p>
          <p style={{ fontSize: 14, margin: 0 }}>צור הצעה ראשונה לאירוע קייטרינג</p>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(330px, 1fr))', gap: 14 }}>
        {quotes.map(q => {
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }} dir="rtl">

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
                    <input value={l.item_name} onChange={e => setLine(i, { item_name: e.target.value, cost_per_base_unit: undefined })}
                      style={{ ...inp, height: 40 }} placeholder="שם הפריט" dir="auto" list="quote-products" />
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
              <datalist id="quote-products">
                {[...new Set(history.map(h => h.name))].slice(0, 300).map(n => <option key={n} value={n} />)}
              </datalist>

              <button onClick={addLine}
                style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 'var(--r-btn)', border: '1px dashed var(--border)', background: 'none', color: 'var(--text-mute)', fontSize: 13.5, cursor: 'pointer', fontFamily: 'var(--font-main)' }}>
                <Plus size={14} /> הוסף פריט
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 10 }}>
              <Field label='הנחה (%)'><input type="number" min="0" max="100" value={edit.discount_pct} onChange={e => setEdit({ ...edit, discount_pct: e.target.value })} style={inp} /></Field>
              <Field label='מע"מ (%)'><input type="number" min="0" value={edit.vat_rate} onChange={e => setEdit({ ...edit, vat_rate: e.target.value })} style={inp} /></Field>
            </div>

            {/* Live totals */}
            {totals && (
              <div style={{ background: 'var(--panel-2)', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 5, fontSize: 14 }}>
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

            <Field label="הערות"><textarea value={edit.notes} onChange={e => setEdit({ ...edit, notes: e.target.value })} style={{ ...inp, height: 64, paddingTop: 8, resize: 'vertical' }} dir="auto" /></Field>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setEdit(null)} style={{ flex: 1, padding: 12, borderRadius: 'var(--r-btn)', border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text-dim)', fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font-main)' }}>ביטול</button>
              <button onClick={save} disabled={saving} style={{ flex: 2, padding: 12, borderRadius: 'var(--r-btn)', border: 'none', background: saving ? 'var(--border)' : 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: saving ? 'default' : 'pointer', fontFamily: 'var(--font-main)' }}>
                {saving ? 'שומר…' : 'שמור הצעה'}
              </button>
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
