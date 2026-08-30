import { useEffect, useState } from 'react'
import { FileText, Receipt } from 'lucide-react'
import { signedReceiptUrl } from '../lib/storage'

// Cache resolved thumbnail URLs per storage path so scrolling / re-renders don't
// re-sign the same object. Signed URLs live ~1h; a page session is far shorter.
const thumbCache = new Map()

/**
 * Lazy receipt thumbnail (audit C1). Loads a small (96px) image straight from the
 * private Storage bucket via a signed URL — no base64 ever rides in the DB row.
 * Falls back to an inline data-URL (legacy/unmigrated rows) or a type icon.
 */
export default function ReceiptThumb({ storagePath, inlineImage, size = 44, onClick, title }) {
  const isPdf = !!storagePath && /\.pdf$/i.test(storagePath)
  const [url, setUrl] = useState(() =>
    (storagePath && thumbCache.get(storagePath)) ||
    (typeof inlineImage === 'string' && inlineImage.startsWith('data:') ? inlineImage : null))

  useEffect(() => {
    let alive = true
    if (!storagePath || isPdf) return
    if (thumbCache.has(storagePath)) { setUrl(thumbCache.get(storagePath)); return }
    ;(async () => {
      const u = await signedReceiptUrl(storagePath, 3600, { width: 96, height: 96, resize: 'cover', quality: 60 })
      if (!alive) return
      if (u) { thumbCache.set(storagePath, u); setUrl(u) }
    })()
    return () => { alive = false }
  }, [storagePath, isPdf])

  const box = {
    width: size, height: size, borderRadius: 8, overflow: 'hidden', flexShrink: 0, padding: 0,
    border: `1px solid ${storagePath ? 'var(--accent)' : 'var(--border)'}`,
    background: storagePath ? 'var(--accent-bg)' : 'var(--panel-2)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: onClick ? 'pointer' : 'default',
  }
  return (
    <button type="button" onClick={onClick} title={title} style={box}>
      {url && !isPdf
        ? <img src={url} alt="קבלה" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : (storagePath
            ? <FileText size={17} style={{ color: 'var(--accent)' }} />
            : <Receipt size={16} style={{ color: 'var(--text-mute)' }} />)}
    </button>
  )
}
