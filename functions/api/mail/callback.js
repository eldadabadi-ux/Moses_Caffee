/**
 * GET /api/mail/callback — Google redirects here after consent. Validates the
 * signed `state`, exchanges the code for tokens, stores the (encrypted) refresh
 * token + connected email, then redirects back to Settings. No JWT here (it's a
 * top-level browser redirect from Google) — trust comes from the signed state.
 */
import { verifyState, encryptToken } from '../_lib/mailCrypto.js'
import { getSupabaseUrl } from '../_lib/extractReceipt.js'

const back = (origin, status) => Response.redirect(`${origin}/settings?mail=${status}#set-mail`, 302)

export async function onRequestGet({ request, env }) {
  const origin = new URL(request.url).origin
  const params = new URL(request.url).searchParams
  if (params.get('error')) return back(origin, 'denied')
  const code = params.get('code')
  const stateObj = await verifyState(params.get('state'), env.MAIL_TOKEN_KEY)
  if (!code || !stateObj?.uid) return back(origin, 'error')

  try {
    const redirect_uri = env.MAIL_REDIRECT_URI || `${origin}/api/mail/callback`
    // 1) code → tokens
    const tokRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
        code, grant_type: 'authorization_code', redirect_uri,
      }),
    })
    if (!tokRes.ok) return back(origin, 'error')
    const tok = await tokRes.json()
    if (!tok.refresh_token) return back(origin, 'norefresh')   // user must re-consent for offline access

    // 2) connected email address (read-only profile)
    let email = null
    try {
      const prof = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${tok.access_token}` } })
      if (prof.ok) email = (await prof.json()).emailAddress || null
    } catch {}

    // 3) upsert the connection (service-role; refresh token encrypted at rest)
    const enc = await encryptToken(tok.refresh_token, env.MAIL_TOKEN_KEY)
    const url = getSupabaseUrl(env), key = env.SUPABASE_SERVICE_ROLE_KEY
    await fetch(`${url}/rest/v1/mail_connections?on_conflict=user_id,provider`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        user_id: stateObj.uid, org_id: stateObj.oid || null, provider: 'gmail',
        email, refresh_token_enc: enc, status: 'active', last_error: null,
      }),
    })
    return back(origin, 'connected')
  } catch {
    return back(origin, 'error')
  }
}
