import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { trapMediaDialogFocus } from './mediaDialogFocus';

export default function MediaLinkModal({ url, title, onClose }) {
  const { t } = useTranslation();
  const closeButtonRef = useRef(null);
  const triggerRef = useRef(null);
  const dialogRef = useRef(null);

  useEffect(() => {
    triggerRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
      trapMediaDialogFocus(event, dialogRef.current);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      triggerRef.current?.focus?.();
    };
  }, [onClose]);

  const closeOnBackdrop = (event) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <div className="media-legal-overlay" role="presentation" onMouseDown={closeOnBackdrop}>
      <section ref={dialogRef} tabIndex={-1} className="media-legal-dialog media-link-dialog" role="dialog" aria-modal="true" aria-labelledby="media-link-title">
        <header className="media-legal-dialog-header">
          <div>
            <span className="media-legal-dialog-kicker">{t('media.feed.title')}</span>
            <h2 id="media-link-title">{title || url}</h2>
          </div>
          <div className="media-legal-dialog-actions">
            <Link
              to={url}
              className="media-legal-expand"
              aria-label={t('media.shell.openFullPage')}
              onClick={onClose}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </Link>
            <button
              ref={closeButtonRef}
              type="button"
              className="media-legal-close"
              onClick={onClose}
              aria-label={t('media.shell.close')}
            >
              ×
            </button>
          </div>
        </header>
        <div className="media-legal-dialog-body media-link-dialog-body">
          <iframe
            src={url}
            title={title || url}
            className="media-link-iframe"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
          />
        </div>
      </section>
    </div>
  );
}
