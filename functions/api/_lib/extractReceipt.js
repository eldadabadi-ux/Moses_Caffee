/**
 * extractReceipt — shared receipt-extraction core (Gemini OCR + VAT + FX).
 *
 * Extracted from scan-receipt.js so every ingestion channel reuses ONE pipeline:
 *   - /api/scan-receipt   (authenticated, camera/upload)
 *   - /api/inbound/email  (email attachments)
 *   - /api/import/link    (downloaded invoice files)
 *
 * Gemini accepts images AND PDFs as inline_data, so the same call handles both.
 *
 * Usage:
 *   const result = await extractReceipt({ images, mimeType, env, userId, vatRate })
 *   // result: { vendor_name, receipt_date, total_amount, amount_before_vat,
 *   //           vat_amount, currency, items[], fx, total_ils?, ... }
 */

import { getIlsRate, normalizeCurrency } from './fxRate.js'
import { applyReceiptCategory } from './classifyReceipt.js'
import { withUnitPricing } from './units.js'

// Model chain — flash models work on the free tier and are fast + accurate.
// gemini-2.5-pro is intentionally NOT used: it returns 429 (quota) on the free tier.
const GEMINI_PRIMARY  = 'gemini-2.5-flash'
const GEMINI_FALLBACK = 'gemini-flash-latest'

export function getSupabaseUrl(env) {
  return env.VITE_SUPABASE_URL || env.SUPABASE_URL || 'https://dsoucojqjrodxozcbicf.supabase.co'
}

// ── Default categories — tailored for a café/food-service business ────────────
const DEFAULT_CATEGORIES = `- ירקות ופירות
  - ירקות ופירות › ירקות טריים
  - ירקות ופירות › פירות טריים
  - ירקות ופירות › ירקות חתוכים מוכנים
  - ירקות ופירות › ירקות קפואים
- מוצרי מזון ומכולת
  - מוצרי מזון ומכולת › מוצרי חלב (חלב, גבינות, יוגורט)
  - מוצרי מזון ומכולת › לחם ומאפים
  - מוצרי מזון ומכולת › סלטים מוכנים וממרחים (חומוס, טחינה, סלטים)
  - מוצרי מזון ומכולת › דגנים ומוצרים יבשים (גרנולה, דגני בוקר, קמח)
  - מוצרי מזון ומכולת › שמנים ותבלינים
  - מוצרי מזון ומכולת › שימורים ומוצרים ארוזים
- קפה ומשקאות
  - קפה ומשקאות › פולי קפה ואבקת קפה
  - קפה ומשקאות › תה ותחליפי קפה
  - קפה ומשקאות › מיצים ומשקאות קרים
  - קפה ומשקאות › סירופים ותוספות למשקאות
  - קפה ומשקאות › גז לסודה / CO2
- ניקיון וחומרי ניקוי
  - ניקיון וחומרי ניקוי › סבון כלים וניקוי משטחים
  - ניקיון וחומרי ניקוי › סבון ידיים ומוצרי היגיינה
  - ניקיון וחומרי ניקוי › מגבונים ומפיות
  - ניקיון וחומרי ניקוי › שקיות אשפה ומוצרי ניקיון כלליים
- ציוד וכלים
  - ציוד וכלים › מכשירי חשמל גדולים (מדיח, מכונת קפה, טוסטר)
  - ציוד וכלים › כלי מטבח וכלי הגשה
  - ציוד וכלים › ריהוט ואביזרי עסק
- גינון ותחזוקה
  - גינון ותחזוקה › צינורות והשקיה (טפטפות, מתזים)
  - גינון ותחזוקה › דשן וחומרי דישון
  - גינון ותחזוקה › חומרי הדברה
  - גינון ותחזוקה › כלי גינון (אתים, מזמרות, מגרפות)
- חד פעמי ואריזות
  - חד פעמי ואריזות › כוסות וצלחות חד פעמי
  - חד פעמי ואריזות › אריזות לקחת הביתה
  - חד פעמי ואריזות › נייר אפייה ועטיפות
- שונות`

const DEFAULT_L1 = [
  'ירקות ופירות', 'מוצרי מזון ומכולת', 'קפה ומשקאות',
  'ניקיון וחומרי ניקוי', 'ציוד וכלים', 'גינון ותחזוקה',
  'חד פעמי ואריזות', 'שונות',
]

