import { Suspense, lazy, useState, useEffect, useTransition } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { SettingsProvider, useSettings } from './hooks/useSettings'
import { TenantProvider, useBrand } from './hooks/useTenant'
import { useAppUpdate } from './hooks/useAppUpdate'
import { clearPageCache } from './lib/pageCache'
import { prefetchAllPages } from './lib/prefetch'
import LoadingSpinner from './components/ui/LoadingSpinner'
import MonthlyExportPrompt from './components/MonthlyExportPrompt'
import InstallBanner from './components/InstallBanner'
import DailyBackup from './components/DailyBackup'
import AIChatWidget from './components/AIChatWidget'
import CookieConsent from './components/CookieConsent'
import Sidebar from './components/Sidebar'
import { Receipt, Tag, Camera, RefreshCw, LogOut, BarChart2, Settings, Menu, Store } from 'lucide-react'

const LoginPage          = lazy(() => import('./pages/LoginPage'))
const ResetPasswordPage  = lazy(() => import('./pages/ResetPasswordPage'))
const PrivacyPage        = lazy(() => import('./pages/PrivacyPage'))
const TermsPage          = lazy(() => import('./pages/TermsPage'))
const AccessibilityPage  = lazy(() => import('./pages/AccessibilityPage'))
const ReceiptsPage    = lazy(() => import('./pages/ReceiptsPage'))
const CategoriesPage  = lazy(() => import('./pages/CategoriesPage'))
const DashboardPage   = lazy(() => import('./pages/DashboardPage'))
const SettingsPage    = lazy(() => import('./pages/SettingsPage'))
const SuppliersPage   = lazy(() => import('./pages/SuppliersPage'))
const AdminPage       = lazy(() => import('./pages/AdminPage'))

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

// ── Brand logo (round) — business logo or ₪ placeholder ──────────────────────
function BrandLogo({ size = 30 }) {
  const { logo } = useBrand()
  if (logo) {
    return <img src={logo} alt="לוגו" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '1px solid var(--border)' }} />
  }
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <span style={{ color: 'white', fontSize: size * 0.5, fontWeight: 700 }}>₪</span>
    </div>
  )
}

// ── Top navigation (desktop ≥ 768px) ─────────────────────────────────────────
function TopNav({ onSignOut }) {
  const location = useLocation()
  const { businessName } = useBrand()
  const isCategories = location.pathname === '/categories'

  const navBtn = (active) => ({
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px',
    padding: '6px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer',
    background: active ? 'var(--accent-bg)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--text-mute)',
    fontFamily: 'var(--font-main)', fontSize: '14px', fontWeight: active ? 600 : 400,
    textDecoration: 'none', transition: 'all 140ms',
  })

  return (
    <nav style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 20px', height: '64px',
      background: 'var(--panel)', borderBottom: '1px solid var(--border)',
      position: 'sticky', top: 0, zIndex: 100,
    }} dir="rtl">
      {/* Logo (top-right in RTL) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <BrandLogo size={34} />
        <span style={{ fontWeight: 700, fontSize: '17px', color: 'var(--text)' }}>{businessName}</span>
      </div>
      {/* Nav links */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <Link to="/" style={navBtn(location.pathname === '/')}>
          <BarChart2 size={18} /> דשבורד
        </Link>
        <Link to="/receipts" style={navBtn(location.pathname === '/receipts')}>
          <Receipt size={18} /> קבלות
        </Link>
        <Link to="/categories" style={navBtn(isCategories)}>
          <Tag size={18} /> קטגוריות
        </Link>
        <Link to="/settings" style={navBtn(location.pathname === '/settings')}>
          <Settings size={18} /> הגדרות
        </Link>
      </div>
      {/* Sign out */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--ok)', boxShadow: '0 0 0 3px rgba(22,163,74,0.15)' }} />
        <button onClick={onSignOut} style={{ padding: '7px 14px', background: 'none', border: '1px solid var(--border)', borderRadius: '7px', color: 'var(--text-mute)', fontSize: '15px', cursor: 'pointer', fontFamily: 'var(--font-main)', display: 'flex', alignItems: 'center', gap: '5px' }}>
          <LogOut size={14} /> התנתק
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
  const isSuppliers = location.pathname === '/suppliers'

  const tabStyle = (active) => ({
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px',
    padding: '8px 0 4px', flex: 1, border: 'none', cursor: 'pointer',
    background: 'transparent', textDecoration: 'none',
    color: active ? 'var(--accent)' : 'var(--text-mute)',
    fontFamily: 'var(--font-main)', fontSize: '13px', fontWeight: active ? 600 : 400,
  })

  function handleScanTap() {
    // Receipts now lives at /receipts. Navigate there with ?scan=1 (read on
    // mount) and also fire the event in case the page is already mounted.
    navigate('/receipts?scan=1')
    setTimeout(() => window.dispatchEvent(new Event('receipts-scan')), 60)
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
      {/* Dashboard — rightmost (home) */}
      <Link to="/" style={tabStyle(location.pathname === '/')}>
        <BarChart2 size={21} />
        <span>דשבורד</span>
      </Link>

      {/* Receipts */}
      <Link to="/receipts" style={tabStyle(location.pathname === '/receipts')}>
        <Receipt size={21} />
        <span>קבלות</span>
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

      {/* Suppliers — quick access */}
      <Link to="/suppliers" style={tabStyle(isSuppliers)}>
        <Store size={21} />
        <span>ספקים</span>
      </Link>

      {/* Settings */}
      <Link to="/settings" style={tabStyle(location.pathname === '/settings')}>
        <Settings size={21} />
        <span>הגדרות</span>
      </Link>
    </nav>
  )
}

