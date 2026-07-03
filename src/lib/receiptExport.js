/**
 * receiptExport — reusable builders for the accountant exports.
 * Used by the export dialog, the quick Excel/PDF buttons, and the monthly prompt.
 */
import { docTypeOf, docTypeLabel, isExpenseDoc } from './docTypes'
import { matchInvoice, findCandidates, normalizeVendor, docNumberOf, TOLERANCE } from './reconciliation'
import { signedReceiptUrl } from './storage'

const fmtDate = d => d ? d.split('-').reverse().join('.') : ''
const il = n => `₪${parseFloat(n || 0).toLocaleString('he-IL', { minimumFractionDigits: 2 })}`
// Doc-type display for exports — regular receipts stay blank (the common case).
const docCell = r => { const t = docTypeOf(r); return t === 'receipt' ? '' : docTypeLabel(t) }

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
  // Summary invoices (חשבונית מרכזת) are listed (official tax documents) but
  // EXCLUDED from the totals — their delivery notes are already summed.
  const expense  = receipts.filter(isExpenseDoc)
  const excluded = receipts.filter(r => !isExpenseDoc(r))
  const sumBefore = expense.reduce((s, r) => s + vatBefore(r, vatRate), 0)
  const sumVat    = expense.reduce((s, r) => s + vatAmount(r, vatRate), 0)
  const sumTotal  = expense.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
  const excludedSum = excluded.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
  const rows = [
    ['תאריך', 'ספק', 'סוג מסמך', 'קטגוריה', 'לפני מע"מ (₪)', 'מע"מ (₪)', 'סה"כ כולל מע"מ (₪)'],
    ...receipts.map(r => [
      fmtDate(r.receipt_date), r.vendor_name || '', docCell(r), r.category_text || '',
      Math.round(vatBefore(r, vatRate) * 100) / 100,
      Math.round(vatAmount(r, vatRate) * 100) / 100,
      parseFloat(r.amount || 0),
    ]),
    ['', '', '', 'סה"כ', Math.round(sumBefore*100)/100, Math.round(sumVat*100)/100, Math.round(sumTotal*100)/100],
    ...(excluded.length ? [['', '', '', `מתוכן חשבוניות מרכזות (${excluded.length}) — לא נכללות בסה"כ`, '', '', Math.round(excludedSum*100)/100]] : []),
  ]
  const thin = { style: 'thin', color: { rgb: 'CCCCCC' } }
  const border = { top: thin, bottom: thin, left: thin, right: thin }
  const ws = XLSXs.utils.aoa_to_sheet(rows)
  const range = XLSXs.utils.decode_range(ws['!ref'] || 'A1')
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSXs.utils.encode_cell({ r: R, c: C })
      if (!ws[addr]) ws[addr] = { v: '', t: 's' }
      const isHeader = R === 0, isTotal = R > receipts.length
      ws[addr].s = {
        font:      { bold: isHeader || isTotal, name: 'Arial', sz: 11 },
        fill:      isHeader ? { patternType: 'solid', fgColor: { rgb: 'E8E8E8' } } : { patternType: 'none' },
        border,
        alignment: { horizontal: 'right', readingOrder: 2 },
      }
    }
  }
  ws['!cols']  = [{ wch: 14 }, { wch: 22 }, { wch: 15 }, { wch: 20 }, { wch: 15 }, { wch: 13 }, { wch: 17 }]
  ws['!views'] = [{ rightToLeft: true }]
  const wb = XLSXs.utils.book_new()
  XLSXs.utils.book_append_sheet(wb, ws, 'קבלות')
  // Second worksheet: delivery-note ↔ summary-invoice reconciliation (התאמות),
  // added automatically whenever the set contains classified documents.
  const sections = buildReconciliationRows(receipts)
  if (sections.length) appendReconciliationSheet(XLSXs, wb, sections)
  const buf = XLSXs.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true })
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

// ── Reconciliation (התאמות) — per-supplier delivery notes vs summary invoice ──

