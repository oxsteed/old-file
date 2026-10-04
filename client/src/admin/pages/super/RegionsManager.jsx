import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  Compass,
  Edit2,
  Globe2,
  Layers3,
  Loader2,
  Map,
  MapPinned,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import adminApi from '../../../lib/adminApi';
import { SuggestDropdown } from '../../../components/SuggestDropdown';
import '../../lib/suggestDropdownAdmin.css';
import RegionForm from '../../../components/RegionForm';

const TYPE_META = {
  zip_range: {
    tone: 'rgba(59, 130, 246, 0.14)',
    color: '#93c5fd',
  },
  city_state: {
    tone: 'rgba(14, 165, 233, 0.14)',
    color: '#7dd3fc',
  },
  geo_radius: {
    tone: 'rgba(249, 115, 22, 0.14)',
    color: '#fdba74',
  },
  country_region: {
    tone: 'rgba(34, 197, 94, 0.14)',
    color: '#86efac',
  },
  country_only: {
    tone: 'rgba(168, 85, 247, 0.14)',
    color: '#d8b4fe',
  },
};

function summarizeBoundary(def, t) {
  if (!def || !def.type) return '-';
  switch (def.type) {
    case 'zip_range':
      return t('adminRegionsZipRanges', { count: def.ranges?.length || 0 });
    case 'city_state':
      return t('adminRegionsCityStatePairs', { count: def.entries?.length || 0 });
    case 'geo_radius':
      return t('adminRegionsGeoRadiusSummary', {
        radius: def.radius_miles,
        lat: def.center?.lat?.toFixed(3),
        lng: def.center?.lng?.toFixed(3),
      });
    case 'country_region': {
      const n = def.entries?.length || 0;
      if (!n) return t('adminRegionsCountryRegionPairs', { count: 0 });
      const first = def.entries[0];
      const more = n > 1 ? ` +${n - 1}` : '';
      return t('adminRegionsCountryRegionSummary', {
        country: first?.country || '?',
        region: first?.region || '?',
        more,
      });
    }
    case 'country_only': {
      const list = def.countries || [];
      if (!list.length) return t('adminRegionsCountries', { count: 0 });
      const head = list.slice(0, 3).join(', ');
      const more = list.length > 3 ? ` +${list.length - 3}` : '';
      return `${head}${more}`;
    }
    default:
      return def.type;
  }
}

const TYPE_LABEL_KEY = {
  zip_range: 'adminRegionsTypeZipRange',
  city_state: 'adminRegionsTypeCityState',
  geo_radius: 'adminRegionsTypeGeoRadius',
  country_region: 'adminRegionsTypeCountryRegion',
  country_only: 'adminRegionsTypeCountryOnly',
};
const TYPE_DESC_KEY = {
  zip_range: 'adminRegionsTypeZipRangeDesc',
  city_state: 'adminRegionsTypeCityStateDesc',
  geo_radius: 'adminRegionsTypeGeoRadiusDesc',
  country_region: 'adminRegionsTypeCountryRegionDesc',
  country_only: 'adminRegionsTypeCountryOnlyDesc',
};

function boundaryCount(def) {
  if (!def || !def.type) return 0;
  switch (def.type) {
    case 'zip_range':
      return def.ranges?.length || 0;
    case 'city_state':
    case 'country_region':
      return def.entries?.length || 0;
    case 'country_only':
      return def.countries?.length || 0;
    case 'geo_radius':
      return 1;
    default:
      return 0;
  }
}

function boundaryHighlights(def, t) {
  if (!def || !def.type) return [];
  const milesUnit = t ? t('adminRegionsMilesUnit', { defaultValue: 'miles' }) : 'miles';
  switch (def.type) {
    case 'zip_range':
      return (def.ranges || []).slice(0, 3).map((range) => `${range.start}-${range.end}`);
    case 'city_state':
      return (def.entries || []).slice(0, 3).map((entry) => `${entry.city}, ${entry.state}`);
    case 'country_region':
      return (def.entries || []).slice(0, 3).map((entry) => `${entry.country} - ${entry.region}`);
    case 'country_only':
      return (def.countries || []).slice(0, 4);
    case 'geo_radius':
      return [`${def.radius_miles} ${milesUnit}`, `Lat ${def.center?.lat ?? 0}`, `Lng ${def.center?.lng ?? 0}`];
    default:
      return [];
  }
}

