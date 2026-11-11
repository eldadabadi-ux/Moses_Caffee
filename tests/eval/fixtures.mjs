/**
 * fixtures — a synthetic Hebrew receipt corpus with exact ground truth
 * (client request #9: "בדוק אם יש מודל טוב יותר").
 *
 * WHY SYNTHETIC: measuring whether one extraction model beats another needs a
 * corpus with known-correct answers. The obvious source — real receipts — is a
 * live business's confidential data, and it has no ground truth either: the only
 * "answer" on file is what the current model already produced, which makes it
 * useless for judging that same model. These receipts are generated, so the
 * expected values are exact by construction and nothing confidential is stored
 * in the repo.
 *
 * Every fixture encodes a failure mode observed in the live data or named in the
 * client's list, so a regression shows up as a specific field going red rather
 * than a vague drop in a single score.
 *
 * Adding a case: append here, re-run `npm run eval:scan`. No image files are
 * committed — the runner renders them.
 */

export const VAT_RATE = 18
const r2 = (n) => Math.round(n * 100) / 100
/** Build an item line and the exact totals it implies — no hand-typed arithmetic. */
const line = (item_name, quantity, unit, unit_price, extra = {}) => ({
  item_name, quantity, unit, unit_price, price: r2(quantity * unit_price), ...extra,
})
const sum = (items) => r2(items.reduce((s, i) => s + i.price, 0))

