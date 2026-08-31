/**
 * useMailAlerts — mailboxes whose connection has expired (client request #14).
 *
 * When a refresh token stops working, importing from that mailbox stops too —
 * silently. Receipts keep arriving by email and simply never appear in the app,
 * and the only trace was a red line inside Settings that nobody opens. This
 * surfaces it where the receipts are.
 *
 * Cheap (one request, safe fields only) and fails closed to "nothing wrong",
 * so a hiccup never produces a false alarm.
 */
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function useMailAlerts() {
  const [broken, setBroken] = useState([])

  useEffect(() => {
    let alive = true
    async function check() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) return
        const res = await fetch('/api/mail/status', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (!res.ok || !alive) return
        const json = await res.json()
        setBroken(Array.isArray(json?.needs_attention) ? json.needs_attention : [])
      } catch { /* offline or not configured → no alert */ }
    }
    check()
    window.addEventListener('mail-changed', check)
    return () => { alive = false; window.removeEventListener('mail-changed', check) }
  }, [])

  return broken
}
