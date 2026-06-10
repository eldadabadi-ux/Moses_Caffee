/**
 * TenantContext — multi-tenant isolation provider (mirrors crm-law's useTenant).
 *
 * Backward-compatible / defensive: if the tenant tables don't exist yet
 * (before the multi_tenant migration is applied) every call no-ops and the app
 * behaves exactly as the single-tenant version. Once the migration runs it
 * auto-activates.
 *
 * useTenant():
 *   activeTenantId  — uuid of the active tenant (or null = single-tenant mode)
 *   activeTenant    — full tenant row { id, name, slug, features, ... } or null
 *   tenants         — all tenants (SuperAdmin only)
 *   isSuperAdmin    — platform owner
 *   tenantReady     — resolution finished
 *   switchTenant    — SuperAdmin: switch active tenant
 *   withTenant(q)   — adds .eq('tenant_id', id) to a query (no-op if unknown; RLS still isolates)
 *   stampTenant(o)  — adds tenant_id to an insert payload (no-op if unknown; DB trigger also fills it)
 *   features, hasFeature(key) — per-tenant feature flags (default ON unless explicitly false)
 */
import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

const SUPERADMIN_EMAIL = 'eldadabadi@gmail.com'
const lsKey = () => `rcpt_active_tenant:${window.location.hostname}`

const DEFAULT = {
  activeTenantId: null, activeTenant: null, tenants: [], isSuperAdmin: false, tenantReady: false,
  switchTenant: () => {}, withTenant: (q) => q, stampTenant: (o) => o, features: {}, hasFeature: () => true,
}

const TenantContext = createContext(null)

export function TenantProvider({ children }) {
  const { user } = useAuth()
  const isSuperAdmin = user?.email === SUPERADMIN_EMAIL
  const [activeTenantId, setActiveTenantId] = useState(null)
  const [activeTenant, setActiveTenant]     = useState(null)
  const [tenants, setTenants]               = useState([])
  const [tenantReady, setTenantReady]       = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!user) { setActiveTenantId(null); setActiveTenant(null); setTenants([]); setTenantReady(false); return }

    ;(async () => {
      try {
        const { data: prof, error: pErr } = await supabase
          .from('profiles').select('tenant_id').eq('id', user.id).maybeSingle()
        if (pErr) throw pErr
        let tid = prof?.tenant_id || null

        if (isSuperAdmin) {
          const { data: list } = await supabase.from('tenants').select('*').order('name')
          const all = list || []
          if (!cancelled) setTenants(all)
          const host  = window.location.hostname.toLowerCase()
          const saved = (() => { try { return localStorage.getItem(lsKey()) } catch { return null } })()
          const byHost = all.find(t => t.slug && host.includes(t.slug.toLowerCase()))
          tid = (saved && all.find(t => t.id === saved) ? saved : null) || byHost?.id || tid || all[0]?.id || null
          if (!cancelled) setActiveTenant(all.find(t => t.id === tid) || null)
        } else if (tid) {
          const { data: t } = await supabase.from('tenants').select('*').eq('id', tid).maybeSingle()
          if (!cancelled) setActiveTenant(t || null)
        }
        if (!cancelled) { setActiveTenantId(tid); setTenantReady(true) }
      } catch {
        // Tenant tables not present yet → single-tenant fallback (app works as today)
        if (!cancelled) { setActiveTenantId(null); setActiveTenant(null); setTenantReady(true) }
      }
    })()
    return () => { cancelled = true }
  }, [user, isSuperAdmin])

  const switchTenant = useCallback((id) => {
    if (!isSuperAdmin) return
    setActiveTenantId(id)
    setActiveTenant(tenants.find(t => t.id === id) || null)
    try { localStorage.setItem(lsKey(), id) } catch {}
  }, [isSuperAdmin, tenants])

  // Reads: scope to tenant when known (RLS enforces it regardless). No-op pre-migration.
  const withTenant  = useCallback((query) => (activeTenantId ? query.eq('tenant_id', activeTenantId) : query), [activeTenantId])
  // Writes: stamp tenant_id when known (the DB trigger is the real guarantee). No-op pre-migration.
  const stampTenant = useCallback((obj) => (activeTenantId ? { ...obj, tenant_id: activeTenantId } : obj), [activeTenantId])

  const features = activeTenant?.features || {}
  const hasFeature = useCallback((key) => features[key] !== false, [features])

  return (
    <TenantContext.Provider value={{
      activeTenantId, activeTenant, tenants, isSuperAdmin, tenantReady,
      switchTenant, withTenant, stampTenant, features, hasFeature,
    }}>
      {children}
    </TenantContext.Provider>
  )
}

export function useTenant() { return useContext(TenantContext) || DEFAULT }
export { SUPERADMIN_EMAIL }
