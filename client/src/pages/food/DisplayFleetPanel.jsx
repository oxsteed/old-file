// DisplayFleetPanel — restaurant dashboard "Displays" tab (Track B).
//
// Authenticated owner view: pairs new wall displays by entering the
// 6-character code shown on the TV, and lists paired displays for the
// selected restaurant with online/offline status, last seen, and Refresh /
// Unpair actions. Talks to /api/restaurant/displays.

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api/axios';

function apiErr(err, fallback) {
  const m = err?.response?.data?.error?.message || err?.response?.data?.message;
  return typeof m === 'string' ? m : fallback;
}

function formatLastSeen(t, lastSeen) {
  if (!lastSeen) return t('displayFleet.neverSeen');
  const diffMs = Date.now() - new Date(lastSeen).getTime();
  if (diffMs < 60 * 1000) return t('displayFleet.justNow');
  const mins = Math.floor(diffMs / (60 * 1000));
  return t('displayFleet.minutesAgo', { count: mins });
}

export default function DisplayFleetPanel({ t, restaurant }) {
  const [displays, setDisplays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [pairing, setPairing] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/restaurant/displays');
      const all = Array.isArray(data?.displays) ? data.displays : [];
      setDisplays(all.filter((d) => Number(d.restaurant_id) === Number(restaurant.id)));
    } catch (err) {
      toast.error(apiErr(err, t('displayFleet.loadError')));
    } finally {
      setLoading(false);
    }
  }, [restaurant.id, t]);

  useEffect(() => { load(); }, [load]);

  const pair = async (e) => {
    e.preventDefault();
    const cleanCode = code.trim();
    if (!cleanCode || pairing) return;
    setPairing(true);
    try {
      await api.post('/restaurant/displays/claim', { code: cleanCode, label: label.trim() || undefined });
      toast.success(t('displayFleet.pairedOk'));
      setCode('');
      setLabel('');
      load();
    } catch (err) {
      toast.error(apiErr(err, t('displayFleet.pairError')));
    } finally {
      setPairing(false);
    }
  };

  const refresh = async (id) => {
    setBusyId(id);
    try {
      await api.post(`/restaurant/displays/${id}/refresh`);
      toast.success(t('displayFleet.refreshSent'));
      load();
    } catch (err) {
      toast.error(apiErr(err, t('displayFleet.refreshError')));
    } finally {
      setBusyId(null);
    }
  };

  const unpair = async (id) => {
    if (!window.confirm(t('displayFleet.unpairConfirm'))) return;
    setBusyId(id);
    try {
      await api.delete(`/restaurant/displays/${id}`);
      toast.success(t('displayFleet.unpairedOk'));
      load();
    } catch (err) {
      toast.error(apiErr(err, t('displayFleet.unpairError')));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fd-section">
      <h2>{t('displayFleet.title')}</h2>
      <p className="fd-card-meta">{t('displayFleet.intro')}</p>

      <form onSubmit={pair} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap', marginTop: '1rem' }}>
        <div className="fd-field" style={{ marginBottom: 0, minWidth: '11rem' }}>
          <label htmlFor="display-pair-code">{t('displayFleet.codeLabel')}</label>
          <input
            id="display-pair-code"
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
            placeholder={t('displayFleet.codePlaceholder')}
            maxLength={8}
            autoComplete="off"
            spellCheck={false}
            style={{ textTransform: 'uppercase', letterSpacing: '0.2em', fontWeight: 700 }}
          />
        </div>
        <div className="fd-field" style={{ marginBottom: 0, minWidth: '11rem', flex: 1 }}>
          <label htmlFor="display-pair-label">{t('displayFleet.nameLabel')}</label>
          <input
            id="display-pair-label"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t('displayFleet.namePlaceholder')}
            maxLength={60}
            autoComplete="off"
          />
        </div>
        <button type="submit" className="fd-btn fd-btn-primary" disabled={pairing || !code.trim()}>
          {pairing ? t('displayFleet.pairing') : t('displayFleet.pairButton')}
        </button>
      </form>

      <div style={{ marginTop: '1.5rem' }}>
        {loading ? (
          <div className="fd-empty">{t('food.common.loading')}</div>
        ) : displays.length === 0 ? (
          <div className="fd-empty">{t('displayFleet.noDisplays')}</div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {displays.map((d) => (
              <li
                key={d.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: '1rem',
                  padding: '0.75rem 0', borderBottom: '1px solid var(--fd-border, #e5e7eb)',
                }}
              >
                <span
                  title={d.online ? t('displayFleet.online') : t('displayFleet.offline')}
                  aria-label={d.online ? t('displayFleet.online') : t('displayFleet.offline')}
                  role="img"
                  style={{
                    width: '0.75rem', height: '0.75rem', borderRadius: '50%',
                    background: d.online ? '#16a34a' : '#9ca3af', flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{d.label || t('displayFleet.title')}</div>
                  <div className="fd-card-meta">
                    {d.online ? t('displayFleet.online') : t('displayFleet.offline')}
                    {' · '}
                    {t('displayFleet.lastSeen')}: {formatLastSeen(t, d.last_seen_at)}
                  </div>
                </div>
                <button
                  type="button"
                  className="fd-btn fd-btn-secondary fd-btn-sm"
                  disabled={busyId === d.id}
                  onClick={() => refresh(d.id)}
                >
                  {t('displayFleet.refreshButton')}
                </button>
                <button
                  type="button"
                  className="fd-btn fd-btn-danger fd-btn-sm"
                  disabled={busyId === d.id}
                  onClick={() => unpair(d.id)}
                >
                  {t('displayFleet.unpairButton')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
