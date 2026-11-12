/**
 * SupplierDetailPage — תיק ספק (client requirement 11.11.26 §8) + תקציב (§1).
 *
 * One deep-linkable page per canonical supplier (/suppliers/:id): mini-dashboard
 * (period totals + monthly bars), contact actions, budget definition with live
 * utilization, top products/categories, and a gallery of every scanned file.
 * All numbers are derived the same way everywhere: deriveVendorStats for spend,
 * budgetStatus for the budget — this page computes nothing of its own.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useSettings } from '../hooks/useSettings'
import { deriveVendorStats, waLink, telLink, gmailComposeLink } from '../lib/suppliers'
import { normalizeVendor } from '../lib/supplierMatch'
import { loadBudget, saveBudget, deleteBudget, budgetStatus, BUDGET_PERIODS, periodLabel } from '../lib/budgets'
import { isExpenseDoc } from '../lib/docTypes'
import { isCafeBook } from '../lib/books'
import { signedReceiptUrl } from '../lib/storage'
import MonthlyBars from '../components/charts/MonthlyBars'
import ReceiptThumb from '../components/ReceiptThumb'
import ImageViewer from '../components/ImageViewer'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import {
  ArrowRight, Phone, Mail, MapPin, MessageCircle, Pencil, Receipt,
  Wallet, Package, CalendarDays, AlertTriangle, Trash2,
} from 'lucide-react'
import toast from 'react-hot-toast'

const fmtILS = n => `₪${Math.round(Number(n) || 0).toLocaleString('he-IL')}`
const fmtDate = d => d ? d.split('-').reverse().join('.') : '—'

const card = { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px' }
const h2 = { margin: '0 0 10px', fontSize: '14.5px', fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 7 }
const chip = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--panel-2)', color: 'var(--text)', fontSize: '12.5px', fontWeight: 600, textDecoration: 'none' }

const BUDGET_COLORS = { ok: 'var(--ok, #16a34a)', warn: '#d97706', over: '#dc2626' }

export default function SupplierDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { settings } = useSettings()
  const isMobile = window.innerWidth < 768

  const [supplier, setSupplier] = useState(null)
  const [aliases, setAliases]   = useState([])
  const [receipts, setReceipts] = useState([])
  const [budget, setBudget]     = useState(null)
  const [loading, setLoading]   = useState(true)
  const [budgetEdit, setBudgetEdit] = useState(null)   // { period, amount, alert_pct } | null
  const [budgetBusy, setBudgetBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [lightboxUrl, setLightboxUrl] = useState(null)

  const loadAll = useCallback(async () => {
    if (!user || !id) return
    setLoading(true)
    try {
      const [{ data: sup }, { data: ali }, { data: recs }, bud] = await Promise.all([
        supabase.from('suppliers').select('*').eq('id', id).maybeSingle(),
        supabase.from('supplier_aliases').select('alias').eq('supplier_id', id),
        supabase.from('receipts')
          .select('id, vendor_name, supplier_id, receipt_date, amount, category_text, items, archived_at, created_at, doc_type, doc_number, book, storage_path, receipt_image, status')
          .eq('user_id', user.id),
        loadBudget(user.id, id),
      ])
      setSupplier(sup || null)
      setAliases((ali || []).map(a => a.alias))
      setReceipts(recs || [])
      setBudget(bud)
    } catch (e) { console.error('[supplier-detail] load', e?.message) }
    finally { setLoading(false) }
  }, [user, id])

  useEffect(() => { loadAll() }, [loadAll])

  // This supplier's receipts: linked rows, plus unlinked rows whose scanned
  // spelling equals the canonical name or a confirmed alias (same normal form
  // the matcher uses — nothing fuzzy here, a fuzzy guess belongs in the queue).
  const myReceipts = useMemo(() => {
    if (!supplier) return []
    const names = new Set([supplier.name, ...aliases].map(normalizeVendor).filter(Boolean))
    return receipts.filter(r => r.supplier_id === id ||
      (!r.supplier_id && names.has(normalizeVendor(r.vendor_name))))
  }, [receipts, supplier, aliases, id])

  const stat = useMemo(() => {
    const rows = deriveVendorStats(myReceipts, supplier ? [supplier] : [])
    return rows.find(r => r.supplierId === id) || rows[0] || null
  }, [myReceipts, supplier, id])

  // Monthly bars — current year, expense docs in the café book only (the same
  // filter every other spend figure uses).
  const year = new Date().getFullYear()
  const monthly = useMemo(() => {
    const sums = Array.from({ length: 12 }, () => 0)
    for (const r of myReceipts) {
      if (r.archived_at || !isExpenseDoc(r) || !isCafeBook(r)) continue
      const d = r.receipt_date || ''
      if (!d.startsWith(String(year))) continue
      sums[Number(d.slice(5, 7)) - 1] += parseFloat(r.amount) || 0
    }
    return sums.map((total, i) => ({ month: i + 1, total }))
  }, [myReceipts, year])

  const status = useMemo(() => budgetStatus(budget, myReceipts), [budget, myReceipts])

  // Every scanned file, newest first — the quick access the client asked for.
  const files = useMemo(() =>
    myReceipts
      .filter(r => r.storage_path || r.receipt_image)
      .sort((a, b) => (b.receipt_date || '').localeCompare(a.receipt_date || '')),
  [myReceipts])

  async function openFile(r) {
    if (r.storage_path) {
      const u = await signedReceiptUrl(r.storage_path, 300)
      if (!u) { toast.error('הקובץ אינו זמין'); return }
      if (/\.pdf$/i.test(r.storage_path)) window.open(u, '_blank', 'noopener')
      else setLightboxUrl(u)
    } else if (r.receipt_image) {
      setLightboxUrl(r.receipt_image)
    }
  }

  async function submitBudget() {
    setBudgetBusy(true)
    try {
      const saved = await saveBudget(user.id, id, budgetEdit)
      setBudget(saved)
      setBudgetEdit(null)
      toast.success('התקציב נשמר')
    } catch (e) { toast.error(e.message || 'שמירת התקציב נכשלה') }
    finally { setBudgetBusy(false) }
  }

  async function removeBudget() {
    try {
      await deleteBudget(budget.id)
      setBudget(null); setConfirmDelete(false)
      toast.success('התקציב הוסר')
    } catch (e) { toast.error(e.message || 'שגיאה') }
  }

  if (loading) return <LoadingSpinner />
  if (!supplier) return (
    <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-mute)' }}>
      הספק לא נמצא. <button onClick={() => navigate('/suppliers')} style={{ border: 'none', background: 'none', color: 'var(--accent)', cursor: 'pointer', fontFamily: 'var(--font-main)', fontSize: 'inherit' }}>חזרה לספקים</button>
    </div>
  )

  const c = supplier
  const barColor = status ? BUDGET_COLORS[status.state] : 'var(--accent)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ── Header ── */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={() => navigate('/suppliers')} aria-label="חזרה לספקים"
            style={{ display: 'flex', alignItems: 'center', border: 'none', background: 'var(--panel-2)', borderRadius: 8, padding: 7, cursor: 'pointer', color: 'var(--text)' }}>
            <ArrowRight size={17} />
          </button>
          <div style={{ flex: 1, minWidth: 180 }}>
            <h1 style={{ margin: 0, fontSize: '19px', fontWeight: 800, color: 'var(--text)' }}>{c.name}</h1>
            {c.supplies && <div style={{ fontSize: '12.5px', color: 'var(--text-mute)', marginTop: 3 }}>{c.supplies}</div>}
            {aliases.length > 0 && (
              <div style={{ fontSize: '11.5px', color: 'var(--text-mute)', marginTop: 3 }}>נסרק גם כ: {aliases.join(' · ')}</div>
            )}
          </div>
          <button onClick={() => navigate(`/suppliers?focus=${encodeURIComponent(c.name)}`)}
            style={{ ...chip, cursor: 'pointer', fontFamily: 'var(--font-main)' }}>
            <Pencil size={13} /> עריכת פרטים
          </button>
        </div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 12 }}>
          {c.phone && <a href={telLink(c.phone)} style={chip}><Phone size={13} /> {c.phone}</a>}
          {(c.whatsapp || c.phone) && <a href={waLink(c.whatsapp || c.phone)} target="_blank" rel="noreferrer" style={chip}><MessageCircle size={13} /> WhatsApp</a>}
          {c.email && <a href={gmailComposeLink(c.email, user?.email, settings?.business_name)} target="_blank" rel="noreferrer" style={chip}><Mail size={13} /> {c.email}</a>}
          {c.address && <span style={chip}><MapPin size={13} /> {c.address}</span>}
        </div>
      </div>

      {/* ── Stat tiles ── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 10 }}>
        {[
          { label: 'החודש', value: fmtILS(stat?.thisMonth || 0) },
          { label: 'השנה', value: fmtILS(stat?.thisYear || 0) },
          { label: 'סה"כ', value: fmtILS(stat?.total || 0) },
          { label: 'מסמכים', value: `${stat?.count || 0}`, sub: stat?.lastDate ? `אחרון: ${fmtDate(stat.lastDate)}` : null },
        ].map(t => (
          <div key={t.label} style={{ ...card, padding: '12px 14px' }}>
            <div style={{ fontSize: '11.5px', color: 'var(--text-mute)', fontWeight: 600 }}>{t.label}</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text)', marginTop: 2 }}>{t.value}</div>
            {t.sub && <div style={{ fontSize: '11px', color: 'var(--text-mute)', marginTop: 2 }}>{t.sub}</div>}
          </div>
        ))}
      </div>

      {/* ── Budget ── */}
      <div style={{ ...card, ...(status?.state === 'over' ? { border: `1px solid ${BUDGET_COLORS.over}` } : {}) }}>
        <div style={h2}><Wallet size={15} /> תקציב לספק {status && <span style={{ fontWeight: 600, color: 'var(--text-mute)', fontSize: '12.5px' }}>· {periodLabel(budget.period)} · {status.window.label}</span>}</div>

        {!budget && !budgetEdit && (
          <div style={{ fontSize: '13px', color: 'var(--text-mute)' }}>
            לא הוגדר תקציב.{' '}
            <button onClick={() => setBudgetEdit({ period: 'monthly', amount: '', alert_pct: 80 })}
              style={{ border: 'none', background: 'none', color: 'var(--accent)', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-main)', fontSize: 'inherit', padding: 0 }}>
              הגדר תקציב חודשי / רבעוני / שנתי
            </button>
          </div>
        )}

        {budgetEdit && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ fontSize: '12px', color: 'var(--text-mute)', fontWeight: 600 }}>תקופה
              <select value={budgetEdit.period} onChange={e => setBudgetEdit(b => ({ ...b, period: e.target.value }))}
                style={{ display: 'block', marginTop: 4, padding: '9px 10px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text)', fontFamily: 'var(--font-main)' }}>
                {BUDGET_PERIODS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '12px', color: 'var(--text-mute)', fontWeight: 600 }}>סכום (₪)
              <input type="number" min="1" value={budgetEdit.amount} onChange={e => setBudgetEdit(b => ({ ...b, amount: e.target.value }))}
                style={{ display: 'block', marginTop: 4, width: 120, padding: '9px 10px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text)', fontFamily: 'var(--font-main)' }} />
            </label>
            <label style={{ fontSize: '12px', color: 'var(--text-mute)', fontWeight: 600 }}>התראה בניצול של (%)
              <input type="number" min="1" max="100" value={budgetEdit.alert_pct} onChange={e => setBudgetEdit(b => ({ ...b, alert_pct: e.target.value }))}
                style={{ display: 'block', marginTop: 4, width: 90, padding: '9px 10px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text)', fontFamily: 'var(--font-main)' }} />
            </label>
            <button onClick={submitBudget} disabled={budgetBusy}
              style={{ padding: '9px 18px', borderRadius: 9, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-main)' }}>
              שמור
            </button>
            <button onClick={() => setBudgetEdit(null)} disabled={budgetBusy}
              style={{ padding: '9px 14px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text-mute)', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-main)' }}>
              ביטול
            </button>
          </div>
        )}

        {status && !budgetEdit && (
          <>
            {/* Utilization bar — the budget graph in the supplier card (§1) */}
            <div style={{ height: 14, borderRadius: 999, background: 'var(--panel-2)', overflow: 'hidden', border: '1px solid var(--border)' }}>
              <div style={{ width: `${Math.min(status.pct, 100)}%`, height: '100%', background: barColor, transition: 'width .4s' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginTop: 8, fontSize: '13px', color: 'var(--text)' }}>
              <span>נוצל <strong>{fmtILS(status.used)}</strong> מתוך {fmtILS(status.amount)} ({status.pct}%)</span>
              <span style={{ color: barColor, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}>
                {status.state === 'over' && <AlertTriangle size={14} />}
                {status.state === 'over' ? `חריגה של ${fmtILS(-status.remaining)}` : `נותרו ${fmtILS(status.remaining)}`}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
              <span style={{ fontSize: '11.5px', color: 'var(--text-mute)' }}>התראה מוגדרת בניצול {budget.alert_pct}%</span>
              <span style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setBudgetEdit({ period: budget.period, amount: budget.amount, alert_pct: budget.alert_pct })}
                  style={{ border: 'none', background: 'none', color: 'var(--accent)', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-main)', padding: 0 }}>
                  עריכה
                </button>
                <button onClick={() => setConfirmDelete(true)}
                  style={{ border: 'none', background: 'none', color: 'var(--text-mute)', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-main)', padding: 0, display: 'flex', alignItems: 'center', gap: 3 }}>
                  <Trash2 size={12} /> הסר
                </button>
              </span>
            </div>
          </>
        )}
      </div>

      {/* ── Monthly spend ── */}
      <div style={card}>
        <div style={h2}><CalendarDays size={15} /> הוצאות חודשיות · {year}</div>
        <MonthlyBars data={monthly} year={year} />
      </div>

      {/* ── Top products & categories ── */}
      {(stat?.topProducts?.length > 0 || stat?.topCategories?.length > 0) && (
        <div style={card}>
          <div style={h2}><Package size={15} /> מה קונים מהספק</div>
          {stat.topCategories?.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: stat.topProducts?.length ? 10 : 0 }}>
              {stat.topCategories.map(tc => (
                <span key={tc.name} style={chip}>{tc.name} · {fmtILS(tc.total)}</span>
              ))}
            </div>
          )}
          {stat.topProducts?.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {stat.topProducts.map(p => (
                <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--text)', borderBottom: '1px solid var(--border)', padding: '4px 0' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                  <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtILS(p.total)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Scanned files gallery ── */}
      <div style={card}>
        <div style={{ ...h2, justifyContent: 'space-between' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Receipt size={15} /> קבצים סרוקים ({files.length})</span>
          <button onClick={() => { const p = new URLSearchParams({ supplier: id, supplierName: c.name }); navigate(`/receipts?${p}`) }}
            style={{ border: 'none', background: 'none', color: 'var(--accent)', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-main)', padding: 0 }}>
            לרשימת המסמכים ←
          </button>
        </div>
        {files.length === 0
          ? <div style={{ fontSize: '13px', color: 'var(--text-mute)' }}>אין עדיין קבצים סרוקים לספק זה.</div>
          : (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 76 : 92}px, 1fr))`, gap: 8 }}>
              {files.map(r => (
                <div key={r.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                  <ReceiptThumb storagePath={r.storage_path} inlineImage={r.receipt_image}
                    size={isMobile ? 72 : 88} onClick={() => openFile(r)}
                    title={`${fmtDate(r.receipt_date)} · ${fmtILS(r.amount)}`} />
                  <span style={{ fontSize: '10.5px', color: 'var(--text-mute)' }}>{fmtDate(r.receipt_date)}</span>
                </div>
              ))}
            </div>
          )}
      </div>

      {lightboxUrl && <ImageViewer src={lightboxUrl} alt="קבלה" onClose={() => setLightboxUrl(null)} />}
      <ConfirmDialog
        isOpen={confirmDelete}
        title="הסרת תקציב"
        message={`להסיר את התקציב של ${c.name}? הקבלות עצמן אינן נמחקות.`}
        confirmText="הסר"
        onConfirm={removeBudget}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  )
}