// ── Load the user's category tree (service role) ──────────────────────────────
// Returns { categoriesTree (string), allowedCategories (string[]) }.
async function loadCategories(supabaseUrl, serviceKey, userId) {
  let categoriesTree = DEFAULT_CATEGORIES
  let allowedCategories = DEFAULT_L1
  try {
    if (serviceKey && supabaseUrl && userId) {
      const catRes = await fetch(
        `${supabaseUrl}/rest/v1/categories?user_id=eq.${userId}&select=id,name,parent_id,level&order=level,sort_order`,
        { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
      )
      if (catRes.ok) {
        const cats = await catRes.json()
        if (Array.isArray(cats) && cats.length > 0) {
          const l1 = cats.filter(c => c.level === 1)
          const l2 = cats.filter(c => c.level === 2)
          const l3 = cats.filter(c => c.level === 3)
          const lines = []
          for (const c1 of l1) {
            lines.push(`- ${c1.name}`)
            for (const c2 of l2.filter(c => c.parent_id === c1.id)) {
              lines.push(`  - ${c1.name} › ${c2.name}`)
              for (const c3 of l3.filter(c => c.parent_id === c2.id)) {
                lines.push(`    - ${c1.name} › ${c2.name} › ${c3.name}`)
              }
            }
          }
          if (lines.length > 0) {
            categoriesTree = lines.join('\n')
            allowedCategories = l1.map(c => c.name)
          }
        }
      }
    }
  } catch (e) {
    console.warn('[extractReceipt] Could not fetch categories:', e?.message)
  }
  return { categoriesTree, allowedCategories }
}

/**
 * Main entry point — extract one receipt from 1+ page images (or a PDF).
 * @param {object}   opts
 * @param {string[]} opts.images   base64 strings (1 or more pages of ONE receipt)
 * @param {string}   opts.mimeType e.g. 'image/jpeg', 'application/pdf'
 * @param {object}   opts.env      Cloudflare env (GEMINI_API_KEY, SUPABASE_*)
 * @param {string}   opts.userId   owner — used to load their category tree
 * @param {number}   [opts.vatRate=18]
 * @returns {Promise<object>} the reconciled receipt result
 */
export async function extractReceipt({ images, mimeType, env, userId, vatRate = 18 }) {
  const GEMINI_API_KEY = env?.GEMINI_API_KEY
  if (!GEMINI_API_KEY) { const e = new Error('GEMINI_API_KEY not configured'); e.code = 'NO_KEY'; throw e }

  const imgs = (Array.isArray(images) ? images : [images]).filter(Boolean)
  if (!imgs.length || !mimeType) { const e = new Error('Missing images or mimeType'); e.code = 'BAD_INPUT'; throw e }

  const rate = Number(vatRate) > 0 ? Number(vatRate) : 18
  const supabaseUrl = getSupabaseUrl(env)
  const { categoriesTree, allowedCategories } = await loadCategories(supabaseUrl, env?.SUPABASE_SERVICE_ROLE_KEY, userId)

  const prompt = buildPrompt(allowedCategories, categoriesTree, imgs.length)

  // ── Call Gemini with retry across models ──────────────────────────────────
  let result = null, lastError = null, usedModel = null
  for (const model of [GEMINI_PRIMARY, GEMINI_FALLBACK]) {
    try {
      result = await callGemini(GEMINI_API_KEY, model, imgs, mimeType, prompt)
      if (result && (result.total_amount > 0 || result.vendor_name)) { usedModel = model; break }
    } catch (err) {
      lastError = err
      console.warn(`[extractReceipt] ${model} failed:`, err?.message)
    }
  }

  // ── Retry once with a focused prompt if the amount is still missing ────────
  if (result && (!result.total_amount || result.total_amount === 0)) {
    console.warn('[extractReceipt] Amount missing — retrying with focused prompt')
    try {
      const retryResult = await callGemini(GEMINI_API_KEY, GEMINI_PRIMARY, imgs, mimeType, buildRetryPrompt(result))
      if (retryResult?.total_amount > 0) result = { ...result, ...retryResult }
    } catch (retryErr) {
      console.warn('[extractReceipt] Retry failed:', retryErr?.message)
    }
  }

  if (!result) { const e = new Error('AI processing failed'); e.code = 'AI_FAILED'; e.detail = lastError?.message || 'all models unavailable'; throw e }

  // ── Cross-check the total against the sum of line items ───────────────────
  // On dense delivery notes / invoices the model often misreads the grand total
  // (e.g. grabs one line). If the items clearly sum to more, trust the items.
  result = reconcileTotalFromItems(result, rate)

  // ── Normalize VAT breakdown ───────────────────────────────────────────────
  result = reconcileVat(result, rate)
  result._model = usedModel

  // ── Document classification (unknown → regular receipt) ──────────────────
  result.doc_type = ['delivery_note', 'summary_invoice'].includes(result.doc_type) ? result.doc_type : 'receipt'
  result.doc_number = String(result.doc_number || '').trim() || null
  result.doc_refs = result.doc_type === 'summary_invoice' && Array.isArray(result.doc_refs)
    ? result.doc_refs.filter(x => x && (Number(x.amount) > 0 || x.note_number)) : []

  // ── Deterministic category safety net ─────────────────────────────────────
  // Forces fuel/transport receipts to "תחבורה ודלק" regardless of what the
  // model said, and sets the receipt-level `category` (instead of the UI having
  // to guess from items[0]). No-op when no strong rule matches → AI's choice.
  applyReceiptCategory(result)

  // ── Date sanity check ─────────────────────────────────────────────────────
  // A mis-read year sails straight through and lands a receipt years away from
  // every report it belongs in. The live data holds one dated 2020-08-02 that is
  // really a 2026 delivery note. An implausible date is dropped, not guessed —
  // the review screen then asks the user for it.
  result.receipt_date = sanitizeReceiptDate(result.receipt_date)

  // ── Canonical units + price per base unit (audit R3, client request #12) ──
  // The model reports the unit as printed ("ק\"ג" / "קילו" / "קג"), which makes
  // cross-supplier price comparison meaningless. Fold it here, once, so every
  // downstream consumer reads one consistent ₪/kg · ₪/l · ₪/unit figure.
  result.items = (result.items || []).map(withUnitPricing)

  // ── Foreign currency → official ILS estimate (Bank of Israel rate) ─────────
  const currency = normalizeCurrency(result.currency)
  result.currency = currency
  result.fx = null
  if (currency !== 'ILS') {
    const fx = await getIlsRate(currency)
    if (fx) {
      const r2 = (n) => Math.round((Number(n) || 0) * fx.rate * 100) / 100
      result.fx = { rate: fx.rate, date: fx.date, source: fx.source, currency }
      result.total_ils      = r2(result.total_amount)
      result.before_vat_ils = r2(result.amount_before_vat)
      result.vat_ils        = r2(result.vat_amount)
      result.items = (result.items || []).map(it => ({
        ...it,
        price_ils: r2(it.price),
        unit_price_ils: (it.unit_price != null && it.unit_price !== '') ? r2(it.unit_price) : null,
        // ₪/base-unit must be converted too, or a foreign receipt would compare
        // its original-currency rate against everyone else's shekels.
        price_per_base_unit: it.price_per_base_unit != null ? r2(it.price_per_base_unit) : null,
      }))
    }
  }

  return result
}

// How far back a scanned receipt date may plausibly reach. This is an ongoing
// expense tool, not an archive importer: a date older than this is far more
// likely a mis-read year than a genuinely old invoice, and the review screen
// always shows the date for the user to fill in when we reject it.
export const MAX_RECEIPT_AGE_YEARS = 3

/**
 * Accept a receipt date only when it is a real date in a plausible window:
 * no older than MAX_RECEIPT_AGE_YEARS, no more than 30 days ahead. Anything
 * else returns '' so the user is asked rather than silently mis-filed.
 */
export function sanitizeReceiptDate(raw, now = new Date()) {
  const s = String(raw || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return ''
  const d = new Date(`${s}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return ''
  // Round-trip guard — "2026-02-31" parses but is not a real calendar date.
  if (d.toISOString().slice(0, 10) !== s) return ''
  const maxAhead = new Date(now.getTime() + 30 * 86400000)
  const minBack = new Date(now.getTime()); minBack.setFullYear(minBack.getFullYear() - MAX_RECEIPT_AGE_YEARS)
  if (d > maxAhead || d < minBack) return ''
  return s
}

/**
 * Ensure total_amount, amount_before_vat, and vat_amount are consistent.
 *  1. If the receipt explicitly listed a base + VAT, trust those.
 *  2. Otherwise derive base + VAT from the total using the user's vatRate.
 */
/**
 * Cross-check the stated total against the sum of the line items. On multi-item
 * delivery notes / invoices the model frequently misreads the grand total (often
 * grabbing a single line). When the items clearly sum to MORE than the stated
 * total — or no total was read — trust the items. Line "סה"כ" amounts on Israeli
 * B2B delivery notes are net (pre-VAT), so we treat the sum as the base and add
 * VAT. Only triggers on a clear discrepancy, so correct simple receipts are
 * untouched. Sets _total_from_items for transparency.
 */
export function reconcileTotalFromItems(result, vatRate) {
  const items = Array.isArray(result.items) ? result.items : []
  if (items.length < 2) return result
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
  const itemsSum = r2(items.reduce((s, it) => s + (parseFloat(it.price) || 0), 0))
  const stated = Number(result.total_amount) || 0
  if (itemsSum <= 0) return result
  if (stated <= 0 || itemsSum > stated * 1.1) {
    const factor = 1 + (Number(vatRate) || 0) / 100
    const before = itemsSum
    const total  = r2(before * factor)
    return { ...result, amount_before_vat: before, vat_amount: r2(total - before), total_amount: total, _total_from_items: true }
  }
  return result
}

export function reconcileVat(result, vatRate) {
  const factor = 1 + vatRate / 100
  let total  = Number(result.total_amount) || 0
  let before = Number(result.amount_before_vat) || 0
  let vat    = Number(result.vat_amount) || 0

  if (before > 0 && before < total) {
    vat = Math.round((total - before) * 100) / 100
  } else if (total > 0) {
    before = Math.round((total / factor) * 100) / 100
    vat    = Math.round((total - before) * 100) / 100
  } else if (before > 0) {
    total = Math.round(before * factor * 100) / 100
    vat   = Math.round((total - before) * 100) / 100
  }

  return { ...result, total_amount: total, amount_before_vat: before, vat_amount: vat, vat_rate: vatRate }
}

// ── Main extraction prompt ─────────────────────────────────────────────────────
function buildPrompt(allowedCategories, categoriesTree, pageCount = 1) {
  const multiPageNote = pageCount > 1 ? `
## ⚠️ קבלה מרובת עמודים — ${pageCount} תמונות
התמונות המצורפות הן **${pageCount} עמודים של אותה קבלה אחת** (לפי הסדר).
- אחֵד את **כל** שורות המוצרים מכל העמודים לרשימת items אחת.
- הסכום הסופי (total_amount) ופירוט המע"מ מופיעים בדרך כלל **בעמוד האחרון** — קח אותם משם.
- שם הספק והתאריך מופיעים בדרך כלל בעמוד הראשון.
- החזר תוצאה **אחת מאוחדת** עבור כל הקבלה (לא תוצאה לכל עמוד).
` : ''
  return `אתה מומחה לניתוח קבלות ישראליות עבור בית קפה ומסעדה קטנה.
המטרה: לחלץ נתונים מדויקים מהקבלה כדי לנהל הוצאות עסקיות.
${multiPageNote}
## ⚠️ דיוק לאגורה — חוק עליון (חובה!)
- החזר את כל הסכומים **בדיוק** כפי שמופיעים בקבלה, כולל אגורות (שתי ספרות אחרי הנקודה).
- **אסור לעגל** לשקלים שלמים או למספרים "עגולים". 12.90 יישאר 12.90 (לא 13). 7.99 יישאר 7.99 (לא 8).
- אם מופיע מחיר כמו 295.77 — החזר 295.77 בדיוק, לא 295.76 ולא 296.
- העתק את הספרות בדיוק; אל תבצע "עיגול נוח". כל אגורה חשובה לרישום החשבונאי.

## חוקי חילוץ חובה

### שם הספק (vendor_name):
- שם החברה / הספק כפי שמופיע בראש הקבלה (בדרך כלל שורה 1-3)
- לא כתובת, לא מספר טלפון, לא ח.פ
- אם מופיע שם עסק גדול (כגון "מחסני השוק", "חברת עמינח") — זה הספק
- אם הקבלה היא ממסעדה/קפה — שם המסעדה הוא הספק
- אם אין שם ברור — כתוב "ספק לא ידוע"

### תאריך (receipt_date):
- פורמט פלט: YYYY-MM-DD
- חפש "תאריך:", "date:", DD/MM/YYYY, DD.MM.YYYY
- **⚠️ חובה — פורמט ישראלי "יום קודם" (DD/MM/YYYY), לא אמריקאי!**
  - בקבלות בישראל המספר הראשון הוא **היום** והשני הוא **החודש** (DD/MM), **לא** חודש-יום כמו בארה"ב.
  - דוגמה: 07/06/26 = ה-7 ביוני 2026 → 2026-06-07 (ולא 6 ביולי!).
  - דוגמה: 03/12/2025 = ה-3 בדצמבר 2025 → 2025-12-03.
  - אם המספר הראשון גדול מ-12 (למשל 25/06) — ברור שזה היום: 25 ביוני.
  - שנה דו-ספרתית: 26 → 2026, 25 → 2025 (הוסף 2000).
- אם לא מופיע תאריך ברור — החזר ""

### סוג המסמך (doc_type) — חובה!
זהה את סוג המסמך לפי הכותרת והתוכן והחזר אחד משלושה ערכים:
- **"delivery_note"** — תעודת משלוח: כותרת "תעודת משלוח" / "ת. משלוח" / "תעודה". מפרטת מוצרים וכמויות שסופקו, לרוב **ללא** דרישת תשלום וללא פירוט מע"מ. נפוצה אצל ספקים במהלך החודש.
- **"summary_invoice"** — חשבונית מרכזת: כותרת "חשבונית מרכזת" / "חשבונית ריכוז" / "ריכוז תעודות משלוח" / חשבונית חודשית שמרכזת כמה תעודות משלוח. לרוב מכילה **טבלה של מספרי תעודות משלוח** עם תאריך וסכום לכל תעודה (בלי פירוט מוצרים).
- **"receipt"** — כל השאר: קבלה, חשבונית מס, חשבונית מס/קבלה על עסקה בודדת.
אם אינך בטוח — החזר "receipt".

### מספר מסמך (doc_number):
- מספר תעודת המשלוח / החשבונית כפי שמודפס: "תעודה מס'", "מס' תעודה", "חשבונית מס'", "מס' מסמך", "מספר".
- החזר את המספר בלבד (ספרות). אם אין מספר ברור — החזר "".

### הפניות לתעודות משלוח (doc_refs) — רק בחשבונית מרכזת:
- אם המסמך הוא חשבונית מרכזת שמפרטת את תעודות המשלוח שהיא מרכזת — החזר doc_refs: שורה לכל תעודה עם:
  - **note_number** = מספר תעודת המשלוח כפי שמופיע בחשבונית.
  - **note_date** = תאריך התעודה בפורמט YYYY-MM-DD (אם מופיע, אחרת "").
  - **amount** = סכום התעודה כפי שמופיע בחשבונית (כולל אגורות, ללא עיגול).
- אם אין פירוט תעודות (או שהמסמך אינו חשבונית מרכזת) — החזר doc_refs: [].

### סכום סופי (total_amount):
- זהו הסכום הסופי לתשלום **כולל מע"מ** (בדרך כלל הגדול ביותר).
- חפש: "סה"כ לתשלום", "סה"כ", "total", "לתשלום", "לחיוב", "סכום כולל מע"מ".
- **⚠️ קבלה / תעודת משלוח / חשבונית עם טבלת פריטים (הרבה שורות):** הסכום הכולל = **סכום עמודת ה"סה"כ" של כל השורות יחד**. אל תחזיר סכום של שורה בודדת או של חלק מהשורות — חבר את **כל** השורות. אם יש 18 שורות, הסכום הכולל הוא סכום כל ה-18.
- אם הסכום המודפס נראה **קטן** מסכום השורות — טעית; העדף את **סכום השורות**.
- בתעודות משלוח/חשבוניות B2B סכומי השורות הם בדרך כלל **לפני מע"מ**, והמע"מ מתווסף בתחתית. במקרה כזה: amount_before_vat = סכום השורות, ו-total = סכום השורות + מע"מ.
- אם מופיע "₪" או "ש"ח" ליד מספר — זה כנראה סכום. **לעולם אל תחזיר 0** אם יש מספרים בקבלה.

### פירוט מע"מ (amount_before_vat + vat_amount):
חשוב מאוד — קבלות עסקיות בישראל בדרך כלל מציגות בנפרד:
- **סכום לפני מע"מ** — חפש: "סכום לפני מע"מ", "בסיס חייב", "מחיר ללא מע"מ", "סה"כ לפני מע"מ", "subtotal", "before VAT"
- **סכום המע"מ** — חפש: "מע"מ", "מע״מ 18%", "VAT", "מס ערך מוסף"
- **amount_before_vat** = הסכום לפני המע"מ (אם מופיע במפורש בקבלה)
- **vat_amount** = סכום המע"מ עצמו (אם מופיע במפורש בקבלה)
- אם הקבלה **לא** מציגה פירוט מע"מ — החזר 0 בשני השדות (המערכת תחשב לבד)
- ודא ש: amount_before_vat + vat_amount = total_amount

### מטבע (currency) — חשוב לקבלות מחו"ל:
- זהה את מטבע הקבלה לפי הסמל ($, €, £, ¥) או הקוד (USD, EUR, GBP…) או טקסט (Dollar, Euro).
- אם הקבלה בשקלים (₪ / ש"ח / NIS) — החזר **"ILS"**.
- אחרת החזר את **קוד המטבע הבינלאומי (ISO 4217)**, למשל "USD", "EUR", "GBP", "JPY".
- **כל הסכומים בקבלה (total, items, מע"מ) הם במטבע הזה** — אל תמיר לשקלים, החזר את הערכים המקוריים במטבע המקור. ההמרה לשקלים תתבצע בנפרד.

### פריטים (items) — דיוק מוחלט (חשוב מאוד!):
- **חלץ כל שורה בטבלה, אחת אחר השנייה — אל תדלג על אף שורה ואל תמציא שורות.** בתעודת משלוח/חשבונית עם 10–30 שורות חובה להחזיר את **כולן**, לפי הסדר.
- **דייק בשם כל מוצר** — העתק את הטקסט המדויק של שם הפריט מהשורה. **אל תחליף מוצר אחד באחר** (למשל חלב ≠ גבינה, קוטג' ≠ שמנת, יוגורט ≠ מעדן). אם אינך בטוח — העתק כפי שכתוב בדיוק.
- בטבלה בעברית (RTL) התאם נכון את העמודות לכל שורה: **שם פריט · כמות · מחיר ליחידה · סה"כ לשורה**. אל תבלבל בין "מחיר ליחידה" ל-"סה"כ לשורה".
- רשום כל שורת מוצר בנפרד עם **כל** עמודות השורה כפי שמופיעות בקבלה (כולל אגורות, ללא עיגול):
  - **item_name** = שם המוצר.
  - **quantity** = הכמות שנרכשה (מספר). למשל 3, 4, 2.77, 16. אם אין כמות — החזר 1.
  - **unit** = יחידת המידה בדיוק כפי שכתוב: "יח'", "ק"ג", "ל'", "גרם", "מארז", "קרטון", "מגש" וכו'.
    **חובה למלא** — זהו שדה קריטי להשוואת מחירים. אם היחידה לא מודפסת בשורה, הסק אותה מהקשר:
    מוצר שנמכר במשקל (ירקות, גבינה, בשר) → "ק"ג"; נוזל → "ל'"; פריט בודד → "יח'".
    רק אם באמת אי אפשר להסיק — החזר "".
  - **pack_size** = אם שם המוצר או השורה מציינים גודל אריזה (למשל "1 ליטר", "500 גרם",
    "12 יח' בקרטון", "4 ק"ג") — החזר את הגודל כמחרוזת בדיוק כפי שמופיע, למשל "1 ליטר".
    אם אין — החזר "".
  - **unit_price** = המחיר ליחידה אחת / לק"ג (כולל אגורות). אם אין — 0.
  - **price** = הסכום הכולל של השורה = quantity × unit_price (כולל אגורות). זהו הסכום הקובע.
- אם יש כמות × מחיר ליחידה — ודא ש-price = quantity × unit_price, בדיוק לאגורה.
- שמות מוצרים: **בעברית** גם אם מופיעים באנגלית בקבלה
  - "Humus" → "חומוס"
  - "Cucumber" → "מלפפון"
  - "Milk 3%" → "חלב 3%"
- **סיווג היררכי תלת-שכבתי לכל פריט:**
  - category_l1 = קטגוריה ראשית — מהרשימה הקיימת אם מתאים, אחרת צור קטגוריה חדשה מתאימה (וסמן is_new_category=true)
  - category_l2 = תת-קטגוריה (למשל "ירקות טריים" תחת "ירקות ופירות")
  - category_l3 = שם המוצר הספציפי / תת-תת-קטגוריה (למשל "עגבנייה", "מלפפון", "חלב 3%") — חשוב למעקב לאורך זמן
  - דוגמה: עגבניות שרי → l1="ירקות ופירות", l2="ירקות טריים", l3="עגבנייה"
  - דוגמה: חלב 3% → l1="מוצרי מזון ומכולת", l2="מוצרי חלב", l3="חלב"

### סיווג קטגוריות — דייק ותהיה ספציפי (חשוב מאוד!):
קטגוריות קיימות (העדף אותן רק כשהן באמת מתאימות): ${allowedCategories.join(' | ')}

**חוק-על: לעולם אל תכפה פריט/קבלה לקטגוריה לא-מתאימה רק כי היא קיימת.** עסק קונה הרבה יותר ממזון — דלק, חניה, ציוד, שירותים, תיקונים ועוד. כשאין התאמה ברורה — **צור קטגוריה ראשית חדשה, ספציפית ומדויקת** (category_l1) וסמן is_new_category=true.

זהה קודם את **סוג הקבלה** מהספק וקבע קטגוריה לפיו (גם אם אין פירוט פריטים):
- תחנת דלק / פז / סונול / דור אלון / דלק / ליטרים בנזין-סולר → **"תחבורה ודלק"**
- חניון / חניה / פנגו / סלופארק → **"תחבורה ודלק"**
- מסעדה / בית קפה אחר / משלוח אוכל → **"מסעדות ואירוח"**
- חשמל/מחשבים, תוכנה, אינטרנט, סלולר, טלפון → **"שירותים ותקשורת"**
- כלי כתיבה, נייר, דיו, ציוד משרדי → **"ציוד משרדי"**
- חשמלאי / אינסטלטור / תיקונים → **"אחזקה ותיקונים"**
- עירייה / אגרה / ביטוח / בנק → **"מסים ואגרות"** / **"ביטוח ובנקאות"**

**דוגמה מחייבת:** קבלה מתחנת דלק = "תחבורה ודלק". **אסור** לסווג אותה כ"מוצרי מזון ומכולת".

### שדה category (קטגוריה ראשית של הקבלה כולה) — חובה!
- החזר שדה **category** ברמת הקבלה = הקטגוריה הראשית (L1) שמייצגת את **כל הקבלה**, לפי סוג הקבלה/הספק (הכללים למעלה).
- זו הקטגוריה שתוצג למשתמש — קבע אותה לפי הספק וסוג הקבלה, **לא** לפי פריט מקרי בודד.
- קבלת דלק/חניה/תחבורה → category = "תחבורה ודלק". קבלת מסעדה → "מסעדות ואירוח". וכן הלאה.
- אם אין התאמה לקטגוריה קיימת — צור שם קטגוריה חדש, ספציפי ומדויק (לא "שונות" אלא אם באמת אין סיווג).

### כללי סיווג למוצרי מזון (כשהקבלה באמת מזון — לעסק קפה):
- ירקות, פירות, עלים, עגבניות, מלפפון, פלפל, בצל = "ירקות ופירות"
- חומוס, טחינה, סלטים מוכנים, ממרחים = "מוצרי מזון ומכולת"
- חלב, גבינה, שמנת, יוגורט = "מוצרי מזון ומכולת"
- קפה, פולי קפה, אספרסו, קפוצ'ינו = "קפה ומשקאות"
- תה, חליטות, מיצים = "קפה ומשקאות"
- גז CO2, מכלי גז לסודה = "קפה ומשקאות"
- סבון, חומרי ניקוי, מגבונים, מפיות = "ניקיון וחומרי ניקוי"
- מדיח, מכונת קפה, טוסטר, מכשירי חשמל = "ציוד וכלים"
- כלים, צלחות, כוסות, סכו"ם = "ציוד וכלים"
- השקיה, טפטפות, צינורות, דשן, הדברה, כלי גינון = "גינון ותחזוקה"
- כוסות חד פעמי, צלחות חד פעמי, שקיות = "חד פעמי ואריזות"

## פורמט תשובה — JSON בלבד, ללא הסברים

{
  "vendor_name": "שם הספק",
  "receipt_date": "YYYY-MM-DD או ריק",
  "doc_type": "receipt או delivery_note או summary_invoice",
  "doc_number": "מספר התעודה/החשבונית או ריק",
  "doc_refs": [ { "note_number": "מס' תעודת משלוח", "note_date": "YYYY-MM-DD או ריק", "amount": סכום התעודה } ],
  "total_amount": מספר כולל מע"מ (לא 0 אם יש מספרים בקבלה),
  "amount_before_vat": מספר לפני מע"מ (0 אם לא מופיע בקבלה),
  "vat_amount": סכום המע"מ (0 אם לא מופיע בקבלה),
  "currency": "קוד מטבע — ILS אם שקלים, אחרת USD/EUR/GBP וכו'",
  "original_amount": total_amount,
  "category": "הקטגוריה הראשית של הקבלה כולה לפי סוג הספק (למשל: תחבורה ודלק / מסעדות ואירוח / מוצרי מזון ומכולת)",
  "items": [
    {
      "item_name": "שם הפריט בעברית",
      "quantity": כמות (מספר, ברירת מחדל 1),
      "unit": "יחידת מידה (יח'/ק\\"ג/ל'/גרם/מארז/קרטון — חובה, הסק אם לא מודפס)",
      "pack_size": "גודל אריזה אם צוין, למשל 1 ליטר / 500 גרם / 12 יח' (או ריק)",
      "unit_price": מחיר ליחידה (כולל אגורות, 0 אם אין),
      "price": סכום השורה הכולל (quantity × unit_price),
      "category_l1": "קטגוריה ראשית (קיימת אם מתאים, אחרת חדשה מתאימה)",
      "category_l2": "תת-קטגוריה",
      "category_l3": "שם המוצר הספציפי",
      "is_new_category": false
    }
  ]
}`
}

// ── Retry prompt when amount is missing ───────────────────────────────────────
function buildRetryPrompt(prevResult) {
  return `ניסיון שני: הסריקה הקודמת החזירה סכום 0. בדוק שוב את הקבלה.

**חפש בעדיפות גבוהה:**
1. הסכום הגבוה ביותר בקבלה (זהו הסכום הסופי)
2. מלים: "סה"כ", "לתשלום", "total", "לחיוב", "סכום כולל"
3. כל מספר ליד סמל ₪ או "ש"ח"
4. שורה אחרונה בקבלה (בדרך כלל שם הסכום)

שם הספק שזוהה: "${prevResult.vendor_name || 'לא ידוע'}"

החזר JSON עם אותם שדות, עם הסכום הנכון:`
}

// ── Gemini API call ────────────────────────────────────────────────────────────
// `images` is an array of base64 strings (1 or more pages of the same receipt).
async function callGemini(apiKey, model, images, mimeType, prompt) {
  const imageArr = Array.isArray(images) ? images : [images]
  const payload = {
    contents: [{
      parts: [
        { text: prompt },
        ...imageArr.map(data => ({ inline_data: { mime_type: mimeType, data } })),
      ],
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          vendor_name:       { type: 'STRING' },
          receipt_date:      { type: 'STRING' },
          total_amount:      { type: 'NUMBER' },
          amount_before_vat: { type: 'NUMBER' },
          vat_amount:        { type: 'NUMBER' },
          currency:          { type: 'STRING' },
          original_amount:   { type: 'NUMBER' },
          category:          { type: 'STRING' },
          doc_type:          { type: 'STRING', enum: ['receipt', 'delivery_note', 'summary_invoice'] },
          doc_number:        { type: 'STRING' },
          doc_refs: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                note_number: { type: 'STRING' },
                note_date:   { type: 'STRING' },
                amount:      { type: 'NUMBER' },
              },
              required: ['amount'],
            },
          },
          items: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                item_name:       { type: 'STRING' },
                quantity:        { type: 'NUMBER' },
                unit:            { type: 'STRING' },
                pack_size:       { type: 'STRING' },
                unit_price:      { type: 'NUMBER' },
                price:           { type: 'NUMBER' },
                category_l1:     { type: 'STRING' },
                category_l2:     { type: 'STRING' },
                category_l3:     { type: 'STRING' },
                is_new_category: { type: 'BOOLEAN' },
              },
              required: ['item_name', 'price', 'category_l1', 'is_new_category'],
            },
          },
        },
        required: ['vendor_name', 'total_amount', 'items'],
      },
      temperature: 0.05,   // Very low — deterministic extraction
      maxOutputTokens: 8192,                   // room for many line items (dense delivery notes)
      thinkingConfig: { thinkingBudget: -1 },  // dynamic thinking → accurate on dense tables (cheap on simple receipts)
    },
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

  // Retry up to 3 times on transient errors (503 high-demand, 429 rate, 500).
  const MAX_ATTEMPTS = 3
  let lastErr = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } catch (netErr) {
      lastErr = new Error(`Network error: ${netErr?.message}`)
      if (attempt < MAX_ATTEMPTS) { await sleep(attempt * 1500); continue }
      throw lastErr
    }

    if (res.ok) {
      const data = await res.json()
      const raw  = data?.candidates?.[0]?.content?.parts?.[0]?.text
      if (!raw) {
        lastErr = new Error('Empty response from Gemini')
        if (attempt < MAX_ATTEMPTS) { await sleep(attempt * 1200); continue }
        throw lastErr
      }
      try {
        return JSON.parse(raw)
      } catch {
        const match = raw.match(/```(?:json)?\s*([\s\S]+?)```/)
        if (match) return JSON.parse(match[1])
        throw new Error('Cannot parse JSON from Gemini response')
      }
    }

    // Non-OK response
    const errText = await res.text()
    lastErr = new Error(`Gemini ${model} ${res.status}: ${errText.slice(0, 160)}`)
    if ([429, 500, 502, 503, 504].includes(res.status) && attempt < MAX_ATTEMPTS) {
      await sleep(attempt * 1500)   // 1.5s, 3s backoff
      continue
    }
    throw lastErr
  }
  throw lastErr
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
