/**
 * mail-inbound-worker — the Cloudflare Email Worker behind the self-service
 * inbound address (client request #7).
 *
 * Cloudflare Email Routing delivers every message for the inbound domain to this
 * Worker's `email()` handler. It parses the MIME, base64-encodes each attachment,
 * and POSTs the result to the app's /api/inbound endpoint (shared-secret auth).
 * All OCR, supplier resolution and storage happen there — this Worker only
 * transports the message.
 *
 * Deploy: see README.md. Requires two values in the Worker's environment:
 *   INBOUND_API_URL  e.g. https://moses-caffee.pages.dev/api/inbound
 *   INBOUND_SECRET   the same secret set on the Pages project (wrangler secret)
 */
import PostalMime from 'postal-mime'

function toBase64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

export default {
  async email(message, env) {
    let parsed
    try {
      parsed = await PostalMime.parse(message.raw)
    } catch (err) {
      console.error('[inbound-worker] MIME parse failed:', err?.message)
      return   // accept-and-drop: nothing to retry on a malformed message
    }

    const attachments = (parsed.attachments || [])
      .filter(a => a && a.content)
      .map(a => ({
        filename: a.filename || 'attachment',
        mimeType: a.mimeType || 'application/octet-stream',
        contentBase64: toBase64(a.content),
      }))

    if (attachments.length === 0) return   // no attachments → nothing to ingest

    const payload = {
      to: message.to,
      from: message.from,
      subject: parsed.subject || '',
      message_id: parsed.messageId || message.headers.get('message-id') || '',
      attachments,
    }

    try {
      const res = await fetch(env.INBOUND_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-inbound-secret': env.INBOUND_SECRET },
        body: JSON.stringify(payload),
      })
      if (!res.ok) console.error('[inbound-worker] /api/inbound responded', res.status)
    } catch (err) {
      console.error('[inbound-worker] POST failed:', err?.message)
    }
  },
}
