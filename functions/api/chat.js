/**
 * Cloudflare Pages Function — /api/chat
 *
 * POST { messages, context: { screen, path } }  (auth: Bearer JWT)
 * → { reply }
 *
 * Loads ALL of the signed-in user's receipts + categories + suppliers (service
 * role, filtered by user_id), builds café-oriented statistics (spend, per-vendor,
 * product price comparison, seasonality) into a Hebrew system prompt, and calls
 * Anthropic Claude — same model/pattern as the CRM bot.
 */

import { requireMember, wrapAuthErrors } from './_lib/auth.js'

const CLAUDE_MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS   = 2048

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
  return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  } })
}

// ── helpers ────────────────────────────────────────────────────────────────────
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null }
const ils = (n) => `₪${Math.round(Number(n) || 0).toLocaleString('he-IL')}`
const HE_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר']

function makeSbGet(url, sk) {
  return async function sbGet(path) {
    try {
      const res = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: sk, Authorization: `Bearer ${sk}` } })
      return res.ok ? res.json() : []
    } catch { return [] }
  }
}

// Flatten receipt line items (all amounts already in ILS).
function flatten(receipts) {
  const out = []
  for (const r of receipts || []) {
    if (r.archived_at) continue
    const date = r.receipt_date || (r.created_at || '').slice(0, 10)
    const vendor = (r.vendor_name || '').trim() || 'לא ידוע'
    const cat = (r.category_text || 'שונות').trim()
    const items = Array.isArray(r.items) ? r.items : []
    if (items.length) {
      for (const it of items) {
        out.push({
          date, vendor,
          cat: (it.category_l1 || cat).trim(),
          name: (it.item_name || it.category_l3 || it.category_l2 || 'מוצר').trim(),
          qty: num(it.quantity), unit: (it.unit || '').trim(),
          unitPrice: num(it.unit_price), price: num(it.price) || 0,
        })
      }
    } else {
      out.push({ date, vendor, cat, name: vendor, qty: null, unit: '', unitPrice: null, price: num(r.amount) || 0 })
    }
  }
  return out
}

