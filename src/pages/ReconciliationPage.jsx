/**
 * ReconciliationPage — "התאמות": compare each supplier's summary invoice
 * (חשבונית מרכזת) against the delivery notes (תעודות משלוח) it aggregates,
 * flag mismatches, and persist confirmed matches (see lib/reconciliation.js).
 */
import { useState, useEffect, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getCached, setCached, hasCached } from '../lib/pageCache'
import { docTypeOf } from '../lib/docTypes'
import { findCandidates, matchInvoice, confirmMatch, unconfirmMatch, normalizeVendor, docNumberOf, TOLERANCE } from '../lib/reconciliation'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import toast from 'react-hot-toast'
import { ArrowLeftRight, ChevronRight, ChevronLeft, CheckCircle2, AlertTriangle, Clock, RotateCcw, Receipt, Truck, Download } from 'lucide-react'

const fmtDate = d => d ? d.split('-').reverse().join('.') : '—'
const fmtILS  = n => `₪${parseFloat(n || 0).toLocaleString('he-IL', { minimumFractionDigits: 2 })}`
const HEB_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר']
const monthLabel = ym => ym ? `${HEB_MONTHS[parseInt(ym.slice(5, 7), 10) - 1]} ${ym.slice(0, 4)}` : ''
const shiftMonth = (ym, d) => {
  const [y, m] = ym.split('-').map(Number)
  const dt = new Date(y, m - 1 + d, 1)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
}

// Status strip config
const STATUS = {
  matched:  { color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0', icon: CheckCircle2, label: () => '✓ תואם' },
  rounding: { color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0', icon: CheckCircle2, label: r => `✓ תואם (הפרש עיגול ${fmtILS(Math.abs(r.delta))})` },
  mismatch: { color: '#dc2626', bg: '#fef2f2', border: '#fecaca', icon: AlertTriangle, label: r => `⚠ פער של ${fmtILS(Math.abs(r.delta))}` },
}

function StatusStrip({ result }) {
  const s = STATUS[result.status] || STATUS.mismatch
  const Icon = s.icon
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, background:s.bg, border:`1px solid ${s.border}`, borderRadius:10, padding:'9px 13px', fontSize:14, fontWeight:700, color:s.color }}>
      <Icon size={16} />
      <span>{s.label(result)}</span>
      <span style={{ marginInlineStart:'auto', fontWeight:600, fontSize:12.5, color:'var(--text-dim)' }}>
        חשבונית {fmtILS(result.invoiceTotal)} מול {result.notes.length} תעודות {fmtILS(result.notesTotal)}
      </span>
    </div>
  )
}

