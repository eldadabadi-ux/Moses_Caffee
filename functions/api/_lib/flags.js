/**
 * flags — feature flags (July audit: no way to ship something switched off).
 *
 * There is no staging environment: every release goes straight to a live
 * business. Flags are the substitute that fits — ship the code off, turn it on
 * for the TESTING tenant, watch it against real behaviour, then turn it on for
 * the café. No deploy either way, and an instant way back.
 *
 * Resolution, most specific wins:
 *   org row  →  global row  →  the default declared here in code
 *
 * A flag with no row anywhere therefore takes its code default, which is how a
 * newly shipped flag is off by construction rather than by remembering to
 * insert a row.
 *
 * Pure resolution (no I/O) so it is testable and identical on both sides.
 */

/**
 * Every flag the app knows about, and what it does when nobody has said
 * otherwise. Adding a flag here with `false` is what "ship it dark" means.
 *
 * A flag that has been on everywhere for a while should be DELETED along with
 * the branch it guards — a permanent flag is just an untested second code path.
 */
export const FLAG_DEFAULTS = {
  // The assistant's tool-use loop. On: it queries the database per question.
  // Off: it is unavailable rather than silently falling back to a worse answer.
  bot_tools: true,
  // Catering events: the ledger tab, the quotes screen, the book filter.
  events_book: true,
  // Ask the user to confirm an uncertain supplier match during a scan.
  supplier_confirm: true,
  // Price-change detection in the assistant.
  price_alerts: true,
}

export const FLAG_KEYS = Object.keys(FLAG_DEFAULTS)

/**
 * Resolve every flag from the rows a tenant can see.
 *
 * @param {Array} rows [{ key, org_id, enabled }] — globals and this org's overrides
 * @param {string|null} orgId the caller's org
 * @returns {Object} { [key]: boolean } — always complete, every known key present
 */
export function resolveFlags(rows, orgId = null) {
  const out = { ...FLAG_DEFAULTS }
  const globals = {}, overrides = {}

  for (const r of rows || []) {
    if (!r || !FLAG_KEYS.includes(r.key)) continue      // ignore unknown keys
    if (r.org_id == null) globals[r.key] = !!r.enabled
    else if (orgId && r.org_id === orgId) overrides[r.key] = !!r.enabled
  }

  for (const k of FLAG_KEYS) {
    if (k in globals) out[k] = globals[k]
    if (k in overrides) out[k] = overrides[k]           // most specific wins
  }
  return out
}

/** Read the flags for one tenant, server-side. Never throws — falls back to defaults. */
export async function loadFlags(url, key, { orgId } = {}) {
  if (!url || !key) return { ...FLAG_DEFAULTS }
  try {
    const scope = orgId ? `or=(org_id.is.null,org_id.eq.${encodeURIComponent(orgId)})` : 'org_id=is.null'
    const res = await fetch(`${url}/rest/v1/feature_flags?${scope}&select=key,org_id,enabled`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    if (!res.ok) return { ...FLAG_DEFAULTS }
    return resolveFlags(await res.json(), orgId || null)
  } catch {
    // A flag lookup must never take the request down with it.
    return { ...FLAG_DEFAULTS }
  }
}
