/**
 * flags (client) — re-export of the ONE implementation in
 * functions/api/_lib/flags.js (guardrail 2 — SSOT), plus the React hook.
 */
import { useState, useEffect } from 'react'
import { supabase } from './supabase'
import { FLAG_DEFAULTS, resolveFlags } from '../../functions/api/_lib/flags.js'

export { FLAG_DEFAULTS, FLAG_KEYS, resolveFlags } from '../../functions/api/_lib/flags.js'

/**
 * Flags for the signed-in user's tenant.
 *
 * Starts from the code defaults so the first render is never blank or wrong in
 * the "everything is off" direction, then refines once the rows arrive. RLS
 * already limits the rows to globals plus this org's overrides.
 */
export function useFeatureFlags() {
  const [flags, setFlags] = useState(FLAG_DEFAULTS)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { data, error } = await supabase.from('feature_flags').select('key, org_id, enabled')
        if (error || !alive || !data) return
        // The caller's org is whichever non-null org_id came back — RLS returns
        // only their own, so there is nothing to disambiguate.
        const orgId = data.find(r => r.org_id)?.org_id || null
        setFlags(resolveFlags(data, orgId))
      } catch { /* keep the defaults */ }
    })()
    return () => { alive = false }
  }, [])

  return flags
}
