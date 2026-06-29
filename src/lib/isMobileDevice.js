/**
 * isMobileDevice — true on phones/tablets (device-based, via user agent), NOT a
 * viewport-width check. Used to keep file backups/exports on the desktop website
 * only (a narrow desktop window should still allow them).
 */
export function isMobileDevice() {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '')
}
