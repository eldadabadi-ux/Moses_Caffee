/**
 * GET /api/admin/audit — platform owner only. Returns the most recent audit_log
 * entries (service-role read, across all orgs) plus a hash-chain integrity
 * check, so the owner can see every privileged action and detect tampering.
 * (Per-tenant self-service audit views use the RLS SELECT policy instead.)
 */
import { requireUser, wrapAuthErrors } from '../_lib/auth.js'
import { getSupabaseUrl } from '../_lib/extractReceipt.js'

const SUPERADMIN_FALLBACK = 'eldadabadi@gmail.com'
const json = (b, s = 200) => Response.json(b, { status: s, headers: { 'Content-Type': 'application/json' } })

export const onRequestGet = wrapAuthErrors(async ({ request, env }) => {
  const caller = await requireUser(request, env)
  const superadmin = (env.SUPERADMIN_EMAIL || SUPERADMIN_FALLBACK).toLowerCase()
  if ((caller.email || '').toLowerCase() !== superadmin) return json({ error: 'forbidden' }, 403)

  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) return json({ error: 'server_config' }, 500)
  const url = getSupabaseUrl(env)

  const limit = Math.min(Number(new URL(request.url).searchParams.get('limit')) || 50, 200)
  const res = await fetch(`${url}/rest/v1/audit_log?select=id,org_id,user_id,action,target,meta,prev_hash,row_hash,created_at&order=id.desc&limit=${limit}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (!res.ok) {
    // Table not created yet → empty, not an error the owner needs to see raw.
    if (res.status === 404) return json({ entries: [], chainOk: true, migrated: false })
    console.error('[admin/audit] read failed:', res.status)
    return json({ error: 'read_failed' }, 502)
  }
  const rows = await res.json()

  // Authoritative integrity check: recompute the ENTIRE SHA-256 chain in Postgres
  // (verify_audit_chain RPC) — catches edited content, not just broken links.
  // Falls back to a client-side linkage check over the window if the function
  // isn't installed yet.
  let chainOk = true, brokenId = null
  try {
    const vr = await fetch(`${url}/rest/v1/rpc/verify_audit_chain`, {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: '{}',
    })
    if (vr.ok) {
      const out = await vr.json()
      const row = Array.isArray(out) ? out[0] : out
      chainOk = !!row?.ok
      brokenId = row?.broken_id ?? null
    } else {
      const asc = [...rows].reverse()
      for (let i = 1; i < asc.length; i++) if (asc[i].prev_hash !== asc[i - 1].row_hash) { chainOk = false; break }
    }
  } catch {
    const asc = [...rows].reverse()
    for (let i = 1; i < asc.length; i++) if (asc[i].prev_hash !== asc[i - 1].row_hash) { chainOk = false; break }
  }
  return json({ entries: rows, chainOk, brokenId, migrated: true })
})
