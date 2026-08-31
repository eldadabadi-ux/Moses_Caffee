/**
 * ExportDialog — choose what goes into the accountant's export (Excel, PDF, the
 * receipt images) and build it.
 *
 * Extracted from ReceiptsPage (audit M2). The document building lives in
 * lib/receiptExport.js; this is only the chooser around it.
 */
import { useState } from 'react'
import { Download } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from '../ui/Modal'
import { downloadFile } from '../../lib/downloadFile'
import { buildExcelBlob, pdfBlob as buildPdfBlob, buildImagesZip, combineZip, buildReconciliationRows, buildReconciliationHtml } from '../../lib/receiptExport'

const fmtILS = n => `₪${parseFloat(n || 0).toLocaleString('he-IL', { minimumFractionDigits: 2 })}`

export default function ExportDialog({ receipts, totalAmount, filterFrom, filterTo, vatRate = 18, onClose, onExported }) {
  const [opts, setOpts] = useState({ excel: true, pdf: true, images: true })
  const [busy, setBusy] = useState(false)
  const nImages = receipts.filter(r => r.storage_path || r.receipt_image).length
  const noneSelected = !opts.excel && !opts.pdf && !opts.images
  const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent) || window.innerWidth < 768
  const selectedCount = [opts.excel, opts.pdf, opts.images && nImages > 0].filter(Boolean).length
  const useZip = !isMobile && selectedCount > 1

  async function doExport() {
    if (busy) return
    setBusy(true)
    try {
      const dateStr = new Date().toISOString().slice(0, 10)
      const excelBlob  = opts.excel ? await buildExcelBlob(receipts, vatRate) : null
      const pdfFile    = opts.pdf   ? buildPdfBlob(receipts, { filterFrom, filterTo, vatRate }) : null
      const imagesBlob = (opts.images && nImages > 0) ? await buildImagesZip(receipts) : null
      // Reconciliation document — included when the set has delivery notes /
      // summary invoices (goes in the accountant folder next to the report).
      const reconFile = buildReconciliationRows(receipts).length
        ? new Blob([buildReconciliationHtml(receipts)], { type: 'text/html;charset=utf-8' }) : null

      if (useZip) {
        const blob = await combineZip([
          { name: 'קבלות.xlsx',         blob: excelBlob },
          { name: 'דוח_קבלות.html',     blob: pdfFile },
          { name: 'דוח_התאמות.html',    blob: reconFile },
          { name: 'תמונות_קבלות.zip',   blob: imagesBlob },
        ])
        await downloadFile({ blob, filename: `קבלות_לרו"ח_${dateStr}.zip` })
      } else {
        if (excelBlob)  await downloadFile({ blob: excelBlob,  filename: `קבלות_${dateStr}.xlsx` })
        if (pdfFile)    await downloadFile({ blob: pdfFile,    filename: `דוח_קבלות_${dateStr}.html` })
        if (imagesBlob) await downloadFile({ blob: imagesBlob, filename: `תמונות_קבלות_${dateStr}.zip` })
      }
      toast.success('הייצוא הושלם!')
      onClose()
      onExported?.(receipts)   // offer to move the exported receipts to the archive
    } catch (err) {
      toast.error('שגיאה בייצוא: ' + (err?.message || ''))
    } finally {
      setBusy(false)
    }
  }

  const checkStyle = (active) => ({
    display:'flex', alignItems:'flex-start', gap:'12px', padding:'12px 14px',
    borderRadius:'10px', cursor:'pointer', transition:'all 120ms', marginBottom:'10px',
    background: active ? 'var(--accent-bg)' : 'var(--panel-2)',
    border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
  })

  return (
    <Modal isOpen={true} onClose={onClose} title={`ייצוא לרו"ח · ${receipts.length} קבלות`} size="sm">
      <div style={{ display:'flex', flexDirection:'column', gap:'14px' }} dir="rtl">
        <p style={{ margin:0, fontSize:'13px', color:'var(--text-mute)' }}>סה"כ {fmtILS(totalAmount)}</p>
        <div>
          <p style={{ margin:'0 0 10px', fontSize:'11px', fontWeight:600, color:'var(--text-mute)', textTransform:'uppercase', letterSpacing:'0.07em' }}>מה לכלול</p>
          {[
            { key:'excel', icon:'📊', label:'Excel לרואה חשבון',   sub:'.xlsx עם כל הקבלות' },
            { key:'pdf',   icon:'📄', label:'דוח להדפסה (PDF)',    sub:'קובץ HTML → הדפס → שמור PDF' },
            { key:'images',icon:'🖼',  label:'תמונות קבלות',        sub:`${nImages} קבלות עם תמונה` },
          ].map(({ key, icon, label, sub }) => (
            <label key={key} style={checkStyle(opts[key])}>
              <input type="checkbox" checked={!!opts[key]} onChange={() => setOpts(p => ({ ...p, [key]: !p[key] }))} style={{ accentColor:'var(--accent)', width:'18px', height:'18px', marginTop:'1px', cursor:'pointer', flexShrink:0 }} />
              <span style={{ fontSize:'20px' }}>{icon}</span>
              <div>
                <p style={{ margin:0, fontWeight:600, fontSize:'14px', color:'var(--text)' }}>{label}</p>
                <p style={{ margin:'2px 0 0', fontSize:'12px', color:'var(--text-mute)' }}>{sub}</p>
              </div>
            </label>
          ))}
        </div>
        <div style={{ display:'flex', gap:'10px', paddingTop:'4px', paddingBottom:'4px' }}>
          <button onClick={onClose} disabled={busy} style={{ flex:1, padding:'13px', borderRadius:'var(--r-btn)', border:'1px solid var(--border)', background:'var(--panel)', color:'var(--text-dim)', fontSize:'14px', cursor:'pointer', fontFamily:'var(--font-main)' }}>ביטול</button>
          <button onClick={doExport} disabled={busy || noneSelected}
            style={{ flex:2, display:'flex', alignItems:'center', justifyContent:'center', gap:'8px', padding:'13px', borderRadius:'var(--r-btn)', border:'none', fontSize:'14px', fontWeight:700, fontFamily:'var(--font-main)', cursor:(busy||noneSelected)?'default':'pointer', background:(busy||noneSelected)?'var(--panel-2)':'linear-gradient(135deg,#2563eb,#1d4ed8)', color:(busy||noneSelected)?'var(--text-mute)':'white' }}>
            <Download size={15} />
            {busy ? 'מייצא...' : useZip ? 'ייצא ZIP לרו"ח' : 'ייצא'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Main ReceiptsPage ─────────────────────────────────────────────────────────
