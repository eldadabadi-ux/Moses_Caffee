/**
 * useSettings — manages user preferences for VAT rate and display mode.
 *
 * Storage: localStorage (instant) + Supabase user_settings (persistent across devices).
 * On mount: loads from localStorage immediately, then syncs from Supabase.
 */
import { useState, useEffect, useCallback, createContext, useContext } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

const STORAGE_KEY = 'receipts_settings_v1'

const DEFAULT_SETTINGS = {
  vatRate:     18,     // current Israeli VAT rate
  showWithVat: true,   // true = show prices WITH VAT, false = show prices WITHOUT VAT
  logo:        null,   // base64 data URL of the business logo
  businessName: 'מנהל קבלות', // shown next to the logo
  reminderTiming: 'start',    // 'start' (1st) | 'mid' (15th) | 'end' (last day)
}

function loadLocal() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return {
      vatRate:      typeof s.vatRate     === 'number'  ? s.vatRate     : DEFAULT_SETTINGS.vatRate,
      showWithVat:  typeof s.showWithVat === 'boolean' ? s.showWithVat : DEFAULT_SETTINGS.showWithVat,
      logo:         typeof s.logo        === 'string'  ? s.logo        : DEFAULT_SETTINGS.logo,
      businessName: typeof s.businessName === 'string' && s.businessName ? s.businessName : DEFAULT_SETTINGS.businessName,
      reminderTiming: ['start','mid','end'].includes(s.reminderTiming) ? s.reminderTiming : DEFAULT_SETTINGS.reminderTiming,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function saveLocal(settings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)) } catch {}
}

const SettingsContext = createContext(null)

export function SettingsProvider({ children }) {
  const { user } = useAuth()
  const [settings, setSettings] = useState(loadLocal)
  const [saving, setSaving] = useState(false)

  // Sync from Supabase on mount/login — pulls all settings incl. logo so they
  // appear on every device. Falls back to localStorage if the table is missing.
  useEffect(() => {
    if (!user) return
    supabase
      .from('user_settings')
      .select('vat_rate, show_with_vat, logo, business_name, reminder_timing')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          const s = {
            vatRate:        data.vat_rate ?? DEFAULT_SETTINGS.vatRate,
            showWithVat:    typeof data.show_with_vat === 'boolean' ? data.show_with_vat : DEFAULT_SETTINGS.showWithVat,
            logo:           data.logo ?? null,
            businessName:   data.business_name || DEFAULT_SETTINGS.businessName,
            reminderTiming: ['start','mid','end'].includes(data.reminder_timing) ? data.reminder_timing : DEFAULT_SETTINGS.reminderTiming,
          }
          setSettings(s)
          saveLocal(s)
        }
      })
      .catch(() => {}) // table might not exist yet
  }, [user?.id])

  const updateSettings = useCallback(async (patch) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveLocal(next)

    if (!user) return
    setSaving(true)
    try {
      await supabase.from('user_settings').upsert({
        user_id:         user.id,
        vat_rate:        next.vatRate,
        show_with_vat:   next.showWithVat,
        logo:            next.logo,
        business_name:   next.businessName,
        reminder_timing: next.reminderTiming,
        updated_at:      new Date().toISOString(),
      }, { onConflict: 'user_id' })
    } catch {} finally { setSaving(false) }
  }, [settings, user])

  // Quick toggle — doesn't write to Supabase, just local preference
  const toggleVatDisplay = useCallback(() => {
    updateSettings({ showWithVat: !settings.showWithVat })
  }, [settings.showWithVat, updateSettings])

  /**
   * Apply VAT display to an amount:
   * - showWithVat = true  → return amount as-is (already with VAT)
   * - showWithVat = false → return amount_before_vat if available, or calculate
   */
  const displayAmount = useCallback((amountWithVat, amountBeforeVat) => {
    if (settings.showWithVat) return amountWithVat || 0
    if (amountBeforeVat != null && amountBeforeVat > 0) return amountBeforeVat
    // Fallback: calculate from total using current VAT rate
    return Math.round((amountWithVat || 0) / (1 + settings.vatRate / 100) * 100) / 100
  }, [settings.showWithVat, settings.vatRate])

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, toggleVatDisplay, displayAmount, saving }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  return useContext(SettingsContext)
}
