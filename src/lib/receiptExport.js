/**
 * receiptExport — reusable builders for the accountant exports.
 * Used by the export dialog, the quick Excel/PDF buttons, and the monthly prompt.
 */

const fmtDate = d => d ? d.split('-').reverse().join('.') : ''
const il = n => `₪${parseFloat(n || 0).toLocaleString('he-IL', { minimumFractionDigits: 2 })}`

// VAT breakdown for one receipt — prefers exact scanned values (column or
// ai_summary), else computes from total + rate.
export function vatBefore(r, defaultRate = 18) {
  const t = parseFloat(r.amount) || 0
  if (r.amount_before_vat != null && r.amount_before_vat > 0) return parseFloat(r.amount_before_vat)
  if (r.ai_summary?.before_vat > 0) return parseFloat(r.ai_summary.before_vat)
  const rate = r.vat_rate || defaultRate
  return Math.round(t / (1 + rate / 100) * 100) / 100
}
export function vatAmount(r, defaultRate = 18) {
  const t = parseFloat(r.amount) || 0
  if (r.vat_amount != null && r.vat_amount > 0) return parseFloat(r.vat_amount)
  if (r.ai_summary?.vat_amount > 0) return parseFloat(r.ai_summary.vat_amount)
  return Math.round((t - vatBefore(r, defaultRate)) * 100) / 100
}

// ── Excel (RTL, styled, full VAT breakdown) ───────────────────────────────────
export async function buildExcelBlob(receipts, vatRate = 18) {
  const XLSXs = (await import('xlsx-js-style')).default
  const sumBefore = receipts.reduce((s, r) => s + vatBefore(r, vatRate), 0)
  const sumVat    = receipts.reduce((s, r) => s + vatAmount(r, vatRate), 0)
  const sumTotal  = receipts.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
  const rows = [
    ['תאריך', 'ספק', 'קטגוריה', 'לפני מע"מ (₪)', 'מע"מ (₪)', 'סה"כ כולל מע"מ (₪)'],
    ...receipts.map(r => [
      fmtDate(r.receipt_date), r.vendor_name || '', r.category_text || '',
      Math.round(vatBefore(r, vatRate) * 100) / 100,
      Math.round(vatAmount(r, vatRate) * 100) / 100,
      parseFloat(r.amount || 0),
    ]),
    ['', '', 'סה"כ', Math.round(sumBefore*100)/100, Math.round(sumVat*100)/100, Math.round(sumTotal*100)/100],
  ]
  const thin = { style: 'thin', color: { rgb: 'CCCCCC' } }
  const border = { top: thin, bottom: thin, left: thin, right: thin }
  const ws = XLSXs.utils.aoa_to_sheet(rows)
  const range = XLSXs.utils.decode_range(ws['!ref'] || 'A1')
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSXs.utils.encode_cell({ r: R, c: C })
      if (!ws[addr]) ws[addr] = { v: '', t: 's' }
      const isHeader = R === 0, isTotal = R === range.e.r
      ws[addr].s = {
        font:      { bold: isHeader || isTotal, name: 'Arial', sz: 11 },
        fill:      isHeader ? { patternType: 'solid', fgColor: { rgb: 'E8E8E8' } } : { patternType: 'none' },
        border,
        alignment: { horizontal: 'right', readingOrder: 2 },
      }
    }
  }
  ws['!cols']  = [{ wch: 14 }, { wch: 22 }, { wch: 20 }, { wch: 15 }, { wch: 13 }, { wch: 17 }]
  ws['!views'] = [{ rightToLeft: true }]
  const wb = XLSXs.utils.book_new()
  XLSXs.utils.book_append_sheet(wb, ws, 'קבלות')
  const buf = XLSXs.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true })
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

