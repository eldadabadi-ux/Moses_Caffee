/**
 * useIsMobile — true below the 768px breakpoint, kept in sync with resize.
 *
 * Extracted from ReceiptsPage (audit M2). Most screens read window.innerWidth
 * once at render and never react to a rotation or a resized window; this is the
 * one that does.
 */
import { useState, useEffect } from 'react'

export function useIsMobile() {
  const [v, setV] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const h = () => setV(window.innerWidth < 768)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])
  return v
}
