import React from 'react';

export default function Card({
  children,
  className = '',
  title,
  subtitle,
  headerActions,
  noPadding = false,
  /* accent dot color (optional) */
  accentDot,
}) {
  const hasHeader = title || subtitle || headerActions;

  return (
    <div
      className={className}
      style={{
        background:   'var(--panel)',
        border:       '1px solid var(--border)',
        borderRadius: 'var(--r-card)',
        boxShadow:    'var(--shadow-card)',
        overflow:     'hidden',
      }}
    >
      {hasHeader && (
        <div
          style={{
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'space-between',
            padding:        '14px 18px',
            borderBottom:   '1px solid var(--border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            {accentDot && (
              <span style={{
                width: '7px', height: '7px',
                borderRadius: '50%',
                background: accentDot,
                flexShrink: 0,
              }} />
            )}
            <div style={{ minWidth: 0 }}>
              {title && (
                <h3 style={{
                  fontSize:      '14.5px',
                  fontWeight:    600,
                  color:         'var(--text)',
                  letterSpacing: '-0.015em',
                  lineHeight:    1.3,
                }}>
                  {title}
                </h3>
              )}
              {subtitle && (
                <p style={{
                  fontSize:   '12px',
                  fontWeight: 500,
                  color:      'var(--text-mute)',
                  marginTop:  '2px',
                }}>
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          {headerActions && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              {headerActions}
            </div>
          )}
        </div>
      )}
      <div style={noPadding ? {} : { padding: '18px' }}>{children}</div>
    </div>
  );
}