function MetricCard({ icon: Icon, label, value, hint, tone }) {
  return (
    <div
      className="rounded-3xl border border-white/10 bg-slate-950/80 p-5 shadow-[0_22px_60px_rgba(2,6,23,0.28)]"
      style={{ boxShadow: '0 22px 60px rgba(2, 6, 23, 0.28)' }}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div
          className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10"
          style={{ background: tone }}
        >
          <Icon size={18} className="text-white" />
        </div>
        <div className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-slate-400">
          {label}
        </div>
      </div>
      <div className="text-3xl font-semibold text-white">{value}</div>
      <div className="mt-2 text-sm leading-6 text-slate-400">{hint}</div>
    </div>
  );
}

function RegionCard({ region, onEdit, onDelete, deleting }) {
  const { t } = useTranslation();
  const type = region.boundary_definition?.type || 'unknown';
  const known = Boolean(TYPE_META[type]);
  const meta = TYPE_META[type] || {
    tone: 'rgba(148, 163, 184, 0.14)',
    color: '#cbd5e1',
  };
  const typeLabel = known ? t(TYPE_LABEL_KEY[type]) : type;
  const typeDescription = known ? t(TYPE_DESC_KEY[type]) : t('adminRegionsTypeCustomDesc');
  const chips = boundaryHighlights(region.boundary_definition, t);

  return (
    <article className="rounded-[28px] border border-white/10 bg-slate-950/80 p-5 shadow-[0_22px_60px_rgba(2,6,23,0.28)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center rounded-full px-3 py-1 text-[0.72rem] font-semibold uppercase tracking-[0.14em]"
              style={{ background: meta.tone, color: meta.color }}
            >
              {typeLabel}
            </span>
            <span className="inline-flex items-center rounded-full bg-white/5 px-3 py-1 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-slate-300">
              {t('adminRegionsActiveGrants', { count: region.active_grants_count || 0 })}
            </span>
          </div>
          <h2 className="truncate text-xl font-semibold text-white">{region.name}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            {region.description || typeDescription}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onEdit(region)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-300 transition hover:border-orange-400/40 hover:bg-orange-500/10 hover:text-orange-200"
            title={t('adminRegionsEditRegion')}
          >
            <Edit2 size={15} />
          </button>
          <button
            onClick={() => onDelete(region)}
            disabled={deleting}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-300 transition hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-50"
            title={t('adminRegionsDeleteRegion')}
          >
            {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-white/8 bg-slate-900/70 p-4">
          <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-slate-500">
            {t('adminRegionsCoverage')}
          </div>
          <div className="mt-2 text-sm font-medium text-slate-100">
            {summarizeBoundary(region.boundary_definition, t)}
          </div>
        </div>
        <div className="rounded-2xl border border-white/8 bg-slate-900/70 p-4">
          <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-slate-500">
            {t('adminRegionsBoundaryUnits')}
          </div>
          <div className="mt-2 text-sm font-medium text-slate-100">
            {boundaryCount(region.boundary_definition)}
          </div>
        </div>
        <div className="rounded-2xl border border-white/8 bg-slate-900/70 p-4">
          <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-slate-500">
            {t('adminRegionsOwnerLoad')}
          </div>
          <div className="mt-2 text-sm font-medium text-slate-100">
            {region.active_grants_count > 0 ? t('adminRegionsAssigned') : t('adminRegionsUnassigned')}
          </div>
        </div>
      </div>

      {chips.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-2">
          {chips.map((chip) => (
            <span
              key={chip}
              className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300"
            >
              {chip}
            </span>
          ))}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/8 pt-4 text-xs text-slate-500">
        <span>{t('adminRegionsCreatedBy', { name: region.created_by_name || t('adminRegionsUnknownAdmin') })}</span>
        <span>{t('adminRegionsUpdated', { date: new Date(region.updated_at || region.created_at).toLocaleDateString() })}</span>
      </div>
    </article>
  );
}

export default function RegionsManager() {
  const { t } = useTranslation();
  const [regions, setRegions] = useState([]);

  // Typeahead suggestions from the loaded region rows.
  const regionSuggestItems = useMemo(() => {
    const seen = new Set();
    const items = [];
    for (const region of regions) {
      if (region.id == null || seen.has(region.id)) continue;
      seen.add(region.id);
      items.push({ id: region.id, title: region.name || String(region.id), meta: region.code || undefined });
    }
    return items;
  }, [regions]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [editing, setEditing] = useState(null); // null, 'new', or region object
  const [deletingId, setDeletingId] = useState(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data } = await adminApi.get('/admin/super/regions');
      setRegions(data.regions || []);
    } catch (err) {
      setLoadError(err.response?.data?.error || t('adminRegionsLoadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filteredRegions = useMemo(() => {
    const term = search.trim().toLowerCase();
    return regions.filter((region) => {
      const type = region.boundary_definition?.type || '';
      const matchesType = !typeFilter || type === typeFilter;
      const haystack = [
        region.name,
        region.description,
        type,
        summarizeBoundary(region.boundary_definition, t),
        ...boundaryHighlights(region.boundary_definition, t),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      const matchesSearch = !term || haystack.includes(term);
      return matchesType && matchesSearch;
    });
  }, [regions, search, typeFilter, t]);

  const metrics = useMemo(() => {
    const total = regions.length;
    const assigned = regions.filter((region) => (region.active_grants_count || 0) > 0).length;
    const international = regions.filter((region) =>
      ['country_region', 'country_only'].includes(region.boundary_definition?.type)
    ).length;
    const boundaryUnits = regions.reduce(
      (sum, region) => sum + boundaryCount(region.boundary_definition),
      0
    );
    return { total, assigned, international, boundaryUnits };
  }, [regions]);

  const handleSaved = () => {
    setEditing(null);
    load();
  };

  const handleDelete = async (region) => {
    if (!confirm(t('adminRegionsDeleteConfirm', { name: region.name }))) return;
    setDeletingId(region.id);
    try {
      await adminApi.delete(`/admin/super/regions/${region.id}`);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || t('adminRegionsDeleteFailed'));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="min-h-full bg-[linear-gradient(180deg,#020617_0%,#0f172a_44%,#111827_100%)] px-4 py-6 text-slate-100">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <section className="rounded-[32px] border border-white/10 bg-slate-950/80 p-6 shadow-[0_28px_90px_rgba(2,6,23,0.34)]">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-orange-400/20 bg-orange-500/10 px-3 py-1 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-orange-200">
                <MapPinned size={14} />
                {t('adminRegionsEyebrow')}
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white md:text-4xl">
                {t('adminRegionsTitle')}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-400 md:text-base">
                {t('adminRegionsSubtitle')}
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={load}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-200 transition hover:bg-white/10"
              >
                <RefreshCcw size={15} />
                {t('common.refresh')}
              </button>
              <button
                onClick={() => setEditing('new')}
                className="inline-flex items-center gap-2 rounded-2xl bg-orange-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-orange-500"
              >
                <Plus size={15} />
                {t('adminRegionsNewRegion')}
              </button>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              icon={Map}
              label={t('adminRegionsMetricTotal')}
              value={metrics.total}
              hint={t('adminRegionsMetricTotalHint')}
              tone="linear-gradient(135deg, rgba(59,130,246,0.3), rgba(14,165,233,0.15))"
            />
            <MetricCard
              icon={ShieldCheck}
              label={t('adminRegionsMetricAssigned')}
              value={metrics.assigned}
              hint={t('adminRegionsMetricAssignedHint')}
              tone="linear-gradient(135deg, rgba(34,197,94,0.3), rgba(16,185,129,0.15))"
            />
            <MetricCard
              icon={Globe2}
              label={t('adminRegionsMetricInternational')}
              value={metrics.international}
              hint={t('adminRegionsMetricInternationalHint')}
              tone="linear-gradient(135deg, rgba(168,85,247,0.3), rgba(99,102,241,0.15))"
            />
            <MetricCard
              icon={Layers3}
              label={t('adminRegionsMetricBoundaryUnits')}
              value={metrics.boundaryUnits}
              hint={t('adminRegionsMetricBoundaryUnitsHint')}
              tone="linear-gradient(135deg, rgba(249,115,22,0.3), rgba(234,88,12,0.15))"
            />
          </div>
        </section>

        <section className="rounded-[28px] border border-white/10 bg-slate-950/80 p-5 shadow-[0_22px_60px_rgba(2,6,23,0.28)]">
          <div className="flex flex-wrap items-center gap-3">
            <SuggestDropdown
              id="regions-manager-search"
              items={regionSuggestItems}
              value={search}
              onQueryChange={setSearch}
              onSelect={(item) => setSearch(item.title || '')}
              recentsKey="oxsteed_admin_regions_manager_search_recents"
              placeholder={t('adminRegionsSearchPlaceholder')}
              ariaLabel={t('adminRegionsSearchPlaceholder')}
              className="sd-admin-dark min-w-[240px] flex-1"
            />

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white focus:border-orange-500 focus:outline-none"
            >
              <option value="">{t('adminRegionsAllBoundaryTypes')}</option>
              {Object.entries(TYPE_META).map(([value]) => (
                <option key={value} value={value}>
                  {t(TYPE_LABEL_KEY[value])}
                </option>
              ))}
            </select>

            {(search || typeFilter) && (
              <button
                onClick={() => {
                  setSearch('');
                  setTypeFilter('');
                }}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-300 transition hover:bg-white/10"
              >
                {t('adminRegionsClearFilters')}
              </button>
            )}
          </div>
        </section>

        {loadError && (
          <div className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-950/40 p-4 text-sm text-red-200">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
            <span>{loadError}</span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center rounded-[28px] border border-white/10 bg-slate-950/70 py-20 text-slate-400">
            <Loader2 size={20} className="mr-2 animate-spin" />
            {t('adminRegionsLoading')}
          </div>
        ) : filteredRegions.length === 0 ? (
          <div className="rounded-[28px] border border-dashed border-white/10 bg-slate-950/60 px-6 py-20 text-center">
            <div className="mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-3xl bg-white/5 text-slate-300">
              <Compass size={22} />
            </div>
            <h2 className="text-xl font-semibold text-white">
              {regions.length === 0 ? t('adminRegionsEmptyTitle') : t('adminRegionsNoMatchTitle')}
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-slate-400">
              {regions.length === 0
                ? t('adminRegionsEmptyDetail')
                : t('adminRegionsNoMatchDetail')}
            </p>
            {regions.length === 0 && (
              <button
                onClick={() => setEditing('new')}
                className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-orange-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-orange-500"
              >
                <Plus size={15} />
                {t('adminRegionsCreateFirst')}
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-5 xl:grid-cols-2">
            {filteredRegions.map((region) => (
              <RegionCard
                key={region.id}
                region={region}
                onEdit={setEditing}
                onDelete={handleDelete}
                deleting={deletingId === region.id}
              />
            ))}
          </div>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-3xl overflow-hidden rounded-[28px] border border-white/10 bg-slate-950 shadow-[0_32px_100px_rgba(0,0,0,0.5)]">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  {editing === 'new' ? t('adminRegionsCreateTitle') : t('adminRegionsEditTitle', { name: editing.name })}
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  {t('adminRegionsModalSubtitle')}
                </p>
              </div>
              <button
                onClick={() => setEditing(null)}
                aria-label={t('common.close')}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </div>
            <div className="max-h-[78vh] overflow-y-auto p-6">
              <RegionForm
                region={editing === 'new' ? null : editing}
                onSaved={handleSaved}
                onCancel={() => setEditing(null)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
