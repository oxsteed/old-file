import React, { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import {
  MESSENGER_MOBILE_BREAKPOINT,
  resolveDockLayout,
} from './messengerDockState.js';
import './MessengerDock.css';

function Avatar({ src, name, shape = 'round' }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  const shapeClass =
    shape === 'square'
      ? 'messenger-dock__avatar--square'
      : 'messenger-dock__avatar--round';

  return (
    <span className={`messenger-dock__avatar ${shapeClass}`} aria-hidden="true">
      {src ? <img src={src} alt="" /> : initial}
    </span>
  );
}

/**
 * Desktop right dock / mobile bottom sheet chrome for public profile chat.
 * Children fill the body (guest gate or ChatPanel).
 */
export default function MessengerDock({
  open = false,
  onClose,
  displayName = '',
  subtitle,
  avatarUrl,
  avatarShape = 'round',
  footer,
  children,
  className = '',
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const panelRef = useRef(null);
  const previouslyFocused = useRef(null);
  const [layout, setLayout] = useState(() =>
    typeof window === 'undefined'
      ? 'panel'
      : resolveDockLayout(window.innerWidth, MESSENGER_MOBILE_BREAKPOINT),
  );

  useEffect(() => {
    const onResize = () => {
      setLayout(resolveDockLayout(window.innerWidth, MESSENGER_MOBILE_BREAKPOINT));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    previouslyFocused.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose?.();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    // Focus close button after open for keyboard users
    const closeBtn = panelRef.current?.querySelector('.messenger-dock__close');
    window.setTimeout(() => closeBtn?.focus?.(), 30);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      if (previouslyFocused.current && previouslyFocused.current.focus) {
        previouslyFocused.current.focus();
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  const resolvedSubtitle =
    subtitle ?? t('helperProfile.messenger.replyExpectation');

  return (
    <div
      className={['messenger-dock-root', className].filter(Boolean).join(' ')}
      data-open={open ? 'true' : 'false'}
      data-layout={layout}
    >
      <div
        className="messenger-dock__backdrop"
        onClick={onClose}
        aria-hidden="true"
      />
      <section
        ref={panelRef}
        className={`messenger-dock messenger-dock--${layout}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div
          className="messenger-dock__handle"
          onClick={onClose}
          role="button"
          tabIndex={0}
          aria-label={t('helperProfile.messenger.close')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onClose?.();
            }
          }}
        >
          <span className="messenger-dock__handle-bar" />
        </div>

        <header className="messenger-dock__header">
          <Avatar src={avatarUrl} name={displayName} shape={avatarShape} />
          <div className="messenger-dock__identity">
            <h2 id={titleId} className="messenger-dock__title">
              {displayName || t('helperProfile.messenger.message')}
            </h2>
            <p className="messenger-dock__subtitle">{resolvedSubtitle}</p>
          </div>
          <button
            type="button"
            className="messenger-dock__close"
            onClick={onClose}
            aria-label={t('helperProfile.messenger.close')}
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </header>

        <div className="messenger-dock__body">{children}</div>

        {footer ? <div className="messenger-dock__footer">{footer}</div> : null}
      </section>
    </div>
  );
}

/** Compact sidebar card that opens the same dock (replaces embedded ChatPanel shell). */
export function MessengerInviteCard({ displayName, onOpen }) {
  const { t } = useTranslation();
  return (
    <div className="messenger-invite-card">
      <h3 className="messenger-invite-card__title">
        {t('helperProfile.messenger.inviteTitle', { name: displayName })}
      </h3>
      <p className="messenger-invite-card__body">
        {t('helperProfile.messenger.inviteBody')}
      </p>
      <button
        type="button"
        className="messenger-invite-card__button"
        onClick={onOpen}
      >
        {t('helperProfile.messenger.messageName', { name: displayName })}
      </button>
    </div>
  );
}
