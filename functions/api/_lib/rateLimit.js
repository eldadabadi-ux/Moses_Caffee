/**
 * rateLimit.js — per-user request throttling (A.8.12) backed by Cloudflare KV.
 *
 * Fail-OPEN by design: if the `RATE_LIMIT` KV binding isn't configured, or KV
 * errors, requests are allowed — so enabling this can never take the app down.
 * Fixed-window counter; KV's eventual consistency makes it approximate, which
 * is fine for abuse/cost protection (not for exact quotas).
 *
 * windowSec must be >= 60 (KV minimum TTL).
 *
 * @returns {Promise<{allowed:boolean, retryAfter?:number}>}
 */
export async function checkRateLimit(env, key, { limit, windowSec = 60 }) {
  const kv = env?.RATE_LIMIT
  if (!kv) return { allowed: true }              // not configured → no limiting
  try {
    const now = Date.now()
    const win = Math.max(60, windowSec)
    const bucket = Math.floor(now / (win * 1000))
    const k = `rl:${key}:${bucket}`
    const cur = Number(await kv.get(k)) || 0
    if (cur >= limit) {
      const retryAfter = win - Math.floor((now % (win * 1000)) / 1000)
      return { allowed: false, retryAfter: Math.max(1, retryAfter) }
    }
    await kv.put(k, String(cur + 1), { expirationTtl: win + 1 })
    return { allowed: true }
  } catch {
    return { allowed: true }                     // KV error → fail open
  }
}

/** Standard 429 JSON response (Hebrew) with Retry-After. */
export function rateLimitedResponse(retryAfter = 60, extraHeaders = {}) {
  return Response.json(
    { error: 'rate_limited', message: 'יותר מדי בקשות בזמן קצר — נסה שוב בעוד רגע.' },
    { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter), ...extraHeaders } },
  )
}
