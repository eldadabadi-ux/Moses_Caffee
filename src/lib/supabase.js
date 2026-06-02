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
  },
})