function buildReceiptsBlock(receipts, categories, suppliers) {
  const active = (receipts || []).filter(r => !r.archived_at)
  const now = new Date()
  const y0 = now.getFullYear(), y1 = y0 - 1
  const m0 = now.getMonth() // 0-based
  const ym = (d) => (d || '').slice(0, 7)
  const curYM = `${y0}-${String(m0 + 1).padStart(2, '0')}`
  const prevYM = m0 === 0 ? `${y1}-12` : `${y0}-${String(m0).padStart(2, '0')}`
  const nextMonthIdx = (m0 + 1) % 12

  const amt = (r) => num(r.amount) || 0
  const total = active.reduce((s, r) => s + amt(r), 0)
  const thisMonth = active.filter(r => ym(r.receipt_date) === curYM).reduce((s, r) => s + amt(r), 0)
  const lastMonth = active.filter(r => ym(r.receipt_date) === prevYM).reduce((s, r) => s + amt(r), 0)
  const thisYear = active.filter(r => (r.receipt_date || '').startsWith(`${y0}`)).reduce((s, r) => s + amt(r), 0)
  const lastYear = active.filter(r => (r.receipt_date || '').startsWith(`${y1}`)).reduce((s, r) => s + amt(r), 0)

  const flat = flatten(active)

  // ── per-vendor summary ────────────────────────────────────────────────────
  const supMap = {}
  ;(suppliers || []).forEach(s => { if (s?.name) supMap[s.name.trim()] = s })
  const vMap = {}
  for (const f of flat) {
    if (!vMap[f.vendor]) vMap[f.vendor] = { total: 0, count: new Set(), month: 0, year: 0, last: '', cats: {}, prods: {} }
    const v = vMap[f.vendor]
    v.total += f.price
    v.count.add(f.date)
    if (ym(f.date) === curYM) v.month += f.price
    if ((f.date || '').startsWith(`${y0}`)) v.year += f.price
    if (f.date > v.last) v.last = f.date
    v.cats[f.cat] = (v.cats[f.cat] || 0) + f.price
    v.prods[f.name] = (v.prods[f.name] || 0) + f.price
  }
  const vendors = Object.entries(vMap).map(([name, v]) => {
    const dates = active.filter(r => ((r.vendor_name || '').trim() || 'לא ידוע') === name).map(r => r.receipt_date).filter(Boolean).sort()
    const last = dates[dates.length - 1] || v.last
    const topCats = Object.entries(v.cats).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c).join(', ')
    const topProds = Object.entries(v.prods).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([p, s]) => `${p} (${ils(s)})`).join(', ')
    const receiptCount = dates.length
    const c = supMap[name]
    return { name, total: v.total, month: v.month, year: v.year, last, receiptCount, topCats, topProds, contact: c }
  }).sort((a, b) => b.total - a.total)

  // Only real summed figures per vendor — no extrapolated averages (a single
  // receipt must never imply a "yearly" cost).
  const vendorsBlock = vendors.map((v, i) => {
    const lines =
      `${i + 1}. ${v.name} | סה"כ: ${ils(v.total)} | החודש: ${ils(v.month)} | השנה: ${ils(v.year)} | ` +
      `קבלות: ${v.receiptCount} | רכישה אחרונה: ${v.last || '-'}` +
      (v.topCats ? ` | מספק: ${v.topCats}` : '') +
      (v.topProds ? `\n     מוצרים מובילים: ${v.topProds}` : '') +
      (v.contact ? `\n     פרטי קשר: ${[v.contact.phone && 'טל ' + v.contact.phone, v.contact.whatsapp && 'וואטסאפ ' + v.contact.whatsapp, v.contact.email, v.contact.address].filter(Boolean).join(' | ')}` : '')
    return lines
  }).join('\n')

  // ── product → vendor price comparison (for "cheaper at X") ─────────────────
  const prodMap = {}
  for (const f of flat) {
    if (!f.name) continue
    if (!prodMap[f.name]) prodMap[f.name] = { total: 0, vendors: {} }
    prodMap[f.name].total += f.price
    const pv = prodMap[f.name].vendors
    if (!pv[f.vendor]) pv[f.vendor] = { spend: 0, qty: 0, prices: [] }
    pv[f.vendor].spend += f.price
    if (f.qty != null) pv[f.vendor].qty += f.qty
    if (f.unitPrice != null) pv[f.vendor].prices.push(f.unitPrice)
  }
  const compareBlock = Object.entries(prodMap)
    .filter(([, p]) => Object.keys(p.vendors).length >= 2)   // only products bought from 2+ vendors
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 25)
    .map(([name, p]) => {
      const parts = Object.entries(p.vendors).sort((a, b) => b[1].spend - a[1].spend).map(([vn, d]) => {
        const avgUnit = d.qty > 0 ? d.spend / d.qty : (d.prices.length ? d.prices.reduce((s, x) => s + x, 0) / d.prices.length : null)
        return `${vn}${avgUnit != null ? ` ${ils(avgUnit)}/יח'` : ''} (סה"כ ${ils(d.spend)})`
      }).join(' · ')
      return `- ${name}: ${parts}`
    }).join('\n')

  // ── category breakdown + seasonality (this year vs last year) ──────────────
  const catYoY = {}
  for (const f of flat) {
    const yr = (f.date || '').slice(0, 4)
    if (!catYoY[f.cat]) catYoY[f.cat] = { y0: 0, y1: 0 }
    if (yr === `${y0}`) catYoY[f.cat].y0 += f.price
    else if (yr === `${y1}`) catYoY[f.cat].y1 += f.price
  }
  const catBlock = Object.entries(catYoY).sort((a, b) => (b[1].y0 + b[1].y1) - (a[1].y0 + a[1].y1)).map(([c, v]) => {
    const ch = v.y1 > 0 ? Math.round(((v.y0 - v.y1) / v.y1) * 100) : null
    return `- ${c}: השנה ${ils(v.y0)} | שנה שעברה ${ils(v.y1)}${ch != null ? ` (${ch >= 0 ? '+' : ''}${ch}%)` : ''}`
  }).join('\n')

  // monthly totals (this year + last year) for trend reasoning
  const monthly = (year) => {
    const arr = Array(12).fill(0)
    active.forEach(r => { if ((r.receipt_date || '').startsWith(`${year}`)) { const m = parseInt((r.receipt_date || '').slice(5, 7)) - 1; if (m >= 0) arr[m] += amt(r) } })
    return arr
  }
  const my0 = monthly(y0), my1 = monthly(y1)
  const monthlyBlock = HE_MONTHS.map((nm, i) => `${nm}: ${y0} ${ils(my0[i])} · ${y1} ${ils(my1[i])}`).join(' | ')

  // next-month-last-year per category (seasonality hint)
  const nm = `${y1}-${String(nextMonthIdx + 1).padStart(2, '0')}`
  const nmCats = {}
  flat.forEach(f => { if (ym(f.date) === nm) nmCats[f.cat] = (nmCats[f.cat] || 0) + f.price })
  const nextMonthBlock = Object.entries(nmCats).sort((a, b) => b[1] - a[1]).map(([c, s]) => `${c}: ${ils(s)}`).join(' | ') || 'אין נתונים'

  // ── recent receipts ────────────────────────────────────────────────────────
  const recent = [...active].sort((a, b) => (b.receipt_date || '').localeCompare(a.receipt_date || '')).slice(0, 30)
    .map((r, i) => `${i + 1}. ${r.receipt_date || '-'} | ${(r.vendor_name || '-')} | ${ils(amt(r))} | ${r.category_text || '-'}`).join('\n')

  // ── category tree ──────────────────────────────────────────────────────────
  const l1 = (categories || []).filter(c => c.level === 1)
  const treeBlock = l1.map(c1 => {
    const l2 = (categories || []).filter(c => c.level === 2 && c.parent_id === c1.id)
    return `- ${c1.name}${l2.length ? ': ' + l2.map(x => x.name).join(', ') : ''}`
  }).join('\n') || '(אין קטגוריות מוגדרות)'

  return `=== נתוני בית הקפה (${now.toLocaleDateString('he-IL')}) ===
החודש הנוכחי: ${HE_MONTHS[m0]} ${y0}. החודש הבא: ${HE_MONTHS[nextMonthIdx]}.

[סיכום]
סה"כ הוצאות (לא בארכיון): ${ils(total)} | קבלות: ${active.length} | ספקים: ${vendors.length}
החודש: ${ils(thisMonth)} | חודש קודם: ${ils(lastMonth)} | השנה (${y0}): ${ils(thisYear)} | שנה שעברה (${y1}): ${ils(lastYear)}

[הוצאה חודשית — ${y0} מול ${y1}]
${monthlyBlock}

[לפי קטגוריה — השנה מול שנה שעברה]
${catBlock || 'אין נתונים'}

[עונתיות — ${HE_MONTHS[nextMonthIdx]} בשנה שעברה (${y1}) לפי קטגוריה]
${nextMonthBlock}

[ספקים — ${vendors.length}]
${vendorsBlock || 'אין ספקים'}

[השוואת מחירים בין ספקים (מוצרים שנקנו מ-2+ ספקים)]
${compareBlock || 'אין מוצרים שנקנו מכמה ספקים — אי אפשר להשוות מחיר עדיין'}

[קבלות אחרונות]
${recent || 'אין'}

[עץ קטגוריות]
${treeBlock}
===`
}