// ── PDF (HTML for print) ──────────────────────────────────────────────────────
export function buildPdfHtml(receipts, { filterFrom, filterTo, vatRate = 18, title = 'דוח קבלות' } = {}) {
  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  const fmt = d => d ? new Date(d).toLocaleDateString('he-IL', { day:'numeric', month:'long', year:'numeric' }) : ''
  const period = (filterFrom || filterTo) ? `${fmt(filterFrom) || '...'} — ${fmt(filterTo) || '...'}` : 'כל הזמנים'
  const sorted = [...receipts].sort((a,b) => (a.receipt_date||'').localeCompare(b.receipt_date||''))
  const sumBefore = sorted.reduce((s,r)=>s+vatBefore(r, vatRate),0)
  const sumVat    = sorted.reduce((s,r)=>s+vatAmount(r, vatRate),0)
  const sumTotal  = sorted.reduce((s,r)=>s+(parseFloat(r.amount)||0),0)
  const trs = sorted.map(r => `<tr><td>${r.receipt_date ? new Date(r.receipt_date).toLocaleDateString('he-IL') : '—'}</td><td>${esc(r.vendor_name)||'—'}</td><td>${esc(r.category_text||'')}</td><td>${il(vatBefore(r, vatRate))}</td><td style="color:#92400e">${il(vatAmount(r, vatRate))}</td><td style="font-weight:700;color:#059669">${il(r.amount)}</td></tr>`).join('')
  return `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8"/><title>${esc(title)}</title>
<style>@import url('https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700&display=swap');
*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Heebo',Arial,sans-serif;direction:rtl;color:#1e293b;padding:32px;font-size:15px;}
h1{font-size:24px;font-weight:700;margin-bottom:4px;}.subtitle{color:#64748b;font-size:15px;margin-bottom:24px;}
.total-banner{background:#f0fdf4;border:1px solid #a7f3d0;border-radius:10px;padding:12px 20px;display:inline-block;margin-bottom:24px;}
.total-banner span{font-size:19px;font-weight:700;color:#059669;}
table{width:100%;border-collapse:collapse;font-size:14px;}thead tr{background:#f8fafc;border-bottom:2px solid #e2e8f0;}
th{padding:10px 12px;text-align:right;font-weight:600;color:#475569;font-size:13px;}
tbody tr{border-bottom:1px solid #f1f5f9;}tbody tr:nth-child(even){background:#f8fafc;}
tfoot tr{background:#f1f5f9;border-top:2px solid #e2e8f0;}tfoot td{padding:12px;font-weight:700;}
td{padding:10px 12px;color:#334155;}@media print{body{padding:0;}}</style></head><body>
<h1>${esc(title)}</h1><div class="subtitle">${period}</div>
<div class="total-banner">סה"כ כולל מע"מ: <span>${il(sumTotal)}</span> · מתוכו מע"מ: ${il(sumVat)} · לפני מע"מ: ${il(sumBefore)} (${receipts.length} קבלות)</div>
<table><thead><tr><th>תאריך</th><th>ספק</th><th>קטגוריה</th><th>לפני מע"מ</th><th>מע"מ</th><th>סה"כ</th></tr></thead>
<tbody>${trs}</tbody>
<tfoot><tr><td colspan="3">סה"כ</td><td>${il(sumBefore)}</td><td style="color:#92400e">${il(sumVat)}</td><td style="color:#059669">${il(sumTotal)}</td></tr></tfoot></table>
<div style="color:#94a3b8;font-size:13px;margin-top:32px;border-top:1px solid #e2e8f0;padding-top:12px;">הופק ב-${new Date().toLocaleDateString('he-IL',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'})}</div>
<script>window.onload=()=>{window.print();}<\/script></body></html>`
}

export function pdfBlob(receipts, opts) {
  return new Blob([buildPdfHtml(receipts, opts)], { type: 'text/html;charset=utf-8' })
}

// ── Images ZIP ────────────────────────────────────────────────────────────────
export async function buildImagesZip(receipts) {
  const withImages = receipts.filter(r => (r.receipt_image || '').startsWith('data:'))
  if (withImages.length === 0) return null
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  withImages.forEach((r, i) => {
    const [header, b64] = (r.receipt_image || '').split(','); if (!b64) return
    const ext = header.includes('png') ? 'png' : 'jpg'
    const vendor = (r.vendor_name || 'קבלה').replace(/[/\\?%*:|"<>]/g, '-').slice(0, 30)
    zip.file(`${String(i+1).padStart(3,'0')}_${fmtDate(r.receipt_date)||'ללא_תאריך'}_${vendor}.${ext}`, b64, { base64: true })
  })
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

// ── Combine multiple blobs into one ZIP ───────────────────────────────────────
export async function combineZip(files /* [{name, blob}] */) {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  files.forEach(f => { if (f.blob) zip.file(f.name, f.blob) })
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}
