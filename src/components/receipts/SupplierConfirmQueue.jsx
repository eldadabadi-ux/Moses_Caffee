/**
 * SupplierConfirmQueue — "ספקים הממתינים לאישור" (client issue #2).
 *
 * The "is this the same supplier?" question used to exist only inside the live
 * scan-review modal: a receipt saved without answering, or one ingested from
 * email, kept supplier_id null forever and was never asked again — so the same
 * business kept resurfacing as new free-text vendors. This banner lists every
 * unarchived receipt that still carries an unanswered suggestion
 * (ai_summary.supplier_suggestion) and lets the user answer in place.
 *
 * Answers go through /api/suppliers/resolve — the receipt is stamped with the
 * canonical supplier_id and the spelling is learned as an alias, so each
 * question is asked exactly once per spelling.
 */
import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { HelpCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const pill = (busy, accent) => ({
  padding: '5px 11px', borderRadius: 999, fontSize: '12.5px', fontWeight: 600,
  fontFamily: 'var(--font-main)', cursor: busy ? 'default' : 'pointer',
  border: `1px solid ${accent ? 'var(--accent)' : 'var(--border)'}`,
  background: 'var(--panel)', color: accent ? 'var(--accent)' : 'var(--text-mute)',
})

export default function SupplierConfirmQueue({ receipts, onResolved }) {
  const [open, setOpen] = useState(false)
  const [busyId, setBusyId] = useState(null)

  const pending = useMemo(() => (receipts || []).filter(r =>
    !r.supplier_id && !r.archived_at && r.ai_summary?.supplier_suggestion?.scanned
  ), [receipts])

  if (!pending.length) return null

  async function answer(r, supplierId) {
    const sug = r.ai_summary.supplier_suggestion
    setBusyId(r.id)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/suppliers/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify(supplierId
          ? { scanned: sug.scanned, supplier_id: supplierId, receipt_id: r.id }
          : { scanned: sug.scanned, new_name: (r.vendor_name || sug.scanned).trim(), receipt_id: r.id }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || 'שמירת הספק נכשלה')
      const ans = await res.json()
      toast.success(supplierId ? `שויך ל${ans.supplier_name}` : `נוצר ספק: ${ans.supplier_name}`)
      onResolved?.()
    } catch (e) {
      toast.error(e.message || 'שגיאה')
    } finally { setBusyId(null) }
  }

  return (
    <div style={{ margin: '0 0 14px', borderRadius: 12, border: '1px solid var(--accent)', background: 'var(--accent-bg)', overflow: 'hidden' }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '11px 14px',
                 border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--font-main)',
                 fontSize: '13.5px', fontWeight: 700, color: 'var(--text)' }}>
        <HelpCircle size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <span style={{ flex: 1, textAlign: 'start' }}>
          {pending.length === 1 ? 'קבלה אחת ממתינה לאישור ספק' : `${pending.length} קבלות ממתינות לאישור ספק`}
        </span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {open && (
        <div style={{ padding: '0 14px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {pending.map(r => {
            const sug = r.ai_summary.supplier_suggestion
            const busy = busyId === r.id
            return (
              <div key={r.id} style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--panel)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '13px', color: 'var(--text)', marginBottom: 7, lineHeight: 1.5 }}>
                  נסרק <strong>{sug.scanned}</strong>
                  <span style={{ color: 'var(--text-mute)' }}> · {r.receipt_date || ''} · ₪{Number(r.amount || 0).toLocaleString('he-IL')}</span>
                  {sug.candidates?.length > 0 ? ' — האם זה אותו ספק?' : ' — ספק לא מוכר. ליצור אותו?'}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(sug.candidates || []).map(c => (
                    <button key={c.id} onClick={() => answer(r, c.id)} disabled={busy}
                      title={`התאמה ${Math.round((c.score || 0) * 100)}%`} style={pill(busy, true)}>
                      כן — {c.name}
                    </button>
                  ))}
                  <button onClick={() => answer(r, null)} disabled={busy} style={pill(busy, !sug.candidates?.length)}>
                    {sug.candidates?.length ? 'לא — ספק חדש' : `צור ספק: ${(r.vendor_name || sug.scanned).trim()}`}
                  </button>
                </div>
              </div>
            )
          })}
          <div style={{ fontSize: '11.5px', color: 'var(--text-mute)' }}>
            כל תשובה נשמרת — אותו איות לא יישאל שוב.
          </div>
        </div>
      )}
    </div>
  )
}
