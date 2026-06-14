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
    if (err?.code === 'AI_FAILED') {
      return Response.json({ error: 'AI processing failed', detail: err.detail }, { status: 502, headers: CORS })
    }
    if (err?.code === 'BAD_INPUT') {
      return Response.json({ error: err.message }, { status: 400, headers: CORS })
    }
    console.error('[scan-receipt] Fatal:', err?.message)
    return Response.json({ error: 'שגיאת עיבוד', detail: err?.message }, { status: 500, headers: CORS })
  }
})
