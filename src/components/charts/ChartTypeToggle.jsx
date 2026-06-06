import { BarChart3, LineChart } from 'lucide-react'

/** Small bars/line toggle shown next to charts. value: 'bar' | 'line'. */
export default function ChartTypeToggle({ value, onChange }) {
  const btn = (type, Icon, label) => {
    const active = value === type
    return (
      <button onClick={() => onChange(type)} title={label} aria-label={label}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 34, height: 30, borderRadius: 7, border: 'none', cursor: 'pointer',
          background: active ? 'var(--accent)' : 'transparent',
          color: active ? 'white' : 'var(--text-mute)', transition: 'all 120ms',
        }}>
        <Icon size={16} />
      </button>
    )
  }
  return (
    <div style={{ display: 'inline-flex', gap: 2, background: 'var(--panel-2)', borderRadius: 9, padding: 3 }}>
      {btn('bar', BarChart3, 'עמודות')}
      {btn('line', LineChart, 'קו ונקודות')}
    </div>
  )
}
