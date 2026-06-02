import React from 'react';

export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '56px 16px', textAlign: 'center',
    }}>
      {Icon && (
        <div style={{ marginBottom: '18px' }}>
          <div className="icon-box" style={{
            width: '56px', height: '56px', borderRadius: 'var(--r-card)',
            background: 'var(--panel-2)', border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon size={24} style={{ color: 'var(--text-mute)' }} />
          </div>
        </div>
      )}
      {title && (
        <h3 style={{
          fontSize: '14px', fontWeight: 600, color: 'var(--text)',
          marginBottom: '6px',
        }}>{title}</h3>
      )}
      {description && (
        <p style={{
          fontSize: '13px', color: 'var(--text-mute)', maxWidth: '280px',
          marginBottom: '20px', lineHeight: 1.6,
        }}>{description}</p>
      )}
      {action && <div>{action}</div>}
    </div>
  );
}
