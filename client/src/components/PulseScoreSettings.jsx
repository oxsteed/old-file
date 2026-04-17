import { useState, useEffect } from 'react';
import api from '../api/axios';

// ── Source definitions ────────────────────────────────────────────────────────
// Groups shown in the settings panel. `key` matches pulse_score_settings columns.

const GROUPS = [
  {
    label: 'Income',
    color: 'text-emerald-400',
    sources: [
      { key: 'include_manual_income',    label: 'Manual income entries',    desc: 'One-time income you log (wages, gigs, etc.)' },
      { key: 'include_recurring_income', label: 'Recurring income',         desc: 'Salary, subscriptions received, regular inflows' },
      { key: 'include_oxsteed_income',   label: 'OxSteed job income',       desc: 'Settled payouts from completed platform jobs' },
      { key: 'include_predicted_jobs',   label: 'In-progress job income',   desc: 'Authorized escrow — payment held, released on completion' },
      { key: 'include_tool_rentals',     label: 'Tool rental income',       desc: 'Income logged under tool / equipment / rental categories' },
    ],
  },
  {
    label: 'Expenses',
    color: 'text-red-400',
    sources: [
      { key: 'include_manual_expenses',    label: 'Manual expense entries',    desc: 'One-time expenses you log' },
      { key: 'include_recurring_expenses', label: 'Recurring expenses',        desc: 'Subscriptions, bills, regular outflows' },
      { key: 'include_debt_obligations',   label: 'Monthly debt obligations',  desc: 'Recurring loan, mortgage, and credit payments' },
      { key: 'include_home_maintenance',   label: 'Home maintenance plan',     desc: 'Recurring home tasks with an estimated cost' },
      { key: 'include_car_care',           label: 'Car care plan',             desc: 'Recurring vehicle tasks with an estimated cost' },
      { key: 'include_personal_care',      label: 'Personal care plan',        desc: 'Recurring personal care tasks with an estimated cost' },
    ],
  },
  {
    label: 'Business',
    color: 'text-blue-400',
    sources: [
      { key: 'include_business_pl',      label: 'Business P&L',             desc: 'Paid invoice income across all your businesses' },
      { key: 'include_pending_invoices', label: 'Pending invoice income',    desc: 'Outstanding invoices counted at 80% confidence' },
      { key: 'include_tax_obligations',  label: 'Upcoming tax obligations',  desc: 'Estimated tax payments due within the selected window' },
    ],
  },
  {
    label: 'Plans & Obligations',
    color: 'text-purple-400',
    sources: [
      { key: 'include_planned_needs', label: 'Planned needs sinking fund', desc: 'Future expenses you are saving toward (vacation, repairs, etc.)' },
    ],
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
// Props:
//   onClose()         – close the panel
//   onSaved(settings) – called after successful save so parent can refetch pulse
export default function PulseScoreSettings({ onClose, onSaved }) {
  const [settings, setSettings] = useState(null);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState(null);

  useEffect(() => {
    api.get('/life/pulse/settings')
      .then(({ data }) => setSettings(data))
      .catch(() => setError('Failed to load settings.'));
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
      setError('Failed to save settings.');
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
            <p className="text-sm font-semibold text-white">Pulse Score Sources</p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {settings ? `${activeCount} of ${totalCount} sources active` : 'Loading…'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {settings && activeCount < totalCount && (
              <button
                onClick={enableAll}
                className="text-[11px] text-orange-400 hover:text-orange-300 font-medium"
              >
                Enable all
              </button>
            )}
            <button onClick={onClose} aria-label="Close" className="p-2 -mr-1 text-gray-500 hover:text-white transition rounded-lg hover:bg-gray-800">
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
            <div key={group.label}>
              <p className={`text-[10px] uppercase tracking-widest font-semibold mb-3 ${group.color}`}>
                {group.label}
              </p>
              <div className="space-y-2">
                {group.sources.map(src => (
                  <div
                    key={src.key}
                    className={`flex items-center justify-between gap-4 p-3 rounded-xl border transition
                      ${settings[src.key]
                        ? 'bg-gray-900/60 border-gray-700/40'
                        : 'bg-gray-900/20 border-gray-800/30 opacity-60'
                      }`}
                  >
                    <div className="min-w-0">
                      <p className={`text-sm font-medium ${settings[src.key] ? 'text-gray-200' : 'text-gray-500'}`}>
                        {src.label}
                      </p>
                      <p className="text-[11px] text-gray-600 mt-0.5 leading-tight">{src.desc}</p>
                    </div>
                    <Toggle on={!!settings[src.key]} onChange={() => toggle(src.key)} />
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
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-400 disabled:opacity-50
                         text-sm font-semibold text-white transition"
            >
              {saving ? 'Saving…' : 'Save & Recalculate'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
