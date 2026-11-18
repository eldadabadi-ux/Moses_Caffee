/**
 * BudgetAlert — the one banner that announces a supplier's budget state
 * (client fix 18.11.26: "when a supplier goes over its cap, show the alert on
 * the supplier card too"). It renders nothing while the supplier is within the
 * cap, so a card only gains a line when there is something to say.
 *
 * It takes a budgetStatus() result — it computes nothing itself, so the number
 * it shows is the same number the budgets screen, the insights report and the
 * assistant show.
 */
import { AlertTriangle, TrendingUp } from 'lucide-react'

const fmtILS = n => `₪${Math.round(Math.abs(Number(n) || 0)).toLocaleString('he-IL')}`

const TONE = {
  over: { color: 'var(--danger)', icon: AlertTriangle },
  warn: { color: '#d97706',       icon: TrendingUp },
}

export default function BudgetAlert({ status, periodLabel, compact = false }) {
  const tone = TONE[status?.state]
  if (!tone) return null
  const Icon = tone.icon
  const period = periodLabel ? `${periodLabel} · ` : ''
  const headline = status.state === 'over'
    ? `חריגה מהתקציב: ${fmtILS(status.remaining)} מעל התקרה`
    : `מתקרב לתקרת התקציב — נוצלו ${status.pct}%`
  const detail = `${period}${status.window.label} · נוצל ${fmtILS(status.used)} מתוך ${fmtILS(status.amount)}`

  return (
    <div role="status" style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: compact ? '7px 10px' : '9px 12px',
      borderRadius: 10, border: `1px solid ${tone.color}55`,
      background: `${tone.color}14`, color: tone.color,
      fontSize: compact ? 12.5 : 13.5, fontWeight: 700, lineHeight: 1.4,
    }}>
      <Icon size={compact ? 14 : 16} style={{ flexShrink: 0 }} />
      <span style={{ minWidth: 0 }}>
        {headline}
        <span style={{ display: 'block', fontWeight: 600, fontSize: compact ? 11.5 : 12.5, color: 'var(--text-dim)' }}>
          {detail}
        </span>
      </span>
    </div>
  )
}
