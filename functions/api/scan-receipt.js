/**
 * Cloudflare Pages Function — /api/scan-receipt
 *
 * POST body:  { imageBase64?: string, imagesBase64?: string[], mimeType: string }
 *             (imagesBase64 = several pages of one receipt → combined result)
 * Response:   { vendor_name, receipt_date, total_amount, currency, original_amount, items[] }
 *
 * Uses gemini-2.5-pro for maximum accuracy on Hebrew receipts.
 * Falls back to gemini-2.5-flash if pro is unavailable.
 */

import { requireUser, wrapAuthErrors } from './_lib/auth.js'
import { getIlsRate, normalizeCurrency } from './_lib/fxRate.js'

// Model chain — flash models work on the free tier and are fast + accurate.
// gemini-2.5-pro is intentionally NOT used: it returns 429 (quota) on the free tier.
const GEMINI_PRIMARY  = 'gemini-2.5-flash'
const GEMINI_FALLBACK = 'gemini-flash-latest'

function getSupabaseUrl(env) {
  return env.VITE_SUPABASE_URL || env.SUPABASE_URL || 'https://dsoucojqjrodxozcbicf.supabase.co'
}

function corsHeaders(request, env) {
  const origin  = (request.headers.get('origin') || '').trim()
  const allowed = env.ALLOWED_ORIGIN || origin || '*'
  return { 'Access-Control-Allow-Origin': allowed, 'Content-Type': 'application/json' }
}

export async function onRequestOptions(context) {
  const origin  = (context.request.headers.get('origin') || '').trim()
  const allowed = context.env.ALLOWED_ORIGIN || origin || '*'
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': allowed,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
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

export const onRequestPost = wrapAuthErrors(async (context) => {
  const user = await requireUser(context.request, context.env)
  const CORS = corsHeaders(context.request, context.env)
  const { GEMINI_API_KEY, SUPABASE_SERVICE_ROLE_KEY } = context.env
  const SUPABASE_URL = getSupabaseUrl(context.env)

  if (!GEMINI_API_KEY) {
    return Response.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500, headers: CORS })
  }

  let body
  try { body = await context.request.json() } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400, headers: CORS })
  }

  const { imageBase64, imagesBase64, mimeType } = body ?? {}
  // Accept either a single image (imageBase64) or several pages (imagesBase64[]).
  const images = (Array.isArray(imagesBase64) && imagesBase64.length)
    ? imagesBase64.filter(Boolean)
    : (imageBase64 ? [imageBase64] : [])
  if (!images.length || !mimeType) {
    return Response.json({ error: 'Missing required fields: imageBase64/imagesBase64, mimeType' }, { status: 400, headers: CORS })
  }

  // VAT rate from client (defaults to current Israeli rate 18%)
  const vatRate = Number(body?.vatRate) > 0 ? Number(body.vatRate) : 18

  // ── Load user categories from DB ───────────────────────────────────────────
  let categoriesTree = DEFAULT_CATEGORIES
  let dbL1Names = null
  try {
    if (SUPABASE_SERVICE_ROLE_KEY && SUPABASE_URL) {
      const sk = SUPABASE_SERVICE_ROLE_KEY
      const catRes = await fetch(
        `${SUPABASE_URL}/rest/v1/categories?user_id=eq.${user.user_id}&select=id,name,parent_id,level&order=level,sort_order`,
        { headers: { apikey: sk, Authorization: `Bearer ${sk}` } }
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
            dbL1Names = l1.map(c => c.name)
          }
        }
      }
    }
  } catch (e) {
    console.warn('[scan-receipt] Could not fetch categories:', e?.message)
  }

  const ALLOWED_CATEGORIES = dbL1Names ?? [
    'ירקות ופירות', 'מוצרי מזון ומכולת', 'קפה ומשקאות',
    'ניקיון וחומרי ניקוי', 'ציוד וכלים', 'גינון ותחזוקה',
    'חד פעמי ואריזות', 'שונות',
  ]

  // ── Build prompt ───────────────────────────────────────────────────────────
  const prompt = buildPrompt(ALLOWED_CATEGORIES, categoriesTree, images.length)

  // ── Build prompt + call Gemini with retry across models ────────────────────
  let result = null
  let lastError = null

  // Each model is tried with internal retry (handles transient 503/429/500).
  let usedModel = null
  for (const model of [GEMINI_PRIMARY, GEMINI_FALLBACK]) {
    try {
      result = await callGemini(GEMINI_API_KEY, model, images, mimeType, prompt)
      if (result && (result.total_amount > 0 || result.vendor_name)) { usedModel = model; break }
    } catch (err) {
      lastError = err
      console.warn(`[scan-receipt] ${model} failed:`, err?.message)
    }
  }

  // ── Retry once with focused prompt if the amount is still missing ──────────
  if (result && (!result.total_amount || result.total_amount === 0)) {
    console.warn('[scan-receipt] Amount missing — retrying with focused prompt')
    try {
      const retryResult = await callGemini(
        GEMINI_API_KEY, GEMINI_PRIMARY, images, mimeType,
        buildRetryPrompt(result)
      )
      if (retryResult?.total_amount > 0) {
        result = { ...result, ...retryResult }
      }
    } catch (retryErr) {
      console.warn('[scan-receipt] Retry failed:', retryErr?.message)
    }
  }

  if (!result) {
    return Response.json(
      { error: 'AI processing failed', detail: lastError?.message || 'all models unavailable' },
      { status: 502, headers: CORS }
    )
  }

  // ── Normalize VAT breakdown ────────────────────────────────────────────────
  // The model returns total_amount (with VAT). It MAY also return
  // amount_before_vat and vat_amount if the receipt showed them explicitly.
  // We reconcile all three so they are always consistent.
  result = reconcileVat(result, vatRate)
  result._model = usedModel   // diagnostic: which model produced this

  // ── Foreign currency → official ILS estimate (Bank of Israel rate) ──────────
  const currency = normalizeCurrency(result.currency)
  result.currency = currency
  result.fx = null
  if (currency !== 'ILS') {
    const fx = await getIlsRate(currency)       // ILS per 1 foreign unit (official שער יציג)
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
      }))
    }
  }

  return Response.json(result, { headers: CORS })
})