// ── handler ─────────────────────────────────────────────────────────────────
export const onRequestPost = wrapAuthErrors(async (context) => {
  const user = await requireMember(context.request, context.env)
  const CORS = corsHeaders(context.request, context.env)
  const { ANTHROPIC_API_KEY, SUPABASE_SERVICE_ROLE_KEY: sk } = context.env
  const SUPABASE_URL = getSupabaseUrl(context.env)

  if (!ANTHROPIC_API_KEY) {
    return Response.json({ error: 'הבוט אינו מוגדר עדיין (חסר ANTHROPIC_API_KEY בשרת).' }, { status: 500, headers: CORS })
  }

  let body
  try { body = await context.request.json() }
  catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400, headers: CORS }) }
  const { messages = [], context: ctx = {} } = body ?? {}

  // ── Load the user's data (service role, filtered by user_id) ───────────────
  let receipts = [], categories = [], suppliers = [], userSettings = null
  if (sk) {
    const sbGet = makeSbGet(SUPABASE_URL, sk)
    // Org-scoped when multi-tenancy is set up (so the bot sees all of the org's
    // data, not just the current member's); falls back to user_id otherwise.
    // suppliers/user_settings have no org_id column yet → stay user-scoped.
    const scope = user.org_id ? `org_id=eq.${user.org_id}` : `user_id=eq.${user.user_id}`
    const [r, c, s, st] = await Promise.allSettled([
      sbGet(`receipts?${scope}&select=id,vendor_name,receipt_date,amount,currency,category_text,items,ai_summary,archived_at,created_at&order=receipt_date.desc.nullslast`),
      sbGet(`categories?${scope}&select=id,name,parent_id,level&order=level,sort_order`),
      sbGet(`suppliers?user_id=eq.${user.user_id}&select=name,phone,email,address,whatsapp,supplies,notes`),
      sbGet(`user_settings?user_id=eq.${user.user_id}&select=vat_rate,show_with_vat,business_name`),
    ])
    receipts   = r.status === 'fulfilled' ? (r.value || []) : []
    categories = c.status === 'fulfilled' ? (c.value || []) : []
    suppliers  = s.status === 'fulfilled' ? (s.value || []) : []
    userSettings = (st.status === 'fulfilled' && Array.isArray(st.value)) ? (st.value[0] || null) : null
  }

  const dataBlock = (receipts.length || categories.length)
    ? buildReceiptsBlock(receipts, categories, suppliers)
    : '(אין עדיין נתונים — המשתמש לא סרק קבלות.)'

  // Configured business settings — authoritative facts the bot must respect.
  const vatRate     = userSettings?.vat_rate ?? 18
  const showWithVat = userSettings?.show_with_vat !== false
  const bizName     = userSettings?.business_name || 'בית הקפה'

  // STABLE prefix — identical request-to-request within a conversation, so it can
  // be prompt-cached (instructions + business settings + the big data block). Must
  // contain NO per-request values (no timestamp, no current screen).
  const stableSystem = `אתה "העוזר החכם" של בית הקפה של משה — מערכת לניהול קבלות והוצאות.
הטון שלך: חברי, ענייני ומקצועי. השב תמיד בעברית, בניסוח קצר וברור.

יש לך גישה מלאה לכל נתוני העסק: קבלות, ספקים, מוצרים, קטגוריות והוצאות. אתה יכול:
- לענות על שאלות ולחשב סטטיסטיקות (כמה הוצאתי, על מה, מתי, אצל מי).
- לתת המלצות מעשיות לחיסכון, למשל: "כדאי לקנות חלב מספק X ולא Y" כשהמחיר ליחידה אצל X נמוך יותר.
- להצביע על מגמות עונתיות, למשל: "נובמבר מתקרב — בשנה שעברה עלתה ההוצאה על תה/קפה".

חוקים:
- בסס כל מספר/המלצה על הנתונים שלמטה בלבד. אם המידע חסר — אמור זאת בכנות ואל תמציא.
- אל תמציא ממוצעים תקופתיים (יומי/שבועי/חודשי/שנתי) מתוך קבלה בודדת או מעט קבלות. דווח רק סכומים אמיתיים שנצברו (סה"כ, החודש, השנה). כשאין מספיק היסטוריה לחיזוי — אמור זאת במפורש.
- בהמלצת ספק זול יותר — השווה מחיר ליחידה (לא רק סה"כ), וציין את ההפרש.
- כתוב נקי: בלי אימוג'ים, בלי סולמיות (#) או קווים (---). הפרד נושאים בשורה ריקה. השתמש ברשימות רק כשמבקשים.
- כשמבקשים — בצע מיד (אל תפתח ב"שלום, במה אפשר לעזור").
- שיעור המע"מ המוגדר במערכת הוא ${vatRate}% — התייחס אליו כעובדה הקובעת בכל חישוב. אם המשתמש טוען לערך אחר, או אם יש סתירה בין הערך המוגדר לבין מה שאתה חושב לנכון, אל תחליט לבד: שאל את המשתמש מהו הערך הנכון, והנחה אותו לעדכן ב"הגדרות → שיעור מע"מ".

[הגדרות מוגדרות במערכת]
שם העסק: ${bizName} · שיעור מע"מ: ${vatRate}% · תצוגת מחירים: ${showWithVat ? 'כולל מע"מ' : 'ללא מע"מ'}

${dataBlock}`

  // VOLATILE suffix — tiny, changes per request (current screen). NOT cached.
  const volatileSystem = `מסך נוכחי: ${ctx.screen || 'לא ידוע'}${ctx.path ? ` (${ctx.path})` : ''}`

  // ── Call Anthropic Claude ──────────────────────────────────────────────────
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: CLAUDE_MODEL, max_tokens: MAX_TOKENS,
        // The stable block is prompt-cached (written once, then read at ~10% on
        // every following message in the ~5-min window); the volatile block isn't.
        system: [
          { type: 'text', text: stableSystem, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: volatileSystem },
        ],
        messages: messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') })),
      }),
    })
    if (!res.ok) {
      const err = await res.text()
      console.error('[chat] Anthropic error:', res.status, err.slice(0, 300))
      return Response.json({ error: 'בקשת ה-AI נכשלה', detail: err.slice(0, 200) }, { status: 502, headers: CORS })
    }
    const data = await res.json()
    // Cache visibility: cache_read_input_tokens > 0 from the 2nd message onward
    // means the data block was served from cache (~10% price) instead of full price.
    if (data?.usage) console.log('[chat] usage:', JSON.stringify(data.usage))
    const reply = data?.content?.[0]?.text || ''
    return Response.json({ reply }, { headers: CORS })
  } catch (err) {
    console.error('[chat] Fatal:', err?.message)
    return Response.json({ error: 'שגיאת עיבוד', detail: err?.message }, { status: 500, headers: CORS })
  }
})
