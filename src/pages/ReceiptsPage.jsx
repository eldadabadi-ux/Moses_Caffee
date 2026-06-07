import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useSettings } from '../hooks/useSettings'
import { downloadFile } from '../lib/downloadFile'
import { compressImage, downscaleForUpload } from '../lib/imageUtils'
import { buildExcelBlob, pdfBlob as buildPdfBlob, buildImagesZip, combineZip } from '../lib/receiptExport'
import ReceiptScanAnimation from '../components/ReceiptScanAnimation'
import toast from 'react-hot-toast'
import {
  Plus, Receipt, Camera, Download, Trash2, Pencil, X, ZoomIn,
  Sparkles, FileSpreadsheet, CheckCircle2, Image as ImageIcon,
  CalendarDays, Filter, ChevronDown, Receipt as ReceiptIcon, Files,
} from 'lucide-react'
import Modal from '../components/ui/Modal'
import SearchInput from '../components/ui/SearchInput'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import DateInput from '../components/ui/DateInput'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import Badge from '../components/ui/Badge'

// ── Helpers ───────────────────────────────────────────────────────────────────

const COMMON_CATEGORIES = [
  'דלק', 'חניה', 'אוכל ושתייה', 'ציוד משרדי',
  'תקשורת וטכנולוגיה', 'רכב ותחבורה', 'שכירות ומשכנתא',
  'חשמל מים וגז', 'ביטוח', 'שכר טרחה מקצועי',
  'פרסום ושיווק', 'הכשרה והשתלמות', 'נסיעות לחו"ל',
  'מתנות ואירוח עסקי', 'בריאות ורפואה', 'שיפוצים ואחזקה', 'שונות',
]

const fmtDate = d => d ? d.split('-').reverse().join('.') : ''
const fmtILS  = n => `₪${parseFloat(n || 0).toLocaleString('he-IL', { minimumFractionDigits: 2 })}`

function useIsMobile() {
  const [v, setV] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const h = () => setV(window.innerWidth < 768)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])
  return v
}

async function buildStyledExcel(rows) {
  const XLSXs = (await import('xlsx-js-style')).default
  const thin   = { style: 'thin', color: { rgb: 'CCCCCC' } }
  const border = { top: thin, bottom: thin, left: thin, right: thin }
  const ws = XLSXs.utils.aoa_to_sheet(rows)
  const range = XLSXs.utils.decode_range(ws['!ref'] || 'A1')
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSXs.utils.encode_cell({ r: R, c: C })
      if (!ws[addr]) ws[addr] = { v: '', t: 's' }
      const isHeader = R === 0, isTotal = R === range.e.r
      ws[addr].s = {
        font:      { bold: isHeader || isTotal, name: 'Arial', sz: 10 },
        fill:      isHeader ? { patternType: 'solid', fgColor: { rgb: 'E8E8E8' } } : { patternType: 'none' },
        border,
        alignment: { horizontal: 'right', readingOrder: 2 },
      }
    }
  }
  ws['!cols']  = [{ wch: 14 }, { wch: 22 }, { wch: 20 }, { wch: 15 }, { wch: 13 }, { wch: 17 }]
  ws['!views'] = [{ rightToLeft: true }]
  const wb = XLSXs.utils.book_new()
  XLSXs.utils.book_append_sheet(wb, ws, 'קבלות')
  return { XLSXs, wb }
}

