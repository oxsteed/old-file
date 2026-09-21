import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageCircle } from 'lucide-react';
import { shouldPulseLauncher } from './messengerDockState.js';
import './MessengerDock.css';

function Avatar({ src, name, shape = 'round' }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  const shapeClass =
    shape === 'square'
      ? 'messenger-launcher__avatar--square'
      : 'messenger-launcher__avatar--round';

  return (
    <span className={`messenger-launcher__avatar ${shapeClass}`} aria-hidden="true">
      {src ? <img src={src} alt="" /> : initial}
    </span>
  );
}

/**
 * Floating launcher for the public-profile messenger dock.
 * Uses logical inset-inline-end so RTL places it correctly.
 */
export default function MessengerLauncher({
  open = false,
  onOpen,
  displayName = '',
  avatarUrl,
  avatarShape = 'round',
  unreadCount = 0,
  className = '',
  bottomOffset,
}) {
  const { t } = useTranslation();
  const [hasPulsed, setHasPulsed] = useState(false);
  const pulse = shouldPulseLauncher({
    dockOpen: open,
    hasPulsedThisSession: hasPulsed,
  });

  useEffect(() => {
    if (!pulse) return undefined;
    const timer = window.setTimeout(() => setHasPulsed(true), 1800);
    return () => window.clearTimeout(timer);
  }, [pulse]);

  if (open) return null;

  const label = displayName
    ? t('helperProfile.messenger.messageName', { name: displayName })
    : t('helperProfile.messenger.message');

  const style = bottomOffset ? { bottom: bottomOffset } : undefined;

  return (
    <button
      type="button"
      className={[
        'messenger-launcher',
        pulse ? 'messenger-launcher--pulse' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
      onClick={onOpen}
      aria-label={t('helperProfile.messenger.openAria', { name: displayName || '' })}
    >
      <Avatar src={avatarUrl} name={displayName} shape={avatarShape} />
      <span className="messenger-launcher__label">
        <span className="messenger-launcher__kicker">
          {t('helperProfile.messenger.launcherKicker')}
        </span>
        <span className="messenger-launcher__name">{label}</span>
      </span>
      <span className="messenger-launcher__compact">
        {t('helperProfile.messenger.message')}
      </span>
      {unreadCount > 0 && (
        <span className="messenger-launcher__badge" aria-hidden="true">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
      <MessageCircle className="w-4 h-4 opacity-70 flex-shrink-0" aria-hidden="true" />
    </button>
  );
}
