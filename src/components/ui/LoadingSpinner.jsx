import React from 'react'

export default function LoadingSpinner({ text = 'טוען...' }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '64px 16px', gap: '16px',
    }}>
      <div style={{ position: 'relative', width: '48px', height: '48px' }}>
        <svg
          style={{ position: 'absolute', inset: 0, animation: 'spin 1s linear infinite' }}
          viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="24" cy="24" r="20" stroke="var(--border)" strokeWidth="3" />
          <path d="M24 4a20 20 0 0 1 20 20" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <div style={{
          position: 'absolute', inset: '10px', borderRadius: 'var(--r-control)',
          background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ color: 'white', fontWeight: 700, fontSize: '11px', userSelect: 'none' }}>₪</span>
        </div>
      </div>
      {text && <p style={{ fontSize: '16px', fontWeight: 500, color: 'var(--text-mute)' }}>{text}</p>}
    </div>
  )
}
