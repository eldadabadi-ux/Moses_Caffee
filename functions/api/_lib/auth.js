/**
 * functions/api/_lib/auth.js — minimal auth helpers.
 * Only requireUser() is needed — single-user app, no roles or tenants.
 */

// Public values (also present in the frontend bundle) — safe to hardcode as a
// fallback so auth keeps working even if the Function's runtime env vars are
// missing. Override via env.VITE_SUPABASE_URL / env.VITE_SUPABASE_ANON_KEY.
const FALLBACK_SUPABASE_URL = 'https://dsoucojqjrodxozcbicf.supabase.co'
const FALLBACK_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRzb3Vjb2pxanJvZHhvemNiaWNmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2MTQ4MjQsImV4cCI6MjA5NjE5MDgyNH0.4jgRiQ7GM-3maBmbipNtp66dtVva84HGCrNUhviezcg'

class AuthError extends Error {
  constructor(message, status, code) {
    super(message)
    this.status = status
    this.code = code
  }
}

export async function verifyJWT(request, env) {
  const auth = request.headers.get('Authorization') || request.headers.get('authorization')
  if (!auth) return null
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim())
  if (!m) throw new AuthError('Malformed Authorization header', 401, 'bad_token')

  const accessToken = m[1]
  const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || FALLBACK_SUPABASE_URL
  const apiKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY || FALLBACK_ANON_KEY
  if (!apiKey) throw new AuthError('Auth verification unavailable on server', 500, 'server_config')

  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: apiKey, Authorization: `Bearer ${accessToken}` },
  })
  if (res.status === 401 || res.status === 403) throw new AuthError('Invalid or expired token', 401, 'invalid_token')
  if (!res.ok) throw new AuthError('Auth verification failed', 502, 'upstream_auth_error')
  const u = await res.json()
  if (!u?.id) throw new AuthError('Empty user response', 401, 'invalid_token')

  return { user_id: u.id, email: (u.email || '').toLowerCase() }
}

export async function requireUser(request, env) {
  const user = await verifyJWT(request, env)
  if (!user) throw new AuthError('Authentication required', 401, 'unauthenticated')
  return user
}

export function wrapAuthErrors(handler) {
  return async (context) => {
    try {
      return await handler(context)
    } catch (err) {
      if (err instanceof AuthError) {
        return Response.json({ error: err.code, message: err.message }, { status: err.status })
      }
      throw err
    }
  }
}

export { AuthError }