const reconStatusText = s => s.status === 'waiting' ? 'ממתין לחשבונית'
  : s.status === 'mismatch' ? `⚠ פער של ${il(Math.abs(s.delta))}`
  : s.status === 'rounding' ? `✓ תואם (הפרש עיגול ${il(Math.abs(s.delta))})`
  : '✓ תואם'

/**
 * Pure data for the reconciliation document. One section per supplier:
 * its delivery notes, the summary invoice (when arrived), totals and status.
 * `month` ('YYYY-MM', optional) mirrors the ReconciliationPage view: invoices
 * of that month + all still-open ones + suppliers waiting in that month.
 */
export function buildReconciliationRows(receipts, { month } = {}) {
  const r2n = n => Math.round((Number(n) || 0) * 100) / 100
  const active = (receipts || []).filter(r => !r.archived_at)
  const open = r => !r.reconciliation || r.reconciliation.status === 'mismatch'
  const invoices = active.filter(r => docTypeOf(r) === 'summary_invoice'
    && (!month || (r.receipt_date || '').startsWith(month) || open(r)))
  const sections = []
  const usedVendors = new Set()

  for (const inv of invoices) {
    const snap = inv.reconciliation
    let notes, status, delta, notesTotal
    if (snap) {
      notes = (snap.notes || []).map(n => ({ date: n.date || '', number: n.doc_number || '', amount: r2n(n.amount),
        flag: n.ref_amount != null && Math.abs(n.diff) > TOLERANCE }))
      status = snap.status; delta = r2n(snap.delta); notesTotal = r2n(snap.notes_total)
    } else {
      const linked = active.filter(r => r.matched_invoice_id === inv.id)
      const res = matchInvoice(inv, linked.length ? linked : findCandidates(active, inv))
      notes = res.notes.map(n => ({ date: n.date, number: n.doc_number, amount: n.amount,
        flag: n.ref_amount != null && Math.abs(n.diff) > TOLERANCE }))
      status = res.status; delta = res.delta; notesTotal = res.notesTotal
    }
    usedVendors.add(normalizeVendor(inv.vendor_name))
    sections.push({
      vendor: (inv.vendor_name || '').trim() || 'ספק לא ידוע', confirmed: !!snap, status, delta, notesTotal,
      invoice: { date: inv.receipt_date || '', number: docNumberOf(inv), amount: r2n(inv.amount) },
      notes,
    })
  }

  // Suppliers with open delivery notes and no summary invoice yet
  const waitMap = {}
  active.forEach(r => {
    if (docTypeOf(r) !== 'delivery_note' || r.matched_invoice_id) return
    if (month && !(r.receipt_date || '').startsWith(month)) return
    const key = normalizeVendor(r.vendor_name)
    if (usedVendors.has(key)) return
    if (!waitMap[key]) waitMap[key] = { vendor: (r.vendor_name || '').trim() || 'ספק לא ידוע', notes: [] }
    waitMap[key].notes.push({ date: r.receipt_date || '', number: docNumberOf(r), amount: r2n(r.amount), flag: false })
  })
  for (const w of Object.values(waitMap)) {
    w.notes.sort((a, b) => a.date.localeCompare(b.date))
    sections.push({ vendor: w.vendor, confirmed: false, status: 'waiting', delta: null,
      notesTotal: r2n(w.notes.reduce((s, n) => s + n.amount, 0)), invoice: null, notes: w.notes })
  }
  return sections
}

