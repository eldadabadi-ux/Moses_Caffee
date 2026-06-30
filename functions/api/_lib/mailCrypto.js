/**
 * mailCrypto — encrypt/decrypt mailbox refresh tokens at rest, and sign/verify
 * the OAuth `state` (so the Google redirect can't be forged). Uses Web Crypto
 * (available in Cloudflare Workers). One server secret: env.MAIL_TOKEN_KEY
 * (any long random string); a 256-bit key is derived from it via SHA-256.
 */

const enc = new TextEncoder()
const dec = new TextDecoder()

function b64uEncode(bytes) {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function b64uDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/')
  while (str.length % 4) str += '='
  const bin = atob(str)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function keyBytes(secret) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(secret || ''))))
}

// ── Token encryption (AES-GCM) ───────────────────────────────────────────────
export async function encryptToken(plaintext, secret) {
  const key = await crypto.subtle.importKey('raw', await keyBytes(secret), 'AES-GCM', false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext)))
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv, 0); out.set(ct, iv.length)
  return b64uEncode(out)
}

export async function decryptToken(packed, secret) {
  const raw = b64uDecode(packed)
  const iv = raw.slice(0, 12), ct = raw.slice(12)
  const key = await crypto.subtle.importKey('raw', await keyBytes(secret), 'AES-GCM', false, ['decrypt'])
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return dec.decode(pt)
}

// ── Signed OAuth state ───────────────────────────────────────────────────────
async function hmac(data, secret) {
  const key = await crypto.subtle.importKey('raw', await keyBytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)))
}

export async function signState(obj, secret, ttlSec = 900) {
  const payload = b64uEncode(enc.encode(JSON.stringify({ ...obj, exp: Math.floor(Date.now() / 1000) + ttlSec })))
  const sig = b64uEncode(await hmac(payload, secret))
  return `${payload}.${sig}`
}

export async function verifyState(token, secret) {
  const [payload, sig] = String(token || '').split('.')
  if (!payload || !sig) return null
  const expect = b64uEncode(await hmac(payload, secret))
  if (expect !== sig) return null
  let obj
  try { obj = JSON.parse(dec.decode(b64uDecode(payload))) } catch { return null }
  if (!obj.exp || obj.exp < Math.floor(Date.now() / 1000)) return null
  return obj
}
