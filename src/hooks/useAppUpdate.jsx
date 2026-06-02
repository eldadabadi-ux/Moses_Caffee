import { useState, useEffect, useCallback, useRef } from 'react'

const CURRENT = import.meta.env.VITE_APP_VERSION || '0.0.0'
const CHECK_INTERVAL_MS = 10 * 60 * 1000

async function fetchLatestVersion() {
  try {
    const res = await fetch('/version.json?_t=' + Date.now(), { cache: 'no-store' })
    if (!res.ok) return null
    const { version } = await res.json()
    return version || null
  } catch { return null }
}

function isNewer(remote, current) {
  if (!remote || !current) return false
  const r = remote.split('.').map(Number)
  const c = current.split('.').map(Number)
  for (let i = 0; i < Math.max(r.length, c.length); i++) {
    const rv = r[i] ?? 0; const cv = c[i] ?? 0
    if (rv > cv) return true; if (rv < cv) return false
  }
  return false
}

export function useAppUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [latestVersion, setLatestVersion]     = useState(null)
  const timerRef = useRef(null)

  const checkForUpdate = useCallback(async () => {
    try {
      const reg = await navigator.serviceWorker?.getRegistration()
      if (reg) await Promise.race([reg.update(), new Promise(r => setTimeout(r, 5000))])
    } catch (_) {}
    const latest = await fetchLatestVersion()
    if (latest && isNewer(latest, CURRENT)) { setLatestVersion(latest); setUpdateAvailable(true); return true }
    return false
  }, [])

  useEffect(() => {
    checkForUpdate()
    timerRef.current = setInterval(checkForUpdate, CHECK_INTERVAL_MS)
    return () => clearInterval(timerRef.current)
  }, [checkForUpdate])

  const applyUpdate = useCallback(() => {
    try { navigator.serviceWorker?.getRegistrations().then(regs => regs?.forEach(r => r.unregister().catch(() => {}))).catch(() => {}) } catch (_) {}
    try { caches.keys().then(keys => keys?.forEach(k => caches.delete(k).catch(() => {}))).catch(() => {}) } catch (_) {}
    window.location.href = window.location.origin + '/?_v=' + Date.now()
  }, [])

  const dismissUpdate = useCallback(() => setUpdateAvailable(false), [])

  return { updateAvailable, latestVersion, applyUpdate, checkForUpdate, dismissUpdate }
}
