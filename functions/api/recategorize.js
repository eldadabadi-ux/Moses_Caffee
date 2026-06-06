/**
 * Cloudflare Pages Function — /api/recategorize
 *
 * Re-classifies existing receipts against the user's CURRENT category tree.
 * Called when the user adds/edits categories so old receipts get sorted into
 * the new (sub)categories. One Gemini text call handles all receipts at once
 * (vendor + item names only — no images, so it's fast and cheap).
 *
 * POST body: { receipts: [{ id, vendor_name, items:[{item_name, price}] }] }
 * Response:  { results: [{ id, category_l1, category_l2, category_l3,
 *                          items:[{item_name, category_l1, category_l2, category_l3}] }] }
 */

import { requireUser, wrapAuthErrors } from './_lib/auth.js'

const GEMINI_PRIMARY  = 'gemini-2.5-flash'
const GEMINI_FALLBACK = 'gemini-flash-latest'

function getSupabaseUrl(env) {
  return env.VITE_SUPABASE_URL || env.SUPABASE_URL || 'https://dsoucojqjrodxozcbicf.supabase.co'
}
function corsHeaders(request, env) {
  const origin = (request.headers.get('origin') || '').trim()
  return { 'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || origin || '*', 'Content-Type': 'application/json' }
}
export async function onRequestOptions(context) {
  const origin = (context.request.headers.get('origin') || '').trim()
  return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': context.env.ALLOWED_ORIGIN || origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  } })
}

export const onRequestPost = wrapAuthErrors(async (context) => {
  const user = await requireUser(context.request, context.env)
  const CORS = corsHeaders(context.request, context.env)
  const { GEMINI_API_KEY, SUPABASE_SERVICE_ROLE_KEY } = context.env
  const SUPABASE_URL = getSupabaseUrl(context.env)
  if (!GEMINI_API_KEY) return Response.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500, headers: CORS })

  let body
  try { body = await context.request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: CORS }) }
  const receipts = Array.isArray(body?.receipts) ? body.receipts : []
  if (receipts.length === 0) return Response.json({ results: [] }, { headers: CORS })

  // ── Load the user's category tree ──────────────────────────────────────────
  let tree = ''
  let l1Names = []
  try {
    if (SUPABASE_SERVICE_ROLE_KEY) {
      const sk = SUPABASE_SERVICE_ROLE_KEY
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/categories?user_id=eq.${user.user_id}&select=id,name,parent_id,level&order=level,sort_order`,
        { headers: { apikey: sk, Authorization: `Bearer ${sk}` } }
      )
      if (res.ok) {
        const cats = await res.json()
        const l1 = cats.filter(c => c.level === 1)
        const l2 = cats.filter(c => c.level === 2)
        const l3 = cats.filter(c => c.level === 3)
        l1Names = l1.map(c => c.name)
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
        tree = lines.join('\n')
      }
    }
  } catch (e) { console.warn('[recategorize] tree load:', e?.message) }

  if (!tree) return Response.json({ error: 'no categories' }, { status: 400, headers: CORS })

  // ── Build the classification prompt ─────────────────────────────────────────
  const compact = receipts.map(r => ({
    id: r.id,
    vendor: r.vendor_name || '',
    items: (r.items || []).map(it => it.item_name).filter(Boolean),
  }))

  const prompt = `אתה מסווג קבלות עסקיות ישראליות לפי עץ קטגוריות נתון.

עץ הקטגוריות (L1 › L2 › L3):
${tree}

לכל קבלה ברשימה, סווג כל פריט לקטגוריה המתאימה ביותר מהעץ.
- category_l1: חובה, בחר מ: ${l1Names.join(' | ')}
- category_l2: תת-קטגוריה מהעץ אם מתאים (אחרת "")
- category_l3: תת-תת-קטגוריה מהעץ אם מתאים (אחרת "")
- לקבלה כולה: קבע category_l1 = הקטגוריה הדומיננטית (של רוב הסכום/הפריטים).

קבלות:
${JSON.stringify(compact, null, 1)}

החזר JSON בלבד במבנה:
{ "results": [ { "id": "...", "category_l1": "...", "category_l2": "", "category_l3": "",
   "items": [ { "item_name": "...", "category_l1": "...", "category_l2": "", "category_l3": "" } ] } ] }`

  const schema = {
    type: 'OBJECT',
    properties: {
      results: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            id:          { type: 'STRING' },
            category_l1: { type: 'STRING' },
            category_l2: { type: 'STRING' },
            category_l3: { type: 'STRING' },
            items: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  item_name:   { type: 'STRING' },
                  category_l1: { type: 'STRING' },
                  category_l2: { type: 'STRING' },
                  category_l3: { type: 'STRING' },
                },
                required: ['item_name', 'category_l1'],
              },
            },
          },
          required: ['id', 'category_l1'],
        },
      },
    },
    required: ['results'],
  }

  let out = null, lastErr = null
  for (const model of [GEMINI_PRIMARY, GEMINI_FALLBACK]) {
    try { out = await callGemini(GEMINI_API_KEY, model, prompt, schema); if (out?.results) break }
    catch (e) { lastErr = e; console.warn(`[recategorize] ${model}:`, e?.message) }
  }
  if (!out) return Response.json({ error: 'AI failed', detail: lastErr?.message }, { status: 502, headers: CORS })

  return Response.json(out, { headers: CORS })
})

async function callGemini(apiKey, model, prompt, schema) {
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.05, thinkingConfig: { thinkingBudget: 0 } },
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    if (res.ok) {
      const data = await res.json()
      const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text
      if (!raw) { if (attempt < 3) { await sleep(attempt * 1200); continue } throw new Error('empty') }
      try { return JSON.parse(raw) } catch {
        const m = raw.match(/```(?:json)?\s*([\s\S]+?)```/); if (m) return JSON.parse(m[1]); throw new Error('parse')
      }
    }
    const errText = await res.text()
    if ([429, 500, 502, 503, 504].includes(res.status) && attempt < 3) { await sleep(attempt * 1500); continue }
    throw new Error(`Gemini ${model} ${res.status}: ${errText.slice(0, 140)}`)
  }
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
