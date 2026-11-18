/**
 * useAIContext — current screen name + path for the AI assistant.
 * All app data is fetched server-side in functions/api/chat.js (service role).
 */
import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'

const ROUTE_NAMES = {
  '/':                 'דשבורד',
  '/receipts':         'קבלות',
  '/categories':       'קטגוריות',
  '/suppliers':        'ספקים',
  '/suppliers/merge':  'איחוד ספקים',
  '/suppliers/budgets': 'הגבלת תקציב לספק',
  '/compare':          'השוואת ספקים',
  '/reconcile':        'התאמות',
  '/products':         'השוואת מוצרים',
  '/insights':         'תובנות',
  '/events/quotes':    'הצעות מחיר לאירועים',
  '/archive':          'ארכיון',
  '/settings':         'הגדרות',
  '/admin':            'ניהול',
}

function resolveScreen(pathname) {
  if (ROUTE_NAMES[pathname]) return ROUTE_NAMES[pathname]
  // Longest prefix wins, so "/suppliers/merge" beats "/suppliers".
  let best = null, bestLen = -1
  for (const [prefix, label] of Object.entries(ROUTE_NAMES)) {
    if (prefix !== '/' && pathname.startsWith(prefix + '/') && prefix.length > bestLen) { best = label; bestLen = prefix.length }
  }
  return best || 'מסך לא ידוע'
}

export function useAIContext() {
  const location = useLocation()
  const screen = useMemo(() => resolveScreen(location.pathname), [location.pathname])
  return { screen, path: location.pathname }
}
