/**
 * receiptTemplate — turn a fixture into the HTML of a plausible Israeli receipt.
 *
 * Pure string building, so it is testable and reviewable. The point is not
 * beauty: it is that the rendered image contains EXACTLY the values the fixture
 * declares, laid out the way real supplier paperwork is, so a model's mistakes
 * are the model's and not the corpus's.
 */
import { VAT_RATE, totalsOf } from './fixtures.mjs'

const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
const money = (n, sym = '₪') => `${sym}${Number(n).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`

export function receiptHtml(fx) {
  const d = fx.doc
  const t = totalsOf(fx)
  const sym = d.symbol || '₪'
  const rtl = !d.ltr
  const showUnits = !d.noUnitColumn

  const rows = d.items.map(it => `
      <tr>
        <td class="name">${esc(it.item_name)}</td>
        <td class="num">${it.quantity}</td>
        ${showUnits ? `<td class="unit">${esc(it.unit || '')}</td>` : ''}
        <td class="num">${money(it.unit_price, sym)}</td>
        <td class="num">${money(it.price, sym)}</td>
      </tr>`).join('')

  const refs = d.refs?.length ? `
    <div class="refs">
      <div class="refs-title">${rtl ? 'תעודות משלוח הכלולות בחשבונית זו:' : 'Included delivery notes:'}</div>
      ${d.refs.map(r => `<span class="ref">${esc(r)}</span>`).join('')}
    </div>` : ''

  const L = rtl
    ? { qty: 'כמות', unit: 'יח\'', price: 'מחיר', total: 'סה"כ', date: 'תאריך', no: 'מס\'',
        net: 'סכום לפני מע"מ', vat: `מע"מ ${VAT_RATE}%`, grand: 'סה"כ לתשלום' }
    : { qty: 'Qty', unit: 'Unit', price: 'Price', total: 'Amount', date: 'Date', no: 'No.',
        net: 'Subtotal', vat: `VAT ${VAT_RATE}%`, grand: 'Total' }

  return `<!doctype html><html dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 26px 30px; width: 760px;
         font-family: "DejaVu Sans", "FreeSans", sans-serif; color: #111; background: #fff; }
  .head { display: flex; justify-content: space-between; align-items: flex-start;
          border-bottom: 2px solid #111; padding-bottom: 10px; }
  .vendor { font-size: 25px; font-weight: 700; }
  .addr { font-size: 13px; color: #333; margin-top: 3px; }
  .doctype { font-size: 15px; margin-top: 3px; letter-spacing: .5px; }
  .meta { font-size: 14px; line-height: 1.9; text-align: ${rtl ? 'left' : 'right'}; white-space: nowrap; }
  table { width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 14.5px; }
  th { text-align: ${rtl ? 'right' : 'left'}; border-bottom: 1px solid #444; padding: 6px 8px; font-weight: 700; }
  td { padding: 6px 8px; border-bottom: 1px solid #e2e2e2; }
  td.num, th.num { text-align: ${rtl ? 'left' : 'right'}; white-space: nowrap; font-variant-numeric: tabular-nums; }
  td.unit, th.unit { width: 74px; color: #333; }
  td.name { width: 46%; }
  .totals { margin-top: 16px; ${rtl ? 'margin-left' : 'margin-right'}: 0;
            ${rtl ? 'margin-right' : 'margin-left'}: auto; width: 290px; font-size: 15px; }
  .totals div { display: flex; justify-content: space-between; padding: 4px 0; }
  .totals .grand { border-top: 2px solid #111; margin-top: 6px; padding-top: 8px;
                   font-size: 18px; font-weight: 700; }
  .refs { margin-top: 16px; font-size: 13.5px; }
  .refs-title { font-weight: 700; margin-bottom: 5px; }
  .ref { display: inline-block; border: 1px solid #999; border-radius: 4px;
         padding: 1px 9px; margin: 0 0 4px 6px; font-variant-numeric: tabular-nums; }
  .foot { margin-top: 22px; font-size: 12px; color: #666; border-top: 1px dashed #bbb; padding-top: 8px; }
</style></head><body>
  <div class="head">
    <div>
      <div class="vendor">${esc(d.vendor)}</div>
      ${d.address ? `<div class="addr">${esc(d.address)}</div>` : ''}
      <div class="doctype">${esc(d.docType || '')}</div>
    </div>
    <div class="meta">
      ${L.date}: ${esc(d.dateText)}<br>
      ${d.docNumber ? `${L.no} ${esc(d.docNumber)}` : ''}
    </div>
  </div>
  <table>
    <thead><tr>
      <th>${rtl ? 'תיאור' : 'Description'}</th>
      <th class="num">${L.qty}</th>
      ${showUnits ? `<th class="unit">${L.unit}</th>` : ''}
      <th class="num">${L.price}</th>
      <th class="num">${L.total}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${refs}
  <div class="totals">${
    t.mode === 'inclusive' ? `
    <div class="grand"><span>${L.grand}</span><span>${money(t.total, sym)}</span></div>
    <div><span>${rtl ? `המחירים כוללים מע"מ · מע"מ ${VAT_RATE}% הכלול` : `Prices include VAT · VAT ${VAT_RATE}% included`}</span><span>${money(t.vat_amount, sym)}</span></div>`
    : t.mode === 'exempt' ? `
    <div class="grand"><span>${L.grand}</span><span>${money(t.total, sym)}</span></div>
    <div><span>${rtl ? 'עוסק פטור — העסקה פטורה ממע"מ (מע"מ 0%)' : 'VAT exempt (0%)'}</span><span>${money(0, sym)}</span></div>`
    : `
    <div><span>${L.net}</span><span>${money(t.before_vat, sym)}</span></div>
    <div><span>${L.vat}</span><span>${money(t.vat_amount, sym)}</span></div>
    <div class="grand"><span>${L.grand}</span><span>${money(t.total, sym)}</span></div>`
  }
  </div>
  <div class="foot">${rtl ? 'מסמך שנוצר לבדיקות בלבד — אינו מסמך אמיתי' : 'Synthetic document — test fixture only'}</div>
</body></html>`
}

/** CSS applied on top for the deliberately degraded scan. */
export function degradeCss(render = {}) {
  if (!render || (!render.rotate && !render.contrast && !render.noise)) return ''
  const parts = []
  if (render.contrast) parts.push(`filter: contrast(${render.contrast}) grayscale(1) blur(0.35px);`)
  if (render.rotate) parts.push(`transform: rotate(${render.rotate}deg);`)
  return `body { ${parts.join(' ')} }
    ${render.noise ? `body::after { content:''; position:fixed; inset:0; pointer-events:none; opacity:.055;
      background-image: repeating-linear-gradient(0deg,#000 0 1px,transparent 1px 3px),
                        repeating-linear-gradient(90deg,#000 0 1px,transparent 1px 4px); }` : ''}`
}
