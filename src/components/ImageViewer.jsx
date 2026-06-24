import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'

/**
 * ImageViewer — a FLOATING (windowed, not full-screen) image viewer with zoom:
 *   • Desktop: mouse wheel zooms toward the cursor + on-screen +/−/reset buttons.
 *   • Mobile:  two-finger pinch to zoom, one-finger drag to pan.
 *   • Double-click / double-tap toggles 1× ⇄ 2×.
 * Used for opening receipt images.
 */
const MIN = 1, MAX = 6
const clamp = (s) => Math.min(MAX, Math.max(MIN, s))

export default function ImageViewer({ src, alt = 'תמונה', onClose }) {
  const [scale, setScale] = useState(1)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)
  const viewportRef = useRef(null)
  const dragRef  = useRef(null)   // panning (mouse / 1-finger)
  const pinchRef = useRef(null)   // pinch (2-finger)
  const interacting = useRef(false)

  const reset = useCallback(() => { setScale(1); setTx(0); setTy(0) }, [])
  const zoomBy = (f) => setScale(s => { const n = clamp(s * f); if (n === 1) { setTx(0); setTy(0) } return n })

  // Esc closes; lock background scroll while open.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])

  // Wheel zoom (toward cursor) — native non-passive listener so preventDefault works.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const cx = e.clientX - rect.left - rect.width / 2
      const cy = e.clientY - rect.top - rect.height / 2
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      setScale(prev => {
        const next = clamp(prev * factor)
        if (next === prev) return prev
        const ratio = next / prev
        if (next === 1) { setTx(0); setTy(0) }
        else { setTx(t => (t - cx) * ratio + cx); setTy(t => (t - cy) * ratio + cy) }
        return next
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ── Mouse pan ──
  const onMouseDown = (e) => { if (scale <= 1) return; dragRef.current = { x: e.clientX, y: e.clientY, tx, ty }; interacting.current = true }
  const onMouseMove = (e) => { if (!dragRef.current) return; setTx(dragRef.current.tx + (e.clientX - dragRef.current.x)); setTy(dragRef.current.ty + (e.clientY - dragRef.current.y)) }
  const endMouse = () => { dragRef.current = null; interacting.current = false }

  // ── Touch pinch + pan ── (touchAction:none on the viewport prevents native zoom)
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
  const onTouchStart = (e) => {
    interacting.current = true
    if (e.touches.length === 2) { pinchRef.current = { d: dist(e.touches), s: scale }; dragRef.current = null }
    else if (e.touches.length === 1 && scale > 1) { dragRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, tx, ty } }
  }
  const onTouchMove = (e) => {
    if (e.touches.length === 2 && pinchRef.current) {
      setScale(clamp(pinchRef.current.s * (dist(e.touches) / pinchRef.current.d)))
    } else if (e.touches.length === 1 && dragRef.current) {
      setTx(dragRef.current.tx + (e.touches[0].clientX - dragRef.current.x))
      setTy(dragRef.current.ty + (e.touches[0].clientY - dragRef.current.y))
    }
  }
  const onTouchEnd = (e) => {
    if (e.touches.length < 2) pinchRef.current = null
    if (e.touches.length === 0) { dragRef.current = null; interacting.current = false; if (scale <= 1.02) reset() }
  }

  const btn = { width:34, height:34, display:'flex', alignItems:'center', justifyContent:'center', background:'transparent', border:'none', borderRadius:8, cursor:'pointer', color:'var(--text-mute)', fontFamily:'var(--font-main)' }
  const hov = (e, on) => { e.currentTarget.style.background = on ? 'var(--panel-2)' : 'transparent' }

  return createPortal(
    <div onClick={onClose} style={{ position:'fixed', inset:0, zIndex:1100, display:'flex', alignItems:'center', justifyContent:'center', padding:'16px', background:'rgba(0,0,0,0.6)', backdropFilter:'blur(4px)' }}>
      {/* Floating window (does not fill the screen) */}
      <div onClick={e => e.stopPropagation()} dir="rtl"
        style={{ position:'relative', display:'flex', flexDirection:'column', width:'min(92vw, 680px)', height:'min(88dvh, 920px)', background:'var(--panel)', borderRadius:16, boxShadow:'var(--shadow-modal)', overflow:'hidden' }}>
        {/* Toolbar */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 12px', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:4 }}>
            <button onClick={() => zoomBy(1/1.3)} title="הקטן" style={btn} onMouseEnter={e=>hov(e,1)} onMouseLeave={e=>hov(e,0)}><ZoomOut size={18} /></button>
            <button onClick={() => zoomBy(1.3)} title="הגדל" style={btn} onMouseEnter={e=>hov(e,1)} onMouseLeave={e=>hov(e,0)}><ZoomIn size={18} /></button>
            <button onClick={reset} title="איפוס" style={btn} onMouseEnter={e=>hov(e,1)} onMouseLeave={e=>hov(e,0)}><Maximize2 size={16} /></button>
            <span style={{ fontSize:12.5, color:'var(--text-mute)', fontFamily:'var(--font-main)', minWidth:42, textAlign:'center' }}>{Math.round(scale*100)}%</span>
          </div>
          <button onClick={onClose} title="סגור" style={btn} onMouseEnter={e=>hov(e,1)} onMouseLeave={e=>hov(e,0)}><X size={18} /></button>
        </div>
        {/* Viewport */}
        <div ref={viewportRef}
          onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={endMouse} onMouseLeave={endMouse}
          onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
          onDoubleClick={() => (scale > 1 ? reset() : zoomBy(2))}
          style={{ flex:1, overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--panel-2)', touchAction:'none', cursor: scale > 1 ? 'grab' : 'zoom-in' }}>
          <img src={src} alt={alt} draggable={false}
            style={{ maxWidth:'100%', maxHeight:'100%', objectFit:'contain', transform:`translate(${tx}px, ${ty}px) scale(${scale})`, transformOrigin:'center center', transition: interacting.current ? 'none' : 'transform 120ms ease', userSelect:'none', willChange:'transform' }} />
        </div>
        <div style={{ padding:'6px 12px', borderTop:'1px solid var(--border)', flexShrink:0, fontSize:11.5, color:'var(--text-mute)', fontFamily:'var(--font-main)', textAlign:'center' }}>
          גלגלת או הכפתורים להגדלה · במגע — צביטה באצבעות · גרירה להזזה
        </div>
      </div>
    </div>,
    document.body
  )
}
