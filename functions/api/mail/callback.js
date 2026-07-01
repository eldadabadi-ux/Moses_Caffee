/**
 * GET /api/mail/callback — OAuth redirect target for both providers. Validates
 * the signed `state`, exchanges the code for tokens at the provider's endpoint,
 * stores the (encrypted) refresh token + connected email, and redirects back to
 * Settings. No JWT — trust comes from the signed state.
 */
import { verifyState, encryptToken } from '../_lib/mailCrypto.js'
import { getSupabaseUrl } from '../_lib/extractReceipt.js'

const back = (origin, status) => Response.redirect(`${origin}/settings?mail=${status}#set-mail`, 302)

export async function onRequestGet({ request, env }) {
  const origin = new URL(request.url).origin
  const params = new URL(request.url).searchParams
  if (params.get('error')) return back(origin, 'denied')
  const code = params.get('code')
  const st = await verifyState(params.get('state'), env.MAIL_TOKEN_KEY)
  if (!code || !st?.uid) return back(origin, 'error')
  const provider = st.p === 'outlook' ? 'outlook' : 'gmail'
  const redirect_uri = env.MAIL_REDIRECT_URI || `${origin}/api/mail/callback`

  try {
    const body = provider === 'outlook'
      ? { client_id: env.MICROSOFT_CLIENT_ID, client_secret: env.MICROSOFT_CLIENT_SECRET, code, grant_type: 'authorization_code', redirect_uri, scope: 'https://graph.microsoft.com/Mail.Read offline_access openid email' }
      : { client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, code, grant_type: 'authorization_code', redirect_uri }
    const tokUrl = provider === 'outlook'
      ? 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
      : 'https://oauth2.googleapis.com/token'
    const tokRes = await fetch(tokUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) })
    if (!tokRes.ok) return back(origin, 'error')
    const tok = await tokRes.json()
    if (!tok.refresh_token) return back(origin, 'norefresh')

    // Connected email address
    let email = null
    try {
      if (provider === 'outlook') {
        const me = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', { headers: { Authorization: `Bearer ${tok.access_token}` } })
        if (me.ok) { const j = await me.json(); email = j.mail || j.userPrincipalName || null }
      } else {
        const prof = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${tok.access_token}` } })
        if (prof.ok) email = (await prof.json()).emailAddress || null
      }
    } catch {}

    const enc = await encryptToken(tok.refresh_token, env.MAIL_TOKEN_KEY)
    const url = getSupabaseUrl(env), key = env.SUPABASE_SERVICE_ROLE_KEY
    await fetch(`${url}/rest/v1/mail_connections?on_conflict=user_id,provider`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ user_id: st.uid, org_id: st.oid || null, provider, email, refresh_token_enc: enc, status: 'active', last_error: null }),
    })
    return back(origin, 'connected')
  } catch {
    return back(origin, 'error')
  }
}
