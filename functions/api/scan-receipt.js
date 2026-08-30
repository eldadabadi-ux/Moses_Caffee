/**
 * Cloudflare Pages Function — /api/scan-receipt
 *
 * POST body:  { imageBase64?: string, imagesBase64?: string[], mimeType: string, vatRate?: number }
 *             (imagesBase64 = several pages of one receipt → combined result)
 * Response:   { vendor_name, receipt_date, total_amount, currency, items[], fx,
 *               supplier: { outcome, supplier_id, supplier_name, suggestion }, ... }
 *
 * Thin authenticated wrapper around the shared extraction core (extractReceipt),
 * which is also reused by /api/inbound/email and /api/import/link.
 */

import { requireMember, wrapAuthErrors } from './_lib/auth.js'
import { extractReceipt, getSupabaseUrl } from './_lib/extractReceipt.js'
import { resolveSupplier } from './_lib/supplierResolve.js'
import { checkRateLimit, rateLimitedResponse } from './_lib/rateLimit.js'
import { errorResponse } from './_lib/response.js'

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

export const onRequestPost = wrapAuthErrors(async (context) => {
  const user = await requireMember(context.request, context.env)
  const CORS = corsHeaders(context.request, context.env)

  // Throttle expensive Gemini OCR per user (A.8.12) — fail-open if KV unbound.
  const rl = await checkRateLimit(context.env, `${user.user_id}:scan`, { limit: 30, windowSec: 60 })
  if (!rl.allowed) return rateLimitedResponse(rl.retryAfter, CORS)

  if (!context.env.GEMINI_API_KEY) {
    return errorResponse('שירות הסריקה אינו מוגדר בשרת', 500, { code: 'server_config', headers: CORS })
  }

  let body
  try { body = await context.request.json() } catch {
    return errorResponse('גוף הבקשה אינו תקין', 400, { code: 'bad_json', headers: CORS })
  }

  const { imageBase64, imagesBase64, mimeType } = body ?? {}
  // Accept either a single image (imageBase64) or several pages (imagesBase64[]).
  const images = (Array.isArray(imagesBase64) && imagesBase64.length)
    ? imagesBase64.filter(Boolean)
    : (imageBase64 ? [imageBase64] : [])
  if (!images.length || !mimeType) {
    return errorResponse('חסרים שדות חובה בבקשה', 400, { code: 'bad_input', headers: CORS })
  }

  const vatRate = Number(body?.vatRate) > 0 ? Number(body.vatRate) : 18

  try {
    const result = await extractReceipt({ images, mimeType, env: context.env, userId: user.user_id, vatRate })

    // ── Resolve the scanned vendor to a CANONICAL supplier (audit R1) ────────
    // The model rewrites the vendor string on every scan, so without this step
    // one supplier splits into many. A confident match links silently; an
    // uncertain one comes back as `suggestion` for the user to confirm — the
    // scan is never blocked and a supplier is never invented over a likely match.
    result.supplier = await resolveSupplier({
      vendorName: result.vendor_name,
      url: getSupabaseUrl(context.env),
      key: context.env.SUPABASE_SERVICE_ROLE_KEY,
      userId: user.user_id,
      orgId: user.org_id,
    })

    return Response.json(result, { headers: CORS })
  } catch (err) {
    // Full upstream detail is logged server-side with a correlation id (A.8.28);
    // the browser gets a stable code + generic message + that id only.
    if (err?.code === 'AI_FAILED') return errorResponse('עיבוד ה-AI נכשל — נסה שוב', 502, { code: 'ai_failed', err, headers: CORS })
    if (err?.code === 'BAD_INPUT') return errorResponse('הקלט אינו תקין', 400, { code: 'bad_input', err, headers: CORS })
    return errorResponse('שגיאת עיבוד', 500, { code: 'processing_error', err, headers: CORS })
  }
})
