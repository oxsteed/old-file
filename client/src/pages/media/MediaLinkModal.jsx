import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { trapMediaDialogFocus } from './mediaDialogFocus';
import { resolveAuthReturnPath } from '../../utils/authReturnPath';

const AUTH_PAGES = {
  '/login': lazy(() => import('../Login')),
  '/join': lazy(() => import('../JoinPage')),
  '/forgot-password': lazy(() => import('../ForgotPassword')),
};

// Account and settings pages rendered directly (no iframe), like the legal modal.
const PROFILE_PAGE = lazy(() => import('../PublicProfile'));
const EMBEDDED_PAGES = {
  '/dashboard': lazy(() => import('../SmartDashboard')),
  '/settings': lazy(() => import('../SettingsPage')),
  '/settings/notifications': lazy(() => import('../Settings/Notifications')),
  '/support': lazy(() => import('../SupportEscalationPage')),
  '/discover': lazy(() => import('../DiscoverPage')),
};

// Returns true if the modal can render this path directly (no iframe needed).
export function canEmbedMediaLink(pathname) {
  return Boolean(AUTH_PAGES[pathname] || EMBEDDED_PAGES[pathname] || pathname.startsWith('/profile/'));
}

export default function MediaLinkModal({ url, title, onClose }) {
  const { t } = useTranslation();
  const closeButtonRef = useRef(null);
  const triggerRef = useRef(null);
  const dialogRef = useRef(null);
  const [activeUrl, setActiveUrl] = useState(url);
  const destination = new URL(activeUrl, window.location.origin);
  const AuthPage = AUTH_PAGES[destination.pathname];
  const EmbeddedPage = EMBEDDED_PAGES[destination.pathname]
    || (destination.pathname.startsWith('/profile/') ? PROFILE_PAGE : null);
  const DirectPage = AuthPage || EmbeddedPage;
  const returnTo = resolveAuthReturnPath(destination.searchParams.get('next'), '/media');
  const authTitle = destination.pathname === '/login' ? t('nav.signIn')
    : destination.pathname === '/join' ? t('nav.joinOxsteed') : t('forgotPassword.title');

  // Keep transitions between sign-in, registration and password recovery in
  // the same dialog and AuthContext. No second application in an iframe.
  const followAuthLink = event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target.closest('a');
    if (!anchor || anchor.target || anchor.hasAttribute('download')) return;
    const target = new URL(anchor.href, window.location.origin);
    if (target.origin !== window.location.origin || !AUTH_PAGES[target.pathname]) return;
    event.preventDefault();
    if (!target.searchParams.has('next')) target.searchParams.set('next', returnTo);
    setActiveUrl(`${target.pathname}${target.search}${target.hash}`);
  };

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    triggerRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onCloseRef.current();
      trapMediaDialogFocus(event, dialogRef.current);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      triggerRef.current?.focus?.();
    };
  }, []);

  const closeOnBackdrop = (event) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <div className="media-legal-overlay" role="presentation" onMouseDown={closeOnBackdrop}>
      <section ref={dialogRef} tabIndex={-1} className="media-legal-dialog media-link-dialog" role="dialog" aria-modal="true" aria-labelledby="media-link-title">
        <header className="media-legal-dialog-header">
          <div>
            <span className="media-legal-dialog-kicker">{t('media.feed.title')}</span>
            <h2 id="media-link-title">{AuthPage ? authTitle : title || url}</h2>
          </div>
          <div className="media-legal-dialog-actions">
            <Link
              to={activeUrl}
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
        <div className={`media-legal-dialog-body media-link-dialog-body${DirectPage ? ' media-auth-dialog-body' : ''}`} onClickCapture={AuthPage ? followAuthLink : undefined}>
          <Suspense fallback={<div className="media-legal-loading" role="status">{t('common.loading')}</div>}>
            {AuthPage ? <AuthPage embedded returnTo={returnTo} embeddedSearch={destination.search} /> : <EmbeddedPage />}
          </Suspense>
        </div>
      </section>
    </div>
  );
}
