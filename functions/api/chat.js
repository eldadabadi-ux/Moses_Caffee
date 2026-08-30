/**
 * Cloudflare Pages Function — /api/chat
 *
 * POST { messages, context: { screen, path } }  (auth: Bearer JWT)
 * → { reply }
 *
 * The assistant reaches the business's data through TOOLS (see _lib/botTools.js),
 * not through a pre-digested text dump.
 *
 * WHY (audit R2, client request #1): this endpoint used to flatten everything
 * into one Hebrew string — the last 30 receipts as one line each, the top 25
 * comparable products, 5 products per supplier — and paste it into the prompt.
 * The bot could not see line items, or any document outside that window. Moses
 * reported exactly that: "אין לבוט גישה לכל הקבלות… לא יודע לבצע חשיבה". It also
 * silently truncated as the data grew, so the answers would have quietly become
 * wrong rather than visibly incomplete.
 *
 * Now the prompt carries only an ORIENTATION block — what data exists — and the
 * model pulls what a question actually needs, at any depth, at any scale.
 */

import { requireMember, wrapAuthErrors } from './_lib/auth.js'
import { checkRateLimit, rateLimitedResponse } from './_lib/rateLimit.js'
import { errorResponse } from './_lib/response.js'
import { getSupabaseUrl } from './_lib/extractReceipt.js'
import { TOOL_DEFS, runTool, buildOrientation } from './_lib/botTools.js'

const CLAUDE_MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS   = 2048
const MAX_ROUNDS   = 6     // tool-use turns before we stop and answer with what we have

function corsHeaders(request, env) {
  const origin  = (request.headers.get('origin') || '').trim()
  const allowed = env.ALLOWED_ORIGIN || origin || '*'
  return { 'Access-Control-Allow-Origin': allowed, 'Content-Type': 'application/json' }
}
export async function onRequestOptions(context) {
  const origin  = (context.request.headers.get('origin') || '').trim()
  const allowed = context.env.ALLOWED_ORIGIN || origin || '*'
  return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  } })
}

function buildSystemPrompt({ orientation, vatRate, showWithVat, bizName }) {
  return `אתה "העוזר החכם" של ${bizName} — מערכת לניהול קבלות והוצאות.
הטון שלך: חברי, ענייני ומקצועי. השב תמיד בעברית, בניסוח קצר וברור.

יש לך גישה מלאה לכל נתוני העסק דרך כלים. אל תנחש ואל תסתמך על הסיכום שלמטה למספרים —
**הפעל כלי** בכל פעם שנדרש נתון, סכום, השוואה או דו"ח:
- query_receipts — מסמכים ספציפיים ושורות המוצרים שלהם
- compare_product_prices — מי זול יותר, לפי מחיר ליחידת בסיס
- supplier_report — סיכום ספק לפי חודש / רבעון / שנה
- price_changes — מוצרים שהמחיר שלהם עלה או ירד

חוקים:
- כל מספר בתשובה חייב להגיע מכלי שהרצת בשיחה הזו. אם כלי החזיר note או error —
  אמור זאת בכנות במקום להשלים מהראש.
- בהשוואת ספקים השווה **מחיר ליחידת בסיס** (₪ לק"ג / לליטר / ליחידה), לא סה"כ, וציין את ההפרש.
- אל תמציא ממוצעים תקופתיים מתוך מעט קבלות. דווח רק סכומים אמיתיים שנצברו.
  כשאין מספיק היסטוריה לחיזוי — אמור זאת במפורש.
- קבלות בארכיון נכללות בכלים. ארכיון = "נשלח לרו"ח", לא "נמחק".
- כתוב נקי: בלי אימוג'ים, בלי סולמיות (#) או קווים (---). הפרד נושאים בשורה ריקה.
  השתמש ברשימות רק כשמבקשים.
- כשמבקשים — בצע מיד (אל תפתח ב"שלום, במה אפשר לעזור").
- שיעור המע"מ המוגדר במערכת הוא ${vatRate}% — התייחס אליו כעובדה הקובעת. אם המשתמש
  טוען לערך אחר, שאל אותו והנחה לעדכן ב"הגדרות → שיעור מע"מ".

[הגדרות מוגדרות במערכת]
שם העסק: ${bizName} · שיעור מע"מ: ${vatRate}% · תצוגת מחירים: ${showWithVat ? 'כולל מע"מ' : 'ללא מע"מ'}

[מה קיים במערכת — למען התמצאות בלבד, לא מקור למספרים]
מסמכים: ${orientation.documents} (מתוכם ${orientation.archived} בארכיון · ${orientation.delivery_notes} תעודות משלוח · ${orientation.summary_invoices} חשבוניות מרכזות)
טווח תאריכים: ${orientation.date_range}
ספקים (${orientation.suppliers.length}): ${orientation.suppliers.join(' · ') || 'אין'}
קטגוריות: ${orientation.categories.join(' · ') || 'אין'}`
}

