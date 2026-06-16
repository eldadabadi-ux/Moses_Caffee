import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// ── PWA install prompt capture (must be set up early — the event fires fast) ──
window.__deferredInstallPrompt = null
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  window.__deferredInstallPrompt = e
  window.dispatchEvent(new Event('pwa-installable'))
})
window.addEventListener('appinstalled', () => {
  window.__deferredInstallPrompt = null
  window.dispatchEvent(new Event('pwa-installed'))
})

function cacheBustingReload() {
  const url = new URL(window.location.href)
  url.searchParams.set('_r', Date.now().toString())
  window.location.replace(url.toString())
}

const isCacheBustReload = new URLSearchParams(window.location.search).has('_r')

if (isCacheBustReload) {
  const u = new URL(window.location.href)
  u.searchParams.delete('_r')
  window.history.replaceState({}, '', u.toString())
} else {
  fetch('/version.json', { cache: 'no-store' })
    .then(r => r.json())
    .then(({ version }) => {
      if (version && version !== import.meta.env.VITE_APP_VERSION) cacheBustingReload()
    })
    .catch(() => {})
}

if ('serviceWorker' in navigator) {
  let reloading = false
  function swReload() { if (reloading) return; reloading = true; cacheBustingReload() }
  // On the first visit the SW installs and claims control, firing
  // 'controllerchange' once — reloading there is a spurious full-page refresh.
  // Only reload when an EXISTING controller is replaced (a genuine update).
  const hadController = !!navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'SW_RESET_RELOAD') swReload() })
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) swReload() })
  if (!isCacheBustReload) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {})
    })
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