// ── CameraModal ────────────────────────────────────────────────────────────────
function CameraModal({ onCapture, onClose, multi = false }) {
  const videoRef  = useRef(null)
  const streamRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [err,   setErr]   = useState(null)
  const [pages, setPages] = useState([])   // multi-page: [{ file, url }]
  const pagesRef = useRef([])
  useEffect(() => { pagesRef.current = pages }, [pages])

  useEffect(() => {
    let cancelled = false
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    })
    .then(stream => {
      if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
      streamRef.current = stream
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => {}) }
      setReady(true)
    })
    .catch(e => { if (!cancelled) setErr(e?.name === 'NotAllowedError' ? 'אין הרשאת מצלמה. אפשר הרשאה בהגדרות.' : 'שגיאה בפתיחת מצלמה') })
    return () => { cancelled = true; streamRef.current?.getTracks().forEach(t => t.stop()) }
  }, [])

  // Revoke thumbnail object URLs only on unmount (not on every capture)
  useEffect(() => () => { pagesRef.current.forEach(p => URL.revokeObjectURL(p.url)) }, [])

  function grabFrame() {
    const video = videoRef.current; if (!video || !ready) return null
    const canvas = document.createElement('canvas')
    canvas.width  = video.videoWidth  || 1280
    canvas.height = video.videoHeight || 720
    canvas.getContext('2d').drawImage(video, 0, 0)
    return canvas
  }
  function stopStream() { streamRef.current?.getTracks().forEach(t => t.stop()) }

  function capture() {
    const canvas = grabFrame(); if (!canvas) return
    canvas.toBlob(blob => {
      if (!blob) return
      const file = new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' })
      if (multi) {
        setPages(p => [...p, { file, url: URL.createObjectURL(blob) }])  // keep stream alive
      } else {
        stopStream()
        onCapture([file])
      }
    }, 'image/jpeg', 0.92)
  }

  function finish() {
    stopStream()
    onCapture(pages.map(p => p.file))
  }
  function removePage(i) {
    setPages(p => { const n = [...p]; URL.revokeObjectURL(n[i].url); n.splice(i, 1); return n })
  }

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 99995, background: '#000', display: 'flex', flexDirection: 'column', fontFamily: 'var(--font-main)' }}>
      {err ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, color: '#fff', padding: '32px' }}>
          <span style={{ fontSize: 15, textAlign: 'center' }}>{err}</span>
          <button onClick={onClose} style={{ padding: '12px 32px', borderRadius: 12, background: '#fff', color: '#000', fontWeight: 700, border: 'none', cursor: 'pointer', fontSize: 15 }}>סגור</button>
        </div>
      ) : (
        <>
          <video ref={videoRef} playsInline muted autoPlay style={{ flex: 1, width: '100%', objectFit: 'cover', display: 'block' }} />
          {!ready && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', color: '#fff', fontSize: 14 }}>מאתחל מצלמה…</div>}

          {/* Multi-page banner + captured thumbnails */}
          {multi && (
            <div dir="rtl" style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: 'calc(10px + env(safe-area-inset-top)) 12px 10px', background: 'linear-gradient(rgba(0,0,0,0.55), transparent)' }}>
              <div style={{ color: '#fff', fontSize: 13.5, fontWeight: 600, marginBottom: pages.length ? 8 : 0, textAlign: 'center' }}>
                מצב מספר עמודים · צולמו {pages.length} עמודים
              </div>
              {pages.length > 0 && (
                <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
                  {pages.map((p, i) => (
                    <div key={p.url} style={{ position: 'relative', flexShrink: 0 }}>
                      <img src={p.url} alt={`עמ' ${i + 1}`} style={{ width: 48, height: 64, objectFit: 'cover', borderRadius: 7, border: '2px solid rgba(255,255,255,0.8)' }} />
                      <span style={{ position: 'absolute', bottom: 2, right: 2, background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 4, padding: '0 4px' }}>{i + 1}</span>
                      <button onClick={() => removePage(i)} aria-label="הסר" style={{ position: 'absolute', top: -6, left: -6, width: 20, height: 20, borderRadius: '50%', background: '#dc2626', color: '#fff', border: '2px solid #000', cursor: 'pointer', fontSize: 11, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '24px 24px calc(40px + env(safe-area-inset-bottom))', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'linear-gradient(transparent, rgba(0,0,0,0.5))' }}>
            <button onClick={() => { stopStream(); onClose() }} style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'manipulation' }}>✕</button>
            <button onClick={capture} disabled={!ready}
              style={{ width: 76, height: 76, borderRadius: '50%', background: ready ? '#fff' : '#666', border: '4px solid rgba(255,255,255,0.5)', cursor: ready ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'manipulation' }}>
              <div style={{ width: 58, height: 58, borderRadius: '50%', background: ready ? '#fff' : '#888', border: '3px solid #000' }} />
            </button>
            {/* Done button (multi only) */}
            {multi ? (
              <button onClick={finish} disabled={!pages.length}
                style={{ minWidth: 52, height: 52, padding: '0 14px', borderRadius: 26, background: pages.length ? '#16a34a' : 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', fontSize: 14, fontWeight: 700, cursor: pages.length ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'manipulation', fontFamily: 'var(--font-main)' }}>
                סיים{pages.length ? ` (${pages.length})` : ''}
              </button>
            ) : <div style={{ width: 52 }} />}
          </div>
        </>
      )}
    </div>,
    document.body
  )
}

// ── CropModal ─────────────────────────────────────────────────────────────────
function CropModal({ src, onConfirm, onCancel }) {
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
function ExportDialog({ receipts, totalAmount, filterFrom, filterTo, vatRate = 18, onClose }) {
  const [opts, setOpts] = useState({ excel: true, pdf: true, images: true })
  const [busy, setBusy] = useState(false)
  const nImages = receipts.filter(r => r.receipt_image).length
  const noneSelected = !opts.excel && !opts.pdf && !opts.images
  const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent) || window.innerWidth < 768
  const selectedCount = [opts.excel, opts.pdf, opts.images && nImages > 0].filter(Boolean).length
  const useZip = !isMobile && selectedCount > 1

  async function doExport() {
    if (busy) return
    setBusy(true)
    try {
      const dateStr = new Date().toISOString().slice(0, 10)
      const excelBlob  = opts.excel ? await buildExcelBlob(receipts, vatRate) : null
      const pdfFile    = opts.pdf   ? buildPdfBlob(receipts, { filterFrom, filterTo, vatRate }) : null
      const imagesBlob = (opts.images && nImages > 0) ? await buildImagesZip(receipts) : null

      if (useZip) {
        const blob = await combineZip([
          { name: 'קבלות.xlsx',         blob: excelBlob },
          { name: 'דוח_קבלות.html',     blob: pdfFile },
          { name: 'תמונות_קבלות.zip',   blob: imagesBlob },
        ])
        await downloadFile({ blob, filename: `קבלות_לרו"ח_${dateStr}.zip` })
      } else {
        if (excelBlob)  await downloadFile({ blob: excelBlob,  filename: `קבלות_${dateStr}.xlsx` })
        if (pdfFile)    await downloadFile({ blob: pdfFile,    filename: `דוח_קבלות_${dateStr}.html` })
        if (imagesBlob) await downloadFile({ blob: imagesBlob, filename: `תמונות_קבלות_${dateStr}.zip` })
      }
      toast.success('הייצוא הושלם!')
      onClose()
    } catch (err) {
      toast.error('שגיאה בייצוא: ' + (err?.message || ''))
    } finally {
      setBusy(false)
    }
  }

  const checkStyle = (active) => ({
    display:'flex', alignItems:'flex-start', gap:'12px', padding:'12px 14px',
    borderRadius:'10px', cursor:'pointer', transition:'all 120ms', marginBottom:'10px',
    background: active ? 'var(--accent-bg)' : 'var(--panel-2)',
    border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
  })

  return (
    <Modal isOpen={true} onClose={onClose} title={`ייצוא לרו"ח · ${receipts.length} קבלות`} size="sm">
      <div style={{ display:'flex', flexDirection:'column', gap:'14px' }} dir="rtl">
        <p style={{ margin:0, fontSize:'13px', color:'var(--text-mute)' }}>סה"כ {fmtILS(totalAmount)}</p>
        <div>
          <p style={{ margin:'0 0 10px', fontSize:'11px', fontWeight:600, color:'var(--text-mute)', textTransform:'uppercase', letterSpacing:'0.07em' }}>מה לכלול</p>
          {[
            { key:'excel', icon:'📊', label:'Excel לרואה חשבון',   sub:'.xlsx עם כל הקבלות' },
            { key:'pdf',   icon:'📄', label:'דוח להדפסה (PDF)',    sub:'קובץ HTML → הדפס → שמור PDF' },
            { key:'images',icon:'🖼',  label:'תמונות קבלות',        sub:`${nImages} קבלות עם תמונה` },
          ].map(({ key, icon, label, sub }) => (
            <label key={key} style={checkStyle(opts[key])}>
              <input type="checkbox" checked={!!opts[key]} onChange={() => setOpts(p => ({ ...p, [key]: !p[key] }))} style={{ accentColor:'var(--accent)', width:'18px', height:'18px', marginTop:'1px', cursor:'pointer', flexShrink:0 }} />
              <span style={{ fontSize:'20px' }}>{icon}</span>
              <div>
                <p style={{ margin:0, fontWeight:600, fontSize:'14px', color:'var(--text)' }}>{label}</p>
                <p style={{ margin:'2px 0 0', fontSize:'12px', color:'var(--text-mute)' }}>{sub}</p>
              </div>
            </label>
          ))}
        </div>
        <div style={{ display:'flex', gap:'10px', paddingTop:'4px', paddingBottom:'4px' }}>
          <button onClick={onClose} disabled={busy} style={{ flex:1, padding:'13px', borderRadius:'var(--r-btn)', border:'1px solid var(--border)', background:'var(--panel)', color:'var(--text-dim)', fontSize:'14px', cursor:'pointer', fontFamily:'var(--font-main)' }}>ביטול</button>
          <button onClick={doExport} disabled={busy || noneSelected}
            style={{ flex:2, display:'flex', alignItems:'center', justifyContent:'center', gap:'8px', padding:'13px', borderRadius:'var(--r-btn)', border:'none', fontSize:'14px', fontWeight:700, fontFamily:'var(--font-main)', cursor:(busy||noneSelected)?'default':'pointer', background:(busy||noneSelected)?'var(--panel-2)':'linear-gradient(135deg,#2563eb,#1d4ed8)', color:(busy||noneSelected)?'var(--text-mute)':'white' }}>
            <Download size={15} />
            {busy ? 'מייצא...' : useZip ? 'ייצא ZIP לרו"ח' : 'ייצא'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Main ReceiptsPage ─────────────────────────────────────────────────────────
export default function ReceiptsPage() {
  const { user } = useAuth()
  const { settings, displayAmount, toggleVatDisplay } = useSettings()
  const isMobile = useIsMobile()
  const [receipts, setReceipts]         = useState([])
  const [categories, setCategories]     = useState([])
  const [loading, setLoading]           = useState(true)
  const [search, setSearch]             = useState('')
  const [filterFrom, setFilterFrom]     = useState('')
  const [filterTo, setFilterTo]         = useState('')
  const [showFilters, setShowFilters]   = useState(false) // mobile: collapse filters
  const [showModal, setShowModal]       = useState(false)
  const [deleteId, setDeleteId]         = useState(null)
  const [editId, setEditId]             = useState(null)
  const [lightboxUrl, setLightboxUrl]   = useState(null)
  const [showCamera, setShowCamera]     = useState(false)
  const [cameraMulti, setCameraMulti]   = useState(false)     // multi-page capture mode
  const [showExport, setShowExport]     = useState(false)
  const [scanLoading, setScanLoading]   = useState(false)
  const [scanPhase, setScanPhase]       = useState('idle')   // 'idle'|'scanning'|'done'|'error' — drives the scan animation
  const [scanningImage, setScanningImage] = useState(null)   // first captured page, shown inside the animation
  const [showReview, setShowReview]     = useState(false)
  const [reviewVendor, setReviewVendor] = useState('')
  const [reviewDate, setReviewDate]     = useState('')
  const [reviewTotal, setReviewTotal]   = useState('')        // total WITH vat
  const [reviewBeforeVat, setReviewBeforeVat] = useState('')  // amount before vat
  const [reviewVatAmount, setReviewVatAmount] = useState('')  // vat amount
  const [reviewItems, setReviewItems]   = useState([])
  const [reviewPages, setReviewPages]   = useState([])        // all page images of a multi-page receipt
  const [scanSource, setScanSource]     = useState('')        // diagnostic: which engine produced the data
  const [reviewCategory, setReviewCategory] = useState('שונות')
  const [reviewImage, setReviewImage]   = useState(null)
  const [approving, setApproving]       = useState(false)
  const [cropSrc, setCropSrc]           = useState(null)
  const [form, setForm]                 = useState({ amount:'', vendor_name:'', category_text:'שונות', receipt_date: new Date().toISOString().slice(0,10), receipt_image:'' })
  const vatRate = settings?.vatRate ?? 18
  const [imagePreview, setImagePreview] = useState(null)

  const scanInputRef    = useRef(null)
  const fileInputRef    = useRef(null)
  const cropCallbackRef = useRef(null)
  // Stable ref to handleScanClick so bottom-nav event listener can call it
  const scanClickRef    = useRef(null)

  // ── Listen for bottom-nav scan trigger ──────────────────────────────────────
  useEffect(() => {
    function onScanEvent() { scanClickRef.current?.() }
    function onExportEvent() { setShowExport(true) }
    function onAddEvent() { resetForm(); setShowModal(true) }
    window.addEventListener('receipts-scan', onScanEvent)
    window.addEventListener('receipts-export', onExportEvent)
    window.addEventListener('receipts-add', onAddEvent)
    return () => {
      window.removeEventListener('receipts-scan', onScanEvent)
      window.removeEventListener('receipts-export', onExportEvent)
      window.removeEventListener('receipts-add', onAddEvent)
    }
  }, [])

  // ── Auto-start scan when arriving via ?scan=1 (bottom-nav FAB / PWA shortcut) ──
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('scan') === '1') {
      // strip the param so a refresh doesn't re-trigger
      const u = new URL(window.location.href)
      u.searchParams.delete('scan')
      window.history.replaceState({}, '', u.toString())
      const t = setTimeout(() => scanClickRef.current?.(), 120)
      return () => clearTimeout(t)
    }
  }, [])

  useEffect(() => { loadData() }, [])
  useEffect(() => { loadCategories() }, [])

  async function loadData() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('receipts').select('*').is('archived_at', null)
        .order('receipt_date', { ascending: false })
      if (error) throw error
      setReceipts(data || [])
    } catch (err) {
      toast.error('שגיאה בטעינה: ' + err.message)
    } finally { setLoading(false) }
  }

  async function loadCategories() {
    try {
      const { data } = await supabase.from('categories').select('id, name, parent_id, level, sort_order').order('level').order('sort_order')
      setCategories(data || [])
    } catch { setCategories([]) }
  }

  const filtered = useMemo(() => receipts.filter(r => {
    const q = search.toLowerCase()
    const matchSearch = !q || r.vendor_name?.toLowerCase().includes(q) || r.category_text?.toLowerCase().includes(q)
    const date = r.receipt_date || ''
    return matchSearch && (!filterFrom || (date && date >= filterFrom)) && (!filterTo || (date && date <= filterTo))
  }), [receipts, search, filterFrom, filterTo])

  // Total respects the with/without-VAT display preference
  // VAT-aware per-receipt helpers — prefer the exact values scanned from the
  // receipt (dedicated column OR ai_summary fallback), else compute from the
  // total + configured VAT rate.
  const amtBefore = (r) => {
    const t = parseFloat(r.amount) || 0
    if (r.amount_before_vat != null && r.amount_before_vat > 0) return parseFloat(r.amount_before_vat)
    if (r.ai_summary?.before_vat > 0) return parseFloat(r.ai_summary.before_vat)
    return Math.round(t / (1 + vatRate / 100) * 100) / 100
  }
  const amtVat = (r) => {
    const t = parseFloat(r.amount) || 0
    if (r.vat_amount != null && r.vat_amount > 0) return parseFloat(r.vat_amount)
    if (r.ai_summary?.vat_amount > 0) return parseFloat(r.ai_summary.vat_amount)
    return Math.round((t - amtBefore(r)) * 100) / 100
  }

  // Three totals: paid (with VAT), before VAT, and the VAT itself.
  const totals = useMemo(() => ({
    paid:   filtered.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0),
    before: filtered.reduce((s, r) => s + amtBefore(r), 0),
    vat:    filtered.reduce((s, r) => s + amtVat(r), 0),
  }), [filtered, vatRate])
  const totalAmount = totals.paid

  // Quick one-click exports (Excel only / PDF only) using the filtered list.
  async function quickExport(kind) {
    if (filtered.length === 0) { toast.error('אין קבלות לייצוא'); return }
    const dateStr = new Date().toISOString().slice(0, 10)
    try {
      if (kind === 'excel') {
        const blob = await buildExcelBlob(filtered, vatRate)
        await downloadFile({ blob, filename: `קבלות_${dateStr}.xlsx` })
        toast.success('Excel הורד')
      } else if (kind === 'pdf') {
        const blob = buildPdfBlob(filtered, { filterFrom, filterTo, vatRate })
        await downloadFile({ blob, filename: `דוח_קבלות_${dateStr}.html` })
        toast.success('דוח PDF הורד — פתח והדפס / שמור כ-PDF')
      }
    } catch (err) {
      toast.error('שגיאה בייצוא: ' + (err?.message || ''))
    }
  }

  const formCategories = useMemo(() => {
    const l1 = categories.filter(c => c.level === 1)
    if (l1.length > 0) return l1.map(c => ({ value: c.name, label: c.name }))
    return COMMON_CATEGORIES.map(c => ({ value: c, label: c }))
  }, [categories])

  // ── Scan flow ────────────────────────────────────────────────────────────────
  function processScannedFile(file) {
    const reader = new FileReader()
    reader.onload = () => {
      cropCallbackRef.current = (croppedDataUrl, croppedMime) => handleScanWithData(croppedDataUrl, croppedMime)
      setCropSrc({ dataUrl: reader.result, mimeType: file.type || 'image/jpeg' })
    }
    reader.onerror = () => toast.error('שגיאה בטעינת התמונה')
    reader.readAsDataURL(file)
  }

  function handleScan(e) {
    const files = Array.from(e.target.files || []); if (!files.length) return
    const multi = e.target.multiple
    e.target.value = ''
    if (multi && files.length > 1) processScannedPages(files)
    else processScannedFile(files[0])
  }

  // Collect several pages of one receipt (no per-page crop — kept simple).
  async function processScannedPages(files) {
    if (!files?.length) return
    if (files.length === 1) return processScannedFile(files[0])
    try {
      toast('מכין עמודים…', { icon: '📄', duration: 4000 })
      const pages = []
      for (const f of files) {
        const { dataUrl } = await compressImage(f)
        pages.push(dataUrl)
      }
      toast.dismiss()
      handleScanWithPages(pages)
    } catch (err) {
      toast.dismiss(); toast.error('שגיאה בטעינת התמונות')
    }
  }

  // Keep the ref current so the bottom-nav event always calls the latest version.
  // `multi` = true → multi-page receipt capture flow.
  const handleScanClick = useCallback(function(multi = false) {
    if (scanLoading) return
    const isMobileUA = /iPhone|iPad|Android/i.test(navigator.userAgent) || window.innerWidth < 768
    if (isMobileUA) {
      if (navigator.mediaDevices?.getUserMedia) { setCameraMulti(!!multi); setShowCamera(true) }
      else { if (scanInputRef.current) scanInputRef.current.multiple = !!multi; scanInputRef.current?.click() }
    } else if (typeof window.showOpenFilePicker === 'function') {
      ;(async () => {
        try {
          const handles = await window.showOpenFilePicker({ multiple: !!multi, types: [{ description: 'תמונת קבלה', accept: { 'image/*': ['.jpg','.jpeg','.png','.webp','.heic'] } }] })
          if (multi && handles.length > 1) processScannedPages(await Promise.all(handles.map(h => h.getFile())))
          else processScannedFile(await handles[0].getFile())
        } catch (err) { if (err?.name !== 'AbortError') toast.error('שגיאה: ' + (err?.message || '')) }
      })()
    } else {
      if (scanInputRef.current) scanInputRef.current.multiple = !!multi
      scanInputRef.current?.click()
    }
  }, [scanLoading])

  // Keep ref in sync
  useEffect(() => { scanClickRef.current = handleScanClick }, [handleScanClick])

  // Single-page entry point (from crop) — delegates to the unified handler.
  function handleScanWithData(dataUrl /*, mimeType */) { return handleScanWithPages([dataUrl]) }

  // Unified scan handler — works for 1 page or several pages of the same receipt.
  async function handleScanWithPages(pages) {
    if (!pages?.length) return
    const multi = pages.length > 1
    setScanLoading(true)
    setScanningImage(pages[0]); setScanPhase('scanning')   // launch the scan animation
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) { toast.error('נדרשת כניסה מחדש'); setScanPhase('error'); return }

      let result = null
      let source = 'unknown'
      try {
        const controller = new AbortController()
        const fetchTimer = setTimeout(() => controller.abort(), multi ? 90000 : 60000)
        // Downscale each page before upload so large phone photos don't time out
        const uploads = await Promise.all(pages.map(p => downscaleForUpload(p)))
        const imagesBase64 = uploads.map(u => u.split(',')[1])
        const res = await fetch('/api/scan-receipt', {
          method: 'POST', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
          body: JSON.stringify({ imagesBase64, mimeType: 'image/jpeg', vatRate }),
        }).finally(() => clearTimeout(fetchTimer))
        if (res.ok) {
          result = await res.json()
          source = result._model ? `AI: ${result._model}${multi ? ` · ${pages.length} עמ׳` : ''}` : 'AI'
        } else {
          const errBody = await res.json().catch(() => ({}))
          source = `שגיאת שרת ${res.status}: ${errBody.detail || errBody.error || ''}`
          console.warn('[scan] API error:', res.status, errBody)
        }
      } catch (aiErr) {
        source = `שגיאת רשת: ${aiErr?.message || ''}`
        console.warn('[scan] AI failed, falling back to OCR:', aiErr?.message)
      }

      if (!result) {
        // OCR fallback can only read the first page (it can't combine pages).
        toast(multi ? 'AI לא זמין — OCR על העמוד הראשון...' : 'AI לא זמין — משתמש ב-OCR...', { icon: '🔍', duration: 5000 })
        const { extractReceiptData } = await import('../lib/ocrService')
        const ocrData = await extractReceiptData(pages[0])
        const t = parseFloat(ocrData.amount) || 0
        const before = t > 0 ? Math.round(t / (1 + vatRate / 100) * 100) / 100 : 0
        result = { vendor_name: ocrData.vendor_name, receipt_date: ocrData.receipt_date, total_amount: t, amount_before_vat: before, vat_amount: Math.round((t - before) * 100) / 100, items: [] }
        source = 'OCR (גיבוי) — ' + source
      }
      setScanSource(source)

      const items = (result.items || []).map((item, idx) => ({ ...item, _id: idx }))
      const t      = Number(result.total_amount) || 0
      const before = Number(result.amount_before_vat) || (t > 0 ? Math.round(t / (1 + vatRate / 100) * 100) / 100 : 0)
      const vat    = Number(result.vat_amount) || Math.round((t - before) * 100) / 100
      setReviewVendor(result.vendor_name || '')
      setReviewDate(result.receipt_date || new Date().toISOString().slice(0, 10))
      setReviewTotal(t ? String(t) : '')
      setReviewBeforeVat(before ? String(before) : '')
      setReviewVatAmount(vat ? String(vat) : '')
      setReviewItems(items)
      setReviewCategory(items[0]?.category_l1 || 'שונות')
      setReviewPages(pages)
      setReviewImage(pages[0])
      setShowReview(true)
      setScanPhase('done')   // animation plays success → fades → reveals the review
      toast.dismiss()
    } catch (err) {
      toast.dismiss()
      toast.error('שגיאה בסריקה: ' + (err?.message || ''), { duration: 6000 })
      setScanPhase('error')
    } finally { setScanLoading(false) }
  }

  // Ensure the L1→L2→L3 categories referenced by the scanned items exist in the
  // categories table (creates missing ones). Returns the L1 id for `primaryL1`.
  async function ensureHierarchy(items, primaryL1) {
    // Load fresh so we don't duplicate
    const { data: existing } = await supabase
      .from('categories').select('id, name, parent_id, level').eq('user_id', user.id)
    const cats = existing || []
    const find = (name, level, parentId) => cats.find(c =>
      c.level === level &&
      c.name.trim().toLowerCase() === String(name).trim().toLowerCase() &&
      (level === 1 || c.parent_id === parentId)
    )
    async function ensure(name, level, parentId) {
      const nm = (name || '').trim()
      if (!nm) return null
      let cat = find(nm, level, parentId)
      if (cat) return cat.id
      const { data: created } = await supabase.from('categories')
        .insert({ user_id: user.id, name: nm, level, parent_id: parentId || null,
                  sort_order: cats.filter(c => c.level === level && c.parent_id === (parentId||null)).length })
        .select().single()
      if (created) { cats.push(created); return created.id }
      return null
    }
    // Build the whole tree from items
    for (const it of (items || [])) {
      const l1id = await ensure(it.category_l1, 1, null)
      if (l1id && it.category_l2) {
        const l2id = await ensure(it.category_l2, 2, l1id)
        if (l2id && it.category_l3) await ensure(it.category_l3, 3, l2id)
      }
    }
    // Resolve the receipt's primary L1 id
    return await ensure(primaryL1, 1, null)
  }

  async function approveScan() {
    if (approving) return
    setApproving(true)
    try {
      let category_id = null
      try {
        category_id = await ensureHierarchy(reviewItems, reviewCategory)
        loadCategories()
      } catch (hErr) { console.warn('[approveScan] hierarchy:', hErr?.message) }

      // Compress a data-URL image (no-op for non-data URLs)
      async function compressDataUrl(src) {
        if (!src?.startsWith('data:')) return src
        try {
          const blob = await fetch(src).then(r => r.blob())
          const file = new File([blob], 'receipt.jpg', { type: 'image/jpeg' })
          const { dataUrl } = await compressImage(file)
          return dataUrl
        } catch { return src }
      }

      const pages = reviewPages.length ? reviewPages : (reviewImage ? [reviewImage] : [])
      const finalImage = await compressDataUrl(pages[0] || reviewImage)
      // Extra pages of a multi-page receipt (compressed) — kept in ai_summary so
      // no schema migration is needed.
      const extraPages = pages.length > 1
        ? await Promise.all(pages.slice(1).map(compressDataUrl))
        : []

      const totalAmt = parseFloat(reviewTotal) || 0
      const beforeAmt = parseFloat(reviewBeforeVat) || Math.round(totalAmt / (1 + vatRate / 100) * 100) / 100
      const vatAmt    = parseFloat(reviewVatAmount) || Math.round((totalAmt - beforeAmt) * 100) / 100
      const base = {
        user_id: user.id, vendor_name: reviewVendor,
        receipt_date: reviewDate || new Date().toISOString().slice(0, 10),
        amount: totalAmt, currency: 'ILS',
        category_id, category_text: reviewCategory,
        items: reviewItems.length > 0 ? reviewItems : null,
        receipt_image: finalImage || null, ai_extracted: true,
        // Exact VAT breakdown is stored inside ai_summary too — this works even
        // when the dedicated columns don't exist yet (no migration required).
        ai_summary: { vendor: reviewVendor, total: totalAmt, before_vat: beforeAmt, vat_amount: vatAmt, vat_rate: vatRate, model: 'gemini-2.5-flash',
          pages: pages.length, ...(extraPages.length ? { extra_pages: extraPages } : {}) },
      }
      let { error } = await supabase.from('receipts').insert({ ...base, amount_before_vat: beforeAmt, vat_amount: vatAmt, vat_rate: vatRate })
      // Graceful fallback if VAT migration hasn't run yet — ai_summary keeps the values
      if (error && /amount_before_vat|vat_amount|vat_rate/.test(error.message || '')) {
        ;({ error } = await supabase.from('receipts').insert(base))
      }
      if (error) throw error
      toast.success('קבלה נשמרה!')
      setShowReview(false); setReviewItems([]); setReviewImage(null); setReviewPages([])
      setReviewBeforeVat(''); setReviewVatAmount('')
      loadData()
    } catch (err) {
      toast.error('שגיאה בשמירה: ' + (err?.message || ''))
    } finally { setApproving(false) }
  }

  // ── Manual CRUD ───────────────────────────────────────────────────────────────
  async function saveReceipt() {
    if (!form.amount || parseFloat(form.amount) <= 0) { toast.error('נא להזין סכום תקין'); return }
    const totalAmt  = parseFloat(form.amount)
    const beforeAmt = Math.round(totalAmt / (1 + vatRate / 100) * 100) / 100
    const vatAmt    = Math.round((totalAmt - beforeAmt) * 100) / 100
    const payload = {
      user_id: user.id, vendor_name: form.vendor_name || null,
      receipt_date: form.receipt_date || new Date().toISOString().slice(0, 10),
      amount: totalAmt, currency: 'ILS',
      category_text: form.category_text || 'שונות', receipt_image: imagePreview || null,
    }
    const vatCols = { amount_before_vat: beforeAmt, vat_amount: vatAmt, vat_rate: vatRate }

    if (editId) {
      let { error } = await supabase.from('receipts').update({ ...payload, ...vatCols }).eq('id', editId)
      if (error && /amount_before_vat|vat_amount|vat_rate/.test(error.message || '')) {
        ;({ error } = await supabase.from('receipts').update(payload).eq('id', editId))
      }
      if (error) { toast.error('שגיאה בעדכון'); return }
      toast.success('קבלה עודכנה')
      setReceipts(prev => prev.map(r => r.id === editId ? { ...r, ...payload, ...vatCols } : r))
    } else {
      let resp = await supabase.from('receipts').insert({ ...payload, ...vatCols }).select().single()
      if (resp.error && /amount_before_vat|vat_amount|vat_rate/.test(resp.error.message || '')) {
        resp = await supabase.from('receipts').insert(payload).select().single()
      }
      if (resp.error) { toast.error('שגיאה בשמירה'); return }
      toast.success('קבלה נשמרה')
      setReceipts(prev => [resp.data, ...prev])
    }
    setShowModal(false); setEditId(null); resetForm()
  }

  async function deleteReceipt() {
    const { error } = await supabase.from('receipts').delete().eq('id', deleteId)
    if (error) { toast.error('שגיאה'); return }
    toast.success('קבלה נמחקה')
    setReceipts(prev => prev.filter(r => r.id !== deleteId))
    setDeleteId(null)
  }

  function resetForm() {
    setForm({ amount:'', vendor_name:'', category_text:'שונות', receipt_date: new Date().toISOString().slice(0,10), receipt_image:'' })
    setImagePreview(null)
  }

  function openEdit(r) {
    setEditId(r.id)
    setForm({ amount: r.amount||'', vendor_name: r.vendor_name||'', category_text: r.category_text||'שונות', receipt_date: r.receipt_date||new Date().toISOString().slice(0,10), receipt_image: r.receipt_image||'' })
    setImagePreview(r.receipt_image||null)
    setShowModal(true)
  }

  async function handleImageChange(e) {
    const file = e.target.files?.[0]; if (!file) return; e.target.value = ''
    try {
      const { dataUrl, mimeType } = await compressImage(file)
      cropCallbackRef.current = (croppedDataUrl) => setImagePreview(croppedDataUrl)
      setCropSrc({ dataUrl, mimeType })
    } catch {
      const reader = new FileReader()
      reader.onload = () => setImagePreview(reader.result)
      reader.readAsDataURL(file)
    }
  }

  // ── Styles ──────────────────────────────────────────────────────────────────
  const FS = { display:'block', width:'100%', boxSizing:'border-box', borderRadius:'var(--r-btn)', border:'1px solid var(--border)', background:'var(--panel)', padding:'0 14px', height:'48px', fontSize:'17px', color:'var(--text)', outline:'none', fontFamily:'var(--font-main)' }
  const LS = { display:'block', fontSize:'16px', fontWeight:600, color:'var(--text-dim)', marginBottom:'8px' }
  const formGrid = { display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap:'14px' }

  if (loading) return <LoadingSpinner />

  const hasActiveFilter = search || filterFrom || filterTo

  return (
    <div className="animate-fade-in" style={{ display:'flex', flexDirection:'column', gap: isMobile ? '14px' : '20px' }} dir="rtl">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px' }}>
        <div>
          <h1 style={{ fontSize: isMobile ? '23px' : '26px', fontWeight:700, color:'var(--text)', margin:0 }}>קבלות</h1>
          <p style={{ fontSize:'15px', color:'var(--text-mute)', marginTop:'2px' }}>{receipts.length} קבלות</p>
        </div>
        {/* Desktop / tablet actions */}
        {!isMobile && (
          <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
            <button onClick={() => setShowExport(true)} style={{ display:'flex', alignItems:'center', gap:'6px', padding:'8px 14px', background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:'var(--r-btn)', fontSize:'13px', fontWeight:600, color:'#16a34a', cursor:'pointer', fontFamily:'var(--font-main)' }}>
              <FileSpreadsheet size={14} /> ייצוא לרו"ח
            </button>
            <input ref={scanInputRef} type="file" accept="image/*" capture="environment" onChange={handleScan} style={{ display:'none' }} />
            {scanLoading ? (
              <div style={{ display:'inline-flex', alignItems:'center', gap:'8px', padding:'8px 16px', background:'var(--panel-2)', borderRadius:'var(--r-btn)', fontSize:'13px', fontWeight:600, color:'var(--text-mute)', fontFamily:'var(--font-main)' }}>
                <Sparkles size={14} /> סורק...
              </div>
            ) : (
              <button onClick={() => handleScanClick(false)} style={{ display:'flex', alignItems:'center', gap:'8px', padding:'8px 16px', background:'linear-gradient(135deg,#2563eb,#1d4ed8)', border:'none', borderRadius:'var(--r-btn)', fontSize:'13px', fontWeight:600, color:'white', cursor:'pointer', fontFamily:'var(--font-main)' }}>
                <Camera size={14} /> סרוק קבלה
              </button>
            )}
            {!scanLoading && (
              <button onClick={() => handleScanClick(true)} title="קבלה עם כמה עמודים" style={{ display:'flex', alignItems:'center', gap:'7px', padding:'8px 14px', background:'var(--panel)', border:'1px solid var(--accent)', borderRadius:'var(--r-btn)', fontSize:'13px', fontWeight:600, color:'var(--accent)', cursor:'pointer', fontFamily:'var(--font-main)' }}>
                <Files size={14} /> כמה עמודים
              </button>
            )}
            <button onClick={() => { resetForm(); setShowModal(true) }} style={{ display:'flex', alignItems:'center', gap:'6px', padding:'8px 14px', background:'var(--panel)', border:'1px solid var(--border)', borderRadius:'var(--r-btn)', fontSize:'13px', color:'var(--text-dim)', cursor:'pointer', fontFamily:'var(--font-main)' }}>
              <Plus size={14} /> הוסף ידנית
            </button>
          </div>
        )}
        {/* Mobile: compact actions bar */}
        {isMobile && (
          <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
            {scanLoading && (
              <div style={{ display:'inline-flex', alignItems:'center', gap:'6px', padding:'8px 12px', background:'var(--accent-bg)', borderRadius:'var(--r-btn)', fontSize:'12px', fontWeight:600, color:'var(--accent)', fontFamily:'var(--font-main)' }}>
                <Sparkles size={13} /> סורק...
              </div>
            )}
            <button onClick={() => handleScanClick(true)} title="קבלה עם כמה עמודים" style={{ display:'flex', alignItems:'center', gap:'6px', height:40, padding:'0 12px', background:'var(--accent-bg)', border:'1px solid var(--accent)', borderRadius:'10px', cursor:'pointer', color:'var(--accent)', fontSize:'12.5px', fontWeight:600, fontFamily:'var(--font-main)', whiteSpace:'nowrap' }}>
              <Files size={16} /> כמה עמודים
            </button>
            <button onClick={() => setShowExport(true)} title="ייצוא" style={{ width:40, height:40, display:'flex', alignItems:'center', justifyContent:'center', background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:'10px', cursor:'pointer', color:'#16a34a', flexShrink:0 }}>
              <FileSpreadsheet size={18} />
            </button>
            <button onClick={() => { resetForm(); setShowModal(true) }} title="הוסף ידנית" style={{ width:40, height:40, display:'flex', alignItems:'center', justifyContent:'center', background:'var(--panel)', border:'1px solid var(--border)', borderRadius:'10px', cursor:'pointer', color:'var(--text-dim)', flexShrink:0 }}>
              <Plus size={18} />
            </button>
            <input ref={scanInputRef} type="file" accept="image/*" capture="environment" onChange={handleScan} style={{ display:'none' }} />
          </div>
        )}
      </div>

      {/* ── Search + filter row ─────────────────────────────────────────────── */}
      <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
        {/* Search + filter toggle */}
        <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
          <div style={{ flex:1 }}>
            <SearchInput value={search} onChange={setSearch} placeholder="חיפוש לפי ספק / קטגוריה..." />
          </div>
          {/* On mobile: toggle button for date filters */}
          {isMobile && (
            <button
              onClick={() => setShowFilters(f => !f)}
              style={{ width:40, height:36, display:'flex', alignItems:'center', justifyContent:'center', background: showFilters || (filterFrom || filterTo) ? 'var(--accent-bg)' : 'var(--panel)', border:`1px solid ${showFilters || (filterFrom || filterTo) ? 'var(--accent)' : 'var(--border)'}`, borderRadius:'var(--r-btn)', cursor:'pointer', color: showFilters || (filterFrom || filterTo) ? 'var(--accent)' : 'var(--text-mute)', flexShrink:0, position:'relative' }}>
              <Filter size={16} />
              {(filterFrom || filterTo) && (
                <span style={{ position:'absolute', top:3, right:3, width:7, height:7, borderRadius:'50%', background:'var(--accent)', border:'1.5px solid var(--bg)' }} />
              )}
            </button>
          )}
        </div>

        {/* Date filters — always visible on desktop, toggleable on mobile */}
        {(!isMobile || showFilters) && (
          <div style={{ display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap', animation: isMobile ? 'fadeIn 180ms ease both' : 'none' }}>
            <span style={{ fontSize:'12.5px', color:'var(--text-mute)', whiteSpace:'nowrap' }}>מתאריך:</span>
            <DateInput value={filterFrom} onChange={e => setFilterFrom(e.target.value)} style={{ flex:'1 1 130px', maxWidth:'180px', height:'36px', fontSize:'13px' }} clearable />
            <span style={{ fontSize:'12.5px', color:'var(--text-mute)', whiteSpace:'nowrap' }}>עד:</span>
            <DateInput value={filterTo} onChange={e => setFilterTo(e.target.value)} style={{ flex:'1 1 130px', maxWidth:'180px', height:'36px', fontSize:'13px' }} clearable />
            {hasActiveFilter && (
              <button onClick={() => { setSearch(''); setFilterFrom(''); setFilterTo(''); setShowFilters(false) }}
                style={{ padding:'6px 12px', background:'none', border:'1px solid var(--border)', borderRadius:'6px', fontSize:'12px', color:'var(--text-mute)', cursor:'pointer', fontFamily:'var(--font-main)', whiteSpace:'nowrap' }}>
                נקה הכל
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Summary: paid / VAT / before-VAT ─────────────────────────────────── */}
      {filtered.length > 0 && (
        <div style={{ display:'flex', alignItems:'stretch', gap:'10px', flexWrap:'wrap' }}>
          {/* Total paid (with VAT) — primary */}
          <div style={{ display:'flex', flexDirection:'column', gap:'2px', background:'var(--panel)', border:'1px solid var(--border)', borderRadius:'var(--r-card)', padding: isMobile ? '10px 16px' : '12px 20px', boxShadow:'var(--shadow-card)' }}>
            <span style={{ fontSize:'11px', color:'var(--text-mute)', fontWeight:600 }}>סה"כ לתשלום ({filtered.length} קבלות)</span>
            <span style={{ fontSize: isMobile ? '20px' : '22px', fontWeight:800, color:'var(--ok)', lineHeight:1.1 }}>{fmtILS(totals.paid)}</span>
          </div>
          {/* VAT breakdown */}
          <div style={{ display:'flex', gap: isMobile ? '14px' : '20px', alignItems:'center', background:'var(--panel-2)', border:'1px solid var(--border)', borderRadius:'var(--r-card)', padding: isMobile ? '10px 16px' : '12px 20px' }}>
            <div style={{ display:'flex', flexDirection:'column', gap:'2px' }}>
              <span style={{ fontSize:'12px', color:'var(--text-mute)' }}>לפני מע"מ</span>
              <span style={{ fontSize: isMobile ? '16px' : '17px', fontWeight:700, color:'var(--text)' }}>{fmtILS(totals.before)}</span>
            </div>
            <div style={{ width:1, alignSelf:'stretch', background:'var(--border)' }} />
            <div style={{ display:'flex', flexDirection:'column', gap:'2px' }}>
              <span style={{ fontSize:'12px', color:'var(--text-mute)' }}>מע"מ {vatRate}%</span>
              <span style={{ fontSize: isMobile ? '16px' : '17px', fontWeight:700, color:'#92400e' }}>{fmtILS(totals.vat)}</span>
            </div>
          </div>
          {/* Quick export buttons */}
          <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
            <button onClick={() => quickExport('excel')} title="הורד Excel בלבד"
              style={{ display:'flex', alignItems:'center', gap:'6px', padding:'10px 14px', background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:'var(--r-btn)', fontSize:'14px', fontWeight:600, color:'#16a34a', cursor:'pointer', fontFamily:'var(--font-main)' }}>
              <FileSpreadsheet size={16} /> Excel
            </button>
            <button onClick={() => quickExport('pdf')} title="הורד PDF בלבד"
              style={{ display:'flex', alignItems:'center', gap:'6px', padding:'10px 14px', background:'var(--panel)', border:'1px solid var(--border)', borderRadius:'var(--r-btn)', fontSize:'14px', fontWeight:600, color:'var(--text-dim)', cursor:'pointer', fontFamily:'var(--font-main)' }}>
              <Download size={16} /> PDF
            </button>
          </div>
        </div>
      )}

      {/* ── Receipt list ─────────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div style={{ textAlign:'center', padding:'56px 16px', color:'var(--text-mute)' }}>
          <Receipt size={40} style={{ margin:'0 auto 12px', display:'block', opacity:0.3 }} />
          <p style={{ fontWeight:600, color:'var(--text)', fontSize:'15px' }}>{receipts.length === 0 ? 'אין קבלות עדיין' : 'אין תוצאות לסינון הנוכחי'}</p>
          <p style={{ fontSize:'13px', marginTop:'6px' }}>{receipts.length === 0 ? 'לחץ על כפתור המצלמה כדי לסרוק קבלה' : 'שנה את מסנני החיפוש'}</p>
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
          {filtered.map(r => (
            <div key={r.id} style={{ background:'var(--panel)', border:'1px solid var(--border)', borderRadius:'var(--r-card)', padding: isMobile ? '12px 14px' : '14px 16px', display:'flex', alignItems:'center', gap:isMobile ? '10px' : '12px', boxShadow:'var(--shadow-card)', minHeight:'64px' }}>
              {/* Thumbnail */}
              {r.receipt_image ? (
                <button onClick={() => setLightboxUrl(r.receipt_image)} style={{ width: isMobile ? 40 : 44, height: isMobile ? 40 : 44, borderRadius:'8px', overflow:'hidden', border:'1px solid var(--border)', background:'var(--panel-2)', flexShrink:0, cursor:'pointer', padding:0 }}>
                  <img src={r.receipt_image} alt="קבלה" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                </button>
              ) : (
                <div style={{ width: isMobile ? 40 : 44, height: isMobile ? 40 : 44, borderRadius:'8px', background:'var(--panel-2)', border:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  <Receipt size={16} style={{ color:'var(--text-mute)' }} />
                </div>
              )}

              {/* Details */}
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'baseline', gap:'6px', flexWrap:'wrap' }}>
                  <span style={{ fontWeight:600, fontSize: isMobile ? '16px' : '17px', color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth: isMobile ? '150px' : 'none' }}>{r.vendor_name || '—'}</span>
                  {r.ai_extracted && <Badge variant="info" showDot={false} style={{ fontSize:'12px' }}>AI</Badge>}
                </div>
                <div style={{ display:'flex', gap:'8px', marginTop:'3px', flexWrap:'wrap' }}>
                  {r.receipt_date && <span style={{ fontSize:'14px', color:'var(--text-mute)', display:'flex', alignItems:'center', gap:'3px' }}><CalendarDays size={12} />{fmtDate(r.receipt_date)}</span>}
                  {r.category_text && <span style={{ fontSize:'14px', color:'var(--text-mute)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth: isMobile ? '110px' : 'none' }}>{r.category_text}</span>}
                </div>
              </div>

              {/* Amount (paid, with VAT) + breakdown + actions */}
              <div style={{ display:'flex', alignItems:'center', gap: isMobile ? '4px' : '8px', flexShrink:0 }}>
                <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:'1px' }}>
                  <span style={{ fontSize: isMobile ? '18px' : '19px', fontWeight:700, color:'var(--ok)', whiteSpace:'nowrap' }}>{fmtILS(parseFloat(r.amount) || 0)}</span>
                  <span style={{ fontSize:'12.5px', color:'var(--text-mute)', whiteSpace:'nowrap' }}>
                    לפני מע"מ {fmtILS(amtBefore(r))}
                  </span>
                </div>
                {/* Action buttons — slightly larger on mobile for touch */}
                <button onClick={() => openEdit(r)} style={{ padding: isMobile ? '8px' : '6px', background:'none', border:'none', cursor:'pointer', color:'var(--text-mute)', borderRadius:'6px', display:'flex', alignItems:'center' }} onMouseEnter={e=>e.currentTarget.style.background='var(--panel-2)'} onMouseLeave={e=>e.currentTarget.style.background='none'}><Pencil size={14} /></button>
                <button onClick={() => setDeleteId(r.id)} style={{ padding: isMobile ? '8px' : '6px', background:'none', border:'none', cursor:'pointer', color:'var(--text-mute)', borderRadius:'6px', display:'flex', alignItems:'center' }} onMouseEnter={e=>{e.currentTarget.style.background='#fef2f2';e.currentTarget.style.color='var(--danger)'}} onMouseLeave={e=>{e.currentTarget.style.background='none';e.currentTarget.style.color='var(--text-mute)'}}><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Camera / Crop ────────────────────────────────────────────────────── */}
      {showCamera && <CameraModal multi={cameraMulti}
        onCapture={files => { setShowCamera(false); if (cameraMulti && files.length > 1) processScannedPages(files); else processScannedFile(files[0]) }}
        onClose={() => setShowCamera(false)} />}

      {/* Hi-tech scan animation while the AI processes the receipt */}
      {scanPhase !== 'idle' && (
        <ReceiptScanAnimation phase={scanPhase} receiptUri={scanningImage}
          onDone={() => { setScanPhase('idle'); setScanningImage(null) }} />
      )}
      {cropSrc && (
        <CropModal
          src={cropSrc.dataUrl}
          onConfirm={(croppedDataUrl, croppedMime) => { const cb = cropCallbackRef.current; setCropSrc(null); cb?.(croppedDataUrl, croppedMime) }}
          onCancel={() => setCropSrc(null)}
        />
      )}

      {/* ── AI Review modal ────────────────────────────────────────────────────── */}
      {showReview && (
        <Modal isOpen={true} onClose={() => setShowReview(false)} title="סקירת קבלה" size="md">
          <div style={{ display:'flex', flexDirection:'column', gap:'16px' }} dir="rtl">
            {reviewPages.length > 1 ? (
              <div>
                <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:6, fontSize:'12.5px', color:'var(--accent)', fontWeight:600 }}>
                  <Files size={14} /> קבלה מרובת עמודים · {reviewPages.length} עמודים אוחדו
                </div>
                <div style={{ display:'flex', gap:8, overflowX:'auto', paddingBottom:4 }}>
                  {reviewPages.map((p, i) => (
                    <div key={i} style={{ position:'relative', flexShrink:0, cursor:'pointer' }} onClick={() => setLightboxUrl(p)}>
                      <img src={p} alt={`עמ' ${i+1}`} style={{ height: isMobile ? '110px' : '140px', width:'auto', maxWidth:'120px', objectFit:'cover', borderRadius:'9px', background:'var(--panel-2)', border:'1px solid var(--border)' }} />
                      <span style={{ position:'absolute', bottom:4, right:4, background:'rgba(0,0,0,0.7)', color:'#fff', fontSize:'10.5px', fontWeight:700, borderRadius:5, padding:'1px 6px' }}>{i+1}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : reviewImage && (
              <img src={reviewImage} alt="קבלה" style={{ width:'100%', maxHeight: isMobile ? '160px' : '200px', objectFit:'contain', borderRadius:'10px', background:'var(--panel-2)' }} />
            )}
            {scanSource && (
              <div style={{ fontSize:'11px', color: scanSource.includes('שגיאה') || scanSource.includes('OCR') ? 'var(--danger)' : 'var(--text-mute)', background:'var(--panel-2)', borderRadius:'6px', padding:'5px 10px', direction:'ltr', textAlign:'right' }}>
                {scanSource}
              </div>
            )}
            <div style={formGrid}>
              <div>
                <label style={LS}>ספק</label>
                <input value={reviewVendor} onChange={e => setReviewVendor(e.target.value)} style={FS} dir="auto" placeholder="שם בית העסק" />
              </div>
              <div>
                <label style={LS}>תאריך</label>
                <DateInput value={reviewDate} onChange={e => setReviewDate(e.target.value)} style={{ height:'44px' }} />
              </div>
            </div>
            <div style={formGrid}>
              <div>
                <label style={LS}>סכום כולל מע"מ (₪)</label>
                <input type="number" value={reviewTotal}
                  onChange={e => {
                    const v = e.target.value
                    setReviewTotal(v)
                    const t = parseFloat(v) || 0
                    const before = t > 0 ? Math.round(t / (1 + vatRate / 100) * 100) / 100 : 0
                    setReviewBeforeVat(before ? String(before) : '')
                    setReviewVatAmount(before ? String(Math.round((t - before) * 100) / 100) : '')
                  }}
                  style={{ ...FS, fontWeight:700, fontSize:'18px' }} dir="ltr" placeholder="0.00" />
              </div>
              <div>
                <label style={LS}>קטגוריה</label>
                <select value={reviewCategory} onChange={e => setReviewCategory(e.target.value)} style={{ ...FS, paddingRight:'10px' }}>
                  {formCategories.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            </div>

            {/* VAT breakdown */}
            <div style={{ display:'flex', gap:'10px', background:'var(--panel-2)', borderRadius:'10px', padding:'12px 14px', border:'1px solid var(--border)' }}>
              <div style={{ flex:1 }}>
                <label style={{ ...LS, marginBottom:6 }}>לפני מע"מ (₪)</label>
                <input type="number" value={reviewBeforeVat}
                  onChange={e => {
                    const v = e.target.value
                    setReviewBeforeVat(v)
                    const b = parseFloat(v) || 0
                    const t = parseFloat(reviewTotal) || 0
                    setReviewVatAmount(t > b ? String(Math.round((t - b) * 100) / 100) : '')
                  }}
                  style={{ ...FS, height:'40px', fontSize:'14px' }} dir="ltr" placeholder="0.00" />
              </div>
              <div style={{ flex:1 }}>
                <label style={{ ...LS, marginBottom:6 }}>מע"מ {vatRate}% (₪)</label>
                <input type="number" value={reviewVatAmount} readOnly
                  style={{ ...FS, height:'40px', fontSize:'14px', background:'var(--panel)', color:'var(--text-mute)' }} dir="ltr" placeholder="0.00" />
              </div>
            </div>
            {reviewItems.length > 0 && (
              <div>
                <label style={LS}>פירוט הקבלה ({reviewItems.length} פריטים)</label>
                <div style={{ background:'var(--panel-2)', borderRadius:'10px', padding:'4px 12px', maxHeight:'220px', overflowY:'auto', border:'1px solid var(--border)' }}>
                  {reviewItems.map((item, i) => {
                    const path = [item.category_l1, item.category_l2, item.category_l3].filter(Boolean).join(' › ')
                    return (
                      <div key={item._id ?? i} style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', padding:'9px 0', borderBottom: i < reviewItems.length-1 ? '1px solid var(--border)' : 'none', gap:'10px' }}>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ color:'var(--text)', fontSize:'15px', fontWeight:500 }}>{item.item_name}</div>
                          {path && <div style={{ color:'var(--text-mute)', fontSize:'12.5px', marginTop:'2px' }}>{path}</div>}
                        </div>
                        {item.price > 0 && <span style={{ color:'var(--ok)', fontWeight:700, fontSize:'15px', whiteSpace:'nowrap' }}>{fmtILS(item.price)}</span>}
                      </div>
                    )
                  })}
                  {/* Items total */}
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 0', borderTop:'2px solid var(--border)', marginTop:'2px' }}>
                    <span style={{ color:'var(--text)', fontSize:'15px', fontWeight:700 }}>סה"כ פריטים</span>
                    <span style={{ color:'var(--ok)', fontSize:'16px', fontWeight:800 }}>
                      {fmtILS(reviewItems.reduce((s, it) => s + (parseFloat(it.price) || 0), 0))}
                    </span>
                  </div>
                </div>
                <p style={{ margin:'6px 2px 0', fontSize:'12px', color:'var(--text-mute)' }}>
                  כל פריט מסווג: קטגוריה › תת-קטגוריה › תת-תת. הסכום הכולל למעלה הוא הקובע לשמירה.
                </p>
              </div>
            )}
            <div style={{ display:'flex', gap:'10px', paddingTop:'4px', paddingBottom: isMobile ? '8px' : '0' }}>
              <button onClick={() => setShowReview(false)} style={{ flex:1, padding:'13px', borderRadius:'var(--r-btn)', border:'1px solid var(--border)', background:'var(--panel)', color:'var(--text-dim)', fontSize:'14px', cursor:'pointer', fontFamily:'var(--font-main)' }}>ביטול</button>
              <button onClick={approveScan} disabled={approving || !reviewTotal}
                style={{ flex:2, display:'flex', alignItems:'center', justifyContent:'center', gap:'8px', padding:'13px', borderRadius:'var(--r-btn)', border:'none', fontSize:'14px', fontWeight:700, fontFamily:'var(--font-main)', cursor:(approving||!reviewTotal)?'default':'pointer', background:(approving||!reviewTotal)?'var(--panel-2)':'linear-gradient(135deg,#16a34a,#15803d)', color:(approving||!reviewTotal)?'var(--text-mute)':'white' }}>
                <CheckCircle2 size={15} />
                {approving ? 'שומר...' : 'אשר ושמור'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Manual add/edit modal ───────────────────────────────────────────────── */}
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditId(null); resetForm() }} title={editId ? 'עריכת קבלה' : 'הוספת קבלה ידנית'} size="sm">
        <div style={{ display:'flex', flexDirection:'column', gap:'14px' }} dir="rtl">
          <div style={formGrid}>
            <div>
              <label style={LS}>ספק</label>
              <input value={form.vendor_name} onChange={e => setForm(p => ({ ...p, vendor_name: e.target.value }))} style={FS} dir="auto" placeholder="שם בית העסק" />
            </div>
            <div>
              <label style={LS}>תאריך</label>
              <DateInput value={form.receipt_date} onChange={e => setForm(p => ({ ...p, receipt_date: e.target.value }))} style={{ height:'44px' }} />
            </div>
          </div>
          <div style={formGrid}>
            <div>
              <label style={LS}>סכום (₪) *</label>
              <input type="number" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} style={{ ...FS, fontWeight:600 }} dir="ltr" placeholder="0.00" />
            </div>
            <div>
              <label style={LS}>קטגוריה</label>
              <select value={form.category_text} onChange={e => setForm(p => ({ ...p, category_text: e.target.value }))} style={{ ...FS, paddingRight:'10px' }}>
                {formCategories.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label style={LS}>תמונת קבלה</label>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageChange} style={{ display:'none' }} />
            {imagePreview ? (
              <div style={{ position:'relative', display:'inline-block' }}>
                <img src={imagePreview} alt="קבלה" style={{ height:'80px', borderRadius:'8px', objectFit:'cover', border:'1px solid var(--border)' }} />
                <button onClick={() => setImagePreview(null)} style={{ position:'absolute', top:'-6px', right:'-6px', width:'22px', height:'22px', borderRadius:'50%', background:'var(--danger)', border:'none', color:'white', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}><X size={11} /></button>
                <button onClick={() => setLightboxUrl(imagePreview)} style={{ position:'absolute', bottom:'4px', left:'4px', padding:'3px 7px', background:'rgba(0,0,0,0.5)', color:'white', border:'none', borderRadius:'5px', cursor:'pointer', fontSize:'11px', display:'flex', alignItems:'center', gap:'3px' }}><ZoomIn size={10} />הגדל</button>
              </div>
            ) : (
              <button onClick={() => fileInputRef.current?.click()} style={{ display:'flex', alignItems:'center', gap:'8px', padding:'12px 16px', background:'var(--panel-2)', border:'1px dashed var(--border)', borderRadius:'10px', color:'var(--text-mute)', cursor:'pointer', fontSize:'13.5px', fontFamily:'var(--font-main)', width:'100%', justifyContent:'center' }}>
                <ImageIcon size={16} /> העלה תמונה
              </button>
            )}
          </div>
          <div style={{ display:'flex', gap:'10px', paddingTop:'4px', paddingBottom: isMobile ? '8px' : '0' }}>
            <button onClick={() => { setShowModal(false); setEditId(null); resetForm() }} style={{ flex:1, padding:'13px', borderRadius:'var(--r-btn)', border:'1px solid var(--border)', background:'var(--panel)', color:'var(--text-dim)', fontSize:'14px', cursor:'pointer', fontFamily:'var(--font-main)' }}>ביטול</button>
            <button onClick={saveReceipt} style={{ flex:2, padding:'13px', borderRadius:'var(--r-btn)', border:'none', background:'var(--accent)', color:'white', fontSize:'14px', fontWeight:700, cursor:'pointer', fontFamily:'var(--font-main)' }}>{editId ? 'שמור שינויים' : 'שמור קבלה'}</button>
          </div>
        </div>
      </Modal>

      {/* ── Lightbox ──────────────────────────────────────────────────────────────── */}
      {lightboxUrl && createPortal(
        <div onClick={() => setLightboxUrl(null)} style={{ position:'fixed', inset:0, zIndex:99999, background:'rgba(0,0,0,0.9)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'zoom-out' }}>
          <img src={lightboxUrl} alt="קבלה" style={{ maxWidth:'95vw', maxHeight:'90dvh', objectFit:'contain', borderRadius:'10px', pointerEvents:'none' }} />
          <button onClick={() => setLightboxUrl(null)} style={{ position:'absolute', top:'16px', left:'16px', background:'rgba(255,255,255,0.15)', border:'none', borderRadius:'50%', width:'40px', height:'40px', color:'white', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', touchAction:'manipulation' }}><X size={18} /></button>
        </div>,
        document.body
      )}

      {/* ── Export dialog ─────────────────────────────────────────────────────────── */}
      {showExport && (
        <ExportDialog receipts={filtered} totalAmount={totalAmount} filterFrom={filterFrom} filterTo={filterTo} vatRate={vatRate} onClose={() => setShowExport(false)} />
      )}

      {/* ── Confirm delete ───────────────────────────────────────────────────────── */}
      <ConfirmDialog isOpen={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={deleteReceipt} title="מחיקת קבלה" message="האם למחוק את הקבלה? לא ניתן לשחזר." />
    </div>
  )
}
