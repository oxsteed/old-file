// Groups 5-6 shared panel state: auth-epoch-safe load + mutate with reload.
// The server is authoritative; a 403/404 clears the panel.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../../api/axios';
import { currentAuthEpoch, isCurrentAuthEpoch } from '../../../api/authSessionEpoch';
import { ACCESS_CHANGED_EVENT } from '../../../hooks/useAccessProjection';
import { createMessageRequestId } from '../../../lib/messageRequestId';

export const requestId = () => createMessageRequestId();

export function useBizG56(url, section) {
  const { t, i18n } = useTranslation();
  const tr = useCallback((key, vars) => t(`bizG56.${section}.${key}`, vars), [t, section]);
  const common = useCallback((key, vars) => t(`bizG56.common.${key}`, vars), [t]);
  const epoch = useRef(currentAuthEpoch());
  const gen = useRef(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload(v => v + 1), []);
  useEffect(() => {
    if (!url) return undefined;
    let cancelled = false; const seq = ++gen.current;
    api.get(url).then(({ data: value }) => {
      if (!cancelled && seq === gen.current && isCurrentAuthEpoch(epoch.current)) { setData(value); setError(''); }
    }).catch(err => {
      if (!cancelled && seq === gen.current && isCurrentAuthEpoch(epoch.current)) { setData(null); setError([403, 404].includes(err.response?.status) ? 'noAccess' : 'loadError'); }
    });
    return () => { cancelled = true; };
  }, [url, reload]);
  useEffect(() => {
    const revoke = () => { gen.current++; setData(null); refresh(); };
    window.addEventListener(ACCESS_CHANGED_EVENT, revoke);
    return () => window.removeEventListener(ACCESS_CHANGED_EVENT, revoke);
  }, [refresh]);
  const send = useCallback(async (method, path, body) => {
    if (busy) return null;
    setBusy(true); setError(''); setNotice('');
    try {
      const { data: value } = await api[method](path, body);
      if (isCurrentAuthEpoch(epoch.current)) { setNotice('saved'); refresh(); }
      return value ?? true;
    } catch (err) {
      if (isCurrentAuthEpoch(epoch.current)) {
        const code = err.response?.data?.code || err.response?.data?.error?.code;
        setError(err.response?.status === 409 ? (code || 'conflict') : (code || 'saveError'));
      }
      return null;
    } finally { setBusy(false); }
  }, [busy, refresh]);
  const time = useCallback(v => (v ? new Date(v).toLocaleString(i18n.language) : ''), [i18n.language]);
  const errorText = error ? t(`bizG56.errors.${error}`, { defaultValue: t('bizG56.errors.saveError') }) : '';
  return { t, tr, common, data, error, errorText, notice, busy, send, refresh, time };
}