/** Adds an RTL-styled "התאמות" worksheet to an existing workbook. */
export function appendReconciliationSheet(XLSXs, wb, sections) {
  const rows = [['ספק', 'מסמך', 'תאריך', "מס' מסמך", 'סכום (₪)', 'סטטוס']]
  const meta = ['header']
  for (const s of sections) {
    rows.push([s.vendor, '', '', '', '', reconStatusText(s) + (s.invoice && !s.confirmed && s.status !== 'waiting' ? ' · טרם אושר' : '')])
    meta.push('vendor:' + s.status)
    for (const n of s.notes) {
      rows.push(['', 'תעודת משלוח', fmtDate(n.date), n.number || '', n.amount, n.flag ? '⚠ שונה מהחשבונית' : ''])
      meta.push(n.flag ? 'note-flag' : 'note')
    }
    rows.push(['', 'סה"כ תעודות משלוח', '', '', s.notesTotal, ''])
    meta.push('subtotal')
    if (s.invoice) {
      rows.push(['', 'חשבונית מרכזת', fmtDate(s.invoice.date), s.invoice.number || '', s.invoice.amount,
        s.delta != null && Math.abs(s.delta) > 0.009 ? `הפרש: ${il(s.delta)}` : ''])
      meta.push('invoice')
    }
    rows.push(['', '', '', '', '', ''])
    meta.push('spacer')
  }
  const thin = { style: 'thin', color: { rgb: 'CCCCCC' } }
  const border = { top: thin, bottom: thin, left: thin, right: thin }
  const ws = XLSXs.utils.aoa_to_sheet(rows)
  const range = XLSXs.utils.decode_range(ws['!ref'] || 'A1')
  for (let R = range.s.r; R <= range.e.r; R++) {
    const kind = meta[R] || ''
    if (kind === 'spacer') continue
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSXs.utils.encode_cell({ r: R, c: C })
      if (!ws[addr]) ws[addr] = { v: '', t: 's' }
      const isHeader = kind === 'header'
      const isVendor = kind.startsWith('vendor')
      const fill = isHeader ? { patternType: 'solid', fgColor: { rgb: 'E8E8E8' } }
        : kind === 'vendor:matched' || kind === 'vendor:rounding' ? { patternType: 'solid', fgColor: { rgb: 'C6EFCE' } }
        : kind === 'vendor:mismatch' || kind === 'note-flag' ? { patternType: 'solid', fgColor: { rgb: 'FFC7CE' } }
        : kind === 'vendor:waiting' ? { patternType: 'solid', fgColor: { rgb: 'F2F2F2' } }
        : { patternType: 'none' }
      ws[addr].s = {
        font: { bold: isHeader || isVendor || kind === 'subtotal' || kind === 'invoice', name: 'Arial', sz: 11 },
        fill, border,
        alignment: { horizontal: 'right', readingOrder: 2 },
      }
    }
  }
  ws['!cols']  = [{ wch: 24 }, { wch: 18 }, { wch: 12 }, { wch: 13 }, { wch: 14 }, { wch: 30 }]
  ws['!views'] = [{ rightToLeft: true }]
  XLSXs.utils.book_append_sheet(wb, ws, 'התאמות')
}

