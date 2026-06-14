/**
 * safeFetch — SSRF-hardened fetch for user-supplied URLs (link import).
 *
 * Guards against Server-Side Request Forgery when we download a receipt/invoice
 * from a link a user pasted or shared:
 *   - http/https only; no embedded credentials.
 *   - blocks localhost, private/reserved/link-local IPs, and cloud metadata.
 *   - manual redirect following with per-hop re-validation (capped).
 *   - response size cap + timeout.
 *
 * Returns { status, contentType, finalUrl, bytes:Uint8Array }.
 * Throws Error with .code ('BLOCKED_URL' | 'TOO_LARGE' | 'TIMEOUT' | 'TOO_MANY_REDIRECTS').
 */

const DEFAULT_MAX_BYTES   = 15 * 1024 * 1024  // 15 MB
const DEFAULT_MAX_REDIR   = 4
const DEFAULT_TIMEOUT_MS  = 15000

function blockedError(message) { const e = new Error(message); e.code = 'BLOCKED_URL'; return e }

// IPv4 literal → blocked if in a private/reserved range.
function isBlockedIPv4(ip) {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const [a, b] = p
  if (a === 10) return true                          // 10/8
  if (a === 127) return true                         // loopback
  if (a === 0) return true                           // 0/8
  if (a === 169 && b === 254) return true            // link-local + cloud metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true   // 172.16/12
  if (a === 192 && b === 168) return true            // 192.168/16
  if (a === 192 && b === 0) return true              // 192.0.0/24 + 192.0.2/24
  if (a === 198 && (b === 18 || b === 19)) return true // 198.18/15 benchmarking
  if (a === 100 && b >= 64 && b <= 127) return true  // 100.64/10 CGNAT
  if (a >= 224) return true                          // multicast/reserved 224/4, 240/4
  return false
}

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/

function isBlockedHost(hostname) {
  let h = (hostname || '').toLowerCase().trim()
  if (!h) return true
  // strip IPv6 brackets
  const v6 = h.startsWith('[') && h.endsWith(']')
  if (v6) h = h.slice(1, -1)

  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (h.endsWith('.local') || h.endsWith('.internal')) return true
  if (h === 'metadata.google.internal' || h === 'metadata') return true

  if (IPV4_RE.test(h)) return isBlockedIPv4(h)

  if (v6 || h.includes(':')) {
    // IPv6 literal — block loopback, ULA (fc00::/7), link-local (fe80::/10),
    // unspecified, and IPv4-mapped private addresses.
    if (h === '::1' || h === '::') return true
    if (h.startsWith('fc') || h.startsWith('fd')) return true   // fc00::/7
    if (h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb')) return true // fe80::/10
    const mapped = h.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)
    if (mapped && isBlockedIPv4(mapped[1])) return true
    return false
  }
  return false
}

// Validate a single URL; throws BLOCKED_URL if unsafe. Returns the URL object.
export function assertSafeUrl(raw) {
  let u
  try { u = new URL(raw) } catch { throw blockedError('כתובת לא תקינה') }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw blockedError('פרוטוקול לא נתמך (http/https בלבד)')
  if (u.username || u.password) throw blockedError('כתובת עם פרטי התחברות אינה מותרת')
  if (isBlockedHost(u.hostname)) throw blockedError('כתובת פנימית/חסומה אינה מותרת')
  return u
}

export async function safeFetch(rawUrl, opts = {}) {
  const {
    method = 'GET',
    headers = {},
    maxBytes = DEFAULT_MAX_BYTES,
    maxRedirects = DEFAULT_MAX_REDIR,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = opts

  let current = assertSafeUrl(rawUrl).toString()

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    let res
    try {
      res = await fetch(current, {
        method,
        headers: { 'User-Agent': 'MosesCaffee-ReceiptBot/1.0', Accept: '*/*', ...headers },
        redirect: 'manual',
        signal: ctrl.signal,
      })
    } catch (err) {
      clearTimeout(timer)
      if (err?.name === 'AbortError') { const e = new Error('timeout'); e.code = 'TIMEOUT'; throw e }
      throw err
    }
    clearTimeout(timer)

    // Manual redirect handling — re-validate each hop.
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const next = new URL(res.headers.get('location'), current)
      assertSafeUrl(next.toString())
      current = next.toString()
      continue
    }

    // Enforce size via Content-Length hint, then via streamed read.
    const cl = Number(res.headers.get('content-length') || 0)
    if (cl && cl > maxBytes) { const e = new Error('too large'); e.code = 'TOO_LARGE'; throw e }

    const reader = res.body?.getReader()
    if (!reader) {
      const buf = new Uint8Array(await res.arrayBuffer())
      if (buf.byteLength > maxBytes) { const e = new Error('too large'); e.code = 'TOO_LARGE'; throw e }
      return { status: res.status, contentType: res.headers.get('content-type') || '', finalUrl: current, bytes: buf }
    }
    const chunks = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) { try { await reader.cancel() } catch {} const e = new Error('too large'); e.code = 'TOO_LARGE'; throw e }
      chunks.push(value)
    }
    const bytes = new Uint8Array(total)
    let off = 0
    for (const c of chunks) { bytes.set(c, off); off += c.byteLength }
    return { status: res.status, contentType: res.headers.get('content-type') || '', finalUrl: current, bytes }
  }

  const e = new Error('too many redirects'); e.code = 'TOO_MANY_REDIRECTS'; throw e
}

// Base64-encode a byte array (chunked to avoid call-stack limits).
export function bytesToBase64(bytes) {
  let binary = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CH))
  }
  return btoa(binary)
}
