/**
 * SupplierBudgetsPage — one screen to cap every supplier's spend (client fixes
 * round 18.11.26 §4: the per-supplier budget existed only inside the supplier
 * page and "got lost"; this surfaces it as ספקים → הגבלת תקציב).
 *
 * All math is budgetMath.budgetStatus — the SAME derivation the supplier page,
 * the insights report and the bot use, so every screen shows one truth.
 * Receipts are matched to a supplier exactly like SupplierDetailPage: linked
 * rows by supplier_id, plus unlinked rows whose normalized spelling equals the
 * canonical name or a confirmed alias.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { loadSuppliers } from '../lib/suppliers'
import { loadAllBudgets, saveBudget, deleteBudget, budgetStatus, BUDGET_PERIODS } from '../lib/budgets'
import { normalizeVendor } from '../lib/supplierMatch'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import { Wallet, Search, Trash2, Check } from 'lucide-react'
import toast from 'react-hot-toast'

const fmtILS = (n) => '₪' + (Number(n) || 0).toLocaleString('he-IL', { maximumFractionDigits: 0 })
const STATE_COLOR = { ok: 'var(--ok)', warn: '#d97706', over: 'var(--danger)' }
const STATE_LABEL = { ok: 'בתקציב', warn: 'מתקרב לתקרה', over: 'חריגה' }

export default function SupplierBudgetsPage() {
  const { user } = useAuth()
  const [suppliers, setSuppliers] = useState([])
  const [budgets, setBudgets]     = useState([])
  const [receipts, setReceipts]   = useState([])
  const [aliases, setAliases]     = useState([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [edits, setEdits]         = useState({})   // supplier_id → { amount, period, alert_pct }
  const [savingId, setSavingId]   = useState(null)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const [sup, bud, { data: recs }, { data: ali }] = await Promise.all([
        loadSuppliers(user.id),
        loadAllBudgets(user.id),
        supabase.from('receipts')
          .select('id, vendor_name, supplier_id, receipt_date, amount, archived_at, doc_type, book')
          .eq('user_id', user.id),
        supabase.from('supplier_aliases').select('supplier_id, alias'),
      ])
      setSuppliers(sup); setBudgets(bud); setReceipts(recs || []); setAliases(ali || [])
    } catch (e) { console.error('[budgets-page] load', e?.message) }
    finally { setLoading(false) }
  }, [user])

  useEffect(() => { load() }, [load])

  // supplier_id → its receipts (linked, or unlinked with a matching spelling).
  const bySupplier = useMemo(() => {
    const nameTo = new Map()
    for (const s of suppliers) { const k = normalizeVendor(s.name); if (k) nameTo.set(k, s.id) }
    for (const a of aliases)   { const k = normalizeVendor(a.alias); if (k && !nameTo.has(k)) nameTo.set(k, a.supplier_id) }
    const m = new Map()
    const push = (id, r) => { if (!m.has(id)) m.set(id, []); m.get(id).push(r) }
    for (const r of receipts) {
      const id = r.supplier_id || nameTo.get(normalizeVendor(r.vendor_name))
      if (id) push(id, r)
    }
    return m
  }, [suppliers, aliases, receipts])

  const budgetOf = useMemo(() => new Map(budgets.map(b => [b.supplier_id, b])), [budgets])

  const rows = useMemo(() => {
    const q = search.trim()
    const list = suppliers
      .filter(s => !q || (s.name || '').includes(q))
      .map(s => {
        const budget = budgetOf.get(s.id) || null
        const status = budget ? budgetStatus(budget, bySupplier.get(s.id) || []) : null
        return { supplier: s, budget, status }
      })
    // Problems first, then the rest of the budgeted, then everyone else.
    const rank = (r) => r.status?.state === 'over' ? 0 : r.status?.state === 'warn' ? 1 : r.budget ? 2 : 3
    return list.sort((a, b) => rank(a) - rank(b) || (a.supplier.name || '').localeCompare(b.supplier.name || '', 'he'))
  }, [suppliers, budgetOf, bySupplier, search])

  const totals = useMemo(() => ({
    budgeted: rows.filter(r => r.budget).length,
    warn: rows.filter(r => r.status?.state === 'warn').length,
    over: rows.filter(r => r.status?.state === 'over').length,
  }), [rows])

  function editOf(r) {
    return edits[r.supplier.id] || {
      amount: r.budget ? String(r.budget.amount) : '',
      period: r.budget?.period || 'monthly',
      alert_pct: r.budget?.alert_pct ?? 80,
    }
  }
  const setEdit = (id, patch) => setEdits(prev => ({ ...prev, [id]: { ...(prev[id] || {}), ...patch } }))
  const isDirty = (r) => {
    const e = edits[r.supplier.id]
    if (!e) return false
    const base = { amount: r.budget ? String(r.budget.amount) : '', period: r.budget?.period || 'monthly', alert_pct: r.budget?.alert_pct ?? 80 }
    const cur = { ...base, ...e }
    return cur.amount !== base.amount || cur.period !== base.period || Number(cur.alert_pct) !== Number(base.alert_pct)
  }

  async function save(r) {
    const e = editOf(r)
    if (!(parseFloat(e.amount) > 0)) { toast.error('נא להזין סכום תקציב חיובי'); return }
    setSavingId(r.supplier.id)
    try {
      const saved = await saveBudget(user.id, r.supplier.id, e)
      setBudgets(prev => [...prev.filter(b => b.supplier_id !== r.supplier.id), saved])
      setEdits(prev => { const n = { ...prev }; delete n[r.supplier.id]; return n })
      toast.success(`תקרה נשמרה ל${r.supplier.name}`)
    } catch (err) { toast.error(err?.message || 'שמירה נכשלה') }
    finally { setSavingId(null) }
  }

  async function clear(r) {
    if (!r.budget) return
    setSavingId(r.supplier.id)
    try {
      await deleteBudget(r.budget.id)
      setBudgets(prev => prev.filter(b => b.id !== r.budget.id))
      setEdits(prev => { const n = { ...prev }; delete n[r.supplier.id]; return n })
      toast.success('התקרה הוסרה')
    } catch (err) { toast.error(err?.message || 'מחיקה נכשלה') }
    finally { setSavingId(null) }
  }

  if (loading) return <LoadingSpinner />

  const IN = { height: 38, padding: '0 10px', borderRadius: 9, border: '1.5px solid var(--border)',
               background: 'var(--panel)', color: 'var(--text)', fontSize: 14.5, fontFamily: 'var(--font-main)', outline: 'none', boxSizing: 'border-box' }

  return (
    <div dir="rtl" style={{ maxWidth: 980, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 6px' }}>
        <Wallet size={24} color="var(--accent)" />
        <h1 style={{ fontSize: 23, fontWeight: 700, color: 'var(--text)', margin: 0 }}>הגבלת תקציב לספק</h1>
      </div>
      <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--text-mute)', lineHeight: 1.6 }}>
        קבע לכל ספק תקרת הוצאה לתקופה. ההתראות מופיעות בדף הספק, בדוח התובנות ואצל העוזר —
        וכאן רואים את כולם במסך אחד. {totals.budgeted > 0 && (
          <>מוגדרות {totals.budgeted} תקרות{totals.over ? ` · ${totals.over} בחריגה` : ''}{totals.warn ? ` · ${totals.warn} מתקרבות לתקרה` : ''}.</>
        )}
      </p>

      <div style={{ position: 'relative', margin: '0 0 14px', maxWidth: 340 }}>
        <Search size={15} style={{ position: 'absolute', top: 12, insetInlineStart: 12, color: 'var(--text-mute)' }} />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="חיפוש ספק…"
          style={{ ...IN, width: '100%', paddingInlineStart: 34 }} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map(r => {
          const e = editOf(r)
          const busy = savingId === r.supplier.id
          const st = r.status
          return (
            <div key={r.supplier.id} style={{ background: 'var(--panel)', border: '1px solid ' + (st?.state === 'over' ? 'var(--danger)' : 'var(--border)'), borderRadius: 14, padding: '14px 16px', boxShadow: 'var(--shadow-card)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <Link to={`/suppliers/${r.supplier.id}`} style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--text)', textDecoration: 'none', minWidth: 140, flex: '1 1 160px' }}>
                  {r.supplier.name}
                </Link>

                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-dim)' }}>
                  תקרה
                  <input type="number" min="0" inputMode="decimal" value={e.amount} disabled={busy}
                    onChange={ev => setEdit(r.supplier.id, { amount: ev.target.value })}
                    placeholder="₪" style={{ ...IN, width: 110, textAlign: 'center' }} />
                </label>

                <select value={e.period} disabled={busy} onChange={ev => setEdit(r.supplier.id, { period: ev.target.value })}
                  style={{ ...IN, width: 96 }}>
                  {BUDGET_PERIODS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>

                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-dim)' }} title="אחוז ניצול שממנו מוצגת התראה">
                  התראה מ-
                  <input type="number" min="1" max="100" value={e.alert_pct} disabled={busy}
                    onChange={ev => setEdit(r.supplier.id, { alert_pct: ev.target.value })}
                    style={{ ...IN, width: 64, textAlign: 'center' }} />%
                </label>

                {(isDirty(r) || (!r.budget && parseFloat(e.amount) > 0)) && (
                  <button onClick={() => save(r)} disabled={busy}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, height: 38, padding: '0 16px', borderRadius: 9, border: 'none', background: busy ? 'var(--panel-2)' : 'var(--accent)', color: busy ? 'var(--text-mute)' : 'white', fontSize: 13.5, fontWeight: 700, cursor: busy ? 'default' : 'pointer', fontFamily: 'var(--font-main)' }}>
                    <Check size={14} /> {busy ? 'שומר…' : 'שמור'}
                  </button>
                )}
                {r.budget && (
                  <button onClick={() => clear(r)} disabled={busy} title="הסר את התקרה"
                    style={{ height: 38, padding: '0 10px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--danger)', cursor: busy ? 'default' : 'pointer', display: 'flex', alignItems: 'center' }}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>

              {st && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 4 }}>
                    <span>{st.window.label} · נוצל {fmtILS(st.used)} מתוך {fmtILS(st.amount)} ({st.pct}%)</span>
                    <span style={{ color: STATE_COLOR[st.state], fontWeight: 700 }}>
                      {STATE_LABEL[st.state]}{st.state === 'over' ? ` · ${fmtILS(-st.remaining)} מעל` : ` · נותרו ${fmtILS(st.remaining)}`}
                    </span>
                  </div>
                  <div style={{ height: 8, borderRadius: 6, background: 'var(--panel-2)', overflow: 'hidden' }}>
                    <div style={{ width: Math.min(100, st.pct) + '%', height: '100%', background: STATE_COLOR[st.state], transition: 'width .3s' }} />
                  </div>
                </div>
              )}
            </div>
          )
        })}
        {rows.length === 0 && (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-mute)', fontSize: 14 }}>
            {search ? 'לא נמצא ספק מתאים' : 'אין עדיין ספקים — ספקים נוצרים מתוך קבלות שנקלטות'}
          </div>
        )}
      </div>
    </div>
  )
}
