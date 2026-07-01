/**
 * POST /api/mail/connect?provider=gmail|outlook — start the OAuth flow for the
 * chosen mail provider. Returns the consent URL with a signed `state` (identifies
 * the user + provider) so the callback (a browser redirect, no JWT) can trust it.
 */
import { requireMember, wrapAuthErrors } from '../_lib/auth.js'
import { signState } from '../_lib/mailCrypto.js'

const PROVIDERS = {
  gmail: {
    idEnv: 'GOOGLE_CLIENT_ID',
    auth: 'https://accounts.google.com/o/oauth2/v2/auth',
    scope: 'https://www.googleapis.com/auth/gmail.readonly',
    extra: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
  },
  outlook: {
    idEnv: 'MICROSOFT_CLIENT_ID',
    auth: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    scope: 'https://graph.microsoft.com/Mail.Read offline_access openid email',
    extra: { prompt: 'consent', response_mode: 'query' },
  },
}
const redirectUri = (env, request) => env.MAIL_REDIRECT_URI || `${new URL(request.url).origin}/api/mail/callback`

export const onRequestPost = wrapAuthErrors(async ({ request, env }) => {
  const provider = new URL(request.url).searchParams.get('provider') === 'outlook' ? 'outlook' : 'gmail'
  const cfg = PROVIDERS[provider]
  if (!env[cfg.idEnv] || !env.MAIL_TOKEN_KEY) {
    return Response.json({ error: `אינטגרציית ${provider === 'outlook' ? 'Outlook' : 'Gmail'} לא מוגדרת בשרת` }, { status: 500 })
  }
  const user = await requireMember(request, env)
  const state = await signState({ uid: user.user_id, oid: user.org_id || null, p: provider }, env.MAIL_TOKEN_KEY)
  const url = cfg.auth + '?' + new URLSearchParams({
    client_id: env[cfg.idEnv], redirect_uri: redirectUri(env, request),
    response_type: 'code', scope: cfg.scope, state, ...cfg.extra,
  })
  return Response.json({ url, provider })
})