/**
 * Ensure total_amount, amount_before_vat, and vat_amount are consistent.
 * Priority:
 *  1. If the receipt explicitly listed a base ("בסיס חייב") and VAT, trust those.
 *  2. Otherwise derive base + VAT from the total using the user's vatRate.
 */
function reconcileVat(result, vatRate) {
  const factor = 1 + vatRate / 100
  let total  = Number(result.total_amount) || 0
  let before = Number(result.amount_before_vat) || 0
  let vat    = Number(result.vat_amount) || 0

  // Case A: model gave us an explicit base that's smaller than total → trust it
  if (before > 0 && before < total) {
    vat = Math.round((total - before) * 100) / 100
  }
  // Case B: only total known → derive base + vat from rate
  else if (total > 0) {
    before = Math.round((total / factor) * 100) / 100
    vat    = Math.round((total - before) * 100) / 100
  }
  // Case C: only base known (rare) → derive total
  else if (before > 0) {
    total = Math.round(before * factor * 100) / 100
    vat   = Math.round((total - before) * 100) / 100
  }

  return {
    ...result,
    total_amount:      total,
    amount_before_vat: before,
    vat_amount:        vat,
    vat_rate:          vatRate,
  }
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
  - דוגמה: **07/06/26** = ה-7 ביוני 2026 → 2026-06-07 (ולא 6 ביולי!).
  - דוגמה: **03/12/2025** = ה-3 בדצמבר 2025 → 2025-12-03.
  - אם המספר הראשון גדול מ-12 (למשל 25/06) — ברור שזה היום: 25 ביוני.
  - שנה דו-ספרתית: 26 → 2026, 25 → 2025 (הוסף 2000).
- אם לא מופיע תאריך ברור — החזר ""

### סכום סופי (total_amount):
- זהו **הסכום הגבוה ביותר** בקבלה — הסכום לתשלום **כולל מע"מ**
- חפש: "סה"כ לתשלום", "סה"כ", "total", "לתשלום", "לחיוב", "סכום כולל מע"מ"
- **אם יש כמה סכומים** — קח תמיד את **הגדול ביותר** (זה הסופי עם מע"מ)
- אם מופיע "₪" או "ש"ח" ליד מספר — זה כנראה הסכום
- **לעולם אל תחזיר 0** אם יש מספר כלשהו בקבלה

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

### פריטים (items):
- רשום כל שורת מוצר בנפרד עם **כל** עמודות השורה כפי שמופיעות בקבלה (כולל אגורות, ללא עיגול):
  - **item_name** = שם המוצר.
  - **quantity** = הכמות שנרכשה (מספר). למשל 3, 4, 2.77, 16. אם אין כמות — החזר 1.
  - **unit** = יחידת המידה בדיוק כפי שכתוב: "יח'", "ק"ג", "ל'", "גרם", "מארז" וכו'. אם אין — "".
  - **unit_price** = המחיר ליחידה אחת / לק"ג (כולל אגורות). אם אין — 0.
  - **price** = הסכום הכולל של השורה = quantity × unit_price (כולל אגורות). זהו הסכום הקובע.
- אם יש כמות × מחיר ליחידה — ודא ש-price = quantity × unit_price, בדיוק לאגורה.
- שמות מוצרים: **בעברית** גם אם מופיעים באנגלית בקבלה
  - "Humus" → "חומוס"
  - "Cucumber" → "מלפפון"
  - "Milk 3%" → "חלב 3%"
- **סיווג היררכי תלת-שכבתי לכל פריט:**
  - category_l1 = קטגוריה ראשית (מהרשימה)
  - category_l2 = תת-קטגוריה (למשל "ירקות טריים" תחת "ירקות ופירות")
  - category_l3 = שם המוצר הספציפי / תת-תת-קטגוריה (למשל "עגבנייה", "מלפפון", "חלב 3%") — חשוב למעקב לאורך זמן
  - דוגמה: עגבניות שרי → l1="ירקות ופירות", l2="ירקות טריים", l3="עגבנייה"
  - דוגמה: חלב 3% → l1="מוצרי מזון ומכולת", l2="מוצרי חלב", l3="חלב"

### קטגוריות זמינות:
${allowedCategories.join(' | ')}

### כללי סיווג לעסק זה:
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
  "total_amount": מספר כולל מע"מ (לא 0 אם יש מספרים בקבלה),
  "amount_before_vat": מספר לפני מע"מ (0 אם לא מופיע בקבלה),
  "vat_amount": סכום המע"מ (0 אם לא מופיע בקבלה),
  "currency": "קוד מטבע — ILS אם שקלים, אחרת USD/EUR/GBP וכו'",
  "original_amount": total_amount,
  "items": [
    {
      "item_name": "שם הפריט בעברית",
      "quantity": כמות (מספר, ברירת מחדל 1),
      "unit": "יחידת מידה (יח'/ק\\"ג/ל' וכו', או ריק)",
      "unit_price": מחיר ליחידה (כולל אגורות, 0 אם אין),
      "price": סכום השורה הכולל (quantity × unit_price),
      "category_l1": "קטגוריה ראשית מהרשימה",
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
          items: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                item_name:       { type: 'STRING' },
                quantity:        { type: 'NUMBER' },
                unit:            { type: 'STRING' },
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
      thinkingConfig: {    // Disable thinking → fast (~2s) + reliable, leaves room for retries
        thinkingBudget: 0,
      },
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
    // Retry only on transient codes
    if ([429, 500, 502, 503, 504].includes(res.status) && attempt < MAX_ATTEMPTS) {
      await sleep(attempt * 1500)   // 1.5s, 3s backoff
      continue
    }
    throw lastErr
  }
  throw lastErr
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
