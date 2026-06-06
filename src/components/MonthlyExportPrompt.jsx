import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useSettings } from '../hooks/useSettings'
import { downloadFile } from '../lib/downloadFile'
import { buildExcelBlob, pdfBlob as buildPdfBlob, buildImagesZip, combineZip } from '../lib/receiptExport'
import Modal from './ui/Modal'
import toast from 'react-hot-toast'

const HE_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר']
const PROMPT_KEY = 'moses_monthly_prompt'

function prevMonth() {
  const now = new Date()
  const m = now.getMonth() === 0 ? 11 : now.getMonth() - 1
  const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
  return { m, y, label: `${HE_MONTHS[m]} ${y}` }
}
function currentMonthKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function MonthlyExportPrompt() {
  const { user } = useAuth()
  const { settings } = useSettings()
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const prev = prevMonth()

  useEffect(() => {
    if (!user) return
    // Show once per calendar month, until answered.
    let answered = null
    try { answered = localStorage.getItem(PROMPT_KEY) } catch {}
    if (answered !== currentMonthKey()) {
      // small delay so it doesn't fight the initial page render
      const t = setTimeout(() => setShow(true), 1200)
      return () => clearTimeout(t)
    }
  }, [user])

  function dismiss() {
    try { localStorage.setItem(PROMPT_KEY, currentMonthKey()) } catch {}
    setShow(false)
  }

  async function handleExport() {
    if (busy) return
    setBusy(true)
    const toastId = toast.loading(`מכין ייצוא ${prev.label}...`)
    try {
      const from = `${prev.y}-${String(prev.m + 1).padStart(2, '0')}-01`
      const lastDay = new Date(prev.y, prev.m + 1, 0).getDate()
      const to = `${prev.y}-${String(prev.m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

      const { data: receipts, error } = await supabase
        .from('receipts')
        .select('*')
        .eq('user_id', user.id)
        .gte('receipt_date', from)
        .lte('receipt_date', to)
        .order('receipt_date', { ascending: true })
      if (error) throw error

      if (!receipts?.length) {
        toast.dismiss(toastId)
        toast(`אין קבלות ב${prev.label}`, { icon: 'ℹ️' })
        dismiss()
        return
      }

      const vatRate = settings?.vatRate || 18
      const base = `קבלות_${HE_MONTHS[prev.m]}_${prev.y}`
      const excelBlob  = await buildExcelBlob(receipts, vatRate)
      const pdfFile    = buildPdfBlob(receipts, { filterFrom: from, filterTo: to, vatRate, title: `דוח קבלות — ${prev.label}` })
      const imagesBlob = await buildImagesZip(receipts)

      const zip = await combineZip([
        { name: `${base}.xlsx`,       blob: excelBlob },
        { name: `${base}_דוח.html`,   blob: pdfFile },
        { name: `${base}_תמונות.zip`, blob: imagesBlob },
      ])
      await downloadFile({ blob: zip, filename: `${base}.zip` })

      toast.dismiss(toastId)
      toast.success(`ייצוא ${prev.label} הושלם — ${receipts.length} קבלות`)
      dismiss()
    } catch (err) {
      toast.dismiss(toastId)
      toast.error('שגיאה בייצוא: ' + (err?.message || ''))
    } finally {
      setBusy(false)
    }
  }

  if (!show) return null

  return (
    <Modal isOpen={true} onClose={dismiss} title={`ייצוא חודשי לרואה החשבון`} size="sm">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }} dir="rtl">
        <p style={{ margin: 0, fontSize: '16px', color: 'var(--text-dim)', lineHeight: 1.7 }}>
          התחיל חודש חדש 🗓️<br />
          האם לייצא את כל הקבלות של <strong>{prev.label}</strong> לרואה החשבון?
          <br />
          <span style={{ fontSize: '14px', color: 'var(--text-mute)' }}>
            הקובץ יכלול Excel + דוח PDF להדפסה + תיקיית תמונות הקבלות — הכל ב-ZIP אחד.
          </span>
        </p>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={dismiss} disabled={busy}
            style={{ padding: '11px 20px', borderRadius: '10px', border: '1.5px solid var(--border)', background: 'var(--panel-2)', color: 'var(--text-dim)', fontWeight: 500, fontSize: '15px', cursor: 'pointer', fontFamily: 'var(--font-main)' }}>
            לא תודה
          </button>
          <button onClick={handleExport} disabled={busy}
            style={{ padding: '11px 22px', borderRadius: '10px', border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 600, fontSize: '15px', cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1, fontFamily: 'var(--font-main)' }}>
            {busy ? 'מייצא...' : `כן, ייצא את ${HE_MONTHS[prev.m]}`}
          </button>
        </div>
      </div>
    </Modal>
  )
}
