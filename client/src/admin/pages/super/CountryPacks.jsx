import { useEffect, useState, useCallback } from 'react';
import { Globe, Loader2, Power, Clock, EyeOff } from 'lucide-react';
import adminApi from '../../../lib/adminApi';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

// Super-admin country pack registry (docs/oxsteed-pack-architecture.md §5).
// Activating a country is a one-row status flip — never a deploy.

const STATUS_STYLES = {
  active: 'bg-green-500/10 text-green-400 border-green-500/30',
  coming_soon: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  disabled: 'bg-gray-500/10 text-gray-400 border-gray-500/30',
};

const STATUS_LABEL_KEYS = {
  active: 'superCountryPacks.statusActive',
  coming_soon: 'superCountryPacks.statusComingSoon',
  disabled: 'superCountryPacks.statusDisabled',
};

export default function CountryPacks() {
  const { t } = useTranslation();
  const [packs, setPacks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(null); // country code mid-update
  const [expanded, setExpanded] = useState(null); // country code with config shown

  const fetchPacks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.get('/country-config/admin');
      setPacks(res.data?.data?.packs || []);
    } catch {
      toast.error(t('superCountryPacks.errorLoad'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPacks();
  }, [fetchPacks]);

  const setStatus = async (pack, status) => {
    const verb = t(STATUS_LABEL_KEYS[status]).toLowerCase();
    // eslint-disable-next-line no-alert
    if (!window.confirm(t('superCountryPacks.confirmSet', { name: pack.name, code: pack.code, status: verb }))) return;
    setUpdating(pack.code);
    try {
      await adminApi.patch(`/country-config/admin/${pack.code}`, { status });
      toast.success(t('superCountryPacks.statusUpdated', { emoji: pack.flag_emoji || '', name: pack.name, status: t(STATUS_LABEL_KEYS[status]) }).trim());
      fetchPacks();
    } catch (err) {
      toast.error(err.response?.data?.message || t('superCountryPacks.errorUpdate'));
    } finally {
      setUpdating(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center">
          <Globe size={20} className="text-orange-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">{t('superCountryPacks.title')}</h1>
          <p className="text-sm text-gray-400">
            {t('superCountryPacks.subtitle')}
          </p>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-gray-500 border-b border-gray-800">
              <th className="px-4 py-3">{t('superCountryPacks.colCountry')}</th>
              <th className="px-4 py-3">{t('superCountryPacks.colStatus')}</th>
              <th className="px-4 py-3">{t('superCountryPacks.colCurrency')}</th>
              <th className="px-4 py-3">{t('superCountryPacks.colLocales')}</th>
              <th className="px-4 py-3">{t('superCountryPacks.colPersonas')}</th>
              <th className="px-4 py-3">{t('superCountryPacks.colPayments')}</th>
              <th className="px-4 py-3 text-right">{t('superCountryPacks.colActions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {packs.map((p) => {
              const cfg = p.config || {};
              const busy = updating === p.code;
              return (
                <FragmentRow
                  key={p.code}
                  pack={p}
                  cfg={cfg}
                  busy={busy}
                  expanded={expanded === p.code}
                  onToggleExpand={() => setExpanded(expanded === p.code ? null : p.code)}
                  onSetStatus={setStatus}
                />
              );
            })}
            {packs.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-gray-500">
                  {t('superCountryPacks.empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FragmentRow({ pack: p, cfg, busy, expanded, onToggleExpand, onSetStatus }) {
  const { t } = useTranslation();
  return (
    <>
      <tr className="hover:bg-gray-800/40 transition">
        <td className="px-4 py-3">
          <button type="button" onClick={onToggleExpand} className="flex items-center gap-2.5 text-left">
            <span className="text-xl">{p.flag_emoji || '🌍'}</span>
            <span>
              <span className="block font-semibold text-white">{p.name}</span>
              <span className="block text-[11px] text-gray-500">{p.code}</span>
            </span>
          </button>
        </td>
        <td className="px-4 py-3">
          <span className={`inline-block px-2 py-1 rounded-full border text-[11px] font-bold ${STATUS_STYLES[p.status] || STATUS_STYLES.disabled}`}>
            {t(STATUS_LABEL_KEYS[p.status] || 'superCountryPacks.statusDisabled')}
          </span>
        </td>
        <td className="px-4 py-3 text-gray-300">{p.currency_code}</td>
        <td className="px-4 py-3 text-gray-300">
          {(cfg.locales || [p.default_locale]).map((l) => l.toUpperCase()).join(' · ')}
        </td>
        <td className="px-4 py-3 text-gray-300">{(cfg.enabled_personas || []).length}</td>
        <td className="px-4 py-3 text-gray-400 text-xs">{(cfg.payment_methods || []).join(', ') || '—'}</td>
        <td className="px-4 py-3">
          <div className="flex justify-end gap-1.5">
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin text-orange-400" />
            ) : (
              <>
                {p.status !== 'active' && (
                  <ActionBtn title={t('superCountryPacks.activate')} color="text-green-400 hover:bg-green-500/10" onClick={() => onSetStatus(p, 'active')}>
                    <Power size={14} />
                  </ActionBtn>
                )}
                {p.status !== 'coming_soon' && (
                  <ActionBtn title={t('superCountryPacks.markComingSoon')} color="text-amber-400 hover:bg-amber-500/10" onClick={() => onSetStatus(p, 'coming_soon')}>
                    <Clock size={14} />
                  </ActionBtn>
                )}
                {p.status !== 'disabled' && (
                  <ActionBtn title={t('superCountryPacks.disable')} color="text-gray-400 hover:bg-gray-500/10" onClick={() => onSetStatus(p, 'disabled')}>
                    <EyeOff size={14} />
                  </ActionBtn>
                )}
              </>
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-950/60">
          <td colSpan={7} className="px-6 py-4">
            <pre className="text-[11px] text-gray-400 whitespace-pre-wrap break-all">
              {JSON.stringify(cfg, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}

function ActionBtn({ title, color, onClick, children }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`p-1.5 rounded-lg transition ${color}`}
    >
      {children}
    </button>
  );
}
