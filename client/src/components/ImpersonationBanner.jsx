/**
 * ImpersonationBanner
 *
 * Renders a fixed orange bar at the top of the page whenever the current
 * browser tab has an active impersonation session (detected via sessionStorage).
 * Clicking "Exit Impersonation" clears the session and closes the tab.
 *
 * Usage: render once, high in the component tree, e.g. in App.jsx just inside
 * the router but outside <Routes>. It renders nothing during normal sessions.
 */
import { useState, useEffect } from 'react';
import { UserX, LogOut }       from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  IMPERSONATION_TOKEN_KEY,
  IMPERSONATION_USER_KEY,
  IMPERSONATION_JTI_KEY,
} from '../pages/ImpersonatePage';
import api from '../api/axios';

export default function ImpersonationBanner() {
  const [impUser, setImpUser] = useState(null);
  const { t } = useTranslation('common');

  useEffect(() => {
    const raw = sessionStorage.getItem(IMPERSONATION_USER_KEY);
    if (raw) {
      try { setImpUser(JSON.parse(raw)); } catch (_) {}
    }
  }, []);

  if (!impUser) return null;

  const handleExit = async () => {
    // Tell the server to mark the session ended so audit history closes cleanly.
    try {
      const jti   = sessionStorage.getItem(IMPERSONATION_JTI_KEY);
      if (jti) {
        await api.post(`/admin/users/${impUser.id}/impersonate/end`, { jti });
      }
    } catch (_) {}

    // Clear impersonation state from sessionStorage
    sessionStorage.removeItem(IMPERSONATION_TOKEN_KEY);
    sessionStorage.removeItem(IMPERSONATION_USER_KEY);
    sessionStorage.removeItem(IMPERSONATION_JTI_KEY);

    // Close this tab (returns focus to the admin tab)
    window.close();

    // Fallback if window.close() is blocked: redirect to login
    setTimeout(() => {
      window.location.href = '/admin/users';
    }, 300);
  };

  const displayName = [impUser.first_name, impUser.last_name].filter(Boolean).join(' ')
    || impUser.email;

  return (
    <div
      style={{ zIndex: 99999 }}
      className="fixed top-0 left-0 right-0 flex items-center justify-between
                 gap-3 px-4 py-2.5
                 bg-orange-500 text-white text-sm font-semibold shadow-lg"
      role="alert"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 min-w-0">
        <UserX size={16} className="shrink-0" />
        <span className="truncate">
          {t('impersonation.adminView')}&nbsp;
          <strong>{displayName}</strong>
          &nbsp;({impUser.email})
          &nbsp;—&nbsp;
          <span className="font-normal opacity-80">
            {t('impersonation.loggedAs')}
          </span>
        </span>
      </div>

      <button
        onClick={handleExit}
        className="shrink-0 flex items-center gap-1.5 px-3 py-1
                   bg-white/20 hover:bg-white/30 rounded-lg
                   transition text-white text-xs font-bold whitespace-nowrap"
        aria-label={t('impersonation.exitAria')}
      >
        <LogOut size={13} />
        {t('impersonation.exitButton')}
      </button>
    </div>
  );
}
