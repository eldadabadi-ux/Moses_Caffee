import { useState, useEffect } from 'react'

/**
 * useInstall — PWA install state for Android (beforeinstallprompt) + iOS (manual).
 * The deferred prompt is captured early in main.jsx on window.__deferredInstallPrompt.
 */
export function useInstall() {
  const [, force] = useState(0)

  useEffect(() => {
    const bump = () => force(x => x + 1)
    window.addEventListener('pwa-installable', bump)
    window.addEventListener('pwa-installed', bump)
    return () => {
      window.removeEventListener('pwa-installable', bump)
      window.removeEventListener('pwa-installed', bump)
    }
  }, [])

  const ua = navigator.userAgent || ''
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document)
  const isAndroid = /android/i.test(ua)
  const isStandalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true

  const canInstall = !!window.__deferredInstallPrompt

  async function promptInstall() {
    const dp = window.__deferredInstallPrompt
    if (!dp) return false
    dp.prompt()
    const { outcome } = await dp.userChoice
    if (outcome === 'accepted') {
      window.__deferredInstallPrompt = null
      window.dispatchEvent(new Event('pwa-installed'))
    }
    return outcome === 'accepted'
  }

  return { canInstall, promptInstall, isIOS, isAndroid, isStandalone }
}
