import { Suspense, lazy, useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { SettingsProvider } from './hooks/useSettings'
import { useAppUpdate } from './hooks/useAppUpdate'
import LoadingSpinner from './components/ui/LoadingSpinner'
import { Receipt, Tag, Camera, RefreshCw, LogOut, BarChart2, Settings } from 'lucide-react'

const LoginPage       = lazy(() => import('./pages/LoginPage'))
const ReceiptsPage    = lazy(() => import('./pages/ReceiptsPage'))
const CategoriesPage  = lazy(() => import('./pages/CategoriesPage'))
const DashboardPage   = lazy(() => import('./pages/DashboardPage'))
const SettingsPage    = lazy(() => import('./pages/SettingsPage'))

// Reactive mobile detection
function useIsMobile() {
  const [v, setV] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const h = () => setV(window.innerWidth < 768)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])
  return v
}

// ── Update banner ─────────────────────────────────────────────────────────────
function UpdateBanner() {
  const { updateAvailable, latestVersion, applyUpdate, dismissUpdate } = useAppUpdate()
  if (!updateAvailable) return null
  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9999,
      background: 'var(--accent)', color: 'white',
      padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: '12px', fontFamily: 'var(--font-main)', fontSize: '13px', fontWeight: 500,
    }} dir="rtl">
      <span>גרסה חדשה {latestVersion} זמינה</span>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button onClick={applyUpdate} style={{ padding: '6px 14px', background: 'white', color: 'var(--accent)', border: 'none', borderRadius: '6px', fontWeight: 700, cursor: 'pointer', fontSize: '13px', fontFamily: 'var(--font-main)', display: 'flex', alignItems: 'center', gap: '5px' }}>
          <RefreshCw size={12} /> עדכן עכשיו
        </button>
        <button onClick={dismissUpdate} style={{ padding: '6px 10px', background: 'transparent', color: 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,255,255,0.4)', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontFamily: 'var(--font-main)' }}>
          אחר כך
        </button>
      </div>
    </div>
  )
}

// ── Top navigation (desktop ≥ 768px) ─────────────────────────────────────────
function TopNav({ onSignOut }) {
  const location = useLocation()
  const isReceipts   = location.pathname === '/'
  const isCategories = location.pathname === '/categories'

  const navBtn = (active) => ({
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px',
    padding: '6px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer',
    background: active ? 'var(--accent-bg)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--text-mute)',
    fontFamily: 'var(--font-main)', fontSize: '11px', fontWeight: active ? 600 : 400,
    textDecoration: 'none', transition: 'all 140ms',
  })

  return (
    <nav style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 20px', height: '56px',
      background: 'var(--panel)', borderBottom: '1px solid var(--border)',
      position: 'sticky', top: 0, zIndex: 100,
    }} dir="rtl">
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{ width: 28, height: 28, borderRadius: '7px', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: 'white', fontSize: '14px', fontWeight: 700 }}>₪</span>
        </div>
        <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text)' }}>מנהל קבלות</span>
      </div>
      {/* Nav links */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <Link to="/" style={navBtn(isReceipts)}>
          <Receipt size={16} /> קבלות
        </Link>
        <Link to="/dashboard" style={navBtn(location.pathname === '/dashboard')}>
          <BarChart2 size={16} /> דשבורד
        </Link>
        <Link to="/categories" style={navBtn(isCategories)}>
          <Tag size={16} /> קטגוריות
        </Link>
        <Link to="/settings" style={navBtn(location.pathname === '/settings')}>
          <Settings size={16} /> הגדרות
        </Link>
      </div>
      {/* Sign out */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--ok)', boxShadow: '0 0 0 3px rgba(22,163,74,0.15)' }} />
        <button onClick={onSignOut} style={{ padding: '6px 12px', background: 'none', border: '1px solid var(--border)', borderRadius: '7px', color: 'var(--text-mute)', fontSize: '12px', cursor: 'pointer', fontFamily: 'var(--font-main)', display: 'flex', alignItems: 'center', gap: '5px' }}>
          <LogOut size={12} /> התנתק
        </button>
      </div>
    </nav>
  )
}