// ── One supplier invoice card (open = interactive matching) ──────────────────
function InvoiceCard({ invoice, receipts, autoExpand, onChanged }) {
  const confirmed = !!invoice.reconciliation
  const candidates = useMemo(() => findCandidates(receipts, invoice), [receipts, invoice])
  const candKey = candidates.map(c => c.id).join(',')
  const [included, setIncluded] = useState(() => new Set(candidates.map(c => c.id)))
  useEffect(() => { setIncluded(new Set(candidates.map(c => c.id))) }, [candKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const [expanded, setExpanded] = useState(autoExpand || !confirmed)
  const [busy, setBusy] = useState(false)

  const result = useMemo(
    () => matchInvoice(invoice, candidates.filter(c => included.has(c.id))),
    [invoice, candidates, included])

  async function doConfirm() {
    if (busy) return
    setBusy(true)
    try {
      await confirmMatch(supabase, invoice, result, [...included])
      toast.success(result.status === 'mismatch' ? 'ההתאמה נשמרה — שים לב לפער!' : 'ההתאמה אושרה ✓')
      window.dispatchEvent(new Event('reconcile-changed'))
      onChanged()
    } catch (e) {
      toast.error(e.migrationMissing
        ? 'נדרש עדכון בסיס נתונים — יש להריץ את supabase_doctype.sql ב-Supabase'
        : 'שגיאה באישור: ' + (e?.message || ''), { duration: 7000 })
    } finally { setBusy(false) }
  }

  async function doUnconfirm() {
    if (busy) return
    setBusy(true)
    try {
      await unconfirmMatch(supabase, invoice.id)
      toast.success('ההתאמה בוטלה — התעודות שוחררו')
      window.dispatchEvent(new Event('reconcile-changed'))
      onChanged()
    } catch (e) { toast.error('שגיאה: ' + (e?.message || '')) }
    finally { setBusy(false) }
  }

  async function countAsExpense() {
    if (busy) return
    setBusy(true)
    try {
      const { error } = await supabase.from('receipts').update({ doc_type: 'receipt' }).eq('id', invoice.id)
      if (error) throw error
      toast.success('המסמך סווג כקבלה רגילה — ייספר בהוצאות')
      window.dispatchEvent(new Event('reconcile-changed'))
      onChanged()
    } catch (e) { toast.error('שגיאה: ' + (e?.message || '')) }
    finally { setBusy(false) }
  }

  const snap = invoice.reconciliation
  const headerStatus = confirmed
    ? (snap.status === 'mismatch'
        ? <span style={{ fontSize:12, fontWeight:700, color:'#dc2626', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:6, padding:'2px 8px' }}>⚠ פער {fmtILS(Math.abs(snap.delta))}</span>
        : <span style={{ fontSize:12, fontWeight:700, color:'#16a34a', background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:6, padding:'2px 8px' }}>✓ מותאם</span>)
    : <span style={{ fontSize:12, fontWeight:700, color:'var(--warn)', background:'var(--warn-tint-1)', border:'1px solid var(--warn-tint-border)', borderRadius:6, padding:'2px 8px' }}>ממתין לאישור התאמה</span>

  return (
    <div id={`inv-${invoice.id}`} style={{ background:'var(--panel)', border:'1px solid var(--border)', borderRadius:'var(--r-card)', boxShadow:'var(--shadow-card)', overflow:'hidden' }}>
      {/* Header */}
      <button onClick={() => setExpanded(e => !e)}
        style={{ width:'100%', display:'flex', alignItems:'center', gap:10, padding:'14px 16px', background:'none', border:'none', cursor:'pointer', fontFamily:'var(--font-main)', textAlign:'right' }}>
        <span style={{ fontSize:18 }}>📑</span>
        <span style={{ fontWeight:700, fontSize:16, color:'var(--text)' }}>{invoice.vendor_name || 'ספק לא ידוע'}</span>
        {headerStatus}
        <span style={{ marginInlineStart:'auto', display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:15, fontWeight:800, color:'var(--text)' }}>{fmtILS(invoice.amount)}</span>
          <span style={{ fontSize:12.5, color:'var(--text-mute)' }}>{fmtDate(invoice.receipt_date)}{docNumberOf(invoice) ? ` · חשבונית ${docNumberOf(invoice)}` : ''}</span>
          <ChevronLeft size={16} style={{ color:'var(--text-mute)', transform: expanded ? 'rotate(-90deg)' : 'none', transition:'transform 160ms' }} />
        </span>
      </button>

      {expanded && (
        <div style={{ padding:'0 16px 16px', display:'flex', flexDirection:'column', gap:12 }}>
          {confirmed ? (
            <>
              {/* Confirmed snapshot */}
              <div style={{ background:'var(--panel-2)', borderRadius:10, border:'1px solid var(--border)', padding:'6px 12px' }}>
                {(snap.notes || []).map((n, i) => (
                  <div key={n.id || i} style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 0', borderBottom: i < snap.notes.length - 1 ? '1px solid var(--border)' : 'none', fontSize:13.5 }}>
                    <Truck size={14} style={{ color:'var(--accent)', flexShrink:0 }} />
                    <span style={{ color:'var(--text-mute)' }}>{fmtDate(n.date)}</span>
                    {n.doc_number && <span style={{ color:'var(--text-mute)' }}>תעודה {n.doc_number}</span>}
                    <span style={{ marginInlineStart:'auto', fontWeight:700, color:'var(--text)' }}>{fmtILS(n.amount)}</span>
                    {n.ref_amount != null && Math.abs(n.diff) > TOLERANCE
                      ? <span title={`בחשבונית: ${fmtILS(n.ref_amount)}`} style={{ color:'#dc2626', fontWeight:700, fontSize:12 }}>⚠ {fmtILS(Math.abs(n.diff))}</span>
                      : n.ref_amount != null && <span style={{ color:'#16a34a', fontSize:13 }}>✓</span>}
                  </div>
                ))}
              </div>
              {(snap.refs_unmatched || []).length > 0 && (
                <div style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:10, padding:'9px 13px', fontSize:13, color:'#991b1b', lineHeight:1.6 }}>
                  {snap.refs_unmatched.map((ref, i) => (
                    <div key={i}>⚠ תעודה {ref.note_number || '?'} ({fmtILS(ref.amount)}) מופיעה בחשבונית אך לא נסרקה באפליקציה</div>
                  ))}
                </div>
              )}
              <StatusStrip result={{ status: snap.status, delta: snap.delta, invoiceTotal: snap.invoice_total, notesTotal: snap.notes_total, notes: snap.notes || [] }} />
              <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
                <button onClick={doUnconfirm} disabled={busy}
                  style={{ display:'flex', alignItems:'center', gap:6, padding:'9px 14px', borderRadius:9, border:'1px solid var(--border)', background:'var(--panel)', color:'var(--text-dim)', fontSize:13, cursor:'pointer', fontFamily:'var(--font-main)' }}>
                  <RotateCcw size={14} /> בטל התאמה
                </button>
              </div>
            </>
          ) : candidates.length === 0 ? (
            <>
              <div style={{ background:'var(--warn-tint-1)', border:'1px solid var(--warn-tint-border)', borderRadius:10, padding:'11px 14px', fontSize:13.5, color:'var(--text)', lineHeight:1.7 }}>
                לא נמצאו תעודות משלוח פתוחות של <strong>{invoice.vendor_name}</strong> (עד 60 יום לפני תאריך החשבונית).<br/>
                אם זו חשבונית רגילה (לא מרכזת) — סמן "ספור כהוצאה". אם תעודות המשלוח טרם נסרקו — סרוק אותן וחזור לכאן.
              </div>
              <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
                <button onClick={countAsExpense} disabled={busy}
                  style={{ display:'flex', alignItems:'center', gap:6, padding:'9px 14px', borderRadius:9, border:'none', background:'var(--accent)', color:'white', fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:'var(--font-main)' }}>
                  <Receipt size={14} /> ספור כהוצאה (קבלה רגילה)
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Candidate delivery notes with include/exclude checkboxes */}
              <div style={{ background:'var(--panel-2)', borderRadius:10, border:'1px solid var(--border)', padding:'6px 12px' }}>
                {candidates.map((n, i) => {
                  const row = result.notes.find(x => x.id === n.id)
                  const on = included.has(n.id)
                  return (
                    <label key={n.id} style={{ display:'flex', alignItems:'center', gap:9, padding:'8px 0', borderBottom: i < candidates.length - 1 ? '1px solid var(--border)' : 'none', fontSize:13.5, cursor:'pointer', opacity: on ? 1 : 0.45 }}>
                      <input type="checkbox" checked={on} onChange={() => setIncluded(prev => { const next = new Set(prev); next.has(n.id) ? next.delete(n.id) : next.add(n.id); return next })}
                        style={{ width:16, height:16, accentColor:'var(--accent)', cursor:'pointer' }} />
                      <Truck size={14} style={{ color:'var(--accent)', flexShrink:0 }} />
                      <span style={{ color:'var(--text-mute)' }}>{fmtDate(n.receipt_date)}</span>
                      {docNumberOf(n) && <span style={{ color:'var(--text-mute)' }}>תעודה {docNumberOf(n)}</span>}
                      <span style={{ marginInlineStart:'auto', fontWeight:700, color:'var(--text)' }}>{fmtILS(n.amount)}</span>
                      {row?.ref_amount != null && (Math.abs(row.diff) > TOLERANCE
                        ? <span title={`בחשבונית מופיע: ${fmtILS(row.ref_amount)}`} style={{ color:'#dc2626', fontWeight:700, fontSize:12 }}>⚠ פער {fmtILS(Math.abs(row.diff))}</span>
                        : <span title="תואם לשורה בחשבונית" style={{ color:'#16a34a', fontSize:13 }}>✓</span>)}
                    </label>
                  )
                })}
              </div>
              {result.refsUnmatched.length > 0 && (
                <div style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:10, padding:'9px 13px', fontSize:13, color:'#991b1b', lineHeight:1.6 }}>
                  {result.refsUnmatched.map((ref, i) => (
                    <div key={i}>⚠ תעודה {ref.note_number || '?'}{ref.note_date ? ` מ-${fmtDate(ref.note_date)}` : ''} ({fmtILS(ref.amount)}) מופיעה בחשבונית אך לא נמצאה באפליקציה</div>
                  ))}
                </div>
              )}
              <StatusStrip result={result} />
              <div style={{ display:'flex', gap:8, justifyContent:'flex-end', flexWrap:'wrap' }}>
                <button onClick={doConfirm} disabled={busy || included.size === 0}
                  style={{ display:'flex', alignItems:'center', gap:6, padding:'10px 18px', borderRadius:9, border:'none',
                    background: (busy || included.size === 0) ? 'var(--panel-2)' : result.status === 'mismatch' ? '#d97706' : 'linear-gradient(135deg,#16a34a,#15803d)',
                    color: (busy || included.size === 0) ? 'var(--text-mute)' : 'white', fontSize:14, fontWeight:700, cursor:(busy || included.size === 0) ? 'default' : 'pointer', fontFamily:'var(--font-main)' }}>
                  <CheckCircle2 size={15} /> {busy ? 'שומר…' : result.status === 'mismatch' ? 'אשר למרות הפער' : 'אשר התאמה'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Supplier still waiting for its monthly invoice ────────────────────────────
function WaitingCard({ vendor, notes }) {
  const total = notes.reduce((s, n) => s + (parseFloat(n.amount) || 0), 0)
  return (
    <div style={{ background:'var(--panel)', border:'1px dashed var(--border)', borderRadius:'var(--r-card)', padding:'14px 16px', display:'flex', alignItems:'center', gap:10 }}>
      <Clock size={17} style={{ color:'var(--text-mute)', flexShrink:0 }} />
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontWeight:700, fontSize:15, color:'var(--text)' }}>{vendor}</div>
        <div style={{ fontSize:12.5, color:'var(--text-mute)', marginTop:2 }}>ממתין לחשבונית מרכזת · {notes.length} תעודות משלוח פתוחות</div>
      </div>
      <span style={{ fontSize:15, fontWeight:800, color:'var(--text)' }}>{fmtILS(total)}</span>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ReconciliationPage() {
  const location = useLocation()
  const isMobile = window.innerWidth < 768
  const [receipts, setReceipts] = useState(() => getCached('receipts') || [])
  const [loading, setLoading]   = useState(() => !hasCached('receipts'))
  const [migrationMissing, setMigrationMissing] = useState(false)
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const focusInvoice = useMemo(() => new URLSearchParams(location.search).get('invoice') || '', [location.search])

  async function loadData() {
    try {
      const { data, error } = await supabase
        .from('receipts').select('*').is('archived_at', null)
        .order('receipt_date', { ascending: false })
      if (error) throw error
      setReceipts(data || []); setCached('receipts', data || [])
    } catch (err) { toast.error('שגיאה בטעינה: ' + (err?.message || '')) }
    finally { setLoading(false) }
  }
  useEffect(() => { loadData() }, [])

  // Detect whether supabase_doctype.sql has been applied.
  useEffect(() => {
    supabase.from('receipts').select('doc_type').limit(1).then(({ error }) => {
      if (error && /doc_type/.test(error.message || '')) setMigrationMissing(true)
    })
  }, [])

  // Download the reconciliation document (RTL print HTML → PDF), scoped to the
  // current month view — same file that joins the accountant-export ZIP.
  async function downloadDoc() {
    try {
      const [{ buildReconciliationHtml }, { downloadFile }] = await Promise.all([
        import('../lib/receiptExport'), import('../lib/downloadFile'),
      ])
      const html = buildReconciliationHtml(receipts, { month, periodLabel: monthLabel(month) })
      await downloadFile({ blob: new Blob([html], { type: 'text/html;charset=utf-8' }), filename: `דוח_התאמות_${month}.html` })
      toast.success('הדוח הורד — פתח אותו והדפס / שמור כ-PDF')
    } catch (err) { toast.error('שגיאה בהורדה: ' + (err?.message || '')) }
  }

  // Scroll to a deep-linked invoice (after a summary-invoice scan).
  useEffect(() => {
    if (!focusInvoice || loading) return
    const t = setTimeout(() => document.getElementById(`inv-${focusInvoice}`)?.scrollIntoView({ behavior:'smooth', block:'start' }), 250)
    return () => clearTimeout(t)
  }, [focusInvoice, loading])

  // Invoices shown: those dated in the selected month + ALL still-open ones
  // (so an unconfirmed invoice never disappears just because the month moved).
  const invoices = useMemo(() => {
    const inMonth = r => (r.receipt_date || '').startsWith(month)
    const open = r => !r.reconciliation || r.reconciliation.status === 'mismatch'
    return receipts
      .filter(r => docTypeOf(r) === 'summary_invoice' && (inMonth(r) || open(r)))
      .sort((a, b) => (normalizeVendor(a.vendor_name) || '').localeCompare(normalizeVendor(b.vendor_name) || '') || (b.receipt_date || '').localeCompare(a.receipt_date || ''))
  }, [receipts, month])

  // Suppliers with open delivery notes in the month and no invoice card shown.
  const waiting = useMemo(() => {
    const shown = new Set(invoices.map(inv => normalizeVendor(inv.vendor_name)))
    const map = {}
    receipts.forEach(r => {
      if (docTypeOf(r) !== 'delivery_note' || r.matched_invoice_id) return
      if (!(r.receipt_date || '').startsWith(month)) return
      const key = normalizeVendor(r.vendor_name)
      if (shown.has(key)) return
      const name = (r.vendor_name || '').trim() || 'ספק לא ידוע'
      if (!map[key]) map[key] = { vendor: name, notes: [] }
      map[key].notes.push(r)
    })
    return Object.values(map).sort((a, b) => a.vendor.localeCompare(b.vendor))
  }, [receipts, invoices, month])

  if (loading) return <LoadingSpinner />

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }} dir="rtl">
      {/* Header + month picker */}
      <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
        <h1 style={{ margin:0, fontSize: isMobile ? 20 : 23, fontWeight:800, color:'var(--text)', display:'flex', alignItems:'center', gap:9 }}>
          <ArrowLeftRight size={22} style={{ color:'var(--accent)' }} /> התאמות
        </h1>
        <div style={{ marginInlineStart:'auto', display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
          <div style={{ display:'flex', alignItems:'center', gap:4, background:'var(--panel)', border:'1px solid var(--border)', borderRadius:10, padding:'4px 6px' }}>
            <button onClick={() => setMonth(m => shiftMonth(m, 1))} aria-label="חודש הבא" style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-mute)', display:'flex', padding:6 }}><ChevronRight size={17} /></button>
            <span style={{ fontSize:14, fontWeight:700, color:'var(--text)', minWidth:104, textAlign:'center' }}>{monthLabel(month)}</span>
            <button onClick={() => setMonth(m => shiftMonth(m, -1))} aria-label="חודש קודם" style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-mute)', display:'flex', padding:6 }}><ChevronLeft size={17} /></button>
          </div>
          <button onClick={downloadDoc} title="הורד דוח התאמות להדפסה / לרואה החשבון"
            style={{ display:'flex', alignItems:'center', gap:6, height:38, padding:'0 14px', background:'var(--panel)', border:'1px solid var(--border)', borderRadius:10, cursor:'pointer', color:'var(--text-dim)', fontFamily:'var(--font-main)', fontSize:13, fontWeight:600, whiteSpace:'nowrap' }}>
            <Download size={15} /> דוח התאמות
          </button>
        </div>
      </div>

      <p style={{ margin:0, fontSize:13.5, color:'var(--text-mute)', lineHeight:1.7 }}>
        כאן משווים כל <strong>חשבונית מרכזת</strong> לתעודות המשלוח שהיא מסכמת: סמן אילו תעודות שייכות, בדוק שאין פערים ואשר.
        חשבונית מרכזת אינה נספרת בהוצאות — תעודות המשלוח הן ההוצאה.
      </p>

      {migrationMissing && (
        <div style={{ background:'var(--warn-tint-1)', border:'1px solid var(--warn-tint-border)', borderRadius:12, padding:'12px 16px', fontSize:13.5, color:'var(--text)', lineHeight:1.7 }}>
          ⚠️ <strong>נדרש עדכון חד-פעמי לבסיס הנתונים:</strong> יש להריץ את הקובץ <code style={{ background:'var(--panel-2)', padding:'1px 6px', borderRadius:5 }}>supabase_doctype.sql</code> ב-SQL Editor של Supabase. עד אז לא ניתן לאשר התאמות.
        </div>
      )}

      {/* Invoice cards */}
      {invoices.length === 0 && waiting.length === 0 ? (
        <div style={{ textAlign:'center', padding:'56px 16px', color:'var(--text-mute)' }}>
          <ArrowLeftRight size={40} style={{ margin:'0 auto 12px', display:'block', opacity:0.3 }} />
          <p style={{ fontWeight:600, color:'var(--text)', fontSize:15 }}>אין התאמות לחודש {monthLabel(month)}</p>
          <p style={{ fontSize:13, marginTop:6 }}>סרוק תעודות משלוח במהלך החודש, וכשמגיעה חשבונית מרכזת מהספק — ההשוואה תופיע כאן.</p>
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {invoices.map(inv => (
            <InvoiceCard key={inv.id} invoice={inv} receipts={receipts}
              autoExpand={inv.id === focusInvoice} onChanged={loadData} />
          ))}
          {waiting.map(w => <WaitingCard key={w.vendor} vendor={w.vendor} notes={w.notes} />)}
        </div>
      )}
    </div>
  )
}