export const FIXTURES = [

  // ── 1. The baseline: weight-priced produce, Israeli day-first date ──────────
  {
    id: 'produce-kg-daydirst',
    why: 'Day-first date (03/07 is 3 July, not 7 March) — the mis-read the client reported.',
    doc: {
      vendor: 'קטיף ירקות קצוצים בע"מ',
      dateText: '03/07/2026', docType: 'תעודת משלוח', docNumber: '45871',
      items: [
        line('עגבניה אשכולות', 11.8, 'ק"ג', 7.5),
        line('מלפפון', 5, 'ק"ג', 11.5),
        line('פלפל מיקס', 10, 'ק"ג', 12.5),
      ],
    },
    expect: {
      vendor_name: 'קטיף ירקות קצוצים בע"מ',
      receipt_date: '2026-07-03',
      doc_type: 'delivery_note',
      doc_number: '45871',
      item_count: 3,
      units: ['kg', 'kg', 'kg'],
    },
  },

  // ── 2. A different spelling of the same unit ───────────────────────────────
  {
    id: 'unit-spelling-kilo',
    why: '"קילו" and "ק\\"ג" are the same unit; both must normalise to kg or price comparison breaks.',
    doc: {
      vendor: 'י.י. אגס בע"מ',
      dateText: '12/08/2026', docType: 'חשבונית מס/קבלה',
      items: [
        line('גבינה צהובה', 3, 'קילו', 73.3),
        line('קוטג\' 250 גרם', 12, 'יח\'', 6),
      ],
    },
    expect: {
      vendor_name: 'י.י. אגס בע"מ',
      receipt_date: '2026-08-12',
      doc_type: 'receipt',
      item_count: 2,
      units: ['kg', 'unit'],
    },
  },

  // ── 3. Pack size hidden in the product name ────────────────────────────────
  {
    id: 'pack-size-in-name',
    why: 'A carton priced per unit must reprice per litre from "1 ליטר" in the name (request #12).',
    doc: {
      vendor: 'מייזן סחר ושיווק מזון איכותי בע"מ',
      dateText: '05/08/2026', docType: 'תעודת משלוח', docNumber: '9931',
      items: [
        line('חלב טרי בקרטון 1 ליטר 3% תנובה', 24, 'יח\'', 6.21),
        line('יוגורט כד 1.5 ליטר', 3, 'יח\'', 21.8),
      ],
    },
    expect: {
      vendor_name: 'מייזן סחר ושיווק מזון איכותי בע"מ',
      receipt_date: '2026-08-05',
      doc_type: 'delivery_note',
      item_count: 2,
      // The model reports the printed unit; our pipeline derives the base unit.
      base_units: ['l', 'l'],
    },
  },

  // ── 4. No unit printed anywhere — 34% of the live line items ───────────────
  {
    id: 'no-units-printed',
    why: 'The prompt now asks the model to INFER a unit from context rather than return "".',
    doc: {
      vendor: 'לי-אור דגן שיווק מוצרי מאפה',
      dateText: '19/08/2026', docType: 'תעודת משלוח', docNumber: '2201',
      noUnitColumn: true,
      items: [
        line('לחם מחמצת', 12, '', 15),
        line('ג\'בטה חצי', 30, '', 2),
        line('לחם טוסט אמריקאי', 3, '', 14.5),
      ],
    },
    expect: {
      vendor_name: 'לי-אור דגן שיווק מוצרי מאפה',
      receipt_date: '2026-08-19',
      item_count: 3,
      // Bread is counted, not weighed — an inferred "unit" is the right answer.
      units_inferred_as: 'unit',
    },
  },

  // ── 5. Foreign currency ────────────────────────────────────────────────────
  {
    id: 'foreign-currency-usd',
    why: 'A USD receipt must be detected as USD; ILS conversion uses the official rate server-side.',
    doc: {
      vendor: 'Anthropic, PBC', currency: 'USD', symbol: '$',
      dateText: '01/08/2026', docType: 'INVOICE', docNumber: 'INV-2026-08',
      ltr: true,
      // A US invoice carries no Israeli VAT — the fixture used to print an 18%
      // block while expecting total 20, an unwinnable assertion.
      vatMode: 'exempt',
      items: [line('Claude Pro subscription', 1, 'unit', 20)],
    },
    expect: {
      vendor_name: 'Anthropic, PBC',
      receipt_date: '2026-08-01',
      currency: 'USD',
      total_amount: 20,
      item_count: 1,
    },
  },

  // ── 6. Summary invoice — must NOT be counted as an expense ─────────────────
  {
    id: 'summary-invoice',
    why: 'A חשבונית מרכזת aggregates delivery notes; counting it doubles the month.',
    doc: {
      vendor: 'המתוקיה של בני בע"מ',
      dateText: '31/07/2026', docType: 'חשבונית מרכזת', docNumber: '7788',
      refs: ['45871', '45902', '46011'],
      items: [
        line('תעודה 45871', 1, '', 1250.4),
        line('תעודה 45902', 1, '', 980.15),
        line('תעודה 46011', 1, '', 1442.3),
      ],
    },
    expect: {
      vendor_name: 'המתוקיה של בני בע"מ',
      receipt_date: '2026-07-31',
      doc_type: 'summary_invoice',
      doc_number: '7788',
      doc_refs: ['45871', '45902', '46011'],
    },
  },

  // ── 7. Non-round prices that must survive verbatim ─────────────────────────
  {
    id: 'exact-prices',
    why: 'The client reported rounded amounts. 6.2102 must not come back as 6.21 or 6.',
    doc: {
      vendor: 'אהרון שוק',
      dateText: '22/08/2026', docType: 'חשבונית מס',
      items: [
        line('חלב טרי', 24, 'יח\'', 6.2102),
        line('שמנת מתוקה', 7, 'יח\'', 12.3457),
      ],
    },
    expect: {
      vendor_name: 'אהרון שוק',
      receipt_date: '2026-08-22',
      // Exact to the agora — this is the assertion the client asked for.
      unit_prices: [6.2102, 12.3457],
      item_count: 2,
    },
  },

  // ── 8. Utility bill — a different shape entirely ───────────────────────────
  {
    id: 'utility-kwh',
    why: 'Not a supplier delivery: one line, an energy unit, and a period rather than a purchase date.',
    doc: {
      vendor: 'חברת החשמל לישראל בע"מ',
      dateText: '15/07/2026', docType: 'חשבון חשמל', docNumber: 'EL-556677',
      items: [line('צריכת חשמל', 1420, 'קוט"ש', 0.6021)],
    },
    expect: {
      vendor_name: 'חברת החשמל לישראל בע"מ',
      receipt_date: '2026-07-15',
      item_count: 1,
      units: ['kwh'],
    },
  },

  // ── 9. A long list — truncation shows up here first ────────────────────────
  {
    id: 'long-item-list',
    why: 'Item lists get silently truncated; 18 lines is where that starts to show.',
    doc: {
      vendor: 'צוקי ארסוף',
      dateText: '08/08/2026', docType: 'תעודת משלוח', docNumber: '3344',
      items: [
        'עגבניה', 'מלפפון', 'פלפל אדום', 'פלפל צהוב', 'בצל יבש', 'בצל סגול',
        'גזר', 'תפוח אדמה', 'בטטה', 'חסה', 'כרוב לבן', 'כרוב אדום',
        'סלרי', 'שמיר', 'פטרוזיליה', 'כוסברה', 'נענע', 'לימון',
      ].map((n, i) => line(n, (i % 5) + 1, 'ק"ג', 6 + i * 0.5)),
    },
    expect: {
      vendor_name: 'צוקי ארסוף',
      receipt_date: '2026-08-08',
      item_count: 18,
    },
  },

  // ── 11. Consumer receipt — line prices INCLUDE VAT ──────────────────────────
  {
    id: 'consumer-vat-inclusive',
    why: 'Line prices on a consumer receipt already include VAT; the pipeline used to add 18% on top (client issue #9). The printed address must not leak into the vendor name.',
    doc: {
      vendor: 'סופר הכפר בע"מ',
      address: 'רחוב הדקל 12, רמת גן · טל׳ 03-5551234 · ח.פ 514477221',
      dateText: '02/09/2026', docType: 'חשבונית מס/קבלה', docNumber: '118822',
      vatMode: 'inclusive',
      items: [
        line('חלב 3% קרטון', 6, 'יח\'', 6.9),
        line('לחם אחיד פרוס', 4, 'יח\'', 7.1),
        line('גבינה לבנה 5%', 3, 'יח\'', 5.5),
        line('שמן זית כתית 750 מ"ל', 1, 'יח\'', 54.9),
      ],
    },
    expect: {
      vendor_name: 'סופר הכפר בע"מ',
      receipt_date: '2026-09-02',
      doc_type: 'receipt',
      item_count: 4,
      // The decisive assertion comes from totalsOf('inclusive'):
      // total == the sum of the lines, NOT sum × 1.18.
    },
  },

  // ── 12. VAT-exempt supplier — no VAT may be fabricated ──────────────────────
  {
    id: 'vat-exempt',
    why: 'An עוסק פטור document has 0% VAT; reconcileVat used to invent an 18% split for it.',
    doc: {
      vendor: 'ירון משק חקלאי',
      dateText: '14/09/2026', docType: 'קבלה — עוסק פטור', docNumber: '301',
      vatMode: 'exempt',
      items: [
        line('ביצי חופש L', 10, 'מארז', 32),
        line('דבש טבעי 1 ק"ג', 2, 'יח\'', 65),
      ],
    },
    expect: {
      vendor_name: 'ירון משק חקלאי',
      receipt_date: '2026-09-14',
      item_count: 2,
      // total == before_vat == the line sum; vat is zero by construction.
    },
  },

  // ── 13. Address-heavy letterhead — the name/address confusion case ─────────
  {
    id: 'address-heavy-header',
    why: 'The client reported the supplier name coming back as the address. A busy letterhead (address, phone, ח.פ) must still yield the business name.',
    doc: {
      vendor: 'מידן שיווק ומסחר בע"מ',
      address: 'שד׳ ההסתדרות 88, מפרץ חיפה · ת.ד 2210 · טל׳ 04-8771122 · ח.פ 512233445',
      dateText: '21/09/2026', docType: 'תעודת משלוח', docNumber: '77314',
      items: [
        line('קמח לחם 25 ק"ג', 2, 'שק', 92.5),
        line('סוכר לבן 1 ק"ג', 12, 'יח\'', 5.4),
        line('שמרים טריים', 4, 'ק"ג', 18.7),
      ],
    },
    expect: {
      vendor_name: 'מידן שיווק ומסחר בע"מ',
      receipt_date: '2026-09-21',
      doc_type: 'delivery_note',
      doc_number: '77314',
      item_count: 3,
    },
  },

  // ── 10. A faint, rotated scan — the realistic camera case ──────────────────
  {
    id: 'noisy-scan',
    why: 'Real scans are skewed and low-contrast; accuracy must not fall off a cliff.',
    render: { rotate: -1.6, contrast: 0.72, noise: true },
    doc: {
      vendor: 'המחלבה של בני בע"מ',
      dateText: '27/07/2026', docType: 'תעודת משלוח', docNumber: '5150',
      items: [
        line('גבינה בולגרית 16%', 4, 'ק"ג', 30.6),
        line('לבנה', 6, 'ק"ג', 22.4),
      ],
    },
    expect: {
      vendor_name: 'המחלבה של בני בע"מ',
      receipt_date: '2026-07-27',
      item_count: 2,
      units: ['kg', 'kg'],
    },
  },
]

/**
 * Totals implied by a fixture, computed — never hand-typed.
 * vatMode controls what the line amounts mean (all three exist in real paperwork):
 *   'net'       (default) — B2B style: lines are pre-VAT, VAT added at the bottom.
 *   'inclusive' — consumer style: line prices already include VAT.
 *   'exempt'    — עוסק פטור / 0% VAT: no VAT anywhere.
 */
export function totalsOf(fx) {
  const s = sum(fx.doc.items)
  const mode = fx.doc.vatMode || 'net'
  if (mode === 'inclusive') {
    const before = r2(s / (1 + VAT_RATE / 100))
    return { before_vat: before, vat_amount: r2(s - before), total: s, mode }
  }
  if (mode === 'exempt') {
    return { before_vat: s, vat_amount: 0, total: s, mode }
  }
  const vat = r2(s * VAT_RATE / 100)
  return { before_vat: s, vat_amount: vat, total: r2(s + vat), mode }
}
