/**
 * audit.js — append one entry to the hash-chained audit_log (A.8.15/A.8.16).
 *
 * Server-side only: writes via the service-role key (RLS denies all client
 * writes; the BEFORE INSERT trigger computes the hash chain). Best-effort — an
 * audit failure is logged but NEVER breaks the primary operation.
 *
 * meta must stay small and PII-free (ids/counts/labels, not raw emails/subjects).
 */
import { getSupabaseUrl } from './extractReceipt.js'

export async function writeAudit(env, { orgId = null, userId = null, action, target = null, meta = null }) {
  try {
    const key = env.SUPABASE_SERVICE_ROLE_KEY
    if (!key || !action) return
    const url = getSupabaseUrl(env)
    await fetch(`${url}/rest/v1/audit_log`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ org_id: orgId, user_id: userId, action, target, meta }),
    })
  } catch (e) {
    // Never let auditing break the request it's recording.
    console.error('[audit] write failed:', action, e?.message || '')
  }
}
