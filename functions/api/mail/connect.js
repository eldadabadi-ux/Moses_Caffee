/**
 * POST /api/mail/connect — start the Gmail OAuth flow. Returns the Google
 * consent URL with a signed `state` that identifies the user, so the callback
 * (a browser redirect from Google, no JWT) can trust who is connecting.
 */
import { requireMember, wrapAuthErrors } from '../_lib/auth.js'
import { signState } from '../_lib/mailCrypto.js'

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'

function redirectUri(env, request) {
  return env.MAIL_REDIRECT_URI || `${new URL(request.url).origin}/api/mail/callback`
}

export const onRequestPost = wrapAuthErrors(async ({ request, env }) => {
  if (!env.GOOGLE_CLIENT_ID || !env.MAIL_TOKEN_KEY) {
    return Response.json({ error: 'Gmail integration not configured on the server' }, { status: 500 })
  }
  const user = await requireMember(request, env)
  const state = await signState({ uid: user.user_id, oid: user.org_id || null }, env.MAIL_TOKEN_KEY)

  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(env, request),
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return Response.json({ url })
})
