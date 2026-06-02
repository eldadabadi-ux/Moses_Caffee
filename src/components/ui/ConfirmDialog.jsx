import React from 'react';
import Modal from './Modal';
import Button from './Button';

export default function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'אישור',
  cancelText = 'ביטול',
  variant = 'danger',
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <div style={{ paddingTop: '4px', paddingBottom: '4px' }}>
        <p style={{ fontSize: '13.5px', color: 'var(--text-dim)', lineHeight: 1.6 }}>{message}</p>
      </div>
      <div style={{
        display: 'flex', gap: '8px', justifyContent: 'flex-end',
        marginTop: '20px', paddingTop: '16px',
        borderTop: '1px solid var(--border)',
      }}>
        <Button variant="ghost" onClick={onClose}>
          {cancelText}
        </Button>
        <Button
          variant={variant}
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmText}
        </Button>
      </div>
    </Modal>
  );
}
