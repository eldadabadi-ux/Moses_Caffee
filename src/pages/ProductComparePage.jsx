/**
 * ProductComparePage — "השוואת מוצרים" (client request #4): for each product the
 * café buys from more than one supplier, compare the real ₪ per base unit
 * (₪/kg · ₪/l · ₪/יח') and show who is cheapest and how much is overpaid at the
 * dearest. All figures come from productCompare (SSOT units.js) — the page shows,
 * it does not price.
 */
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { getCached, setCached, hasCached } from '../lib/pageCache'
import { flattenItems } from '../lib/itemAggregation'
import { isExpenseDoc } from '../lib/docTypes'
import { buildProductComparison, comparisonCsv } from '../lib/productCompare'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import toast from 'react-hot-toast'
import { Scale, Search, Download, ChevronLeft, TrendingDown, Trophy } from 'lucide-react'

const fmtUnit = (n, unit) => `₪${Number(n).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / ${unit}`
const fmtDate = d => d ? d.split('-').reverse().join('.') : '—'

function SpreadBadge({ pct }) {
  if (!pct) return <span style={{ fontSize: 12, color: 'var(--text-mute)' }}>מחיר אחיד</span>
  const strong = pct >= 20
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700,
      color: strong ? '#dc2626' : '#d97706', background: strong ? '#fef2f2' : 'var(--warn-tint-1)',
      border: `1px solid ${strong ? '#fecaca' : 'var(--warn-tint-border)'}`, borderRadius: 7, padding: '2px 8px' }}>
      <TrendingDown size={13} /> פער {pct}%
    </span>
  )
}

