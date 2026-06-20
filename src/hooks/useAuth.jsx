import { useState, useEffect, createContext, useContext } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(undefined) // undefined = loading
  const [session, setSession] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  // Change the password of the currently signed-in user.
  async function updatePassword(newPassword) {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) throw error
  }

  // Send a "forgot password" reset email. The link returns the user to
  // /reset-password where ResetPasswordPage establishes the session and lets
  // them set a new password.
  async function requestPasswordReset(email) {
    const redirectTo = `${window.location.origin}/reset-password`
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
    if (error) throw error
  }

  // GDPR / right-to-erasure. The anon client cannot delete an auth user, so a
  // server Function (service-role) purges all of the user's data + storage and
  // then deletes the auth user. Afterwards we sign out locally.
  async function deleteAccount() {
    const { data: { session: fresh } } = await supabase.auth.getSession()
    const token = fresh?.access_token
    if (!token) throw new Error('לא מחובר')
    const res = await fetch('/api/account/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    })
    let body = {}
    try { body = await res.json() } catch {}
    if (!res.ok) throw new Error(body?.message || body?.error || 'מחיקת החשבון נכשלה')
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{
      user, session,
      signIn, signOut,
      updatePassword, requestPasswordReset, deleteAccount,
      loading: user === undefined,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
