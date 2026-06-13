/**
 * useAIChat — chat message state + calls /api/chat (single-user, no tenant).
 */
import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export function useAIChat() {
  const [messages, setMessages] = useState([])   // [{ role, content, ts }]
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)

  const sendMessage = useCallback(async (text, aiContext = {}) => {
    if (!text.trim() || loading) return
    const userMsg = { role: 'user', content: text.trim(), ts: new Date().toISOString() }
    const next = [...messages, userMsg]
    setMessages(next)
    setLoading(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('נדרשת כניסה מחדש')

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: next.map(m => ({ role: m.role, content: m.content })), context: aiContext }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        const msg = err?.error || `שגיאת שרת ${res.status}`
        throw new Error(err?.detail ? `${msg} (${err.detail})` : msg)
      }
      const { reply } = await res.json()
      setMessages(prev => [...prev, { role: 'assistant', content: reply, ts: new Date().toISOString() }])
    } catch (err) {
      setError(err.message || 'שגיאה לא ידועה')
    } finally {
      setLoading(false)
    }
  }, [messages, loading])

  const clearChat = useCallback(() => { setMessages([]); setError(null) }, [])

  return { messages, loading, error, sendMessage, clearChat }
}