async function callAnthropic(env, body) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    const err = new Error(`Anthropic ${res.status}: ${text.slice(0, 300)}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

export const onRequestPost = wrapAuthErrors(async (context) => {
  const user = await requireMember(context.request, context.env)
  const CORS = corsHeaders(context.request, context.env)
  const { ANTHROPIC_API_KEY, SUPABASE_SERVICE_ROLE_KEY: sk } = context.env
  const SUPABASE_URL = getSupabaseUrl(context.env)

  // Throttle the (paid) chat per user (A.8.12) — fail-open if KV unbound.
  const rl = await checkRateLimit(context.env, `${user.user_id}:chat`, { limit: 20, windowSec: 60 })
  if (!rl.allowed) return rateLimitedResponse(rl.retryAfter, CORS)

  if (!ANTHROPIC_API_KEY) {
    return errorResponse('העוזר החכם אינו מוגדר בשרת', 500, { code: 'server_config', headers: CORS })
  }
  if (!sk) {
    return errorResponse('העוזר החכם אינו מוגדר בשרת', 500, { code: 'server_config', headers: CORS })
  }

  let body
  try { body = await context.request.json() }
  catch { return errorResponse('גוף הבקשה אינו תקין', 400, { code: 'bad_json', headers: CORS }) }
  const { messages = [], context: ctx = {} } = body ?? {}

  // Tenant context handed to every tool — org when the user has one, else their
  // own user_id. Tools never trust a client-supplied scope (guardrail 3).
  const toolCtx = { url: SUPABASE_URL, key: sk, orgId: user.org_id || null, userId: user.user_id }

  let orientation, userSettings = null
  try {
    const [o, st] = await Promise.allSettled([
      buildOrientation(toolCtx),
      fetch(`${SUPABASE_URL}/rest/v1/user_settings?user_id=eq.${user.user_id}&select=vat_rate,show_with_vat,business_name`,
        { headers: { apikey: sk, Authorization: `Bearer ${sk}` } }).then(r => r.ok ? r.json() : []),
    ])
    orientation = o.status === 'fulfilled' ? o.value : null
    userSettings = (st.status === 'fulfilled' && Array.isArray(st.value)) ? (st.value[0] || null) : null
  } catch { orientation = null }

  if (!orientation) {
    return errorResponse('טעינת הנתונים נכשלה — נסה שוב', 502, { code: 'data_failed', headers: CORS })
  }

  const system = buildSystemPrompt({
    orientation,
    vatRate: userSettings?.vat_rate ?? 18,
    showWithVat: userSettings?.show_with_vat !== false,
    bizName: userSettings?.business_name || 'בית הקפה',
  })

  // The conversation the model works on. Tool results are appended as it goes.
  const convo = messages.map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || ''),
  }))

  try {
    let rounds = 0
    for (;;) {
      const data = await callAnthropic(context.env, {
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        tools: TOOL_DEFS,
        // The system block is identical request-to-request within a conversation,
        // so it is prompt-cached; the volatile screen note rides outside it.
        system: [
          { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: `מסך נוכחי: ${ctx.screen || 'לא ידוע'}${ctx.path ? ` (${ctx.path})` : ''}` },
        ],
        messages: convo,
      })

      if (data?.usage) console.log('[chat] usage:', JSON.stringify(data.usage))

      const blocks = Array.isArray(data?.content) ? data.content : []
      const toolUses = blocks.filter(b => b.type === 'tool_use')

      if (data?.stop_reason !== 'tool_use' || !toolUses.length) {
        const reply = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n').trim()
        return Response.json({ reply }, { headers: CORS })
      }

      if (++rounds > MAX_ROUNDS) {
        // Out of tool budget — ask for an answer from what has been gathered
        // rather than looping, and never pretend the data is complete.
        convo.push({ role: 'assistant', content: blocks })
        convo.push({
          role: 'user',
          content: toolUses.map(t => ({
            type: 'tool_result', tool_use_id: t.id,
            content: JSON.stringify({ error: 'הגעת למכסת שליפות הנתונים לשאלה הזו' }),
          })),
        })
        continue
      }

      convo.push({ role: 'assistant', content: blocks })
      const results = await Promise.all(toolUses.map(async (t) => ({
        type: 'tool_result',
        tool_use_id: t.id,
        content: JSON.stringify(await runTool(t.name, t.input, toolCtx)),
      })))
      convo.push({ role: 'user', content: results })
    }
  } catch (err) {
    // Full upstream detail is logged server-side with a correlation id (A.8.28);
    // the browser gets a stable code + generic message + that id only.
    if (err?.status) {
      return errorResponse('בקשת ה-AI נכשלה — נסה שוב', 502, { code: 'ai_failed', err, headers: CORS })
    }
    return errorResponse('שגיאת עיבוד', 500, { code: 'processing_error', err, headers: CORS })
  }
})
