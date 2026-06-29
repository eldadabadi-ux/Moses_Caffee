import { useState } from 'react'
import { useInstall } from '../hooks/useInstall'
import { Download, Share, X, Smartphone } from 'lucide-react'
import toast from 'react-hot-toast'

const KEY = 'moses_install_dismissed'

export default function InstallBanner() {
  const { canInstall, promptInstall, isIOS, isStandalone } = useInstall()
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(KEY) === '1' } catch { return false }
  })

  // Show when not already installed and not dismissed — on desktop AND mobile.
  if (isStandalone || dismissed) return null
  if (!canInstall && !isIOS) return null  // nothing actionable to show (no prompt captured)

  function close() {
    try { localStorage.setItem(KEY, '1') } catch {}
    setDismissed(true)
  }

  return (
    <div dir="rtl" style={{
      margin: '0 0 14px', padding: '12px 14px', borderRadius: 12,
      background: 'var(--accent-bg)', border: '1px solid var(--accent-tint-border)',
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <Smartphone size={22} style={{ color: 'var(--accent)', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text)' }}>התקן את האפליקציה</div>
        {isIOS && !canInstall && (
          <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            שיתוף <Share size={15} style={{ color: 'var(--accent)' }} /> ← "הוסף למסך הבית"
          </div>
        )}
      </div>
      {canInstall && (
        <button onClick={async () => { const ok = await promptInstall(); if (ok) { toast.success('האפליקציה מותקנת!'); close() } }}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 9, border: 'none', background: 'var(--accent)', color: 'white', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-main)', flexShrink: 0 }}>
          <Download size={15} /> התקן
        </button>
      )}
      <button onClick={close} aria-label="סגור" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-mute)', padding: 4, display: 'flex', flexShrink: 0 }}>
        <X size={18} />
      </button>
    </div>
  )
}