// ── Bottom navigation (mobile < 768px) ────────────────────────────────────────
// The center FAB triggers the scan flow by navigating to /?scan=1.
// ReceiptsPage watches for that param and auto-starts the camera/file picker.
function BottomNav({ onSignOut }) {
  const location = useLocation()
  const navigate  = useNavigate()
  const isReceipts   = location.pathname === '/'
  const isCategories = location.pathname === '/categories'

  const tabStyle = (active) => ({
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px',
    padding: '8px 0 4px', flex: 1, border: 'none', cursor: 'pointer',
    background: 'transparent', textDecoration: 'none',
    color: active ? 'var(--accent)' : 'var(--text-mute)',
    fontFamily: 'var(--font-main)', fontSize: '10.5px', fontWeight: active ? 600 : 400,
  })

  function handleScanTap() {
    // Navigate to receipts page and set ?scan=1 — ReceiptsPage handles it
    navigate('/')
    // Use a tiny delay so ReceiptsPage is mounted before we push the param
    setTimeout(() => {
      const url = new URL(window.location.href)
      url.searchParams.set('scan', '1')
      window.history.replaceState({}, '', url.toString())
      window.dispatchEvent(new Event('receipts-scan'))
    }, 50)
  }

  return (
    <nav style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
      background: 'var(--panel)',
      borderTop: '1px solid var(--border)',
      display: 'flex', alignItems: 'center',
      // iOS safe area — pushes content above home indicator
      paddingBottom: 'env(safe-area-inset-bottom)',
      minHeight: '56px',
    }} dir="rtl">
      {/* Receipts */}
      <Link to="/" style={tabStyle(isReceipts)}>
        <Receipt size={21} />
        <span>קבלות</span>
      </Link>

      {/* Dashboard */}
      <Link to="/dashboard" style={tabStyle(location.pathname === '/dashboard')}>
        <BarChart2 size={21} />
        <span>דשבורד</span>
      </Link>

      {/* Scan FAB — elevated center button */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
        <button
          onClick={handleScanTap}
          style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'linear-gradient(135deg,#2563eb,#1d4ed8)',
            border: '3px solid var(--bg)',
            boxShadow: '0 4px 18px rgba(37,99,235,0.45)',
            color: 'white', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transform: 'translateY(-14px)',
            transition: 'transform 120ms, box-shadow 120ms',
            touchAction: 'manipulation',
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-17px)'; e.currentTarget.style.boxShadow = '0 7px 22px rgba(37,99,235,0.55)' }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(-14px)'; e.currentTarget.style.boxShadow = '0 4px 18px rgba(37,99,235,0.45)' }}
          aria-label="סרוק קבלה"
        >
          <Camera size={24} />
        </button>
      </div>

      {/* Categories */}
      <Link to="/categories" style={tabStyle(isCategories)}>
        <Tag size={21} />
        <span>קטגוריות</span>
      </Link>

      {/* Settings */}
      <Link to="/settings" style={tabStyle(location.pathname === '/settings')}>
        <Settings size={21} />
        <span>הגדרות</span>
      </Link>
    </nav>
  )
}

// ── App shell ─────────────────────────────────────────────────────────────────
function AppShell() {
  const { user, signOut, loading } = useAuth()
  const isMobile  = useIsMobile()
  const location  = useLocation()

  if (loading) return <LoadingSpinner />
  if (!user)   return <Navigate to="/login" replace />

  // Bottom nav height + safe-area — content shouldn't be hidden behind it
  const bottomPad = isMobile ? 'calc(70px + env(safe-area-inset-bottom))' : 0

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)' }}>
      {/* Top nav — desktop / tablet only */}
      {!isMobile && <TopNav onSignOut={signOut} />}

      {/* Page content */}
      <main style={{
        padding: isMobile ? '16px 14px' : '24px 20px',
        maxWidth: location.pathname === '/dashboard' ? '1100px' : '900px',
        margin: '0 auto',
        paddingBottom: isMobile ? bottomPad : '32px',
      }}>
        <Suspense fallback={<LoadingSpinner />}>
          <Routes>
            <Route path="/"           element={<ReceiptsPage />} />
            <Route path="/dashboard"  element={<DashboardPage />} />
            <Route path="/categories" element={<CategoriesPage />} />
            <Route path="/settings"   element={<SettingsPage />} />
            <Route path="*"           element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>

      {/* Bottom nav — mobile only */}
      {isMobile && <BottomNav onSignOut={signOut} />}

      <UpdateBanner />
    </div>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <AuthProvider>
      <SettingsProvider>
        <BrowserRouter>
          <Toaster
            position="top-center"
            toastOptions={{
              style: { fontFamily: 'var(--font-main)', fontSize: '13.5px', direction: 'rtl', borderRadius: '10px', boxShadow: 'var(--shadow-modal)' },
              duration: 4000,
            }}
          />
          <Suspense fallback={<LoadingSpinner />}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/*"     element={<AppShell />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </SettingsProvider>
    </AuthProvider>
  )
}
