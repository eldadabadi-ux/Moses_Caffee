/**
 * Cloudflare Pages Function — /api/scan-receipt
 *
 * POST body:  { imageBase64: string, mimeType: string }
 * Response:   { vendor_name, receipt_date, total_amount, currency, original_amount, items[] }
 *
 * Uses gemini-2.5-pro for maximum accuracy on Hebrew receipts.
 * Falls back to gemini-2.5-flash if pro is unavailable.
 */

import { requireUser, wrapAuthErrors } from './_lib/auth.js'

const GEMINI_PRO   = 'gemini-2.5-pro'
const GEMINI_FLASH = 'gemini-2.5-flash'

function getSupabaseUrl(env) {
  return env.VITE_SUPABASE_URL || env.SUPABASE_URL || ''
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

  const { imageBase64, mimeType } = body ?? {}
  if (!imageBase64 || !mimeType) {
    return Response.json({ error: 'Missing required fields: imageBase64, mimeType' }, { status: 400, headers: CORS })
  }

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
  const prompt = buildPrompt(ALLOWED_CATEGORIES, categoriesTree)

  // ── Call Gemini (Pro first, Flash fallback) ────────────────────────────────
  let result = null
  let lastError = null

  for (const model of [GEMINI_PRO, GEMINI_FLASH]) {
    try {
      result = await callGemini(GEMINI_API_KEY, model, imageBase64, mimeType, prompt)
      if (result && (result.total_amount > 0 || result.vendor_name)) break
    } catch (err) {
      lastError = err
      console.warn(`[scan-receipt] ${model} failed:`, err?.message)
    }
  }

  // ── Retry if critical fields missing ──────────────────────────────────────
  if (result && (!result.total_amount || result.total_amount === 0)) {
    console.warn('[scan-receipt] Amount missing — retrying with focused prompt')
    try {
      const retryResult = await callGemini(
        GEMINI_API_KEY, GEMINI_PRO, imageBase64, mimeType,
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
      { error: 'Processing failed', detail: lastError?.message },
      { status: 502, headers: CORS }
    )
  }

  return Response.json(result, { headers: CORS })
})

// ── Main extraction prompt ─────────────────────────────────────────────────────
function buildPrompt(allowedCategories, categoriesTree) {
  return `אתה מומחה לניתוח קבלות ישראליות עבור בית קפה ומסעדה קטנה.
המטרה: לחלץ נתונים מדויקים מהקבלה כדי לנהל הוצאות עסקיות.

## חוקי חילוץ חובה

### שם הספק (vendor_name):
- שם החברה / הספק כפי שמופיע בראש הקבלה (בדרך כלל שורה 1-3)
- לא כתובת, לא מספר טלפון, לא ח.פ
- אם מופיע שם עסק גדול (כגון "מחסני השוק", "חברת עמינח") — זה הספק
- אם הקבלה היא ממסעדה/קפה — שם המסעדה הוא הספק
- אם אין שם ברור — כתוב "ספק לא ידוע"

### תאריך (receipt_date):
- פורמט: YYYY-MM-DD
- חפש "תאריך:", "date:", DD/MM/YYYY, DD.MM.YYYY
- אם לא מופיע תאריך ברור — החזר ""

### סכום סופי (total_amount):
- זהו **הסכום הגבוה ביותר** בקבלה — הסכום לתשלום לאחר מע"מ
- חפש: "סה"כ לתשלום", "סה"כ", "total", "לתשלום", "לחיוב", "סכום כולל מע"מ"
- **אם יש כמה סכומים** — קח תמיד את **הגדול ביותר** (זה הסופי עם מע"מ)
- אם מופיע "₪" או "ש"ח" ליד מספר — זה כנראה הסכום
- **לעולם אל תחזיר 0** אם יש מספר כלשהו בקבלה
- אם יש מע"מ (17%) — הסכום הסופי כולל אותו

### פריטים (items):
- רשום כל שורת מוצר בנפרד
- אם יש כמות × מחיר ליחידה — חשב את הסכום (כמות × מחיר)
- שמות מוצרים: **בעברית** גם אם מופיעים באנגלית בקבלה
  - "Humus" → "חומוס"
  - "Cucumber" → "מלפפון"
  - "Milk 3%" → "חלב 3%"

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
  "total_amount": מספר (לא 0 אם יש מספרים בקבלה),
  "currency": "ILS",
  "original_amount": אותו מספר,
  "items": [
    {
      "item_name": "שם הפריט בעברית",
      "price": מחיר הפריט,
      "category_l1": "קטגוריה מהרשימה",
      "category_l2": "תת-קטגוריה אם ידוע",
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
async function callGemini(apiKey, model, imageBase64, mimeType, prompt) {
  const payload = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data: imageBase64 } },
      ],
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          vendor_name:     { type: 'STRING' },
          receipt_date:    { type: 'STRING' },
          total_amount:    { type: 'NUMBER' },
          currency:        { type: 'STRING' },
          original_amount: { type: 'NUMBER' },
          items: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                item_name:       { type: 'STRING' },
                price:           { type: 'NUMBER' },
                category_l1:     { type: 'STRING' },
                category_l2:     { type: 'STRING' },
                is_new_category: { type: 'BOOLEAN' },
              },
              required: ['item_name', 'price', 'category_l1', 'is_new_category'],
            },
          },
        },
        required: ['vendor_name', 'total_amount', 'items'],
      },
      temperature: 0.05,   // Very low — we want deterministic extraction
      thinkingConfig: {    // Enable thinking for Pro model (improves accuracy)
        thinkingBudget: 1024,
      },
    },
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gemini ${model} ${res.status}: ${err.slice(0, 200)}`)
  }

  const data = await res.json()
  const raw  = data?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!raw) throw new Error('Empty response from Gemini')

  let result
  try {
    result = JSON.parse(raw)
  } catch {
    const match = raw.match(/```(?:json)?\s*([\s\S]+?)```/)
    if (match) result = JSON.parse(match[1])
    else throw new Error('Cannot parse JSON from Gemini response')
  }

  return result
}
