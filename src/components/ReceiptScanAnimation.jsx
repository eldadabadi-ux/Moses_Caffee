import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const BLUE = 'var(--accent)'
const GOLD = 'var(--warn)'
const OK = 'var(--ok)'

/**
 * ReceiptScanAnimation — a light, hi-tech "powerful scanner" overlay shown while
 * a receipt is processed by the AI. Web adaptation (CSS keyframes + layers) of a
 * React-Native/Reanimated prompt. The percentage eases toward ~92% while the real
 * (variable-length) scan runs, snaps to 100% on `done`, flashes success, then
 * fades to reveal the review modal underneath.
 *
 * props: { phase: 'scanning'|'done'|'error', receiptUri?: string, onDone: () => void }
 */
export default function ReceiptScanAnimation({ phase, receiptUri, onDone }) {
  const [pct, setPct] = useState(0)
  const pctRef = useRef(0)
  const [fading, setFading] = useState(false)
  const [success, setSuccess] = useState(false)
  const mountTime = useRef(Date.now())
  const reduced = useRef(reducedMotion())
  const doneCalled = useRef(false)

  // Percentage ticker — slow, continuous creep toward ~97% while scanning.
  // It never hard-sticks (keeps inching), and the real result snaps it to 100 fast.
  useEffect(() => {
    if (phase !== 'scanning') return
    const CEIL = 97
    const id = setInterval(() => {
      const p = pctRef.current
      if (p >= CEIL) return
      const next = Math.min(CEIL, p + Math.max(0.07, (CEIL - p) * 0.006))
      pctRef.current = next; setPct(next)
    }, 70)
    return () => clearInterval(id)
  }, [phase])

  // Completion / error transitions.
  useEffect(() => {
    const finish = () => { if (!doneCalled.current) { doneCalled.current = true; onDone?.() } }
    if (phase === 'done') {
      const wait = Math.max(0, 1500 - (Date.now() - mountTime.current)) // min on-screen time
      let fastId, t2, t3
      const t1 = setTimeout(() => {
        // Scan finished → climb FAST to 100, then success → fade → reveal review.
        fastId = setInterval(() => {
          const p = pctRef.current
          const next = Math.min(100, p + Math.max(2.5, (100 - p) * 0.28))
          pctRef.current = next; setPct(next)
          if (next >= 100) {
            clearInterval(fastId)
            setSuccess(true)
            t2 = setTimeout(() => { setFading(true); t3 = setTimeout(finish, 380) }, 900)
          }
        }, 28)
      }, wait)
      return () => { clearTimeout(t1); clearInterval(fastId); clearTimeout(t2); clearTimeout(t3) }
    }
    if (phase === 'error') {
      setFading(true)
      const t = setTimeout(finish, 340)
      return () => clearTimeout(t)
    }
  }, [phase, onDone])

  const anim = (v) => (reduced.current ? 'none' : v)

  // ── Layers ──────────────────────────────────────────────────────────────────
  const cornerBase = { position: 'absolute', width: 30, height: 30, borderColor: BLUE, filter: `drop-shadow(0 0 5px var(--accent))` }
  const corners = [
    { top: -2, right: -2, borderTop: '2.5px solid', borderRight: '2.5px solid', borderTopRightRadius: 6 },
    { top: -2, left: -2,  borderTop: '2.5px solid', borderLeft: '2.5px solid', borderTopLeftRadius: 6 },
    { bottom: -2, right: -2, borderBottom: '2.5px solid', borderRight: '2.5px solid', borderBottomRightRadius: 6 },
    { bottom: -2, left: -2,  borderBottom: '2.5px solid', borderLeft: '2.5px solid', borderBottomLeftRadius: 6 },
  ]
  const edgeSquares = [
    { top: '18%', left: '20%' }, { top: '34%', right: '16%' },
    { bottom: '30%', left: '26%' }, { bottom: '18%', right: '24%' },
  ]
  const dataDots = Array.from({ length: 10 }, (_, i) => ({
    left: `${8 + (i * 8.4) % 84}%`,
    color: i % 3 === 0 ? GOLD : BLUE,
    delay: `${(i * 0.28).toFixed(2)}s`,
    size: i % 4 === 0 ? 6 : 5,
  }))

  const hudMono = { fontFamily: 'var(--font-mono)', direction: 'ltr', textTransform: 'uppercase', letterSpacing: '0.12em', fontSize: 10.5, fontWeight: 700 }

  return createPortal(
    <div
      role="status"
      aria-label="סורק את הקבלה"
      style={{
        position: 'fixed', inset: 0, zIndex: 99996,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(250,250,247,0.82)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
        opacity: fading ? 0 : 1, transition: 'opacity 360ms ease',
        padding: 'max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom))',
      }}
    >
      {/* Scan cell */}
      <div style={{
        position: 'relative', width: 'min(92vw, 420px)', height: 'min(78dvh, 600px)',
        borderRadius: 26, overflow: 'hidden',
        background: 'radial-gradient(120% 100% at 50% 0%, #f5f9ff 0%, #ffffff 70%)',
        border: '1px solid var(--border)', boxShadow: 'var(--shadow-modal)',
        animation: anim('scanCellIn 420ms var(--ease) both'),
      }}>
        {/* Inner dashed frame */}
        <div style={{ position: 'absolute', inset: 10, borderRadius: 20, border: '1px dashed rgba(37,99,235,0.22)', pointerEvents: 'none' }} />

        {/* Depth grid */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: 'linear-gradient(rgba(37,99,235,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(37,99,235,0.06) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
          maskImage: 'radial-gradient(circle at 50% 45%, #000 55%, transparent 90%)',
          WebkitMaskImage: 'radial-gradient(circle at 50% 45%, #000 55%, transparent 90%)',
          animation: anim('gridDrift 14s linear infinite'),
        }} />

        {/* Scan rings */}
        {!reduced.current && [0, 1.5].map((d, i) => (
          <div key={i} style={{
            position: 'absolute', top: '46%', left: '50%', width: 250, height: 250, borderRadius: '50%',
            border: '1.5px solid var(--accent)', opacity: 0,
            animation: `ringPulse 3s ease-out ${d}s infinite`,
          }} />
        ))}

        {/* Receipt + reticle */}
        <div style={{ position: 'absolute', top: '46%', left: '50%', transform: 'translate(-50%,-50%) perspective(1100px) rotateX(7deg)', width: '58%', maxWidth: 230 }}>
          <div style={{ position: 'relative', borderRadius: 10, overflow: 'visible', boxShadow: '0 10px 40px rgba(37,99,235,0.28)', border: '1px solid rgba(37,99,235,0.25)' }}>
            {receiptUri ? (
              <img src={receiptUri} alt="" style={{ display: 'block', width: '100%', maxHeight: 300, objectFit: 'cover', borderRadius: 10, background: '#fff' }} />
            ) : (
              <div style={{ width: '100%', height: 230, borderRadius: 10, background: '#fff', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ height: 14, width: '60%', borderRadius: 4, background: 'var(--panel-2)' }} />
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ height: 8, width: `${50 + (i * 7) % 30}%`, borderRadius: 3, background: 'var(--panel-2)' }} />
                    <div style={{ height: 8, width: 30, borderRadius: 3, background: 'var(--panel-2)' }} />
                  </div>
                ))}
              </div>
            )}

            {/* Reticle corners */}
            {corners.map((c, i) => (
              <div key={i} style={{
                ...cornerBase, ...c,
                animation: anim(`reticleLock 700ms var(--ease) both, reticleBreath 2.8s ease-in-out 700ms infinite`),
              }} />
            ))}

            {/* Edge-detection squares */}
            {!reduced.current && edgeSquares.map((p, i) => (
              <div key={i} style={{
                position: 'absolute', ...p, width: 9, height: 9, borderRadius: 2,
                border: `1.5px solid ${GOLD}`, filter: 'drop-shadow(0 0 4px rgba(217,119,6,0.6))',
                animation: `edgeBlink 2.4s ease-in-out ${(i * 0.5).toFixed(2)}s infinite`,
              }} />
            ))}
          </div>
        </div>

        {/* Volumetric laser (full-cell layer sweeping vertically) */}
        {!reduced.current && (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', animation: 'laserSweep 2.86s ease-in-out infinite' }}>
            {/* volumetric band */}
            <div style={{
              position: 'absolute', top: 0, left: '7%', right: '7%', height: 96,
              background: 'linear-gradient(rgba(37,99,235,0.20), transparent)',
              maskImage: 'repeating-linear-gradient(rgba(0,0,0,0.9) 0 1px, transparent 1px 6px)',
              WebkitMaskImage: 'repeating-linear-gradient(rgba(0,0,0,0.9) 0 1px, transparent 1px 6px)',
            }} />
            {/* core line */}
            <div style={{
              position: 'absolute', top: 0, left: '7%', right: '7%', height: 2, borderRadius: 2,
              background: 'linear-gradient(90deg, transparent, #bfdbfe, #ffffff, #bfdbfe, transparent)',
              boxShadow: '0 0 16px var(--accent), 0 0 6px var(--accent)',
            }}>
              <span style={{ position: 'absolute', top: '50%', left: '4%', width: 6, height: 6, marginTop: -3, borderRadius: '50%', background: '#fff', boxShadow: '0 0 8px var(--accent)' }} />
              <span style={{ position: 'absolute', top: '50%', right: '4%', width: 6, height: 6, marginTop: -3, borderRadius: '50%', background: '#fff', boxShadow: '0 0 8px var(--accent)' }} />
            </div>
          </div>
        )}

        {/* Data dots rising */}
        {!reduced.current && dataDots.map((d, i) => (
          <span key={i} style={{
            position: 'absolute', bottom: '24%', left: d.left, width: d.size, height: d.size, borderRadius: '50%',
            background: d.color, boxShadow: `0 0 6px ${d.color}`, opacity: 0,
            animation: `dataRise 3s ease-in ${d.delay} infinite`,
          }} />
        ))}

        {/* HUD */}
        <div style={{ position: 'absolute', top: 16, left: 16, ...hudMono, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: OK, boxShadow: `0 0 6px ${OK}`, animation: anim('hudBlink 1s steps(1) infinite') }} />
          SCANNING
        </div>
        <div style={{ position: 'absolute', top: 16, right: 16, ...hudMono, color: 'var(--accent)' }}>AI · OCR</div>
        <div style={{ position: 'absolute', bottom: 16, left: 16, ...hudMono, color: GOLD }}>EDGE-LOCK ✓</div>
        <div style={{ position: 'absolute', bottom: 16, left: 0, right: 0, textAlign: 'center', ...hudMono, color: 'var(--text)', fontSize: 13 }}>
          {Math.round(pct)}% ANALYZING
        </div>

        {/* Hebrew status (and reduced-motion label) */}
        <div style={{ position: 'absolute', bottom: 38, left: 0, right: 0, textAlign: 'center', fontFamily: 'var(--font-main)', fontSize: 13.5, fontWeight: 600, color: 'var(--text-mute)' }}>
          {reduced.current ? 'מעבד את הקבלה…' : 'מנתח את הקבלה…'}
        </div>

        {/* Success flash */}
        {success && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(2px)' }}>
            <div style={{ width: 76, height: 76, borderRadius: '50%', background: 'var(--ok)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 30px rgba(22,163,74,0.4)', animation: 'successPop 460ms var(--ease) both' }}>
              <Check size={42} color="#fff" strokeWidth={3} />
            </div>
            <div style={{ fontFamily: 'var(--font-main)', fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>הקבלה נסרקה!</div>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
