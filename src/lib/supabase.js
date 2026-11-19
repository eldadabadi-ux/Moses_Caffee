import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || supabaseUrl === 'https://placeholder.supabase.co') {
  throw new Error('[Security] VITE_SUPABASE_URL is not configured. Set it in .env')
}
if (!supabaseKey || supabaseKey === 'placeholder-key') {
  throw new Error('[Security] VITE_SUPABASE_ANON_KEY is not configured. Set it in .env')
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    // Passkeys (WebAuthn) — Face ID / Touch ID / Windows Hello sign-in. The API
    // is in beta at Supabase and refuses to run without this opt-in. The
    // password flow is untouched and remains the fallback (19.11.26).
    experimental: { passkey: true },
  },
})
