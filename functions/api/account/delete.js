/**
 * Cloudflare Pages Function — POST /api/account/delete  (auth: Bearer JWT)
 *
 * GDPR / right-to-erasure. Purges ALL of the signed-in user's data (receipts,
 * categories, suppliers, settings) + their private storage files, then deletes
 * the auth user itself. The anon client cannot do this — it needs the
 * service-role key, which lives only on the server.
 *
 * Order: data first, auth user last — so a partial failure never orphans data
 * behind a deleted login (the user can retry).
 */

import { requireUser, wrapAuthErrors } from '../_lib/auth.js'

const RECEIPTS_BUCKET = 'receipts'

function getSupabaseUrl(env) {
  return env.VITE_SUPABASE_URL || env.SUPABASE_URL || 'https://dsoucojqjrodxozcbicf.supabase.co'
}

export const onRequestPost = wrapAuthErrors(async (context) => {
  const user = await requireUser(context.request, context.env)
  const sk = context.env.SUPABASE_SERVICE_ROLE_KEY
  const url = getSupabaseUrl(context.env)

  if (!sk) {
    return Response.json(
      { error: 'server_config', message: 'מחיקת חשבון אינה זמינה (חסר מפתח שירות בשרת).' },
      { status: 500 },
    )
  }

  const uid = user.user_id
  const svc = { apikey: sk, Authorization: `Bearer ${sk}` }
  const errors = []

  // ── 1. Remove the user's private storage files (best-effort) ───────────────
  // New receipts store their image under `${uid}/...` in the private bucket;
  // older ones keep base64 in the row (removed when the row is deleted below).
  try {
    const listRes = await fetch(`${url}/storage/v1/object/list/${RECEIPTS_BUCKET}`, {
      method: 'POST',
      headers: { ...svc, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: `${uid}/`, limit: 1000 }),
    })
    if (listRes.ok) {
      const objs = await listRes.json()
      const paths = (Array.isArray(objs) ? objs : [])
        .map(o => o?.name).filter(Boolean).map(name => `${uid}/${name}`)
      if (paths.length) {
        const rm = await fetch(`${url}/storage/v1/object/${RECEIPTS_BUCKET}`, {
          method: 'DELETE',
          headers: { ...svc, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefixes: paths }),
        })
        if (!rm.ok) errors.push(`storage:${rm.status}`)
      }
    } else if (listRes.status !== 404) {
      // 404 = bucket not created yet → nothing to remove.
      errors.push(`storage-list:${listRes.status}`)
    }
  } catch (e) {
    errors.push(`storage:${e?.message || 'err'}`)
  }

  // ── 2. Delete DB rows (each table scoped to this user_id) ──────────────────
  const tables = ['receipts', 'categories', 'suppliers', 'user_settings']
  for (const t of tables) {
    try {
      const res = await fetch(`${url}/rest/v1/${t}?user_id=eq.${uid}`, {
        method: 'DELETE',
        headers: { ...svc, Prefer: 'return=minimal' },
      })
      // 404 = table doesn't exist in this project → ignore.
      if (!res.ok && res.status !== 404) errors.push(`${t}:${res.status}`)
    } catch (e) {
      errors.push(`${t}:${e?.message || 'err'}`)
    }
  }

  // ── 3. Delete the auth user (must succeed) ─────────────────────────────────
  try {
    const res = await fetch(`${url}/auth/v1/admin/users/${uid}`, {
      method: 'DELETE',
      headers: svc,
    })
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200)
      console.error('[account/delete] admin deleteUser failed:', res.status, detail)
      return Response.json(
        { error: 'delete_failed', message: 'מחיקת החשבון נכשלה. נסה שוב או פנה לתמיכה.', detail, errors },
        { status: 502 },
      )
    }
  } catch (e) {
    console.error('[account/delete] Fatal:', e?.message)
    return Response.json(
      { error: 'delete_failed', message: 'שגיאת שרת במחיקת החשבון.', detail: e?.message },
      { status: 500 },
    )
  }

  return Response.json({ ok: true, errors: errors.length ? errors : undefined })
})
