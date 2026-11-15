/**
 * /api/inbound — receive a forwarded receipt email (client request #7).
 *
 * POST (from the Cloudflare Email Worker, authenticated by a shared secret —
 * x-inbound-secret: env.INBOUND_SECRET, NOT a user JWT):
 *   { to, from, subject, message_id, attachments:[{ filename, mimeType, contentBase64 }] }
 *
 * The `to` alias resolves to a customer; each supported attachment is OCR'd into a
 * PENDING receipt through the SAME mailIngest core as Gmail/Outlook, so supplier
 * resolution, VAT handling and the review queue all behave identically.
 *
 * Always answers 200 once the secret checks out (even for an unknown alias or a
 * duplicate) — a non-2xx would make Email Routing retry or bounce a message there
 * is no point reprocessing. Only a bad/absent secret is rejected (403).
 */
import { constantTimeEqual } from './_lib/auth.js'
import { getSupabaseUrl } from './_lib/extractReceipt.js'
import { makeDb, alreadyImported, ingestReceipt } from './_lib/mailIngest.js'
import { aliasFromAddress, pickAttachments } from './_lib/inbound.js'
import { resolveOrgId } from './_lib/auth.js'

export async function onRequestPost({ request, env }) {
  const secret = request.headers.get('x-inbound-secret') || ''
  if (!env.INBOUND_SECRET || !constantTimeEqual(secret, env.INBOUND_SECRET)) {
    return new Response('forbidden', { status: 403 })
  }

  let body
  try { body = await request.json() } catch { return Response.json({ error: 'bad_json' }, { status: 400 }) }
  const { to, from = '', subject = '', message_id = '', attachments = [] } = body || {}

  const alias = aliasFromAddress(to)
  if (!alias) return Response.json({ ok: true, ignored: 'no_alias' })

  const url = getSupabaseUrl(env), key = env.SUPABASE_SERVICE_ROLE_KEY
  const h = { apikey: key, Authorization: `Bearer ${key}` }

  // Alias → customer (+ their VAT rate). The unique index guarantees ≤ 1 row.
  const settings = await fetch(
    `${url}/rest/v1/user_settings?inbound_alias=eq.${encodeURIComponent(alias)}&select=user_id,vat_rate&limit=1`,
    { headers: h }).then(r => r.ok ? r.json() : []).catch(() => [])
  const owner = settings?.[0]
  if (!owner?.user_id) return Response.json({ ok: true, ignored: 'unknown_alias' })

  const db = makeDb(env)

  // Message-level dedup: the same forwarded message must not import twice.
  if (message_id && await alreadyImported(db, message_id)) {
    return Response.json({ ok: true, imported: 0, skipped: 'duplicate' })
  }

  const org_id = await resolveOrgId(owner.user_id, env)
  const conn = { user_id: owner.user_id, org_id }
  const vatRate = Number(owner.vat_rate) > 0 ? Number(owner.vat_rate) : 18
  const files = pickAttachments(attachments)

  let imported = 0, failed = 0
  for (const f of files) {
    try {
      const ok = await ingestReceipt({
        db, env, conn, vatRate, mimeType: f.mimeType, b64: f.b64,
        meta: { from, subject, message_id, provider: 'inbound', filename: f.filename },
        fallbackDateMs: Date.now(),
      })
      if (ok) imported++
    } catch (err) {
      // One bad attachment (quota, non-receipt) must not fail the whole message.
      failed++
      console.warn('[inbound] attachment failed:', err?.message)
    }
  }

  return Response.json({ ok: true, alias_matched: true, attachments: files.length, imported, failed })
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Methods': 'POST, OPTIONS' } })
}