// ── Mobile header — slim bar with hamburger + logo + business name ───────────
function MobileHeader({ onMenu }) {
  const { businessName } = useBrand()
  return (
    <header style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 12px', height: '52px',
      background: 'var(--panel)', borderBottom: '1px solid var(--border)',
      position: 'sticky', top: 0, zIndex: 90,
    }} dir="rtl">
      <button onClick={onMenu} aria-label="תפריט" style={{ padding: '8px', background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', display: 'flex' }}>
        <Menu size={24} />
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
        <span style={{ fontWeight: 700, fontSize: '16px', color: 'var(--text)' }}>{businessName}</span>
        <BrandLogo size={32} />
      </div>
    </header>
  )
}

// ── App shell ─────────────────────────────────────────────────────────────────

function AppShell() {
  const { user, signOut, loading } = useAuth()
  const isMobile  = useIsMobile()
  const location  = useLocation()
  // The page actually rendered. We update it inside a transition so that while
  // the next tab's lazy chunk (or first data) loads, React keeps the CURRENT
  // page on screen instead of flashing the Suspense fallback — no blank/loading
  // feeling on tab switches. The nav highlights the new tab immediately (it uses
  // the real location), only the content waits for the new page to be ready.
  const [displayLocation, setDisplayLocation] = useState(location)
  const [, startNavTransition] = useTransition()
  useEffect(() => {
    startNavTransition(() => setDisplayLocation(location))
  }, [location]) // eslint-disable-line react-hooks/exhaustive-deps
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try { return localStorage.getItem('moses_sidebar_open') !== '0' } catch { return true }
  })
  function toggleSidebar() {
    setSidebarOpen(o => { const n = !o; try { localStorage.setItem('moses_sidebar_open', n ? '1' : '0') } catch {} ; return n })
  }

  // Kick off ALL route chunk loads immediately so the first switch to each tab is
  // instant; the navigation transition above hides any remaining load time.
  useEffect(() => {
    import('./pages/DashboardPage'); import('./pages/ReceiptsPage')
    import('./pages/CategoriesPage'); import('./pages/SuppliersPage')
    import('./pages/SettingsPage'); import('./pages/AdminPage')
  }, [])

  // Warm the data cache for the other tabs while on the home page, so the first
  // switch to each tab shows instantly (no data spinner).
  useEffect(() => { if (user) prefetchAllPages(user) }, [user])

  // Drop cached page data on sign-out so a different account never sees it.
  const handleSignOut = () => { clearPageCache(); signOut() }

  if (loading) return <LoadingSpinner />
  if (!user)   return <Navigate to="/login" replace />

  const bottomPad = isMobile ? 'calc(70px + env(safe-area-inset-bottom))' : 0
  const desktopSidebar = !isMobile && sidebarOpen

  // The sidebar is a fixed OVERLAY (it floats above the content), so the page
  // content never reflows/moves when the sidebar opens or closes.
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)' }}>
      {/* Desktop: fixed sidebar (right, RTL), collapsible. Mobile: slim header + drawer. */}
      {desktopSidebar && <Sidebar onSignOut={handleSignOut} onCollapse={toggleSidebar} />}
      {/* Desktop: floating "open" button when the sidebar is collapsed */}
      {!isMobile && !sidebarOpen && (
        <button onClick={toggleSidebar} aria-label="פתח תפריט"
          style={{ position: 'fixed', top: 14, right: 14, zIndex: 120, display: 'flex', alignItems: 'center', gap: 7, padding: '9px 14px', borderRadius: 10, background: 'var(--panel)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)', color: 'var(--text)', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-main)' }}>
          <Menu size={18} /> תפריט
        </button>
      )}
      {isMobile && <MobileHeader onMenu={() => setDrawerOpen(true)} />}
      {isMobile && drawerOpen && (
        <>
          <div onClick={() => setDrawerOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 199, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }} />
          <Sidebar drawer onSignOut={handleSignOut} onClose={() => setDrawerOpen(false)} onNavigate={() => setDrawerOpen(false)} />
        </>
      )}

      {/* Page content */}
      <main style={{
        padding: isMobile ? '16px 14px' : '24px 28px',
        maxWidth: displayLocation.pathname === '/' ? '1100px' : '900px',
        margin: '0 auto',
        paddingBottom: isMobile ? bottomPad : '32px',
      }}>
        <InstallBanner />
        <Suspense fallback={<LoadingSpinner />}>
          <Routes location={displayLocation}>
            <Route path="/"           element={<DashboardPage />} />
            <Route path="/receipts"   element={<ReceiptsPage />} />
            <Route path="/dashboard"  element={<Navigate to="/" replace />} />
            <Route path="/categories" element={<CategoriesPage />} />
            <Route path="/suppliers"  element={<SuppliersPage />} />
            <Route path="/settings"   element={<SettingsPage />} />
            <Route path="/admin"      element={<AdminPage />} />
            <Route path="*"           element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>

      {/* Bottom nav — mobile only (quick access; full nav is the drawer) */}
      {isMobile && <BottomNav onSignOut={handleSignOut} />}

      {/* End-of-month export reminder */}
      <MonthlyExportPrompt />

      {/* Daily JSON backup */}
      <DailyBackup />

      {/* AI assistant — floating bot */}
      <AIChatWidget />

      <UpdateBanner />
    </div>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <AuthProvider>
      <SettingsProvider>
        <TenantProvider>
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
              <Route path="/login"          element={<LoginPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/privacy"        element={<PrivacyPage />} />
              <Route path="/terms"          element={<TermsPage />} />
              <Route path="/accessibility"  element={<AccessibilityPage />} />
              <Route path="/*"              element={<AppShell />} />
            </Routes>
          </Suspense>
          <CookieConsent />
        </BrowserRouter>
        </TenantProvider>
      </SettingsProvider>
    </AuthProvider>
  )
}
