import React from 'react';

/* ─── Variant styles (Notion/Attio Light) ────────────────────── */
const variantStyles = {
  success: {
    background: '#f0fdf4',
    color:      '#16a34a',
    border:     '1px solid #bbf7d0',
    dotColor:   '#16a34a',
  },
  warn: {
    background: '#fffbeb',
    color:      '#a16207',
    border:     '1px solid #fde68a',
    dotColor:   '#d97706',
  },
  // legacy alias
  warning: {
    background: '#fffbeb',
    color:      '#a16207',
    border:     '1px solid #fde68a',
    dotColor:   '#d97706',
  },
  danger: {
    background: '#fef2f2',
    color:      '#dc2626',
    border:     '1px solid #fecaca',
    dotColor:   '#dc2626',
  },
  info: {
    background: '#eff6ff',
    color:      '#2563eb',
    border:     '1px solid #bfdbfe',
    dotColor:   '#2563eb',
  },
  // legacy alias
  primary: {
    background: '#eff6ff',
    color:      '#2563eb',
    border:     '1px solid #bfdbfe',
    dotColor:   '#2563eb',
  },
  neutral: {
    background: 'var(--panel-2)',
    color:      'var(--text-dim)',
    border:     '1px solid var(--border)',
    dotColor:   'var(--text-mute)',
  },
  purple: {
    background: '#faf5ff',
    color:      '#7c3aed',
    border:     '1px solid #e9d5ff',
    dotColor:   '#7c3aed',
  },
};

export default function Badge({
  children,
  variant = 'neutral',
  showDot = true,
  className = '',
}) {
  const vs = variantStyles[variant] || variantStyles.neutral;

  return (
    <span
      className={className}
      style={{
        display:        'inline-flex',
        alignItems:     'center',
        gap:            '5px',
        padding:        '4px 10px',
        borderRadius:   'var(--r-pill)',
        fontSize:       '14px',
        fontWeight:     500,
        whiteSpace:     'nowrap',
        lineHeight:     1.4,
        background:     vs.background,
        color:          vs.color,
        border:         vs.border,
      }}
    >
      {showDot && (
        <span
          style={{
            width:        '5px',
            height:       '5px',
            borderRadius: '50%',
            background:   vs.dotColor,
            flexShrink:   0,
          }}
        />
      )}
      {children}
    </span>
  );
}
