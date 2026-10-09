import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const MediaGuestGateContext = createContext(null);

export function useMediaGuestGate() {
  const ctx = useContext(MediaGuestGateContext);
  if (!ctx) {
    throw new Error('useMediaGuestGate must be used within MediaGuestGateProvider');
  }
  return ctx;
}

export function MediaGuestGateProvider({ children }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [returnTo, setReturnTo] = useState('/media');

  const requireLogin = useCallback((path) => {
    setReturnTo(path || `${location.pathname}${location.search}`);
    setOpen(true);
  }, [location.pathname, location.search]);

  const value = useMemo(() => ({ requireLogin }), [requireLogin]);

  return (
    <MediaGuestGateContext.Provider value={value}>
      {children}
      {open && (
        <div className="media-verification-dialog" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <div className="media-verification-form" role="dialog" aria-modal="true" aria-labelledby="media-guest-sign-in-title">
            <button type="button" className="media-dialog-close" onClick={() => setOpen(false)} aria-label={t('media.shell.close')}>
              <span aria-hidden="true">×</span>
            </button>
            <h2 id="media-guest-sign-in-title">{t('media.guestSignIn.title')}</h2>
            <p>{t('media.guestSignIn.body')}</p>
            <div className="media-guest-sign-in-actions">
              <Link to="/login" state={{ from: returnTo }} className="media-primary-button" onClick={() => setOpen(false)}>
                {t('media.guestSignIn.signIn')}
              </Link>
              <button type="button" className="media-text-button" onClick={() => setOpen(false)}>
                {t('media.guestSignIn.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </MediaGuestGateContext.Provider>
  );
}
