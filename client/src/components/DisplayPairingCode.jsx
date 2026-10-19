// DisplayPairingCode — self-contained wall-TV pairing widget (Track B).
//
// Mounted on the public display pages (queue board, kiosk, kitchen). Reads
// the restaurant id from the route param itself, so it needs no props.
// Renders as a small corner button that expands to show the 6-character
// pairing code large, with a countdown to expiry and a "new code" button.
// After the owner claims the code in the dashboard, the widget picks up the
// pairing token via the status poll, stores it in localStorage, and
// heartbeats so the dashboard fleet view shows this display as online.
//
// Raw codes and tokens are never logged.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';

const STATUS_POLL_MS = 5000;
const HEARTBEAT_MS = 30000;

const tokenKey = (restaurantId) => `oxsteed:display:token:${restaurantId}`;

function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function DisplayPairingCode() {
  const { restaurantId } = useParams();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(null);
  const [expiresAt, setExpiresAt] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [paired, setPaired] = useState(() => {
    try {
      return Boolean(restaurantId && localStorage.getItem(tokenKey(restaurantId)));
    } catch (_) {
      return false;
    }
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef(null);
  const beatRef = useRef(null);
  const stateRef = useRef({ code: null, paired: false });
  stateRef.current = { code, paired };

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const stopHeartbeat = useCallback(() => {
    if (beatRef.current) { clearInterval(beatRef.current); beatRef.current = null; }
  }, []);

  const requestCode = useCallback(async () => {
    if (!restaurantId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post('/restaurant/displays/pairing-code', { restaurant_id: restaurantId });
      setCode(data.code);
      setExpiresAt(data.expires_at ? new Date(data.expires_at).getTime() : Date.now() + 10 * 60 * 1000);
      setNow(Date.now());
    } catch (_) {
      setError(t('displayPairing.codeError'));
    } finally {
      setBusy(false);
    }
  }, [restaurantId, busy, t]);

  const markPaired = useCallback((token) => {
    try {
      localStorage.setItem(tokenKey(restaurantId), token);
    } catch (_) {
      // Storage unavailable: stay in pairing mode so the flow can retry.
      return;
    }
    setPaired(true);
    setCode(null);
    setExpiresAt(null);
    stopPolling();
  }, [restaurantId, stopPolling]);

  const dropPairing = useCallback(() => {
    try {
      localStorage.removeItem(tokenKey(restaurantId));
    } catch (_) { /* ignore */ }
    setPaired(false);
    stopHeartbeat();
    setCode(null);
    setExpiresAt(null);
  }, [restaurantId, stopHeartbeat]);

  // Poll the claim status while a code is shown.
  useEffect(() => {
    if (!code || paired) return undefined;
    stopPolling();
    const check = async () => {
      const { code: currentCode, paired: isPaired } = stateRef.current;
      if (!currentCode || isPaired) return;
      try {
        const { data } = await api.post('/restaurant/displays/status', { code: currentCode });
        if (data?.claimed && data?.token) markPaired(data.token);
        else if (data?.claimed) {
          // Claimed but the token was already delivered (e.g. this TV
          // reloaded mid-claim): the code is spent, fetch a fresh one.
          setCode(null);
          setExpiresAt(null);
        }
      } catch (_) {
        // Code expired or was never claimed: fall back to a fresh code when
        // the widget is opened again; stay quiet while it counts down.
      }
    };
    pollRef.current = setInterval(check, STATUS_POLL_MS);
    check();
    return stopPolling;
  }, [code, paired, markPaired, stopPolling]);

  // Heartbeat while paired. A requested refresh reloads the page; a 401
  // drops the token and returns to pairing mode.
  useEffect(() => {
    if (!paired) return undefined;
    stopHeartbeat();
    const beat = async () => {
      let token = null;
      try {
        token = localStorage.getItem(tokenKey(restaurantId));
      } catch (_) { /* ignore */ }
      if (!token) { dropPairing(); return; }
      try {
        const { data } = await api.post(
          '/restaurant/displays/heartbeat',
          {},
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (data?.refresh_requested) window.location.reload();
      } catch (err) {
        // Only an explicit invalid-token response drops the pairing; other
        // 401s (rate limits, unrelated auth failures) must not unpair the TV.
        if (err?.response?.data?.code === 'display_token_invalid') dropPairing();
      }
    };
    beatRef.current = setInterval(beat, HEARTBEAT_MS);
    beat();
    return stopHeartbeat;
  }, [paired, restaurantId, stopHeartbeat, dropPairing]);

  // 1s ticker for the countdown, only while a code is shown.
  useEffect(() => {
    if (!code || !expiresAt) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [code, expiresAt]);

  // Another surface (e.g. the kitchen page after a 401 on the device token)
  // can drop this display's pairing: return to pairing mode without a reload.
  useEffect(() => {
    const onPairingDropped = (event) => {
      if (String(event?.detail?.restaurantId || '') !== String(restaurantId)) return;
      dropPairing();
    };
    window.addEventListener('oxsteed:display:pairing-dropped', onPairingDropped);
    return () => window.removeEventListener('oxsteed:display:pairing-dropped', onPairingDropped);
  }, [restaurantId, dropPairing]);

  useEffect(() => () => { stopPolling(); stopHeartbeat(); }, [stopPolling, stopHeartbeat]);

  if (!restaurantId) return null;

  const remaining = expiresAt ? expiresAt - now : 0;
  const expired = code && remaining <= 0;

  return (
    <>
      <button
        type="button"
        // Stop propagation: on the kiosk start screen this widget sits
        // inside a container whose click advances the ordering flow.
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); if (!open && !paired && !code) requestCode(); }}
        aria-label={t('displayPairing.pairThisDisplay')}
        title={t('displayPairing.pairThisDisplay')}
        style={{
          position: 'fixed', left: '0.75rem', bottom: '0.75rem', zIndex: 60,
          width: '2.75rem', height: '2.75rem', borderRadius: '50%',
          border: '1px solid rgba(255,255,255,0.25)',
          background: paired ? 'rgba(22,101,52,0.85)' : 'rgba(17,24,39,0.72)',
          color: '#fff', fontSize: '1.25rem', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          opacity: open ? 1 : 0.55,
        }}
      >
        {paired ? '✓' : '⌁'}
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label={t('displayPairing.title')}
          // Stop propagation so clicks inside the dialog (close, new code)
          // never bubble to the kiosk start screen's advance-on-click.
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed', left: '0.75rem', bottom: '4rem', zIndex: 60,
            width: 'min(22rem, calc(100vw - 1.5rem))',
            background: 'rgba(17,24,39,0.96)', color: '#f9fafb',
            border: '1px solid rgba(255,255,255,0.18)', borderRadius: '0.75rem',
            padding: '1.25rem', boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <strong style={{ fontSize: '1rem' }}>{t('displayPairing.title')}</strong>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('displayPairing.close')}
              style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: '1.25rem', cursor: 'pointer' }}
            >
              ×
            </button>
          </div>
          {paired ? (
            <p style={{ margin: 0, fontSize: '0.95rem', color: '#d1fae5' }}>{t('displayPairing.pairedOk')}</p>
          ) : (
            <>
              <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', color: '#d1d5db' }}>
                {t('displayPairing.instructions')}
              </p>
              {error && (
                <p role="alert" style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', color: '#fca5a5' }}>
                  {error}
                </p>
              )}
              {code && !expired ? (
                <>
                  <div
                    aria-live="polite"
                    style={{
                      fontSize: '3rem', fontWeight: 800, letterSpacing: '0.35em',
                      textAlign: 'center', margin: '0.5rem 0', fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {code}
                  </div>
                  <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', color: '#9ca3af', textAlign: 'center' }}>
                    {t('displayPairing.expiresIn')} {formatCountdown(remaining)}
                  </p>
                  <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: '#6b7280', textAlign: 'center' }}>
                    {t('displayPairing.waitingForClaim')}
                  </p>
                </>
              ) : (
                <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', color: '#9ca3af' }}>
                  {expired ? t('displayPairing.codeExpired') : t('displayPairing.getCodeHint')}
                </p>
              )}
              <button
                type="button"
                onClick={requestCode}
                disabled={busy}
                style={{
                  width: '100%', padding: '0.65rem', borderRadius: '0.5rem',
                  border: '1px solid rgba(255,255,255,0.25)',
                  background: busy ? 'rgba(75,85,99,0.8)' : 'rgba(37,99,235,0.9)',
                  color: '#fff', fontSize: '0.95rem', cursor: busy ? 'wait' : 'pointer',
                }}
              >
                {busy ? t('displayPairing.working') : t('displayPairing.newCode')}
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
