// client/src/admin/pages/TemplateManagement.jsx
// Admin: Template pricing editor, access grants, grant history & revoke

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import PageMeta from '../../components/PageMeta';
import { TEMPLATE_REGISTRY } from '../../components/profileTemplates/index';

// ── Icons ──────────────────────────────────────────────────────────────────
const Ico = ({ children, size = 18, cls = 'text-gray-400' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
    className={`flex-shrink-0 ${cls}`}>{children}</svg>
);
const IcoEdit     = p => <Ico {...p}><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></Ico>;
const IcoSave     = p => <Ico {...p}><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></Ico>;
const IcoX        = p => <Ico {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></Ico>;
const IcoPlus     = p => <Ico {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></Ico>;
const IcoTrash    = p => <Ico {...p}><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></Ico>;
const IcoSearch   = p => <Ico {...p}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></Ico>;
const IcoRefresh  = p => <Ico {...p}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></Ico>;
const IcoUser     = p => <Ico {...p}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></Ico>;
const IcoCheck    = p => <Ico {...p}><polyline points="20 6 9 17 4 12"/></Ico>;
const IcoShield   = p => <Ico {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></Ico>;
const IcoClock    = p => <Ico {...p}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></Ico>;
const IcoStar     = p => <Ico {...p}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></Ico>;

// ── Helpers ────────────────────────────────────────────────────────────────
const cents = v => Math.round(parseFloat(v || '0') * 100);
const dollars = v => (v / 100).toFixed(2);
const IcoPalette  = p => <Ico {...p}><circle cx="12" cy="12" r="10"/><path d="M8 12h.01M12 8h.01M16 12h.01M12 16h.01"/></Ico>;

const TABS = ['pricing', 'grants', 'stats'];

const Badge = ({ type }) => {
  const m = {
    active:    'bg-emerald-500/15 text-emerald-400',
    expired:   'bg-yellow-500/15 text-yellow-400',
    revoked:   'bg-red-500/15 text-red-400',
    permanent: 'bg-blue-500/15 text-blue-400',
    timed:     'bg-purple-500/15 text-purple-400',
    purchase_lifetime: 'bg-amber-500/15 text-amber-400',
    admin_grant: 'bg-indigo-500/15 text-indigo-400',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${m[type] || 'bg-gray-700 text-gray-400'}`}>
      {type?.replace(/_/g, ' ')}
    </span>
  );
};

// ── Pricing row (inline editable) ──────────────────────────────────────────
const PricingRow = ({ row, onSave, saving }) => {
  const [editing, setEditing]   = useState(false);
  const [monthly,  setMonthly]  = useState(dollars(row.monthly_price_cents || 999));
  const [lifetime, setLifetime] = useState(dollars(row.lifetime_price_cents || 4999));
  const [active,   setActive]   = useState(row.is_active !== false);

  const templateMeta = TEMPLATE_REGISTRY[row.slug] || {};

  const handleSave = async () => {
    await onSave(row.slug, {
      monthly_price_cents:  cents(monthly),
      lifetime_price_cents: cents(lifetime),
      is_active: active,
    });
    setEditing(false);
  };

  return (
    <tr className="border-b border-gray-800 hover:bg-gray-800/30 transition">
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gray-700/50 flex items-center justify-center text-gray-400">
            <IcoPalette size={14} />
          </div>
          <div>
            <div className="text-white text-sm font-medium">{row.name || templateMeta.name}</div>
            <div className="text-gray-500 text-xs font-mono">{row.slug}</div>
          </div>
        </div>
      </td>
      <td className="py-3 px-4">
        <span className="text-xs text-gray-400 capitalize">{row.category}</span>
      </td>
      <td className="py-3 px-4">
        {row.is_free
          ? <span className="text-emerald-400 text-xs font-semibold">Free</span>
          : editing
            ? <input type="number" min="0" step="0.01" value={monthly} onChange={e => setMonthly(e.target.value)}
                className="w-20 px-2 py-1 bg-gray-900 border border-gray-600 rounded text-white text-xs focus:outline-none focus:border-blue-500"
              />
            : <span className="text-white text-sm">${dollars(row.monthly_price_cents || 999)}</span>
        }
      </td>
      <td className="py-3 px-4">
        {row.is_free
          ? <span className="text-gray-500 text-xs">-</span>
          : editing
            ? <input type="number" min="0" step="0.01" value={lifetime} onChange={e => setLifetime(e.target.value)}
                className="w-20 px-2 py-1 bg-gray-900 border border-gray-600 rounded text-white text-xs focus:outline-none focus:border-blue-500"
              />
            : <span className="text-white text-sm">${dollars(row.lifetime_price_cents || 4999)}</span>
        }
      </td>
      <td className="py-3 px-4">
        {editing
          ? <button onClick={() => setActive(!active)}
              className={`w-10 h-5 rounded-full transition relative ${active ? 'bg-emerald-600' : 'bg-gray-600'}`}>
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${active ? 'translate-x-5' : 'translate-x-0.5'}`}/>
            </button>
          : <span className={`text-xs font-semibold ${row.is_active !== false ? 'text-emerald-400' : 'text-gray-500'}`}>
              {row.is_active !== false ? 'Active' : 'Inactive'}
            </span>
        }
      </td>
      <td className="py-3 px-4 text-right">
        {row.is_free ? null : editing ? (
          <div className="flex justify-end gap-2">
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition disabled:opacity-60">
              {saving ? <IcoRefresh size={12} cls="text-white animate-spin" /> : <IcoSave size={12} cls="text-white" />}
              Save
            </button>
            <button onClick={() => setEditing(false)}
              className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs transition">
              Cancel
            </button>
          </div>
        ) : (
          <button onClick={() => setEditing(true)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs transition">
            <IcoEdit size={12} cls="text-gray-400" /> Edit
          </button>
        )}
      </td>
    </tr>
  );
};

// ── Grant Form Modal ────────────────────────────────────────────────────────
const GrantModal = ({ open, onClose, onGrant, granting }) => {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    user_id: '',
    template_slug: '',
    grant_type: 'permanent',
    expiry_date: '',
    internal_note: '',
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async e => {
    e.preventDefault();
    if (!form.user_id.trim()) { toast.error('User ID is required'); return; }
    if (!form.template_slug)  { toast.error('Select a template'); return; }
    if (form.grant_type === 'timed' && !form.expiry_date) { toast.error('Expiry date required for timed grant'); return; }
    await onGrant(form);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700/60 rounded-2xl w-full max-w-md shadow-2xl p-6"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-bold text-lg">Grant Template Access</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-800 transition">
            <IcoX size={16} cls="text-gray-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-gray-400 text-xs font-medium mb-1.5">User ID or Email *</label>
            <input
              value={form.user_id}
              onChange={e => set('user_id', e.target.value)}
              placeholder="UUID or email address"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700/50 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
            <p className="text-gray-600 text-xs mt-1">Enter the user's UUID (from Users admin page)</p>
          </div>

          <div>
            <label className="block text-gray-400 text-xs font-medium mb-1.5">Template *</label>
            <select
              value={form.template_slug}
              onChange={e => set('template_slug', e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700/50 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
            >
              <option value="">Select template...</option>
              {Object.entries(TEMPLATE_REGISTRY)
                .filter(([, meta]) => !meta.is_free)
                .map(([slug, meta]) => (
                  <option key={slug} value={slug}>{meta.name}</option>
                ))
              }
            </select>
          </div>

          <div>
            <label className="block text-gray-400 text-xs font-medium mb-1.5">Grant Type *</label>
            <div className="flex gap-3">
              {[
                { val: 'permanent', label: 'Permanent', icon: IcoShield },
                { val: 'timed',     label: 'Timed',     icon: IcoClock },
              ].map(({ val, label, icon: Icon }) => (
                <label key={val} className={`flex-1 flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition ${form.grant_type === val ? 'border-blue-500 bg-blue-500/10' : 'border-gray-700 hover:border-gray-600'}`}>
                  <input type="radio" name="grant_type" value={val} checked={form.grant_type === val}
                    onChange={() => set('grant_type', val)} className="sr-only" />
                  <Icon size={14} cls={form.grant_type === val ? 'text-blue-400' : 'text-gray-500'} />
                  <span className={`text-sm font-medium ${form.grant_type === val ? 'text-white' : 'text-gray-400'}`}>{label}</span>
                </label>
              ))}
            </div>
          </div>

          {form.grant_type === 'timed' && (
            <div>
              <label className="block text-gray-400 text-xs font-medium mb-1.5">Expiry Date *</label>
              <input
                type="date"
                value={form.expiry_date}
                min={new Date().toISOString().slice(0, 10)}
                onChange={e => set('expiry_date', e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700/50 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          )}

          <div>
            <label className="block text-gray-400 text-xs font-medium mb-1.5">Internal Note (optional)</label>
            <textarea
              value={form.internal_note}
              onChange={e => set('internal_note', e.target.value)}
              rows={2}
              placeholder="Reason, ticket #, promo campaign..."
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700/50 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={granting}
              className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {granting ? <IcoRefresh size={15} cls="text-white animate-spin" /> : <IcoPlus size={15} cls="text-white" />}
              {granting ? 'Granting...' : 'Grant Access'}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ── Revoke confirm modal ────────────────────────────────────────────────────
const RevokeConfirm = ({ grant, onConfirm, onCancel, revoking }) => {
  if (!grant) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onCancel}>
      <div className="bg-gray-900 border border-red-500/40 rounded-2xl w-full max-w-sm p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-white font-bold mb-2">Revoke Access?</h3>
        <p className="text-gray-400 text-sm mb-4">
          This will revoke <strong className="text-white">{TEMPLATE_REGISTRY[grant.template_slug]?.name || grant.template_slug}</strong> access
          for user <span className="font-mono text-blue-300 text-xs">{grant.user_id}</span>.
          If their active profile uses this template, it will revert to Default.
        </p>
        <div className="flex gap-3">
          <button onClick={onConfirm} disabled={revoking}
            className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold text-sm transition disabled:opacity-60 flex items-center justify-center gap-2">
            {revoking ? <IcoRefresh size={14} cls="text-white animate-spin" /> : <IcoTrash size={14} cls="text-white" />}
            {revoking ? 'Revoking...' : 'Yes, Revoke'}
          </button>
          <button onClick={onCancel}
            className="px-4 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
export default function TemplateManagement() {
  const { t } = useTranslation();

  const [tab, setTab]               = useState('pricing');
  const [pricingRows, setPricingRows] = useState([]);
  const [grants, setGrants]         = useState([]);
  const [stats, setStats]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [savingSlug, setSavingSlug] = useState(null);
  const [granting, setGranting]     = useState(false);
  const [showGrantModal, setShowGrantModal] = useState(false);
  const [revokeTarget, setRevokeTarget]     = useState(null);
  const [revoking, setRevoking]     = useState(false);

  // Grants filter state
  const [grantSearch, setGrantSearch] = useState('');
  const [grantStatusFilter, setGrantStatusFilter] = useState('active');
  const [grantsPage, setGrantsPage]   = useState(0);
  const GRANTS_PER_PAGE = 20;

  // ── Load pricing ───────────────────────────────────────────────────────
  const loadPricing = useCallback(async () => {
    try {
      const res = await api.get('/templates/admin/pricing');
      setPricingRows(res.data?.data || []);
    } catch (e) {
      toast.error('Failed to load pricing');
    }
  }, []);

  // ── Load grants ────────────────────────────────────────────────────────
  const loadGrants = useCallback(async () => {
    try {
      const params = new URLSearchParams({ status: grantStatusFilter, limit: GRANTS_PER_PAGE, offset: grantsPage * GRANTS_PER_PAGE });
      if (grantSearch) params.set('user_id', grantSearch);
      const res = await api.get(`/templates/admin/grants?${params}`);
      setGrants(res.data?.data || []);
    } catch (e) {
      toast.error('Failed to load grants');
    }
  }, [grantSearch, grantStatusFilter, grantsPage]);

  // ── Load stats ─────────────────────────────────────────────────────────
  const loadStats = useCallback(async () => {
    try {
      const res = await api.get('/templates/admin/stats');
      setStats(res.data?.data || []);
    } catch (e) {
      toast.error('Failed to load stats');
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadPricing(), loadGrants(), loadStats()]).finally(() => setLoading(false));
  }, []);

  useEffect(() => { if (tab === 'grants') loadGrants(); }, [tab, grantSearch, grantStatusFilter, grantsPage, loadGrants]);
  useEffect(() => { if (tab === 'stats')  loadStats();  }, [tab, loadStats]);

  // ── Save pricing ───────────────────────────────────────────────────────
  const handleSavePricing = async (slug, data) => {
    setSavingSlug(slug);
    try {
      await api.patch(`/templates/admin/pricing/${slug}`, data);
      await loadPricing();
      toast.success(`Pricing updated for ${slug}`);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to save pricing');
    } finally {
      setSavingSlug(null);
    }
  };

  // ── Grant access ───────────────────────────────────────────────────────
  const handleGrant = async (form) => {
    setGranting(true);
    try {
      await api.post('/templates/admin/grants', form);
      toast.success('Access granted');
      setShowGrantModal(false);
      await loadGrants();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to grant access');
    } finally {
      setGranting(false);
    }
  };

  // ── Revoke access ──────────────────────────────────────────────────────
  const handleRevoke = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await api.delete(`/templates/admin/grants/${revokeTarget.id}`);
      toast.success('Access revoked');
      setRevokeTarget(null);
      await loadGrants();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to revoke');
    } finally {
      setRevoking(false);
    }
  };

  const formatDate = ts => ts ? new Date(ts).toLocaleDateString() : '-';

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="p-6 min-h-screen bg-gray-950">
      <PageMeta title="Template Management - Admin" />

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Profile Templates</h1>
          <p className="text-gray-400 text-sm mt-0.5">Manage pricing, grant/revoke user access, and view adoption stats</p>
        </div>
        <button
          onClick={() => setShowGrantModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition"
        >
          <IcoPlus size={16} cls="text-white" />
          Grant Access
        </button>
      </div>

      {/* Stats summary bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total Templates', value: pricingRows.length },
          { label: 'Premium Templates', value: pricingRows.filter(r => !r.is_free).length },
          { label: 'Active Grants', value: grants.filter(g => g.status === 'active').length },
          { label: 'Total Access Records', value: grants.length },
        ].map(({ label, value }) => (
          <div key={label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="text-2xl font-bold text-white">{loading ? '-' : value}</div>
            <div className="text-gray-400 text-xs mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition ${tab === t ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
          >
            {t === 'pricing' ? 'Pricing' : t === 'grants' ? 'Access Grants' : 'Stats'}
          </button>
        ))}
      </div>

      {/* ── Pricing tab ─────────────────────────────────────────────────── */}
      {tab === 'pricing' && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-gray-800 flex items-center justify-between">
            <h2 className="text-white font-semibold">Template Pricing</h2>
            <span className="text-gray-500 text-xs">{pricingRows.length} templates — click Edit to modify monthly/lifetime prices inline</span>
          </div>
          {loading ? (
            <div className="p-8 text-center text-gray-500">Loading...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase tracking-wider">
                    <th className="text-left py-3 px-4 font-medium">Template</th>
                    <th className="text-left py-3 px-4 font-medium">Category</th>
                    <th className="text-left py-3 px-4 font-medium">Monthly</th>
                    <th className="text-left py-3 px-4 font-medium">Lifetime</th>
                    <th className="text-left py-3 px-4 font-medium">Status</th>
                    <th className="text-right py-3 px-4 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pricingRows.map(row => (
                    <PricingRow
                      key={row.slug}
                      row={row}
                      onSave={handleSavePricing}
                      saving={savingSlug === row.slug}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Grants tab ──────────────────────────────────────────────────── */}
      {tab === 'grants' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <IcoSearch size={14} cls="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                value={grantSearch}
                onChange={e => { setGrantSearch(e.target.value); setGrantsPage(0); }}
                placeholder="Search by user ID..."
                className="w-full pl-8 pr-3 py-2 bg-gray-800 border border-gray-700/50 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex rounded-lg overflow-hidden border border-gray-700">
              {['all', 'active', 'expired', 'revoked'].map(s => (
                <button
                  key={s}
                  onClick={() => { setGrantStatusFilter(s); setGrantsPage(0); }}
                  className={`px-3 py-2 text-xs font-medium transition ${grantStatusFilter === s ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
            <button onClick={loadGrants} className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 transition" title="Refresh">
              <IcoRefresh size={15} cls="text-gray-400" />
            </button>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase tracking-wider">
                  <th className="text-left py-3 px-4 font-medium">User ID</th>
                  <th className="text-left py-3 px-4 font-medium">Template</th>
                  <th className="text-left py-3 px-4 font-medium">Type</th>
                  <th className="text-left py-3 px-4 font-medium">Status</th>
                  <th className="text-left py-3 px-4 font-medium">Granted</th>
                  <th className="text-left py-3 px-4 font-medium">Expires</th>
                  <th className="text-left py-3 px-4 font-medium">Note</th>
                  <th className="text-right py-3 px-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="py-10 text-center text-gray-500">Loading...</td></tr>
                ) : grants.length === 0 ? (
                  <tr><td colSpan={8} className="py-10 text-center text-gray-500">No grants found</td></tr>
                ) : grants.map(g => (
                  <tr key={g.id} className="border-b border-gray-800 hover:bg-gray-800/30 transition">
                    <td className="py-3 px-4">
                      <span className="font-mono text-blue-300 text-xs">{g.user_id?.slice(0, 12)}…</span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-white text-sm">{TEMPLATE_REGISTRY[g.template_slug]?.name || g.template_slug}</div>
                      <div className="text-gray-600 text-xs font-mono">{g.template_slug}</div>
                    </td>
                    <td className="py-3 px-4"><Badge type={g.access_type} /></td>
                    <td className="py-3 px-4"><Badge type={g.status} /></td>
                    <td className="py-3 px-4 text-gray-400 text-xs">{formatDate(g.start_date || g.created_at)}</td>
                    <td className="py-3 px-4 text-gray-400 text-xs">
                      {g.grant_type === 'permanent' ? (
                        <span className="text-blue-400">Permanent</span>
                      ) : formatDate(g.expiry_date)}
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-gray-500 text-xs truncate max-w-[120px] block" title={g.internal_note}>
                        {g.internal_note || '-'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      {g.status === 'active' && (
                        <button
                          onClick={() => setRevokeTarget(g)}
                          className="flex items-center gap-1 ml-auto px-3 py-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-400 text-xs font-medium transition"
                        >
                          <IcoX size={12} cls="text-red-400" /> Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {grants.length >= GRANTS_PER_PAGE && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
                <button disabled={grantsPage === 0}
                  onClick={() => setGrantsPage(p => p - 1)}
                  className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs disabled:opacity-40 transition">
                  Previous
                </button>
                <span className="text-gray-500 text-xs">Page {grantsPage + 1}</span>
                <button onClick={() => setGrantsPage(p => p + 1)}
                  className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs transition">
                  Next
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Stats tab ───────────────────────────────────────────────────── */}
      {tab === 'stats' && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-gray-800">
            <h2 className="text-white font-semibold">Template Adoption Stats</h2>
            <p className="text-gray-500 text-xs mt-0.5">Number of active profiles using each template</p>
          </div>
          {loading ? (
            <div className="p-8 text-center text-gray-500">Loading...</div>
          ) : stats.length === 0 ? (
            <div className="p-8 text-center text-gray-500">No data yet</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400 text-xs uppercase tracking-wider">
                  <th className="text-left py-3 px-4 font-medium">Template</th>
                  <th className="text-left py-3 px-4 font-medium">Category</th>
                  <th className="text-right py-3 px-4 font-medium">Helper Profiles</th>
                  <th className="text-right py-3 px-4 font-medium">Business Profiles</th>
                  <th className="text-right py-3 px-4 font-medium">Total Access Records</th>
                  <th className="text-right py-3 px-4 font-medium">Active Grants</th>
                </tr>
              </thead>
              <tbody>
                {stats.map(row => (
                  <tr key={row.slug} className="border-b border-gray-800 hover:bg-gray-800/30 transition">
                    <td className="py-3 px-4">
                      <div className="text-white text-sm font-medium">{row.name}</div>
                      <div className="text-gray-600 text-xs font-mono">{row.slug}</div>
                    </td>
                    <td className="py-3 px-4 text-gray-400 text-xs capitalize">{row.category}</td>
                    <td className="py-3 px-4 text-right">
                      <span className="text-white font-semibold">{row.helper_count || 0}</span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <span className="text-white font-semibold">{row.business_count || 0}</span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <span className="text-gray-300">{row.total_access || 0}</span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <span className={`font-semibold ${row.active_grants > 0 ? 'text-emerald-400' : 'text-gray-500'}`}>
                        {row.active_grants || 0}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Modals */}
      <GrantModal
        open={showGrantModal}
        onClose={() => setShowGrantModal(false)}
        onGrant={handleGrant}
        granting={granting}
      />
      <RevokeConfirm
        grant={revokeTarget}
        onConfirm={handleRevoke}
        onCancel={() => setRevokeTarget(null)}
        revoking={revoking}
      />
    </div>
  );
}
