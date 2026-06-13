/**
 * AIChatWidget — floating AI assistant for the receipts app.
 * Desktop: draggable + height-resizable card. Mobile: full-screen panel.
 * Adapted from the CRM bot (brand-blue, single-user, no tenant/memory panel).
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { MessageCircle, Minus, Trash2, Send, Loader2, Sparkles, X } from 'lucide-react'
import { useAIContext } from '../hooks/useAIContext'
import { useAIChat } from '../hooks/useAIChat'

const DESKTOP_W = 360
const DESKTOP_MIN_H = 220
const DESKTOP_DEF_H = 520
const BRAND = 'linear-gradient(135deg,#2563eb,#1d4ed8)'
const BOT_NAME = 'העוזר החכם'

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'בוקר טוב'
  if (h < 17) return 'צהריים טובים'
  return 'ערב טוב'
}
const LAST_GREETING_KEY = 'rcpt_ai_last_greeting'
function shouldShowGreeting() {
  try { const last = localStorage.getItem(LAST_GREETING_KEY); if (!last) return true; return new Date().toDateString() !== new Date(last).toDateString() } catch { return true }
}
function markGreetingSeen() { try { localStorage.setItem(LAST_GREETING_KEY, new Date().toISOString()) } catch {} }

function TypingIndicator() {
  return (
    <div style={{ display: 'flex', gap: '4px', alignItems: 'center', padding: '10px 14px', background: '#f1f5f9', borderRadius: '16px 16px 16px 4px', width: 'fit-content' }}>
      {[0, 1, 2].map(i => <span key={i} style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#94a3b8', animation: `ai-dot-bounce 1.2s ${i * 0.2}s ease-in-out infinite` }} />)}
    </div>
  )
}

function Bubble({ msg }) {
  const isUser = msg.role === 'user'
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-start' : 'flex-end', marginBottom: '6px' }}>
      <div style={{
        maxWidth: '82%', padding: '9px 13px',
        borderRadius: isUser ? '16px 16px 16px 4px' : '16px 16px 4px 16px',
        background: isUser ? '#f1f5f9' : '#2563eb', color: isUser ? '#1e293b' : '#fff',
        fontSize: '15px', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>{msg.content}</div>
    </div>
  )
}

export default function AIChatWidget() {
  const aiCtx = useAIContext()
  const { messages, loading, error, sendMessage, clearChat } = useAIChat()

  const [open, setOpen] = useState(false)
  const [showGreeting, setShowGreeting] = useState(false)
  const [input, setInput] = useState('')
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640)

  const [vvTop, setVvTop] = useState(0)
  const [vvHeight, setVvHeight] = useState(() => window.visualViewport?.height ?? window.innerHeight)

  const [dPos, setDPos] = useState(null)
  const [dH, setDH] = useState(DESKTOP_DEF_H)
  const dPosRef = useRef(dPos)
  const dHRef = useRef(dH)
  useEffect(() => { dPosRef.current = dPos }, [dPos])
  useEffect(() => { dHRef.current = dH }, [dH])

  const dragRef = useRef({ active: false, startMX: 0, startMY: 0, startX: 0, startY: 0 })
  const resizeRef = useRef({ active: false, startMY: 0, startH: 0 })
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 640)
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const sync = () => { setVvTop(Math.round(vv.offsetTop)); setVvHeight(Math.round(vv.height)) }
    sync()
    vv.addEventListener('resize', sync); vv.addEventListener('scroll', sync)
    return () => { vv.removeEventListener('resize', sync); vv.removeEventListener('scroll', sync) }
  }, [])

  useEffect(() => {
    if (isMobile) return
    function onMouseMove(e) {
      if (dragRef.current.active) {
        const { startMX, startMY, startX, startY } = dragRef.current
        const maxX = window.innerWidth - DESKTOP_W
        const maxY = window.innerHeight - dHRef.current
        const nx = Math.max(0, Math.min(startX + (e.clientX - startMX), maxX))
        const ny = Math.max(0, Math.min(startY + (e.clientY - startMY), maxY))
        dPosRef.current = { x: nx, y: ny }; setDPos({ x: nx, y: ny })
      }
      if (resizeRef.current.active) {
        const { startMY, startH } = resizeRef.current
        const dy = e.clientY - startMY
        const posY = dPosRef.current?.y ?? (window.innerHeight - dHRef.current - 130)
        const maxH = window.innerHeight - posY - 10
        const nh = Math.max(DESKTOP_MIN_H, Math.min(startH + dy, maxH))
        dHRef.current = nh; setDH(nh)
      }
    }
    function onMouseUp() { dragRef.current.active = false; resizeRef.current.active = false; document.body.style.userSelect = ''; document.body.style.cursor = '' }
    window.addEventListener('mousemove', onMouseMove); window.addEventListener('mouseup', onMouseUp)
    return () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp) }
  }, [isMobile])

  function startDrag(e) {
    if (isMobile || e.button !== 0) return
    e.preventDefault()
    const pos = dPosRef.current ?? { x: window.innerWidth - DESKTOP_W - 16, y: window.innerHeight - dHRef.current - 130 }
    dragRef.current = { active: true, startMX: e.clientX, startMY: e.clientY, startX: pos.x, startY: pos.y }
    document.body.style.userSelect = 'none'; document.body.style.cursor = 'grabbing'
  }
  function startResize(e) {
    if (isMobile || e.button !== 0) return
    e.preventDefault()
    resizeRef.current = { active: true, startMY: e.clientY, startH: dHRef.current }
    document.body.style.userSelect = 'none'; document.body.style.cursor = 'ns-resize'
  }

  const handleOpen = useCallback(() => {
    setOpen(true)
    if (shouldShowGreeting()) { setShowGreeting(true); markGreetingSeen(); setTimeout(() => setShowGreeting(false), 3000) }
  }, [])

  useEffect(() => { if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading, open])
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 100) }, [open])

  async function handleSend() {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    await sendMessage(text, { screen: aiCtx.screen, path: aiCtx.path })
  }
  async function handleDailySummary() {
    await sendMessage('תן לי סיכום קצר: כמה הוצאתי החודש, על מה הכי הרבה, והמלצה אחת לחיסכון.', { screen: aiCtx.screen, path: aiCtx.path })
  }

  const mobileCardStyle = { position: 'fixed', top: vvTop, left: 0, right: 0, height: vvHeight, borderRadius: 0, background: '#fff', boxShadow: 'none', zIndex: 99999, display: 'grid', gridTemplateRows: 'auto 1fr auto', overflow: 'hidden', direction: 'rtl' }
  const desktopCardStyle = dPos
    ? { position: 'fixed', top: dPos.y, left: dPos.x, width: DESKTOP_W, height: dH, borderRadius: '20px', background: '#fff', boxShadow: '0 12px 40px rgba(0,0,0,0.18)', zIndex: 9999, display: 'grid', gridTemplateRows: 'auto 1fr auto 8px', overflow: 'hidden', direction: 'rtl' }
    : { position: 'fixed', bottom: '130px', right: '16px', width: DESKTOP_W, height: dH, borderRadius: '20px', background: '#fff', boxShadow: '0 12px 40px rgba(0,0,0,0.18)', zIndex: 9999, display: 'grid', gridTemplateRows: 'auto 1fr auto 8px', overflow: 'hidden', direction: 'rtl', animation: 'ai-widget-in 220ms ease' }

  return createPortal(
    <>
      <style>{`
        @keyframes ai-dot-bounce { 0%,80%,100% { transform:translateY(0); opacity:0.4; } 40% { transform:translateY(-5px); opacity:1; } }
        @keyframes ai-widget-in { from { opacity:0; transform:translateY(12px) scale(0.96); } to { opacity:1; transform:translateY(0) scale(1); } }
      `}</style>

      {!open && (
        <button onClick={handleOpen} aria-label="פתח עוזר חכם"
          style={{ position: 'fixed', bottom: isMobile ? '80px' : '130px', right: '16px', width: '52px', height: '52px', borderRadius: '50%', background: BRAND, border: 'none', cursor: 'pointer', display: 'grid', placeItems: 'center', boxShadow: '0 4px 14px rgba(37,99,235,0.45)', zIndex: 99999, transition: 'transform 150ms ease, box-shadow 150ms ease' }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.08)'; e.currentTarget.style.boxShadow = '0 6px 18px rgba(37,99,235,0.55)' }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 14px rgba(37,99,235,0.45)' }}>
          <MessageCircle size={23} color="#fff" />
        </button>
      )}

      {open && (
        <div style={isMobile ? mobileCardStyle : desktopCardStyle}>
          {/* Header */}
          <div onMouseDown={!isMobile ? startDrag : undefined}
            style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: isMobile ? '14px 16px' : '12px 14px', paddingTop: isMobile ? 'max(14px, env(safe-area-inset-top))' : '12px', background: BRAND, color: '#fff', cursor: isMobile ? 'default' : 'grab', userSelect: 'none' }}>
            <MessageCircle size={18} />
            <span style={{ fontWeight: 700, fontSize: '15px', flex: 1 }}>{BOT_NAME}</span>
            <button onMouseDown={e => e.stopPropagation()} onClick={handleDailySummary} disabled={loading} title="סיכום יומי"
              style={{ background: 'rgba(255,255,255,0.2)', border: 'none', cursor: 'pointer', borderRadius: '8px', padding: '4px 8px', color: '#fff', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', opacity: loading ? 0.5 : 1 }}>
              <Sparkles size={12} /><span>סיכום יומי</span>
            </button>
            <button onMouseDown={e => e.stopPropagation()} onClick={() => { if (messages.length) clearChat() }} title="נקה שיחה"
              style={{ background: 'rgba(255,255,255,0.15)', border: 'none', cursor: 'pointer', borderRadius: '8px', padding: '6px', color: '#fff', display: 'grid', placeItems: 'center' }}>
              <Trash2 size={16} />
            </button>
            <button onMouseDown={e => e.stopPropagation()} onClick={() => setOpen(false)} title="סגור"
              style={{ background: 'rgba(255,255,255,0.15)', border: 'none', cursor: 'pointer', borderRadius: '8px', padding: '6px', color: '#fff', display: 'grid', placeItems: 'center' }}>
              {isMobile ? <X size={18} /> : <Minus size={16} />}
            </button>
          </div>

          {/* Greeting overlay */}
          {showGreeting && (
            <div style={{ position: 'absolute', inset: 0, zIndex: 10, background: 'rgba(37,99,235,0.94)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', color: '#fff' }}>
              <Sparkles size={32} />
              <p style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>{getGreeting()}! 👋</p>
              <p style={{ fontSize: '13px', opacity: 0.85, margin: 0 }}>אני {BOT_NAME}, כאן לעזור לך</p>
            </div>
          )}

          {/* Messages */}
          <div style={{ overflowY: 'auto', overscrollBehavior: 'contain', padding: '12px 14px', display: 'flex', flexDirection: 'column', background: isMobile ? '#f0f2f5' : '#fff', minHeight: 0 }}>
            {messages.length === 0 && !loading && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '6px' }}>
                <div style={{ maxWidth: '82%', padding: '9px 13px', borderRadius: '16px 16px 4px 16px', background: '#2563eb', color: '#fff', fontSize: '15px', lineHeight: 1.6 }}>
                  שלום משה, במה אוכל לעזור? אפשר לשאול על הוצאות, ספקים, מחירים והמלצות.
                </div>
              </div>
            )}
            {messages.map((m, i) => <Bubble key={i} msg={m} />)}
            {loading && <div style={{ display: 'flex', justifyContent: 'flex-end' }}><TypingIndicator /></div>}
            {error && <div style={{ color: '#dc2626', fontSize: '12px', textAlign: 'center', padding: '4px' }}>שגיאה: {error}</div>}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{ borderTop: '1px solid #e2e8f0', padding: '10px 12px', paddingBottom: isMobile ? 'max(10px, env(safe-area-inset-bottom))' : '10px', display: 'flex', gap: '8px', alignItems: 'flex-end', background: '#fff' }}>
            <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              placeholder="כתוב הודעה..." rows={1}
              style={{ flex: 1, resize: 'none', border: '1px solid #e2e8f0', borderRadius: '22px', padding: '10px 14px', fontSize: '15px', outline: 'none', fontFamily: 'inherit', direction: 'rtl', lineHeight: 1.5, maxHeight: '100px', overflowY: 'auto', background: '#f0f2f5' }} />
            <button onClick={handleSend} disabled={!input.trim() || loading}
              style={{ flexShrink: 0, width: '42px', height: '42px', borderRadius: '50%', background: input.trim() && !loading ? '#2563eb' : '#e2e8f0', border: 'none', cursor: input.trim() && !loading ? 'pointer' : 'default', display: 'grid', placeItems: 'center', color: '#fff', transition: 'background 150ms ease' }}>
              {loading ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={16} style={{ transform: 'scaleX(-1)' }} />}
            </button>
          </div>

          {/* Resize handle (desktop) */}
          {!isMobile && (
            <div onMouseDown={startResize} title="גרור לשינוי גובה"
              style={{ cursor: 'ns-resize', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', borderTop: '1px solid #e2e8f0', flexShrink: 0 }}>
              <div style={{ display: 'flex', gap: '4px' }}>{[0, 1, 2].map(i => <div key={i} style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#94a3b8' }} />)}</div>
            </div>
          )}
        </div>
      )}
    </>,
    document.body
  )
}