function ProductCard({ product }) {
  const [open, setOpen] = useState(false)
  const { label, unitLabel, suppliers, cheapest, spreadPct } = product
  return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', boxShadow: 'var(--shadow-card)', overflow: 'hidden' }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-main)', textAlign: 'right' }}>
        <span style={{ fontWeight: 700, fontSize: 15.5, color: 'var(--text)' }}>{label}</span>
        <span style={{ fontSize: 12.5, color: 'var(--text-mute)' }}>{suppliers.length} ספקים</span>
        <span style={{ marginInlineStart: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13.5, color: 'var(--text-dim)' }}>
            הזול: <strong style={{ color: '#16a34a' }}>{fmtUnit(cheapest.price, unitLabel)}</strong>
          </span>
          <SpreadBadge pct={spreadPct} />
          <ChevronLeft size={16} style={{ color: 'var(--text-mute)', transform: open ? 'rotate(-90deg)' : 'none', transition: 'transform 160ms' }} />
        </span>
      </button>
      {open && (
        <div style={{ padding: '0 16px 14px' }}>
          <div style={{ background: 'var(--panel-2)', borderRadius: 10, border: '1px solid var(--border)', overflow: 'hidden' }}>
            {suppliers.map((s, i) => {
              const isCheap = s.vendor === cheapest.vendor
              const overPct = cheapest.price > 0 ? Math.round(((s.price - cheapest.price) / cheapest.price) * 100) : 0
              return (
                <div key={s.vendor} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 13px',
                  borderBottom: i < suppliers.length - 1 ? '1px solid var(--border)' : 'none',
                  background: isCheap ? '#f0fdf4' : 'transparent' }}>
                  {isCheap ? <Trophy size={15} style={{ color: '#16a34a', flexShrink: 0 }} />
                           : <span style={{ width: 15, flexShrink: 0 }} />}
                  <span style={{ fontWeight: isCheap ? 700 : 600, fontSize: 14, color: 'var(--text)' }}>{s.vendor}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-mute)' }}>· {s.count} רכישות · {fmtDate(s.lastDate)}</span>
                  <span style={{ marginInlineStart: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                    {overPct > 0 && <span style={{ fontSize: 12, color: '#dc2626', fontWeight: 600 }}>+{overPct}%</span>}
                    <span style={{ fontSize: 14.5, fontWeight: 800, color: isCheap ? '#16a34a' : 'var(--text)' }}>{fmtUnit(s.price, unitLabel)}</span>
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default function ProductComparePage() {
  const isMobile = window.innerWidth < 768
  const [receipts, setReceipts] = useState(() => getCached('receipts') || [])
  const [loading, setLoading] = useState(() => !hasCached('receipts'))
  const [q, setQ] = useState('')

  async function loadData() {
    try {
      const { data, error } = await supabase
        .from('receipts').select('*').is('archived_at', null).eq('book', 'cafe')
        .order('receipt_date', { ascending: false })
      if (error) throw error
      setReceipts(data || []); setCached('receipts', data || [])
    } catch (err) { toast.error('שגיאה בטעינה: ' + (err?.message || '')) }
    finally { setLoading(false) }
  }
  useEffect(() => { loadData() }, [])

  // Only expense documents carry comparable purchase lines.
  const model = useMemo(() => {
    const items = flattenItems(receipts.filter(isExpenseDoc))
    return buildProductComparison(items, { minSuppliers: 2 })
  }, [receipts])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return needle ? model.filter(p => p.label.toLowerCase().includes(needle)) : model
  }, [model, q])

  async function exportCsv() {
    try {
      const { downloadFile } = await import('../lib/downloadFile')
      const csv = comparisonCsv(model)
      await downloadFile({ blob: new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename: 'השוואת_מוצרים.csv' })
      toast.success('הקובץ הורד')
    } catch (err) { toast.error('שגיאה בייצוא: ' + (err?.message || '')) }
  }

  if (loading && receipts.length === 0) return <LoadingSpinner />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }} dir="rtl">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: isMobile ? 20 : 23, fontWeight: 800, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 9 }}>
          <Scale size={22} style={{ color: 'var(--accent)' }} /> השוואת מוצרים
        </h1>
        {model.length > 0 && (
          <button onClick={exportCsv}
            style={{ marginInlineStart: 'auto', display: 'flex', alignItems: 'center', gap: 6, height: 38, padding: '0 14px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, cursor: 'pointer', color: 'var(--text-dim)', fontFamily: 'var(--font-main)', fontSize: 13, fontWeight: 600 }}>
            <Download size={15} /> ייצוא CSV
          </button>
        )}
      </div>

      <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-mute)', lineHeight: 1.7 }}>
        לכל מוצר שנרכש מיותר מספק אחד — השוואת <strong>מחיר ליחידת בסיס</strong> (לק"ג / לליטר / ליחידה), כדי לראות מי הזול ביותר וכמה משלמים ביתר אצל האחרים. המחיר מחושב אחיד לכל הכתיבות של אותו מוצר.
      </p>

      {model.length > 0 && (
        <div style={{ position: 'relative' }}>
          <Search size={16} style={{ position: 'absolute', insetInlineStart: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-mute)' }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש מוצר…"
            style={{ width: '100%', height: 40, paddingInline: '38px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text)', fontSize: 14, fontFamily: 'var(--font-main)', outline: 'none', boxSizing: 'border-box' }} />
        </div>
      )}

      {shown.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '56px 16px', color: 'var(--text-mute)' }}>
          <Scale size={40} style={{ margin: '0 auto 12px', display: 'block', opacity: 0.3 }} />
          <p style={{ fontWeight: 600, color: 'var(--text)', fontSize: 15 }}>
            {model.length === 0 ? 'אין עדיין מוצרים שנרכשו מיותר מספק אחד' : `לא נמצא מוצר התואם "${q}"`}
          </p>
          {model.length === 0 && <p style={{ fontSize: 13, marginTop: 6 }}>כשאותו מוצר נסרק מכמה ספקים, ההשוואה תופיע כאן אוטומטית.</p>}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {shown.map(p => <ProductCard key={p.key} product={p} />)}
        </div>
      )}
    </div>
  )
}
