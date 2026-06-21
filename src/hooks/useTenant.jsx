import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useSettings } from './useSettings'

/**
 * Tenant (organization) context. Resolves the signed-in user's organization via
 * their membership row, and exposes org branding + feature flags.
 *
 * DEFENSIVE: if the multi-tenant tables don't exist yet (Stage B1 migration not
 * run) or the user has no membership, it falls back to org=null and the app
 * behaves exactly as the single-tenant version. So this is safe to ship before
 * the migration is applied.
 */
const TenantContext = createContext(null)

const FALLBACK = { org: null, orgId: null, role: null, features: {}, loading: false, refresh: () => {} }

export function TenantProvider({ children }) {
  const { user } = useAuth()
  const [org, setOrg]   = useState(null)
  const [role, setRole] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!user) { setOrg(null); setRole(null); setLoading(false); return }
    try {
      const { data: mem, error: memErr } = await supabase
        .from('memberships')
        .select('org_id, role')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle()
      if (memErr || !mem) { setOrg(null); setRole(null); return }
      setRole(mem.role || null)

      const { data: o, error: orgErr } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', mem.org_id)
        .maybeSingle()
      setOrg((orgErr || !o) ? null : o)
    } catch {
      setOrg(null); setRole(null)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => { setLoading(true); load() }, [load])

  // Update org-level fields (branding, etc.). RLS (update_own_orgs) restricts this
  // to the user's own org. No-op when multi-tenancy isn't set up.
  const updateOrg = useCallback(async (patch) => {
    if (!org?.id) return
    try {
      const { data, error } = await supabase
        .from('organizations').update(patch).eq('id', org.id).select().maybeSingle()
      if (!error && data) setOrg(data)
    } catch { /* ignore — settings still saved per-user */ }
  }, [org?.id])

  const value = { org, orgId: org?.id || null, role, features: org?.features || {}, loading, refresh: load, updateOrg }
  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>
}

export function useTenant() {
  return useContext(TenantContext) || FALLBACK
}

/**
 * Branding resolver: prefer the organization's branding, fall back to the
 * per-user settings (which is also what the org was seeded from). Used by the
 * logo + business-name displays so they work with or without the migration.
 */
export function useBrand() {
  const { org } = useTenant()
  const { settings } = useSettings()
  const orgName = (org?.business_name || '').trim()
  return {
    logo: org?.logo ?? settings?.logo ?? null,
    businessName: orgName || settings?.businessName || 'מנהל קבלות',
  }
}
