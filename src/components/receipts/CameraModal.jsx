/**
 * CameraModal — capture one receipt, or several pages of one, from the camera
 * or the file picker.
 *
 * Extracted from ReceiptsPage (audit M2): a self-contained overlay driven
 * entirely by props, with no reason to live inside a 2,200-line page.
 */
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Files } from 'lucide-react'

// ── CameraModal ────────────────────────────────────────────────────────────────
export default function CameraModal({ onCapture, onClose, multi = false, onFiles }) {
  const videoRef  = useRef(null)
  const streamRef = useRef(null)
  const filesInputRef = useRef(null)
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

          {/* Pick from files (images or PDF) instead of the camera */}
          <button onClick={() => filesInputRef.current?.click()}
            style={{ position: 'absolute', top: 'calc(12px + env(safe-area-inset-top))', left: 12, zIndex: 3, display: 'flex', alignItems: 'center', gap: 6, padding: '8px 13px', borderRadius: 999, background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.4)', color: '#fff', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-main)', cursor: 'pointer', WebkitBackdropFilter: 'blur(4px)', backdropFilter: 'blur(4px)' }}>
            <Files size={15} /> מהקבצים / PDF
          </button>
          <input ref={filesInputRef} type="file" accept="image/*,application/pdf" multiple
            onChange={(e) => { const f = Array.from(e.target.files || []); e.target.value = ''; if (f.length) { stopStream(); onFiles?.(f) } }}
            style={{ display: 'none' }} />

          {/* Multi-page banner + captured thumbnails */}
          {multi && (
            <div dir="rtl" style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: 'calc(10px + env(safe-area-inset-top)) 12px 10px', background: 'linear-gradient(rgba(0,0,0,0.55), transparent)' }}>
              <div style={{ color: '#fff', fontSize: 13.5, fontWeight: 600, marginBottom: pages.length ? 8 : 0, textAlign: 'center' }}>
                {pages.length === 0
                  ? 'צלם את הקבלה — אפשר להוסיף כמה עמודים'
                  : `צולמו ${pages.length} עמודים · "המשך סריקה" לעמוד נוסף, "סיום" לסיום הסריקה`}
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

          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '24px 20px calc(36px + env(safe-area-inset-bottom))', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', background: 'linear-gradient(transparent, rgba(0,0,0,0.5))' }}>
            <button onClick={() => { stopStream(); onClose() }} style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'manipulation', flexShrink: 0 }}>✕</button>
            {/* Shutter + caption */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <button onClick={capture} disabled={!ready}
                style={{ width: 76, height: 76, borderRadius: '50%', background: ready ? '#fff' : '#666', border: '4px solid rgba(255,255,255,0.5)', cursor: ready ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'manipulation' }}>
                <div style={{ width: 58, height: 58, borderRadius: '50%', background: ready ? '#fff' : '#888', border: '3px solid #000' }} />
              </button>
              {multi && (
                <span style={{ color: '#fff', fontSize: 12.5, fontWeight: 600, fontFamily: 'var(--font-main)', textShadow: '0 1px 4px rgba(0,0,0,0.7)', whiteSpace: 'nowrap' }}>
                  {pages.length ? 'המשך סריקה' : 'צלם קבלה'}
                </span>
              )}
            </div>
            {/* Continue/finish button (multi only) */}
            {multi ? (
              <button onClick={finish} disabled={!pages.length}
                style={{ minWidth: 64, height: 52, padding: '0 16px', borderRadius: 26, background: pages.length ? '#16a34a' : 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', fontSize: 15, fontWeight: 700, cursor: pages.length ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'manipulation', fontFamily: 'var(--font-main)', flexShrink: 0 }}>
                סיום{pages.length ? ` (${pages.length})` : ''}
              </button>
            ) : <div style={{ width: 52 }} />}
          </div>
        </>
      )}
    </div>,
    document.body
  )
}
