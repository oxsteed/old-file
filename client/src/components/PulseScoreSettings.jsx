import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';

// Source keys grouped by category — labels/descs come from i18n
const GROUPS = [
  {
    groupKey: 'income',
    color: 'text-emerald-400',
    sources: [
      'include_manual_income',
      'include_recurring_income',
      'include_oxsteed_income',
      'include_predicted_jobs',
      'include_tool_rentals',
    ],
  },
  {
    groupKey: 'expenses',
    color: 'text-red-400',
    sources: [
      'include_manual_expenses',
      'include_recurring_expenses',
      'include_debt_obligations',
      'include_home_maintenance',
      'include_car_care',
      'include_personal_care',
    ],
  },
  {
    groupKey: 'business',
    color: 'text-blue-400',
    sources: [
      'include_business_pl',
      'include_pending_invoices',
      'include_tax_obligations',
    ],
  },
  {
    groupKey: 'plans',
    color: 'text-purple-400',
    sources: ['include_planned_needs'],
  },
];

// ── Toggle switch ─────────────────────────────────────────────────────────────
function Toggle({ on, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent
        transition-colors duration-200 focus:outline-none
        ${on ? 'bg-orange-500' : 'bg-gray-700'}`}
      aria-pressed={on}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow
          transform transition-transform duration-200
          ${on ? 'translate-x-4' : 'translate-x-0'}`}
      />
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function PulseScoreSettings({ onClose, onSaved }) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(null);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState(null);

  useEffect(() => {
    api.get('/life/pulse/settings')
      .then(({ data }) => setSettings(data))
      .catch(() => setError(t('pulseSettings.loadError')));
  }, []);

  // Lock body scroll and handle Escape while open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const toggle = (key) =>
    setSettings(prev => ({ ...prev, [key]: !prev[key] }));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const { data } = await api.put('/life/pulse/settings', settings);
      onSaved?.(data);
      onClose();
    } catch {
      setError(t('pulseSettings.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const enableAll = () =>
    setSettings(prev => Object.fromEntries(Object.keys(prev).map(k => [k, true])));

  const activeCount = settings
    ? Object.values(settings).filter(Boolean).length
    : 0;
  const totalCount = settings ? Object.keys(settings).length : 0;

  return (
    /* Overlay */
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Drawer */}
      <div className="relative w-full sm:max-w-lg max-h-[90vh] bg-gray-950 border border-gray-700/50
                      rounded-t-3xl sm:rounded-2xl flex flex-col shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div>
            <p className="text-sm font-semibold text-white">{t('pulseSettings.title')}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {settings
                ? t('pulseSettings.sourcesActive', { active: activeCount, total: totalCount })
                : t('pulseSettings.loading')}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {settings && activeCount < totalCount && (
              <button
                onClick={enableAll}
                className="text-[11px] text-orange-400 hover:text-orange-300 font-medium"
              >
                {t('pulseSettings.enableAll')}
              </button>
            )}
            <button onClick={onClose} aria-label={t('common.close')} className="p-2 -mr-1 text-gray-500 hover:text-white transition rounded-lg hover:bg-gray-800">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400">
              {error}
            </div>
          )}

          {!settings && !error && (
            <div className="space-y-3">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-10 bg-gray-800/60 rounded-xl animate-pulse" />
              ))}
            </div>
          )}

          {settings && GROUPS.map(group => (
            <div key={group.groupKey}>
              <p className={`text-[10px] uppercase tracking-widest font-semibold mb-3 ${group.color}`}>
                {t(`pulseSettings.groups.${group.groupKey}`)}
              </p>
              <div className="space-y-2">
                {group.sources.map(srcKey => (
                  <div
                    key={srcKey}
                    className={`flex items-center justify-between gap-4 p-3 rounded-xl border transition
                      ${settings[srcKey]
                        ? 'bg-gray-900/60 border-gray-700/40'
                        : 'bg-gray-900/20 border-gray-800/30 opacity-60'
                      }`}
                  >
                    <div className="min-w-0">
                      <p className={`text-sm font-medium ${settings[srcKey] ? 'text-gray-200' : 'text-gray-500'}`}>
                        {t(`pulseSettings.sources.${srcKey}.label`)}
                      </p>
                      <p className="text-[11px] text-gray-600 mt-0.5 leading-tight">
                        {t(`pulseSettings.sources.${srcKey}.desc`)}
                      </p>
                    </div>
                    <Toggle on={!!settings[srcKey]} onChange={() => toggle(srcKey)} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        {settings && (
          <div className="px-6 py-4 border-t border-gray-800 flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-gray-700 text-sm text-gray-400
                         hover:text-white hover:border-gray-600 transition"
            >
              {t('pulseSettings.cancel')}
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-400 disabled:opacity-50
                         text-sm font-semibold text-white transition"
            >
              {saving ? t('pulseSettings.saving') : t('pulseSettings.saveRecalculate')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