/** Standalone RTL print document (HTML → print → PDF) for the reconciliation. */
export function buildReconciliationHtml(receipts, { month, periodLabel } = {}) {
  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  const sections = buildReconciliationRows(receipts, { month })
  const period = periodLabel || (month ? month.split('-').reverse().join('/') : 'כל הזמנים')
  const stColor = s => s.status === 'mismatch' ? '#dc2626' : s.status === 'waiting' ? '#64748b' : '#059669'
  const secHtml = sections.map(s => `
<div class="sec">
  <div class="sec-head"><span class="vendor">${esc(s.vendor)}</span><span class="status" style="color:${stColor(s)}">${esc(reconStatusText(s))}${s.invoice && !s.confirmed && s.status !== 'waiting' ? ' · טרם אושר' : ''}</span></div>
  <table>
    <thead><tr><th>מסמך</th><th>תאריך</th><th>מס'</th><th>סכום</th><th></th></tr></thead>
    <tbody>
      ${s.notes.map(n => `<tr><td>תעודת משלוח</td><td>${esc(fmtDate(n.date)) || '—'}</td><td>${esc(n.number) || '—'}</td><td>${il(n.amount)}</td><td>${n.flag ? '<span style="color:#dc2626">⚠ שונה מהחשבונית</span>' : ''}</td></tr>`).join('')}
      <tr class="sub"><td colspan="3">סה"כ תעודות משלוח (${s.notes.length})</td><td>${il(s.notesTotal)}</td><td></td></tr>
      ${s.invoice ? `<tr class="inv"><td>חשבונית מרכזת</td><td>${esc(fmtDate(s.invoice.date)) || '—'}</td><td>${esc(s.invoice.number) || '—'}</td><td>${il(s.invoice.amount)}</td><td>${s.delta != null && Math.abs(s.delta) > 0.009 ? `<span style="color:#dc2626">הפרש: ${il(s.delta)}</span>` : '<span style="color:#059669">✓</span>'}</td></tr>` : ''}
    </tbody>
  </table>
</div>`).join('')
  return `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8"/><title>דוח התאמות — תעודות משלוח מול חשבוניות</title>
<style>@import url('https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700&display=swap');
*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Heebo',Arial,sans-serif;direction:rtl;color:#1e293b;padding:32px;font-size:14px;}
h1{font-size:23px;font-weight:700;margin-bottom:4px;}.subtitle{color:#64748b;font-size:14px;margin-bottom:22px;}
.sec{margin-bottom:26px;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;page-break-inside:avoid;}
.sec-head{display:flex;justify-content:space-between;align-items:center;background:#f8fafc;padding:10px 14px;border-bottom:1px solid #e2e8f0;}
.vendor{font-weight:700;font-size:16px;}.status{font-weight:700;font-size:13.5px;}
table{width:100%;border-collapse:collapse;font-size:13.5px;}
th{padding:8px 12px;text-align:right;font-weight:600;color:#64748b;font-size:12px;border-bottom:1px solid #f1f5f9;}
td{padding:8px 12px;color:#334155;border-bottom:1px solid #f8fafc;}
tr.sub td{background:#f8fafc;font-weight:700;border-top:1px solid #e2e8f0;}
tr.inv td{background:#f5f3ff;font-weight:700;}
@media print{body{padding:0;}}</style></head><body>
<h1>דוח התאמות — תעודות משלוח מול חשבוניות מרכזות</h1>
<div class="subtitle">תקופה: ${esc(period)} · הופק ב-${new Date().toLocaleDateString('he-IL',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'})}</div>
${sections.length ? secHtml : '<p style="color:#64748b">אין מסמכים להתאמה בתקופה זו.</p>'}
<div style="color:#94a3b8;font-size:12.5px;margin-top:28px;border-top:1px solid #e2e8f0;padding-top:12px;">
חשבונית מרכזת מסכמת את תעודות המשלוח של הספק ולכן אינה נספרת בהוצאות; ההוצאה נרשמת לפי תעודות המשלוח.
</div>
<script>window.onload=()=>{window.print();}<\/script></body></html>`
}

