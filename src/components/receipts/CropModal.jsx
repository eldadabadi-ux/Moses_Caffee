/**
 * CropModal — straighten and crop a captured page before it is scanned.
 *
 * Extracted from ReceiptsPage (audit M2). Pure overlay: takes a source image,
 * hands back a cropped data URL.
 */
import { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'

// ── CropModal ─────────────────────────────────────────────────────────────────
export default function CropModal({ src, onConfirm, onCancel }) {
  const imgRef = useRef(null)
  const [nat,  setNat]  = useState(null)
  const [vw,   setVw]   = useState(() => window.innerWidth)
  const [vh,   setVh]   = useState(() => window.innerHeight)
  const [safeBot, setSafeBot] = useState(0)
  const [crop, setCrop] = useState({ x: 0, y: 0, w: 1, h: 1 })
  const dragRef = useRef(null), dispRef = useRef(null), cropRef = useRef(crop)
  useEffect(() => { cropRef.current = crop }, [crop])

  const TOP_H = 48, BOT_H = 76, MIN_PX = 40

  useEffect(() => {
    const pb = document.body.style.overflow, ph = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'; document.documentElement.style.overflow = 'hidden'
    return () => { document.body.style.overflow = pb; document.documentElement.style.overflow = ph }
  }, [])

  useEffect(() => {
    function measure() {
      setVw(window.innerWidth); setVh(window.innerHeight)
      const tmp = document.createElement('div')
      tmp.style.cssText = 'position:fixed;bottom:0;left:0;width:1px;height:env(safe-area-inset-bottom,0px);pointer-events:none;visibility:hidden'
      document.body.appendChild(tmp); setSafeBot(tmp.offsetHeight || 0); document.body.removeChild(tmp)
    }
    measure(); window.addEventListener('resize', measure); window.addEventListener('orientationchange', measure)
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('orientationchange', measure) }
  }, [])

  const totalBot = BOT_H + safeBot
  const disp = useMemo(() => {
    if (!nat) return null
    const availW = vw, availH = vh - TOP_H - totalBot
    const scale = Math.min(availW / nat.w, availH / nat.h)
    const imgW = Math.floor(nat.w * scale), imgH = Math.floor(nat.h * scale)
    return { x: Math.floor((availW - imgW) / 2), y: TOP_H + Math.floor((availH - imgH) / 2), w: imgW, h: imgH }
  }, [nat, vw, vh, totalBot])
  useEffect(() => { dispRef.current = disp }, [disp])

  useEffect(() => {
    function getPoint(ev) { const t = ev.touches?.[0] ?? ev.changedTouches?.[0] ?? ev; return { x: t.clientX, y: t.clientY } }
    function onMove(ev) {
      const d = dragRef.current, disp = dispRef.current; if (!d || !disp) return
      ev.preventDefault()
      const { x: px, y: py } = getPoint(ev)
      const W = disp.w, H = disp.h, dx = (px - d.sx) / W, dy = (py - d.sy) / H
      const c = d.crop, minW = MIN_PX / W, minH = MIN_PX / H
      let n = { ...c }
      if      (d.type === 'move')   { n = { ...c, x: c.x + dx, y: c.y + dy } }
      else if (d.type === 'br')     { n = { ...c, w: Math.max(minW, c.w + dx), h: Math.max(minH, c.h + dy) } }
      else if (d.type === 'bl')     { const nw = Math.max(minW, c.w - dx); n = { x: c.x + c.w - nw, y: c.y, w: nw, h: Math.max(minH, c.h + dy) } }
      else if (d.type === 'tr')     { const nh = Math.max(minH, c.h - dy); n = { x: c.x, y: c.y + c.h - nh, w: Math.max(minW, c.w + dx), h: nh } }
      else if (d.type === 'tl')     { const nw = Math.max(minW, c.w - dx), nh = Math.max(minH, c.h - dy); n = { x: c.x + c.w - nw, y: c.y + c.h - nh, w: nw, h: nh } }
      else if (d.type === 'top')    { const nh = Math.max(minH, c.h - dy); n = { ...c, y: c.y + c.h - nh, h: nh } }
      else if (d.type === 'bottom') { n = { ...c, h: Math.max(minH, c.h + dy) } }
      else if (d.type === 'left')   { const nw = Math.max(minW, c.w - dx); n = { ...c, x: c.x + c.w - nw, w: nw } }
      else if (d.type === 'right')  { n = { ...c, w: Math.max(minW, c.w + dx) } }
      const fw = Math.max(minW, Math.min(n.w, 1)), fh = Math.max(minH, Math.min(n.h, 1))
      setCrop({ x: Math.max(0, Math.min(n.x, 1 - fw)), y: Math.max(0, Math.min(n.y, 1 - fh)), w: fw, h: fh })
    }
    function onUp() { dragRef.current = null }
    window.addEventListener('pointermove', onMove, { passive: false }); window.addEventListener('pointerup', onUp)
    window.addEventListener('touchmove', onMove, { passive: false }); window.addEventListener('touchend', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp)
      window.removeEventListener('touchmove', onMove); window.removeEventListener('touchend', onUp)
    }
  }, [])

  function startDrag(ev, type) {
    ev.preventDefault(); ev.stopPropagation()
    const pt = ev.touches?.[0] ?? ev
    dragRef.current = { type, sx: pt.clientX, sy: pt.clientY, crop: { ...cropRef.current } }
  }
  async function confirmCrop() {
    const img = imgRef.current; if (!img) return
    const { x, y, w, h } = crop
    const sx = Math.max(0, Math.round(x * img.naturalWidth)), sy = Math.max(0, Math.round(y * img.naturalHeight))
    const sw = Math.max(1, Math.min(img.naturalWidth - sx, Math.round(w * img.naturalWidth)))
    const sh = Math.max(1, Math.min(img.naturalHeight - sy, Math.round(h * img.naturalHeight)))
    const canvas = document.createElement('canvas'); canvas.width = sw; canvas.height = sh
    canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
    onConfirm(canvas.toDataURL('image/jpeg', 0.9), 'image/jpeg')
  }

  function Handle({ corner }) {
    if (!disp) return null
    const { x, y, w, h } = crop, isR = corner === 'tr' || corner === 'br', isB = corner === 'bl' || corner === 'br'
    const hx = disp.x + (isR ? (x + w) : x) * disp.w, hy = disp.y + (isB ? (y + h) : y) * disp.h
    const HIT = 72, BAR = 38, THK = 5
    return (
      <div onPointerDown={ev => startDrag(ev, corner)} onTouchStart={ev => startDrag(ev, corner)}
        style={{ position: 'fixed', left: hx - HIT/2, top: hy - HIT/2, width: HIT, height: HIT, zIndex: 10005, touchAction: 'none', cursor: (corner==='tl'||corner==='br') ? 'nwse-resize' : 'nesw-resize' }}>
        <div style={{ position: 'absolute', background: '#fff', height: THK, width: BAR, borderRadius: 3, top: isB ? HIT-THK : 0, left: isR ? HIT-BAR : 0 }}/>
        <div style={{ position: 'absolute', background: '#fff', width: THK, height: BAR, borderRadius: 3, top: isB ? HIT-BAR : 0, left: isR ? HIT-THK : 0 }}/>
      </div>
    )
  }
  function EdgeHandle({ edge }) {
    if (!disp) return null
    const { x, y, w, h } = crop
    const lx = disp.x + x * disp.w, ly = disp.y + y * disp.h, rw = w * disp.w, rh = h * disp.h
    const HIT = 44, CORNER = 56
    let s = {}
    if (edge === 'top')    s = { left: lx + CORNER/2, top: ly - HIT/2,        width: rw - CORNER, height: HIT, cursor: 'ns-resize' }
    if (edge === 'bottom') s = { left: lx + CORNER/2, top: ly + rh - HIT/2,   width: rw - CORNER, height: HIT, cursor: 'ns-resize' }
    if (edge === 'left')   s = { left: lx - HIT/2,    top: ly + CORNER/2,     width: HIT, height: rh - CORNER, cursor: 'ew-resize' }
    if (edge === 'right')  s = { left: lx + rw - HIT/2, top: ly + CORNER/2,   width: HIT, height: rh - CORNER, cursor: 'ew-resize' }
    return <div onPointerDown={ev => startDrag(ev, edge)} onTouchStart={ev => startDrag(ev, edge)} style={{ position: 'fixed', zIndex: 10004, touchAction: 'none', ...s }} />
  }

  const { x, y, w, h } = crop
  const cx = disp ? disp.x + x * disp.w : 0, cy = disp ? disp.y + y * disp.h : 0
  const cw = disp ? w * disp.w : 0, ch = disp ? h * disp.h : 0

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 99990, fontFamily: 'var(--font-main)' }}>
      <div style={{ position: 'absolute', inset: 0, background: '#111', touchAction: 'none' }}/>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: TOP_H, background: '#000', borderBottom: '1px solid rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
        <span style={{ color: '#fff', fontWeight: 700, fontSize: '15px' }}>חיתוך תמונה</span>
      </div>
      <img ref={imgRef} src={src} alt="קבלה" onLoad={() => { const i = imgRef.current; if (i) setNat({ w: i.naturalWidth, h: i.naturalHeight }) }}
        style={{ position: 'absolute', zIndex: 1, display: 'block', pointerEvents: 'none', userSelect: 'none', top: disp ? disp.y : '50%', left: disp ? disp.x : '50%', width: disp ? disp.w : 1, height: disp ? disp.h : 1, opacity: disp ? 1 : 0 }} />
      {!nat && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 3, color: 'rgba(255,255,255,0.7)', fontSize: '15px' }}>טוען תמונה…</div>}
      {disp && nat && (<>
        {cy > disp.y+1            && <div style={{ position: 'absolute', top: disp.y, left: disp.x, width: disp.w, height: cy-disp.y, zIndex: 2, background: 'rgba(0,0,0,0.6)', pointerEvents: 'none' }}/>}
        {cy+ch < disp.y+disp.h-1  && <div style={{ position: 'absolute', top: cy+ch, left: disp.x, width: disp.w, height: (disp.y+disp.h)-(cy+ch), zIndex: 2, background: 'rgba(0,0,0,0.6)', pointerEvents: 'none' }}/>}
        {cx > disp.x+1            && <div style={{ position: 'absolute', top: cy, left: disp.x, width: cx-disp.x, height: ch, zIndex: 2, background: 'rgba(0,0,0,0.6)', pointerEvents: 'none' }}/>}
        {cx+cw < disp.x+disp.w-1  && <div style={{ position: 'absolute', top: cy, left: cx+cw, width: (disp.x+disp.w)-(cx+cw), height: ch, zIndex: 2, background: 'rgba(0,0,0,0.6)', pointerEvents: 'none' }}/>}
      </>)}
      {disp && nat && (
        <div onPointerDown={ev => startDrag(ev, 'move')} onTouchStart={ev => startDrag(ev, 'move')}
          style={{ position: 'absolute', top: cy, left: cx, width: cw, height: ch, zIndex: 3, border: '2.5px solid rgba(255,255,255,0.9)', boxSizing: 'border-box', cursor: 'move', touchAction: 'none' }}>
          {[33.3, 66.6].map(p => <div key={`h${p}`} style={{ position: 'absolute', top: `${p}%`, left: 0, right: 0, borderTop: '1px solid rgba(255,255,255,0.2)', pointerEvents: 'none' }}/>)}
          {[33.3, 66.6].map(p => <div key={`v${p}`} style={{ position: 'absolute', left: `${p}%`, top: 0, bottom: 0, borderLeft: '1px solid rgba(255,255,255,0.2)', pointerEvents: 'none' }}/>)}
        </div>
      )}
      {disp && nat && ['top','bottom','left','right'].map(e => <EdgeHandle key={e} edge={e}/>)}
      {disp && nat && ['tl','tr','bl','br'].map(c => <Handle key={c} corner={c}/>)}
      <div dir="rtl" style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10,
        background: '#000', borderTop: '1px solid rgba(255,255,255,0.15)',
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '10px 12px',
        paddingBottom: safeBot > 0 ? `${safeBot + 10}px` : '14px',
      }}>
        <button onClick={onCancel} style={{ flex: 1, height: 50, borderRadius: '12px', border: '1.5px solid rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.08)', color: '#fff', fontSize: '14px', fontWeight: 600, cursor: 'pointer', touchAction: 'manipulation' }}>ביטול</button>
        <button onClick={() => setCrop({ x:0, y:0, w:1, h:1 })} disabled={!nat} style={{ flex: 1.5, height: 50, borderRadius: '12px', border: '1.5px solid rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.08)', color: '#cce', fontSize: '14px', fontWeight: 600, cursor: nat ? 'pointer' : 'default', touchAction: 'manipulation', opacity: nat ? 1 : 0.4 }}>מצב קודם</button>
        <button onClick={confirmCrop} disabled={!nat} style={{ flex: 2, height: 50, borderRadius: '12px', border: 'none', background: nat ? '#2563eb' : '#444', color: '#fff', fontSize: '14px', fontWeight: 700, cursor: nat ? 'pointer' : 'default', touchAction: 'manipulation', opacity: nat ? 1 : 0.5 }}>שמור וסרוק →</button>
      </div>
    </div>,
    document.body
  )
}

// ── ExportDialog ──────────────────────────────────────────────────────────────
