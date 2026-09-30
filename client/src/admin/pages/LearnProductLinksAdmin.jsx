/**
 * LearnProductLinksAdmin.jsx
 * Manage affiliate / product links shown in the Learn tab (iOS + web).
 * Route: /admin/learn/product-links
 *
 * How it works:
 *   - Admin creates rows in learn_product_links.
 *   - The iOS app fetches GET /api/learn/product-links on every refresh and
 *     overlays these rows on top of the hardcoded LearnGuideCatalog.
 *   - No app update required to change a link.
 *   - link_type = "own_inventory" enables future OxSteed store links with no
 *     code changes: the app renders "Shop OxSteed" instead of "Buy" and
 *     suppresses the Amazon affiliate disclosure automatically.
 *
 * Amazon Associates compliance enforced here:
 *   - Buy URL for amazon_affiliate must go directly to amazon.com (no /go/, no amzn.to).
 *   - Affiliate tag must be present in the URL.
 *   - The app renders "(paid link)" and the Associates disclosure automatically.
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Link2, Plus, Pencil, Trash2, AlertTriangle, CheckCircle,
  RefreshCw, Search, ShoppingBag, Tag, X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import adminApi from '../../lib/adminApi';
import { useAbortableFetch } from '../lib/useAbortableFetch';
import AdminErrorState from '../lib/AdminErrorState';
import ConfirmDialog from '../lib/ConfirmDialog';

// ── Constants ──────────────────────────────────────────────────────────────────

const LINK_TYPES = [
  { value: 'amazon_affiliate', i18nKey: 'amazonAffiliate', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
  { value: 'own_inventory',    i18nKey: 'ownInventory',    color: 'bg-green-100  text-green-800  dark:bg-green-900/30  dark:text-green-300'  },
  { value: 'partner',          i18nKey: 'partner',         color: 'bg-blue-100   text-blue-800   dark:bg-blue-900/30   dark:text-blue-300'   },
  { value: 'rental',           i18nKey: 'rental',          color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' },
];

const LINK_TYPE_MAP = Object.fromEntries(LINK_TYPES.map(t => [t.value, t]));
const DEFAULT_TAG   = 'oxsteed-20';

// ── Compliance check ──────────────────────────────────────────────────────────

function checkCompliance(link, t) {
  if (!link.link_type || link.link_type !== 'amazon_affiliate') return { ok: true };
  if (!link.buy_url) return { ok: true };

  const url = link.buy_url;
  const isDirect = /^https?:\/\/(www\.)?amazon\.(com|ca|co\.uk|com\.au|de|fr|it|es|co\.jp)/i.test(url);
  const hasTag   = url.includes(`tag=${link.affiliate_tag || DEFAULT_TAG}`) || url.includes('tag=');
  const noCloak  = !url.includes('/go/') && !url.includes('amzn.to') && !url.includes('bit.ly');

  if (!isDirect || !hasTag || !noCloak) {
    const issues = [];
    if (!isDirect) issues.push(t('adminLearnProductLinks.compliance.urlNotDirect'));
    if (!hasTag)   issues.push(t('adminLearnProductLinks.compliance.missingTag', { tag: link.affiliate_tag || DEFAULT_TAG }));
    if (!noCloak)  issues.push(t('adminLearnProductLinks.compliance.noShorteners'));
    return { ok: false, issues };
  }
  return { ok: true };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function LinkTypeBadge({ type }) {
  const { t } = useTranslation();
  const info = LINK_TYPE_MAP[type];
  if (!info) return <span className="text-zinc-400 text-xs">{type}</span>;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${info.color}`}>
      {t(`adminLearnProductLinks.linkType.${info.i18nKey}`)}
    </span>
  );
}

function ComplianceBadge({ link }) {
  const { t } = useTranslation();
  const result = checkCompliance(link, t);
  if (result.ok) {
    return (
      <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400 text-xs font-medium">
        <CheckCircle size={12} /> {t('adminLearnProductLinks.compliance.ok')}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 text-xs font-medium cursor-help"
      title={result.issues?.join('\n')}
    >
      <AlertTriangle size={12} /> {t('adminLearnProductLinks.compliance.checkUrl')}
    </span>
  );
}

// ── Modal form ────────────────────────────────────────────────────────────────

function ProductLinkModal({ initial, onSave, onClose }) {
  const { t } = useTranslation();
  const editing = !!initial?.id;
  const [form, setForm] = useState({
    guide_id:      initial?.guide_id      ?? '',
    tool_name:     initial?.tool_name     ?? '',
    link_type:     initial?.link_type     ?? 'amazon_affiliate',
    buy_url:       initial?.buy_url       ?? '',
    rent_url:      initial?.rent_url      ?? '',
    affiliate_tag: initial?.affiliate_tag ?? DEFAULT_TAG,
    is_active:     initial?.is_active     ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const compliance = checkCompliance(form, t);

  const handleSave = async () => {
    if (!form.tool_name.trim()) { setErr(t('adminLearnProductLinks.form.toolNameRequired')); return; }

    // Enforce compliance before sending to server
    if (form.link_type === 'amazon_affiliate' && form.buy_url) {
      if (!compliance.ok) {
        setErr(t('adminLearnProductLinks.form.fixCompliancePrefix') + '\n' + compliance.issues?.join('\n'));
        return;
      }
    }

    setSaving(true);
    setErr('');
    try {
      const payload = {
        ...form,
        guide_id:      form.guide_id.trim()      || null,
        tool_name:     form.tool_name.trim(),
        buy_url:       form.buy_url.trim()        || null,
        rent_url:      form.rent_url.trim()       || null,
        affiliate_tag: ['amazon_affiliate','partner'].includes(form.link_type)
                         ? (form.affiliate_tag.trim() || DEFAULT_TAG)
                         : null,
      };
      if (editing) {
        const { data } = await adminApi.put(`/learn/admin/product-links/${initial.id}`, payload);
        onSave(data.product, true);
      } else {
        const { data } = await adminApi.post('/learn/admin/product-links', payload);
        onSave(data.product, false);
      }
    } catch (e) {
      setErr(e.response?.data?.message || e.response?.data?.error || t('adminLearnProductLinks.form.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const isAmazon  = form.link_type === 'amazon_affiliate';
  const isPartner = form.link_type === 'partner';

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-zinc-200 dark:border-zinc-700">
          <h2 className="text-base font-bold">{t(editing ? 'adminLearnProductLinks.modal.editTitle' : 'adminLearnProductLinks.modal.addTitle')}</h2>
          <button onClick={onClose} aria-label={t('adminLearnProductLinks.modal.close')} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Tool name */}
          <div>
            <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1.5">
              {t('adminLearnProductLinks.form.toolName')} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.tool_name}
              onChange={e => set('tool_name', e.target.value)}
              placeholder={t('adminLearnProductLinks.form.toolNamePlaceholder')}
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:border-orange-400"
            />
            <p className="text-xs text-zinc-400 mt-1">{t('adminLearnProductLinks.form.toolNameHelp')}</p>
          </div>

          {/* Guide scope */}
          <div>
            <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1.5">
              {t('adminLearnProductLinks.form.guideScope')}
            </label>
            <input
              type="text"
              value={form.guide_id}
              onChange={e => set('guide_id', e.target.value)}
              placeholder={t('adminLearnProductLinks.form.guideScopePlaceholder')}
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:border-orange-400"
            />
            <p className="text-xs text-zinc-400 mt-1">
              {t('adminLearnProductLinks.form.guideScopeHelpPrefix')} <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded">fix-leaky-faucet</code>{t('adminLearnProductLinks.form.guideScopeHelpSuffix')}
            </p>
          </div>

          {/* Link type */}
          <div>
            <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1.5">
              {t('adminLearnProductLinks.form.linkType')} <span className="text-red-500">*</span>
            </label>
            <select
              value={form.link_type}
              onChange={e => set('link_type', e.target.value)}
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:border-orange-400"
            >
              {LINK_TYPES.map(lt => <option key={lt.value} value={lt.value}>{t(`adminLearnProductLinks.linkType.${lt.i18nKey}`)}</option>)}
            </select>
            {form.link_type === 'own_inventory' && (
              <p className="text-xs text-green-600 dark:text-green-400 mt-1 flex items-center gap-1">
                <CheckCircle size={11} /> {t('adminLearnProductLinks.form.ownInventoryNote')}
              </p>
            )}
          </div>

          {/* Buy URL */}
          <div>
            <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1.5">
              {t('adminLearnProductLinks.form.buyUrl')}
            </label>
            <input
              type="url"
              value={form.buy_url}
              onChange={e => set('buy_url', e.target.value)}
              placeholder={isAmazon ? 'https://www.amazon.com/s?k=...&tag=oxsteed-20' : 'https://shop.oxsteed.com/...'}
              className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none bg-zinc-50 dark:bg-zinc-800
                ${isAmazon && form.buy_url && !compliance.ok
                  ? 'border-amber-400 focus:border-amber-500'
                  : 'border-zinc-200 dark:border-zinc-700 focus:border-orange-400'}`}
            />
            {isAmazon && (
              <p className="text-xs text-zinc-400 mt-1">
                {t('adminLearnProductLinks.form.buyUrlHelp1')} <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded">amazon.com</code> {t('adminLearnProductLinks.form.buyUrlHelp2')} <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded">&tag={form.affiliate_tag || DEFAULT_TAG}</code>{t('adminLearnProductLinks.form.buyUrlHelp3')}
              </p>
            )}
          </div>

          {/* Rent URL */}
          <div>
            <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1.5">{t('adminLearnProductLinks.form.rentUrl')}</label>
            <input
              type="text"
              value={form.rent_url}
              onChange={e => set('rent_url', e.target.value)}
              placeholder="/tool-rentals?category=hand-tools"
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:border-orange-400"
            />
            <p className="text-xs text-zinc-400 mt-1">{t('adminLearnProductLinks.form.rentUrlHelp')}</p>
          </div>

          {/* Affiliate tag — Amazon / partner only */}
          {(isAmazon || isPartner) && (
            <div>
              <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1.5">{t('adminLearnProductLinks.form.affiliateTag')}</label>
              <input
                type="text"
                value={form.affiliate_tag}
                onChange={e => set('affiliate_tag', e.target.value)}
                placeholder={DEFAULT_TAG}
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:border-orange-400"
              />
            </div>
          )}

          {/* Live compliance check for Amazon */}
          {isAmazon && form.buy_url && !compliance.ok && (
            <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 p-3">
              <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300 font-semibold text-xs mb-1">
                <AlertTriangle size={13} /> {t('adminLearnProductLinks.compliance.title')}
              </div>
              <ul className="text-xs text-amber-700 dark:text-amber-400 space-y-0.5 list-disc list-inside">
                {compliance.issues?.map(i => <li key={i}>{i}</li>)}
              </ul>
            </div>
          )}

          {/* Active toggle */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => set('is_active', !form.is_active)}
              aria-label={t(form.is_active ? 'adminLearnProductLinks.form.deactivateLink' : 'adminLearnProductLinks.form.activateLink')}
              aria-pressed={form.is_active}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                form.is_active ? 'bg-orange-500' : 'bg-zinc-300 dark:bg-zinc-600'
              }`}
            >
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                form.is_active ? 'translate-x-4' : 'translate-x-1'
              }`} />
            </button>
            <span className="text-sm">{t(form.is_active ? 'adminLearnProductLinks.form.activeToggle' : 'adminLearnProductLinks.form.inactiveToggle')}</span>
          </div>

          {err && (
            <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-xs text-red-700 dark:text-red-400 whitespace-pre-line">
              {err}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 p-6 border-t border-zinc-200 dark:border-zinc-700">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800">
            {t('adminLearnProductLinks.form.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-50"
          >
            {saving ? t('adminLearnProductLinks.form.saving') : editing ? t('adminLearnProductLinks.form.saveChanges') : t('adminLearnProductLinks.form.addLink')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LearnProductLinksAdmin() {
  const { t } = useTranslation();
  const [links,      setLinks]      = useState([]);
  const [search,     setSearch]     = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterActive, setFilterActive] = useState('');
  const [modal,      setModal]      = useState(null); // null | { initial: obj | null }
  const [deactivating, setDeactivating] = useState(null); // link object pending deactivation

  // Abortable product-links load. A failed refetch keeps the previous list on
  // screen and surfaces a retryable error instead of clearing the table.
  const { data: linksData, error, loading, reload } = useAbortableFetch(async (signal) => {
    const params = {};
    if (filterType)   params.link_type = filterType;
    if (filterActive) params.is_active = filterActive;
    const { data } = await adminApi.get('/learn/admin/product-links', { params, signal });
    return data.products ?? [];
  }, [filterType, filterActive]);

  useEffect(() => { if (linksData) setLinks(linksData); }, [linksData]);

  const load = reload;

  const handleSave = (saved, isEdit) => {
    setLinks(prev =>
      isEdit
        ? prev.map(l => l.id === saved.id ? saved : l)
        : [saved, ...prev],
    );
    setModal(null);
  };

  const handleDeactivate = async () => {
    if (!deactivating) return;
    await adminApi.delete(`/learn/admin/product-links/${deactivating.id}`);
    setLinks(prev => prev.map(l => l.id === deactivating.id ? { ...l, is_active: false } : l));
  };

  const filtered = links.filter(l => {
    if (!search) return true;
    const q = search.toLowerCase();
    return l.tool_name.toLowerCase().includes(q) || (l.guide_id ?? '').toLowerCase().includes(q);
  });

  // Stats
  const total    = links.length;
  const active   = links.filter(l => l.is_active).length;
  const amazon   = links.filter(l => l.link_type === 'amazon_affiliate').length;
  const ownInv   = links.filter(l => l.link_type === 'own_inventory').length;
  const nonComp  = links.filter(l => l.is_active && !checkCompliance(l, t).ok).length;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Link2 size={20} className="text-orange-500" />
            {t('adminLearnProductLinks.title')}
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
            {t('adminLearnProductLinks.subtitle')}
          </p>
        </div>
        <button
          onClick={() => setModal({ initial: null })}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold"
        >
          <Plus size={15} /> {t('adminLearnProductLinks.addProductLink')}
        </button>
      </div>

      {/* Compliance banner */}
      <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 p-4 text-sm">
        <div className="font-semibold text-amber-800 dark:text-amber-300 mb-1 flex items-center gap-1.5">
          <AlertTriangle size={14} /> {t('adminLearnProductLinks.banner.title')}
        </div>
        <ul className="text-amber-700 dark:text-amber-400 space-y-0.5 list-disc list-inside text-xs">
          <li><strong>{t('adminLearnProductLinks.banner.noCloakingTitle')}</strong>{t('adminLearnProductLinks.banner.noCloakingMid')}<code>amazon.com</code>{t('adminLearnProductLinks.banner.noCloakingEnd')}</li>
          <li><strong>{t('adminLearnProductLinks.banner.tagTitle')}</strong>{t('adminLearnProductLinks.banner.tagMid')}<code>&tag=oxsteed-20</code>{t('adminLearnProductLinks.banner.tagEnd')}</li>
          <li>{t('adminLearnProductLinks.banner.autoRenderA')}<em>"(paid link)"</em>{t('adminLearnProductLinks.banner.autoRenderB')}<em>"As an Amazon Associate, OxSteed earns from qualifying purchases."</em>{t('adminLearnProductLinks.banner.autoRenderC')}</li>
          <li>{t('adminLearnProductLinks.banner.ownInventoryA')}<code>link_type = own_inventory</code>{t('adminLearnProductLinks.banner.ownInventoryB')}</li>
        </ul>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { key: 'total',         label: t('adminLearnProductLinks.stats.total'),         val: total,   color: '' },
          { key: 'active',        label: t('adminLearnProductLinks.stats.active'),        val: active,  color: 'text-green-600 dark:text-green-400' },
          { key: 'amazon',        label: t('adminLearnProductLinks.stats.amazon'),        val: amazon,  color: 'text-amber-600 dark:text-amber-400' },
          { key: 'ownInventory',  label: t('adminLearnProductLinks.stats.ownInventory'),  val: ownInv,  color: 'text-green-600 dark:text-green-400' },
          { key: 'compliance',    label: t('adminLearnProductLinks.stats.compliance'),    val: nonComp, color: nonComp > 0 ? 'text-red-600 dark:text-red-400' : 'text-zinc-400' },
        ].map(s => (
          <div key={s.key} className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 p-3">
            <div className={`text-2xl font-black ${s.color}`}>{s.val}</div>
            <div className="text-xs text-zinc-400 uppercase tracking-wide mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-52">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('adminLearnProductLinks.toolbar.searchPlaceholder')}
            className="w-full pl-8 pr-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-sm focus:outline-none focus:border-orange-400"
          />
        </div>
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none"
        >
          <option value="">{t('adminLearnProductLinks.toolbar.allTypes')}</option>
          {LINK_TYPES.map(lt => <option key={lt.value} value={lt.value}>{t(`adminLearnProductLinks.linkType.${lt.i18nKey}`)}</option>)}
        </select>
        <select
          value={filterActive}
          onChange={e => setFilterActive(e.target.value)}
          className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none"
        >
          <option value="">{t('adminLearnProductLinks.toolbar.allStatuses')}</option>
          <option value="true">{t('adminLearnProductLinks.status.active')}</option>
          <option value="false">{t('adminLearnProductLinks.status.inactive')}</option>
        </select>
        <button
          onClick={load}
          disabled={loading}
          className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-500"
          title={t('adminLearnProductLinks.toolbar.refresh')}
          aria-label={t('adminLearnProductLinks.toolbar.refresh')}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl">
          <AdminErrorState onRetry={reload} />
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden bg-white dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-50 dark:bg-zinc-800/60 border-b border-zinc-200 dark:border-zinc-700">
              <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">{t('adminLearnProductLinks.table.tool')}</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">{t('adminLearnProductLinks.table.type')}</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">{t('adminLearnProductLinks.table.buyUrl')}</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide hidden lg:table-cell">{t('adminLearnProductLinks.table.tag')}</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">{t('adminLearnProductLinks.table.status')}</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">{t('adminLearnProductLinks.table.compliant')}</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {loading && links.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-zinc-400">
                  <RefreshCw size={20} className="animate-spin mx-auto mb-2" />
                  {t('adminLearnProductLinks.table.loading')}
                </td>
              </tr>
            )}
            {!loading && !error && links.length > 0 && filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-zinc-400">
                  <ShoppingBag size={32} className="mx-auto mb-2 opacity-30" />
                  {t('adminLearnProductLinks.table.empty')}
                </td>
              </tr>
            )}
            {!loading && filtered.map(link => (
              <tr key={link.id} className={`hover:bg-zinc-50 dark:hover:bg-zinc-800/40 ${!link.is_active ? 'opacity-50' : ''}`}>
                <td className="px-4 py-3">
                  <div className="font-semibold text-zinc-900 dark:text-zinc-100">{link.tool_name}</div>
                  <div className="text-xs text-zinc-400 mt-0.5">
                    {link.guide_id ? t('adminLearnProductLinks.table.guideLabel', { guideId: link.guide_id }) : t('adminLearnProductLinks.table.globalGuides')}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <LinkTypeBadge type={link.link_type} />
                </td>
                <td className="px-4 py-3 max-w-xs">
                  {link.buy_url
                    ? <a href={link.buy_url} target="_blank" rel="noopener noreferrer"
                         className="text-xs text-zinc-500 hover:text-orange-500 truncate block max-w-[220px]"
                         title={link.buy_url}>
                        {link.buy_url}
                      </a>
                    : <span className="text-zinc-300 dark:text-zinc-600">—</span>
                  }
                </td>
                <td className="px-4 py-3 hidden lg:table-cell">
                  <code className="text-xs text-zinc-400">{link.affiliate_tag || '—'}</code>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                    link.is_active
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                      : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${link.is_active ? 'bg-green-500' : 'bg-zinc-400'}`} />
                    {t(link.is_active ? 'adminLearnProductLinks.status.active' : 'adminLearnProductLinks.status.inactive')}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <ComplianceBadge link={link} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 justify-end">
                    <button
                      onClick={() => setModal({ initial: link })}
                      className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                      title={t('adminLearnProductLinks.row.editTitle')}
                      aria-label={t('adminLearnProductLinks.row.editAria', { name: link.tool_name })}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => setDeactivating(link)}
                      className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-zinc-400 hover:text-red-500"
                      title={t('adminLearnProductLinks.row.deactivateTitle')}
                      aria-label={t('adminLearnProductLinks.row.deactivateAria', { name: link.tool_name })}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* How it works */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/40 p-5 text-sm space-y-2">
        <div className="font-semibold flex items-center gap-2"><Tag size={14} className="text-orange-500" /> {t('adminLearnProductLinks.how.title')}</div>
        <ul className="text-zinc-500 dark:text-zinc-400 space-y-1 list-disc list-inside text-xs">
          <li>{t('adminLearnProductLinks.how.item1a')}<code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded">GET /api/learn/product-links</code>{t('adminLearnProductLinks.how.item1b')}</li>
          <li>{t('adminLearnProductLinks.how.item2')}</li>
          <li>{t('adminLearnProductLinks.how.item3a')}<strong>{t('adminLearnProductLinks.how.item3scoped')}</strong>{t('adminLearnProductLinks.how.item3b')}<strong>{t('adminLearnProductLinks.how.item3global')}</strong>{t('adminLearnProductLinks.how.item3c')}</li>
          <li>{t('adminLearnProductLinks.how.item4a')}<code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded">link_type = own_inventory</code>{t('adminLearnProductLinks.how.item4b')}</li>
          <li>{t('adminLearnProductLinks.how.item5')}</li>
        </ul>
      </div>

      {/* Modal */}
      {modal && (
        <ProductLinkModal
          initial={modal.initial}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}

      {/* Deactivate confirmation */}
      {deactivating && (
        <ConfirmDialog
          open
          danger
          title={t('adminLearnProductLinks.deactivate.title')}
          message={t('adminLearnProductLinks.deactivate.message', { name: deactivating.tool_name })}
          confirmLabel={t('adminLearnProductLinks.deactivate.confirm')}
          onConfirm={handleDeactivate}
          onClose={() => setDeactivating(null)}
        />
      )}
    </div>
  );
}
