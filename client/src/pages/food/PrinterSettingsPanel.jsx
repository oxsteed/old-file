// PrinterSettingsPanel — network receipt printer (ESC/POS) + cash drawer.
// Self-contained settings card for the merchant Settings tab. Talks to
// /api/restaurants/:id/printer-settings and /printer-test. Printing is
// fire-and-forget: a failed print shows a clear error and never affects the
// order or payment it was printed from.

import React, { useCallback, useEffect, useState } from 'react';
import api from '../../api/axios';
import { Printer } from 'lucide-react';

function Switch({ checked, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`fd-switch${checked ? ' fd-switch--on' : ''}`} data-track="ui.e34bf5675e.1"
    >
      <span className="fd-switch-knob" aria-hidden="true" />
    </button>
  );
}

function apiErr(err, fallback, t) {
  const data = err?.response?.data || {};
  // The server rejects non-LAN printer hosts with a machine-readable code;
  // show the translated message instead of the raw English fallback.
  if (data.code === 'printer_host_not_local' && typeof t === 'function') {
    return t('printer.hostNotLocal');
  }
  const m = data?.error?.message || data?.message;
  return typeof m === 'string' && m ? m : fallback;
}

export default function PrinterSettingsPanel({ t, restaurant }) {
  const restaurantId = restaurant?.id;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('9100');
  const [drawerKick, setDrawerKick] = useState(true);
  const [testResult, setTestResult] = useState(null); // { ok, message }

  const load = useCallback(async () => {
    if (!restaurantId) return;
    setLoading(true);
    setTestResult(null);
    try {
      const res = await api.get(`/restaurants/${restaurantId}/printer-settings`);
      const s = res.data?.settings || {};
      setEnabled(Boolean(s.enabled));
      setHost(s.host || '');
      setPort(String(s.port ?? 9100));
      setDrawerKick(s.drawerKickOnCash !== false);
    } catch (err) {
      setTestResult({ ok: false, message: apiErr(err, t('printer.loadError')) });
    } finally {
      setLoading(false);
    }
  }, [restaurantId, t]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    setTestResult(null);
    try {
      const res = await api.put(`/restaurants/${restaurantId}/printer-settings`, {
        enabled,
        host: host.trim(),
        port: Number.parseInt(port, 10) || 9100,
        drawerKickOnCash: drawerKick,
      });
      const s = res.data?.settings || {};
      setEnabled(Boolean(s.enabled));
      setHost(s.host || '');
      setPort(String(s.port ?? 9100));
      setDrawerKick(s.drawerKickOnCash !== false);
      setTestResult({ ok: true, message: t('printer.saved') });
    } catch (err) {
      setTestResult({ ok: false, message: apiErr(err, t('printer.saveError'), t) });
    } finally {
      setSaving(false);
    }
  };

  const printTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.post(`/restaurants/${restaurantId}/printer-test`);
      if (res.data?.ok) {
        setTestResult({ ok: true, message: t('printer.testSuccess') });
      } else {
        setTestResult({ ok: false, message: res.data?.error || t('printer.testFailed') });
      }
    } catch (err) {
      setTestResult({ ok: false, message: apiErr(err, t('printer.testFailed'), t) });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <section className="fd-settings-card fd-settings-card--wide" aria-label={t('printer.title')}>
        <div className="fd-settings-card-body">{t('food.common.loading')}</div>
      </section>
    );
  }

  return (
    <section className="fd-settings-card fd-settings-card--wide" aria-label={t('printer.title')}>
      <header className="fd-settings-card-head">
        <span className="fd-settings-card-icon" aria-hidden="true"><Printer size={18} /></span>
        <div>
          <h3 className="fd-settings-card-title">{t('printer.title')}</h3>
          <p className="fd-card-meta fd-settings-card-desc">{t('printer.desc')}</p>
        </div>
      </header>
      <div className="fd-settings-card-body">
        <div className="fd-settings-switch-row">
          <span className="fd-settings-switch-label">{t('printer.enable')}</span>
          <Switch checked={enabled} onChange={setEnabled} disabled={saving} label={t('printer.enable')} />
        </div>

        <div className="fd-field">
          <label htmlFor={`printer-host-${restaurantId}`}>{t('printer.hostLabel')}</label>
          <input
            id={`printer-host-${restaurantId}`}
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder={t('printer.hostPlaceholder')}
            disabled={saving}
            inputMode="text"
            autoComplete="off"
          />
          <p className="fd-settings-hint">{t('printer.hostHint')}</p>
        </div>

        <div className="fd-field">
          <label htmlFor={`printer-port-${restaurantId}`}>{t('printer.portLabel')}</label>
          <input
            id={`printer-port-${restaurantId}`}
            value={port}
            onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
            disabled={saving}
            inputMode="numeric"
            autoComplete="off"
          />
        </div>

        <div className="fd-settings-switch-row">
          <span className="fd-settings-switch-label">{t('printer.drawerKick')}</span>
          <Switch checked={drawerKick} onChange={setDrawerKick} disabled={saving} label={t('printer.drawerKick')} />
        </div>
        <p className="fd-settings-hint">{t('printer.drawerKickHint')}</p>

        {testResult && (
          <div
            role="status"
            style={{
              margin: '0.75rem 0',
              padding: '0.65rem 0.8rem',
              borderRadius: 10,
              fontSize: '0.85rem',
              lineHeight: 1.5,
              background: testResult.ok ? '#f0fdf4' : '#fef2f2',
              border: `1px solid ${testResult.ok ? '#86efac' : '#fca5a5'}`,
              color: testResult.ok ? '#166534' : '#991b1b',
            }}
          >
            {testResult.message}
          </div>
        )}

        <div className="fd-settings-actions">
          <button type="button" className="fd-btn" disabled={saving} onClick={save} data-track="ui.e34bf5675e.2">
            {saving ? t('food.common.saving') : t('printer.save')}
          </button>
          <button
            type="button"
            className="fd-btn-secondary"
            disabled={testing || !enabled}
            onClick={printTest}
            title={!enabled ? t('printer.enableFirst') : undefined} data-track="ui.e34bf5675e.3"
          >
            {testing ? t('printer.testing') : t('printer.printTest')}
          </button>
        </div>
      </div>
    </section>
  );
}
