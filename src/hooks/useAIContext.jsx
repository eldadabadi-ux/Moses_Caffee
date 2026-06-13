/**
 * useAIContext — current screen name + path for the AI assistant.
 * All app data is fetched server-side in functions/api/chat.js (service role).
 */
import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'

const ROUTE_NAMES = {
  '/':           'דשבורד',
  '/receipts':   'קבלות',
  '/categories': 'קטגוריות',
  '/suppliers':  'ספקים',
  '/settings':   'הגדרות',
}

function resolveScreen(pathname) {
  if (ROUTE_NAMES[pathname]) return ROUTE_NAMES[pathname]
  for (const [prefix, label] of Object.entries(ROUTE_NAMES)) {
    if (prefix !== '/' && pathname.startsWith(prefix + '/')) return label
  }
  return 'מסך לא ידוע'
}

export function useAIContext() {
  const location = useLocation()
  const screen = useMemo(() => resolveScreen(location.pathname), [location.pathname])
  return { screen, path: location.pathname }
}
