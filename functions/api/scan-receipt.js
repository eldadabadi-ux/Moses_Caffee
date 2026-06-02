/**
 * Cloudflare Pages Function — /api/scan-receipt
 *
 * POST body:  { imageBase64: string, mimeType: string }
 * Response:   { vendor_name, receipt_date, total_amount, currency, original_amount, items[] }
 *
 * AUTH: Requires Supabase JWT (Authorization: Bearer <token>).
 * Categories are loaded from the `categories` table for the authenticated user.
 *
 * ENV VARS:
 *   GEMINI_API_KEY             — Google AI Studio key
 *   SUPABASE_SERVICE_ROLE_KEY  — reads categories server-side
 *   VITE_SUPABASE_URL          — or SUPABASE_URL
 */

import { requireUser, wrapAuthErrors } from './_lib/auth.js'

const GEMINI_MODEL = 'gemini-2.5-flash'

function getSupabaseUrl(env) {
  return env.VITE_SUPABASE_URL || env.SUPABASE_URL || ''
}

const ALLOWED_ORIGINS_ENV = ['receipts-app.pages.dev']

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

// ── Default Israeli expense categories ────────────────────────────────────────
const DEFAULT_CATEGORIES = `- דלק
  - דלק › תדלוק רכב
- חניה
  - חניה › חניון פרטי
  - חניה › פארקומט
- רכב ותחבורה
  - רכב ותחבורה › אחזקת רכב
  - רכב ותחבורה › נסיעה במונית / אובר
  - רכב ותחבורה › תחבורה ציבורית
  - רכב ותחבורה › השכרת רכב
- אוכל ושתייה
  - אוכל ושתייה › ארוחות עסקיות
  - אוכל ושתייה › קפה ומשקאות
  - אוכל ושתייה › סופרמרקט / מכולת
- ציוד משרדי
  - ציוד משרדי › נייר וכלי כתיבה
  - ציוד משרדי › מדפסות וצריכה מתכלה
  - ציוד משרדי › ריהוט ואביזרי משרד
- תקשורת וטכנולוגיה
  - תקשורת וטכנולוגיה › טלפון נייד
  - תקשורת וטכנולוגיה › אינטרנט וקווי תקשורת
  - תקשורת וטכנולוגיה › תוכנות ומנויים דיגיטליים
  - תקשורת וטכנולוגיה › ציוד מחשוב
- שכירות ומשכנתא
  - שכירות ומשכנתא › שכירות משרד
  - שכירות ומשכנתא › ארנונה וועד בית
- חשמל מים וגז
- ביטוח
  - ביטוח › ביטוח רכב
  - ביטוח › ביטוח עסק
  - ביטוח › ביטוח בריאות
- שכר טרחה מקצועי
  - שכר טרחה מקצועי › רואה חשבון
  - שכר טרחה מקצועי › יעוץ משפטי
- פרסום ושיווק
  - פרסום ושיווק › פרסום מקוון
  - פרסום ושיווק › הדפסה וחומרי שיווק
- הכשרה והשתלמות
  - הכשרה והשתלמות › כנסים וסמינרים
  - הכשרה והשתלמות › קורסים וספרות מקצועית
- נסיעות לחו"ל
  - נסיעות לחו"ל › כרטיסי טיסה
  - נסיעות לחו"ל › מלונות
  - נסיעות לחו"ל › הוצאות שהייה
- מתנות ואירוח עסקי
- בריאות ורפואה
  - בריאות ורפואה › בית מרקחת
  - בריאות ורפואה › רופא ובדיקות
- שיפוצים ואחזקה
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

  // ── Load user's categories from DB ────────────────────────────────────────
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
          if (lines.length > 0) { categoriesTree = lines.join('\n'); dbL1Names = l1.map(c => c.name) }
        }
      }
    }
  } catch (e) { console.warn('[scan-receipt] Could not fetch categories:', e?.message) }

  const ALLOWED_CATEGORIES = dbL1Names ?? [
    'דלק','חניה','אוכל ושתייה','ציוד משרדי','תקשורת וטכנולוגיה',
    'רכב ותחבורה','שכירות ומשכנתא','חשמל מים וגז','ביטוח',
    'שכר טרחה מקצועי','פרסום ושיווק','הכשרה והשתלמות',
    'נסיעות לחו"ל','מתנות ואירוח עסקי','בריאות ורפואה',
    'שיפוצים ואחזקה','שונות',
  ]

  const prompt = `אתה סוכן AI המנתח קבלות עסקיות ישראליות.

נתח את הקבלה המצורפת והחזר JSON בלבד עם השדות:

vendor_name (string) — שם העסק/הספק כפי שמופיע בקבלה.
receipt_date (string) — תאריך בפורמט YYYY-MM-DD. אם לא ניתן לקרוא: "".
total_amount (number) — הסכום הסופי לתשלום בשקלים.
currency (string) — קוד מטבע: "ILS", "USD", "EUR" וכו'. ברירת מחדל "ILS".
original_amount (number) — הסכום במטבע המקורי (=total_amount אם ILS).
items (array) — כל פריט בקבלה.

לכל פריט:
  item_name (string) — שם הפריט.
  price (number) — מחיר הפריט בשקלים.
  category_l1 (string) — חובה. בחר אחד מ: ${ALLOWED_CATEGORIES.join(' | ')}
  category_l2 (string) — תת-קטגוריה אופציונלית.
  is_new_category (boolean) — תמיד false.

חוקי סיווג:
• תחנת דלק / פז / סונול / yellow → "דלק"
• חניון / פארקינג / פארקומט → "חניה" (תמיד! לא "רכב ותחבורה")
• מסעדה / קפה / סופרמרקט / שופרסל / רמי לוי → "אוכל ושתייה"
• אובר / גט / מונית / רכבת / אגד → "רכב ותחבורה"
• KSP / Office Depot / ציוד / מדפסת → "ציוד משרדי"
• סלקום / פרטנר / HOT / בזק / אינטרנט → "תקשורת וטכנולוגיה"
• כרטיסי טיסה / מלון בחו"ל / El Al / Booking → "נסיעות לחו\\"ל"
• ביטוח ישיר / מנורה / הפניקס → "ביטוח"
• סופר-פארם / בית מרקחת / מכבי → "בריאות ורפואה"
• שאר המקרים → "שונות"

החזר JSON תקני בלבד — ללא הסברים, ללא markdown.`

  const geminiPayload = {
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: imageBase64 } }] }],
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
      temperature: 0.1,
    },
  }

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`

  try {
    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiPayload),
    })

    if (!geminiRes.ok) {
      const errText = await geminiRes.text()
      console.error('[scan-receipt] Gemini error:', geminiRes.status, errText)
      return Response.json({ error: 'AI processing failed', detail: errText.slice(0, 300) }, { status: 502, headers: CORS })
    }

    const geminiData = await geminiRes.json()
    const rawContent = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!rawContent) {
      return Response.json({ error: 'Empty AI response' }, { status: 502, headers: CORS })
    }

    let result
    try {
      result = JSON.parse(rawContent)
    } catch {
      const match = rawContent.match(/```(?:json)?\s*([\s\S]+?)```/)
      if (match) { result = JSON.parse(match[1]) }
      else { throw new Error('Could not parse AI JSON response') }
    }

    return Response.json(result, { headers: CORS })

  } catch (err) {
    console.error('[scan-receipt] Fatal error:', err?.message)
    return Response.json({ error: 'Processing failed', detail: err?.message }, { status: 500, headers: CORS })
  }
})
