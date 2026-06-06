import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const sizeMap = { sm: '480px', md: '580px', lg: '720px', xl: '880px' };

export default function Modal({ isOpen, onClose, title, children, size = 'md' }) {
  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleEsc);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isMobile = window.innerWidth < 768;

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50,
      display: 'flex',
      alignItems: isMobile ? 'flex-end' : 'center',
      justifyContent: 'center',
      padding: isMobile ? 0 : '16px',
    }}>
      {/* Backdrop */}
      <div
        style={{ position: 'absolute', inset: 0, background: 'rgba(26,26,23,0.45)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      />

      {/* Dialog */}
      <div style={{
        position: 'relative',
        background: 'var(--panel)',
        borderRadius: isMobile ? '20px 20px 0 0' : 'var(--r-hero)',
        boxShadow: 'var(--shadow-modal)',
        width: '100%',
        maxWidth: isMobile ? '100%' : (sizeMap[size] || sizeMap.md),
        maxHeight: isMobile ? '92dvh' : '88dvh',
        display: 'flex',
        flexDirection: 'column',
        animation: isMobile
          ? 'slideUp 280ms cubic-bezier(0.16,1,0.3,1) both'
          : 'slideInScale 200ms cubic-bezier(0.16,1,0.3,1) both',
        paddingBottom: isMobile ? 'env(safe-area-inset-bottom)' : 0,
      }}>
        {/* Drag handle — mobile only */}
        {isMobile && (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '10px', paddingBottom: '2px', flexShrink: 0 }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border-strong)', opacity: 0.6 }} />
          </div>
        )}

        {/* Header */}
        {title && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: isMobile ? '12px 20px 14px' : '18px 24px',
            borderBottom: '1px solid var(--border)', flexShrink: 0,
          }}>
            <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.015em', margin: 0 }}>
              {title}
            </h2>
            <button
              onClick={onClose}
              style={{
                width: '32px', height: '32px', borderRadius: 'var(--r-control)', border: 'none',
                background: 'transparent', cursor: 'pointer', color: 'var(--text-mute)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'background var(--duration) var(--ease)',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--panel-2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <X size={16} strokeWidth={1.75} />
            </button>
          </div>
        )}

        {/* Content */}
        <div style={{
          padding: isMobile ? '20px 16px 8px' : '24px',
          overflowY: 'auto', flex: 1, WebkitOverflowScrolling: 'touch',
        }}>
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
