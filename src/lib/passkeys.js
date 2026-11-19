/**
 * passkeys — Face ID / Touch ID / Windows Hello sign-in (WebAuthn), added
 * 19.11.26 after the café client found the authenticator code a daily burden.
 *
 * A passkey is NOT a weakening of the 2FA it can replace: the private key is
 * bound to the device's secure element and to the domain app.eldadai.co.il, and
 * it only unlocks after a biometric/PIN check — possession AND inherence in one
 * gesture, phishing-resistant where a typed TOTP code is not (NIST SP 800-63B
 * AAL2/AAL3). The biometric itself never leaves the device: the server only
 * ever sees a public key, so no biometric data is processed by this app.
 *
 * Every call goes through supabase.auth — this module only adds capability
 * detection, a device label and Hebrew error text, so the pages stay thin.
 */
import { supabase } from './supabase'

/** Does this browser speak WebAuthn at all? */
export function passkeysSupported() {
  return typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential === 'function' &&
    !!navigator.credentials?.create
}

/**
 * Is a BUILT-IN authenticator available (Face ID / Touch ID / Windows Hello /
 * Android biometrics)? A browser can support WebAuthn with a security key only,
 * in which case "כניסה עם Face ID" would be a lie — so the button is offered
 * only when the platform itself can verify the user.
 */
export async function biometricAvailable() {
  if (!passkeysSupported()) return false
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch { return false }
}

/** A human label for the device being enrolled ("iPhone · Safari"). */
export function deviceLabel(ua = navigator.userAgent) {
  const os =
    /iPhone/i.test(ua) ? 'iPhone' :
    /iPad/i.test(ua) ? 'iPad' :
    /Android/i.test(ua) ? 'Android' :
    /Macintosh|Mac OS X/i.test(ua) ? 'Mac' :
    /Windows/i.test(ua) ? 'Windows' :
    /Linux/i.test(ua) ? 'Linux' : 'מכשיר'
  const browser =
    /Edg\//i.test(ua) ? 'Edge' :
    /OPR\//i.test(ua) ? 'Opera' :
    /Chrome\//i.test(ua) && !/Edg\//i.test(ua) ? 'Chrome' :
    /Firefox\//i.test(ua) ? 'Firefox' :
    /Safari\//i.test(ua) ? 'Safari' : ''
  return browser ? `${os} · ${browser}` : os
}

/** A credential that already exists on the account — informational, not a failure. */
export function isAlreadyRegistered(error) {
  return /InvalidStateError|(already|previously) registered|duplicate|exclude/i.test(String(error?.message || error || ''))
}

/**
 * Hebrew for the handful of outcomes a user can actually cause. A cancelled
 * ceremony is not an error worth shouting about — the caller can ignore null.
 */
export function passkeyErrorText(error) {
  const msg = String(error?.message || error || '')
  if (/NotAllowedError|abort|cancel/i.test(msg)) return null            // user dismissed the prompt
  // Not a failure worth alarming anyone: a passkey saved in Google Password
  // Manager / iCloud Keychain syncs to the user's other devices, so the second
  // device already HAS the credential and can sign in right now.
  if (/InvalidStateError|(already|previously) registered|duplicate|exclude/i.test(msg)) {
    return 'המכשיר הזה כבר רשום — אפשר להיכנס איתו בזיהוי ביומטרי כבר עכשיו'
  }
  if (/does not support|not supported/i.test(msg)) return 'המכשיר או הדפדפן אינם תומכים בכניסה ביומטרית'
  if (/not enabled|disabled|experimental/i.test(msg)) return 'יש להפעיל Passkeys בפרויקט Supabase (Authentication → Passkeys)'
  if (/no (credentials|passkey)|not found/i.test(msg)) return 'לא נמצא Passkey במכשיר הזה — היכנס עם סיסמה ולאחר מכן רשום אותו בהגדרות'
  return msg || 'הפעולה נכשלה'
}

/** Passkeys registered on the signed-in account (newest first). */
export async function listPasskeys() {
  const { data, error } = await supabase.auth.passkey.list()
  if (error) throw error
  return [...(data || [])].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
}

/**
 * Enrol THIS device. Supabase registers the credential without a name, so the
 * device label is written straight after — otherwise a user with three devices
 * sees three identical rows and cannot tell which one to revoke.
 */
export async function registerPasskey(friendlyName = deviceLabel()) {
  const { data, error } = await supabase.auth.registerPasskey()
  if (error) throw error
  if (data?.id && friendlyName) {
    try { await supabase.auth.passkey.update({ passkeyId: data.id, friendlyName: friendlyName.slice(0, 120) }) }
    catch { /* naming is cosmetic — never fail an enrolled key over it */ }
  }
  return data
}

export async function renamePasskey(passkeyId, friendlyName) {
  const { error } = await supabase.auth.passkey.update({ passkeyId, friendlyName: String(friendlyName).slice(0, 120) })
  if (error) throw error
}

export async function deletePasskey(passkeyId) {
  const { error } = await supabase.auth.passkey.delete({ passkeyId })
  if (error) throw error
}

/**
 * Sign in with a passkey. Returns the session; the auth listener picks it up
 * and the app renders as usual.
 */
export async function signInWithPasskey() {
  const { data, error } = await supabase.auth.signInWithPasskey()
  if (error) throw error
  return data?.session || null
}