// ── PDF (HTML for print) ──────────────────────────────────────────────────────
export function buildPdfHtml(receipts, { filterFrom, filterTo, vatRate = 18, title = 'דוח קבלות' } = {}) {
  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  const fmt = d => d ? new Date(d).toLocaleDateString('he-IL', { day:'numeric', month:'long', year:'numeric' }) : ''
  const period = (filterFrom || filterTo) ? `${fmt(filterFrom) || '...'} — ${fmt(filterTo) || '...'}` : 'כל הזמנים'
  const sorted = [...receipts].sort((a,b) => (a.receipt_date||'').localeCompare(b.receipt_date||''))
  // Totals exclude summary invoices (their delivery notes are already counted)
  const expense  = sorted.filter(isExpenseDoc)
  const excluded = sorted.filter(r => !isExpenseDoc(r))
  const sumBefore = expense.reduce((s,r)=>s+vatBefore(r, vatRate),0)
  const sumVat    = expense.reduce((s,r)=>s+vatAmount(r, vatRate),0)
  const sumTotal  = expense.reduce((s,r)=>s+(parseFloat(r.amount)||0),0)
  const excludedSum = excluded.reduce((s,r)=>s+(parseFloat(r.amount)||0),0)
  const trs = sorted.map(r => `<tr><td>${r.receipt_date ? new Date(r.receipt_date).toLocaleDateString('he-IL') : '—'}</td><td>${esc(r.vendor_name)||'—'}</td><td>${esc(docCell(r))}</td><td>${esc(r.category_text||'')}</td><td>${il(vatBefore(r, vatRate))}</td><td style="color:#92400e">${il(vatAmount(r, vatRate))}</td><td style="font-weight:700;color:#059669">${il(r.amount)}</td></tr>`).join('')
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
<div class="total-banner">סה"כ כולל מע"מ: <span>${il(sumTotal)}</span> · מתוכו מע"מ: ${il(sumVat)} · לפני מע"מ: ${il(sumBefore)} (${expense.length} מסמכים)${excluded.length ? ` · לא כולל ${excluded.length} חשבוניות מרכזות (${il(excludedSum)})` : ''}</div>
<table><thead><tr><th>תאריך</th><th>ספק</th><th>סוג מסמך</th><th>קטגוריה</th><th>לפני מע"מ</th><th>מע"מ</th><th>סה"כ</th></tr></thead>
<tbody>${trs}</tbody>
<tfoot><tr><td colspan="4">סה"כ${excluded.length ? ' (ללא חשבוניות מרכזות)' : ''}</td><td>${il(sumBefore)}</td><td style="color:#92400e">${il(sumVat)}</td><td style="color:#059669">${il(sumTotal)}</td></tr></tfoot></table>
<div style="color:#94a3b8;font-size:13px;margin-top:32px;border-top:1px solid #e2e8f0;padding-top:12px;">הופק ב-${new Date().toLocaleDateString('he-IL',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'})}</div>
<script>window.onload=()=>{window.print();}<\/script></body></html>`
}

export function pdfBlob(receipts, opts) {
  return new Blob([buildPdfHtml(receipts, opts)], { type: 'text/html;charset=utf-8' })
}

// ── Images ZIP ────────────────────────────────────────────────────────────────
// Prefers the FULL-resolution original from the private bucket (storage_path)
// via a signed URL; falls back to an inline receipt_image data-URL for legacy
// rows. (New scans keep only a small thumbnail inline — A.8.24.)
export async function buildImagesZip(receipts) {
  const rows = receipts.filter(r => r.storage_path || (r.receipt_image || '').startsWith('data:'))
  if (rows.length === 0) return null
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  let n = 0
  for (const r of rows) {
    const vendor = (r.vendor_name || 'קבלה').replace(/[/\\?%*:|"<>]/g, '-').slice(0, 30)
    const nameBase = `${String(++n).padStart(3, '0')}_${fmtDate(r.receipt_date) || 'ללא_תאריך'}_${vendor}`
    let added = false
    if (r.storage_path) {
      try {
        const url = await signedReceiptUrl(r.storage_path)
        if (url) {
          const resp = await fetch(url)
          if (resp.ok) {
            const buf = await resp.arrayBuffer()
            const ext = /\.png$/i.test(r.storage_path) ? 'png' : /\.pdf$/i.test(r.storage_path) ? 'pdf' : 'jpg'
            zip.file(`${nameBase}.${ext}`, buf)
            added = true
          }
        }
      } catch { /* fall back to inline below */ }
    }
    if (!added && (r.receipt_image || '').startsWith('data:')) {
      const [header, b64] = r.receipt_image.split(',')
      if (b64) { zip.file(`${nameBase}.${header.includes('png') ? 'png' : 'jpg'}`, b64, { base64: true }) }
    }
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

// ── Combine multiple blobs into one ZIP ───────────────────────────────────────
export async function combineZip(files /* [{name, blob}] */) {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  files.forEach(f => { if (f.blob) zip.file(f.name, f.blob) })
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}
