// client/src/components/ModeSwitcher.jsx
//
// Navbar dropdown for switching the user's active mode. Sits next to
// <BusinessSwitcher /> in Navbar.jsx and only renders for signed-in users.
//
// The user's *default* mode (saved on signup via /join) is the initial value.
// In-session switches are persisted to localStorage so a refresh keeps the
// user in the same mode without rewriting users.default_mode on the server.
// To make a switch sticky across devices the user can hit "Set as default"
// inside the dropdown, which calls PATCH /api/users/me { default_mode }.
//
// All copy comes from i18n under modes.* and modeSwitcher.*.

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';
import {
  MODE_CATALOG,
  getAvailableModesForUser,
  routeForMode,
} from '../utils/modeRouter';

const LS_KEY = 'oxs:activeMode';

export default function ModeSwitcher({ compact = false }) {
  const { t } = useTranslation();
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const menuRef = useRef(null);

  const [open, setOpen] = useState(false);
  const [memberships, setMemberships] = useState([]);
  const [activeMode, setActiveMode] = useState(() => {
    try { return localStorage.getItem(LS_KEY) || null; } catch { return null; }
  });
  const [savingDefault, setSavingDefault] = useState(false);

  // Pull workspace memberships once we know who the user is, so granted
  // modes (manager / employee / support_agent / etc.) show in the list.
  useEffect(() => {
    if (!user) { setMemberships([]); return; }
    let cancelled = false;
    api.get('/me/businesses')
      .then(res => {
        if (cancelled) return;
        const items = Array.isArray(res?.data?.items) ? res.data.items : [];
        setMemberships(items.filter(m => m.status === 'active'));
      })
      .catch(() => { /* endpoint may not be deployed everywhere — fail quiet */ });
    return () => { cancelled = true; };
  }, [user]);

  // Sync activeMode to user.default_mode when nothing's in localStorage.
  useEffect(() => {
    if (activeMode || !user?.default_mode) return;
    setActiveMode(user.default_mode);
  }, [user, activeMode]);

  const availableModes = useMemo(
    () => getAvailableModesForUser(user, { memberships }),
    [user, memberships],
  );

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleSwitch = useCallback((mode) => {
    setActiveMode(mode);
    try { localStorage.setItem(LS_KEY, mode); } catch { /* private mode */ }
    setOpen(false);
    navigate(routeForMode(mode));
  }, [navigate]);

  const handleSetDefault = useCallback(async (mode) => {
    if (!user || savingDefault) return;
    setSavingDefault(true);
    try {
      // Same endpoint Settings page uses for profile updates. Now accepts
      // default_mode (see authController.updateProfile).
      const res = await api.put('/auth/profile', { default_mode: mode });
      if (res?.data?.user) {
        setUser(res.data.user);
        try {
          localStorage.setItem('user', JSON.stringify(res.data.user));
        } catch { /* private mode */ }
      }
    } catch {
      // Fail silent — preference is still remembered locally.
    } finally {
      setSavingDefault(false);
    }
  }, [user, savingDefault, setUser]);

  // Don't render for logged-out users or when there's only one option.
  if (!user) return null;
  if (availableModes.length <= 1) return null;

  const current = activeMode && availableModes.includes(activeMode) ? activeMode : availableModes[0];
  const currentMeta = MODE_CATALOG[current] || MODE_CATALOG.customer;
  const currentLabel = t(currentMeta.labelKey, { defaultValue: current });

  return (
    <div ref={menuRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="ox-mode-switcher-menu"
        className="ox-btn ox-btn-ghost ox-btn-sm"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4rem',
          padding: compact ? '0.3rem 0.5rem' : '0.4rem 0.65rem',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
          color: 'var(--color-text)',
          fontSize: 'var(--text-sm)',
          fontWeight: 500,
        }}
      >
        <span
          style={{
            display: 'inline-block',
            width: '0.5rem',
            height: '0.5rem',
            borderRadius: '50%',
            background: 'var(--color-primary)',
          }}
          aria-hidden="true"
        />
        {!compact && <span style={{ opacity: 0.7, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('modeSwitcher.mode')}</span>}
        <span>{currentLabel}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          id="ox-mode-switcher-menu"
          role="menu"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 0.35rem)',
            minWidth: 'min(20rem, calc(100vw - 2rem))',
            padding: '0.35rem',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            boxShadow: '0 10px 40px rgba(0,0,0,0.18)',
            zIndex: 60,
          }}
        >
          <div
            style={{
              fontSize: '0.65rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--color-text-muted)',
              padding: '0.45rem 0.6rem 0.25rem',
            }}
          >
            {t('modeSwitcher.switchTo')}
          </div>
          {availableModes.map((m) => {
            const meta = MODE_CATALOG[m] || {};
            const isCurrent = m === current;
            const isDefault = m === user?.default_mode;
            return (
              <div
                key={m}
                role="menuitem"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.5rem 0.6rem',
                  borderRadius: 'var(--radius-sm)',
                  cursor: isCurrent ? 'default' : 'pointer',
                  background: isCurrent ? 'var(--color-primary-soft, rgba(249,115,22,0.08))' : 'transparent',
                  transition: 'background var(--transition-fast)',
                }}
                onClick={() => { if (!isCurrent) handleSwitch(m); }}
                onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.background = 'var(--color-surface-hover, rgba(0,0,0,0.04))'; }}
                onMouseLeave={(e) => { if (!isCurrent) e.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text)' }}>
                      {t(meta.labelKey || `modes.${m}.label`, { defaultValue: m })}
                    </span>
                    {isDefault && (
                      <span
                        style={{
                          fontSize: '0.6rem',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          padding: '0.1rem 0.35rem',
                          borderRadius: 'var(--radius-full)',
                          background: 'var(--color-primary)',
                          color: '#fff',
                          letterSpacing: '0.04em',
                        }}
                      >
                        {t('modeSwitcher.defaultBadge')}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginTop: '0.1rem', whiteSpace: 'normal' }}>
                    {t(meta.hintKey || `modes.${m}.hint`, { defaultValue: '' })}
                  </div>
                </div>
                {!isDefault && !isCurrent && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleSetDefault(m); }}
                    disabled={savingDefault}
                    style={{
                      fontSize: '0.65rem',
                      fontWeight: 600,
                      padding: '0.2rem 0.4rem',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--color-border)',
                      background: 'transparent',
                      color: 'var(--color-text-muted)',
                      cursor: savingDefault ? 'wait' : 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                    title={t('modeSwitcher.setAsDefaultHint')}
                  >
                    {t('modeSwitcher.setAsDefault')}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
