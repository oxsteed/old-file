import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import api from '../../api/axios';

// S-06: staff identity on the shared POS terminal. The signed-in account
// owns the device login; the staff member who is actually working unlocks
// with their own PIN and the server issues a short-lived staff
// sub-session. POS requests carry it in the X-Staff-Session header and
// the server stamps acting_staff_user_id on orders, payments, drawer
// events and receipt audits. The session auto-locks after the idle
// window the server returns, and staff can switch user or lock at any
// time. Without a session the POS keeps working as the account user,
// exactly as before S-06.

const storageKey = (restaurantId) => `oxsteed.posStaffSession.${restaurantId}`;

export function readStaffSession(restaurantId) {
  try {
    const raw = sessionStorage.getItem(storageKey(restaurantId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token || !parsed?.expiresAt) return null;
    if (new Date(parsed.expiresAt).getTime() <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveStaffSession(restaurantId, session) {
  try {
    if (session) sessionStorage.setItem(storageKey(restaurantId), JSON.stringify(session));
    else sessionStorage.removeItem(storageKey(restaurantId));
  } catch {
    // sessionStorage unavailable (private mode): the unlock still works
    // for this mount, it just will not survive a reload.
  }
}

export default function PosStaffSessionBar({ restaurantId }) {
  const { t } = useTranslation();
  const [session, setSession] = useState(() => readStaffSession(restaurantId));
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const idleTimerRef = useRef(null);

  const endSession = useCallback(async (reason) => {
    const current = readStaffSession(restaurantId);
    saveStaffSession(restaurantId, null);
    setSession(null);
    setPin('');
    if (current?.token) {
      try {
        await api.delete(`/restaurants/${restaurantId}/pos/staff-session`, {
          data: { reason },
          headers: { 'X-Staff-Session': current.token },
        });
      } catch {
        // Best effort: the server also ends sessions on idle expiry.
      }
    }
  }, [restaurantId]);

  // Attach the staff session token to this restaurant's POS requests.
  useEffect(() => {
    const interceptor = api.interceptors.request.use((config) => {
      if (config.url && config.url.includes(`/restaurants/${restaurantId}/pos/`)) {
        const current = readStaffSession(restaurantId);
        if (current?.token) {
          config.headers = config.headers || {};
          config.headers['X-Staff-Session'] = current.token;
        }
      }
      return config;
    });
    return () => api.interceptors.request.eject(interceptor);
  }, [restaurantId]);

  // Idle auto-lock: any pointer or keyboard activity restarts the
  // countdown; reaching the server-issued idle window locks the session.
  useEffect(() => {
    if (!session) return undefined;
    const idleMs = Math.max(30, Number(session.idleTimeoutSeconds) || 600) * 1000;
    const arm = () => {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = window.setTimeout(() => {
        endSession('idle_timeout');
        toast(t('food.pos.staffSessionExpired'));
      }, idleMs);
    };
    arm();
    window.addEventListener('pointerdown', arm);
    window.addEventListener('keydown', arm);
    return () => {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('keydown', arm);
    };
  }, [session, endSession, t]);

  const submitPin = async () => {
    if (!pin || submitting) return;
    setSubmitting(true);
    try {
      const res = await api.post(`/restaurants/${restaurantId}/pos/staff-session`, { pin });
      const data = res.data || {};
      const next = {
        token: data.token,
        expiresAt: data.expiresAt,
        idleTimeoutSeconds: data.idleTimeoutSeconds || 600,
        staff: data.staff || null,
      };
      saveStaffSession(restaurantId, next);
      setSession(next);
      setPinOpen(false);
      setPin('');
      toast.success(t('food.pos.staffUnlocked', { name: next.staff?.label || next.staff?.roleLabel || '' }));
    } catch (err) {
      const code = err?.response?.data?.error?.code || err?.response?.data?.code;
      if (code === 'pin_locked') toast.error(t('food.pos.pinLocked'));
      else if (code === 'staff_not_member') toast.error(t('food.pos.pinNotMember'));
      else toast.error(t('food.pos.invalidPin'));
      setPin('');
    } finally {
      setSubmitting(false);
    }
  };

  const staffName = session?.staff?.label || session?.staff?.roleLabel || '';

  return (
    <>
      {session ? (
        <span className="fd-tag">
          {t('food.pos.actingAs', { name: staffName })}
          <button type="button" className="fd-btn fd-btn-sm" onClick={() => { endSession('switch_user'); setPinOpen(true); }}>
            {t('food.pos.switchUser')}
          </button>
          <button type="button" className="fd-btn fd-btn-sm" onClick={() => endSession('manual_lock')}>
            {t('food.pos.lockTerminal')}
          </button>
        </span>
      ) : (
        <button type="button" className="fd-btn fd-btn-sm" onClick={() => setPinOpen(true)}>
          {t('food.pos.unlockWithPin')}
        </button>
      )}
      {pinOpen && (
        <div className="fd-modal-overlay" onClick={() => setPinOpen(false)}>
          <div className="fd-modal fd-pos-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t('food.pos.enterStaffPin')}</h3>
            <input
              className="fd-modal-input"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 12))}
              onKeyDown={(e) => { if (e.key === 'Enter') submitPin(); }}
              placeholder={t('food.pos.staffPinPlaceholder')}
              autoFocus
            />
            <div className="fd-pos-modal-actions">
              <button type="button" className="fd-btn-secondary" onClick={() => setPinOpen(false)}>
                {t('food.common.cancel')}
              </button>
              <button type="button" className="fd-btn" onClick={submitPin} disabled={submitting || pin.length < 4}>
                {t('food.pos.unlock')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
