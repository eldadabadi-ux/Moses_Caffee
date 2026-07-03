/**
 * Cloudflare Pages Function — /api/scan-receipt
 *
 * POST body:  { imageBase64?: string, imagesBase64?: string[], mimeType: string, vatRate?: number }
 *             (imagesBase64 = several pages of one receipt → combined result)
 * Response:   { vendor_name, receipt_date, total_amount, currency, items[], fx, ... }
 *
 * Thin authenticated wrapper around the shared extraction core (extractReceipt),
 * which is also reused by /api/inbound/email and /api/import/link.
 */

import { requireUser, wrapAuthErrors } from './_lib/auth.js'
import { extractReceipt } from './_lib/extractReceipt.js'
import { checkRateLimit, rateLimitedResponse } from './_lib/rateLimit.js'

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
  const user = await requireUser(context.request, context.env)
  const CORS = corsHeaders(context.request, context.env)

  // Throttle expensive Gemini OCR per user (A.8.12) — fail-open if KV unbound.
  const rl = await checkRateLimit(context.env, `${user.user_id}:scan`, { limit: 30, windowSec: 60 })
  if (!rl.allowed) return rateLimitedResponse(rl.retryAfter, CORS)

  if (!context.env.GEMINI_API_KEY) {
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

  const vatRate = Number(body?.vatRate) > 0 ? Number(body.vatRate) : 18

  try {
    const result = await extractReceipt({ images, mimeType, env: context.env, userId: user.user_id, vatRate })
    return Response.json(result, { headers: CORS })
  } catch (err) {
    // Log the full upstream detail server-side only; never leak it to the client
    // (A.8.28 information disclosure) — the browser gets a stable code + message.
    console.error('[scan-receipt] error:', err?.code || '', err?.message || '', err?.detail || '')
    if (err?.code === 'AI_FAILED') {
      return Response.json({ error: 'ai_failed', message: 'עיבוד ה-AI נכשל — נסה שוב' }, { status: 502, headers: CORS })
    }
    if (err?.code === 'BAD_INPUT') {
      return Response.json({ error: 'bad_input', message: 'הקלט אינו תקין' }, { status: 400, headers: CORS })
    }
    return Response.json({ error: 'processing_error', message: 'שגיאת עיבוד' }, { status: 500, headers: CORS })
  }
})
