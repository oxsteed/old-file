import { useEffect, useState, useCallback } from 'react';
import { Globe, Loader2, Power, Clock, EyeOff } from 'lucide-react';
import adminApi from '../../../lib/adminApi';
import toast from 'react-hot-toast';

// Super-admin country pack registry (docs/oxsteed-pack-architecture.md §5).
// Activating a country is a one-row status flip — never a deploy.

const STATUS_STYLES = {
  active: 'bg-green-500/10 text-green-400 border-green-500/30',
  coming_soon: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  disabled: 'bg-gray-500/10 text-gray-400 border-gray-500/30',
};

const STATUS_LABELS = {
  active: 'Active',
  coming_soon: 'Coming soon',
  disabled: 'Disabled',
};

export default function CountryPacks() {
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
      toast.error('Failed to load country packs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPacks();
  }, [fetchPacks]);

  const setStatus = async (pack, status) => {
    const verb = STATUS_LABELS[status].toLowerCase();
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Set ${pack.name} (${pack.code}) to "${verb}"? This changes what every user in the picker sees immediately.`)) return;
    setUpdating(pack.code);
    try {
      await adminApi.patch(`/country-config/admin/${pack.code}`, { status });
      toast.success(`${pack.flag_emoji || ''} ${pack.name} → ${STATUS_LABELS[status]}`.trim());
      fetchPacks();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update country pack');
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
          <h1 className="text-xl font-bold text-white">Country Packs</h1>
          <p className="text-sm text-gray-400">
            A country is a pack you register, never a condition you check. Flip a status to change the picker for everyone — no deploy.
          </p>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-gray-500 border-b border-gray-800">
              <th className="px-4 py-3">Country</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Currency</th>
              <th className="px-4 py-3">Locales</th>
              <th className="px-4 py-3">Personas</th>
              <th className="px-4 py-3">Payments</th>
              <th className="px-4 py-3 text-right">Actions</th>
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
                  No country packs yet. Apply migration 304 and reload.
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
            {STATUS_LABELS[p.status] || p.status}
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
                  <ActionBtn title="Activate" color="text-green-400 hover:bg-green-500/10" onClick={() => onSetStatus(p, 'active')}>
                    <Power size={14} />
                  </ActionBtn>
                )}
                {p.status !== 'coming_soon' && (
                  <ActionBtn title="Mark coming soon" color="text-amber-400 hover:bg-amber-500/10" onClick={() => onSetStatus(p, 'coming_soon')}>
                    <Clock size={14} />
                  </ActionBtn>
                )}
                {p.status !== 'disabled' && (
                  <ActionBtn title="Disable (hide everywhere)" color="text-gray-400 hover:bg-gray-500/10" onClick={() => onSetStatus(p, 'disabled')}>
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
