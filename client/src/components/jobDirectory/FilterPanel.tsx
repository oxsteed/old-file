import React, { useState, useCallback } from 'react';
import {
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  MapPin,
  DollarSign,
  Calendar,
  RotateCcw,
  Layers,
  Users,
  Navigation,
  Loader2,
  XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { JobFilters, PostedWithin } from '../../types/jobDirectory';
import {
  CATEGORIES,
  POSTED_WITHIN_OPTIONS,
  JOB_BUDGET_PRESETS,
  countActiveJobFilters,
} from '../../types/jobDirectory';
import { translateJobCategory } from '../../utils/jobsTaxonomy';

// ── Radius options (miles) ────────────────────────────────────────────────────
const RADIUS_OPTIONS = [5, 10, 25, 50, 100] as const;

interface FilterPanelProps {
  filters: JobFilters;
  onChange: (updated: Partial<JobFilters>) => void;
  onReset: () => void;
}

// ── Reusable collapsible section ──────────────────────────────────────────────
const FilterSection: React.FC<{
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: number;
}> = ({ title, icon: Icon, children, defaultOpen = true, badge }) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-gray-800 last:border-0">
      <button
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between py-3.5 px-1 text-start group"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-gray-200 group-hover:text-white transition-colors">
          <Icon className="w-4 h-4 text-gray-500" aria-hidden="true" />
          {title}
          {badge && badge > 0 ? (
            <span className="w-4 h-4 rounded-full bg-brand-500 text-white text-xs flex items-center justify-center font-bold">
              {badge}
            </span>
          ) : null}
        </span>
        {open ? (
          <ChevronUp className="w-4 h-4 text-gray-500" aria-hidden="true" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-500" aria-hidden="true" />
        )}
      </button>
      {open && <div className="pb-4 space-y-1.5">{children}</div>}
    </div>
  );
};

// ── Radio row ─────────────────────────────────────────────────────────────────
const RadioRow: React.FC<{
  label: string;
  checked: boolean;
  onChange: () => void;
  name: string;
}> = ({ label, checked, onChange, name }) => (
  <label className="flex items-center gap-2.5 cursor-pointer group">
    <input
      type="radio"
      name={name}
      checked={checked}
      onChange={onChange}
      className="w-4 h-4 border-gray-600 bg-gray-800 text-brand-500 focus:ring-brand-500 focus:ring-offset-gray-900 cursor-pointer"
    />
    <span
      className={`text-sm flex-1 leading-snug group-hover:text-white transition-colors ${
        checked ? 'text-white' : 'text-gray-400'
      }`}
    >
      {label}
    </span>
  </label>
);

// ── Location section (with geolocation "Use my location" button) ─────────────
type GeoStatus = 'idle' | 'locating' | 'granted' | 'denied';

const LocationSection: React.FC<{
  filters: JobFilters;
  onChange: (updated: Partial<JobFilters>) => void;
}> = ({ filters, onChange }) => {
  const { t } = useTranslation();
  const [geoStatus, setGeoStatus] = useState<GeoStatus>(
    filters.userLat !== null ? 'granted' : 'idle',
  );

  const handleUseMyLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setGeoStatus('denied');
      return;
    }
    setGeoStatus('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoStatus('granted');
        onChange({
          userLat: pos.coords.latitude,
          userLng: pos.coords.longitude,
          // Clear text-based fields so we don't double-filter
          city: '',
          state: '',
        });
      },
      () => {
        setGeoStatus('denied');
      },
      { timeout: 10000 },
    );
  }, [onChange]);

  const handleClearLocation = useCallback(() => {
    setGeoStatus('idle');
    onChange({ userLat: null, userLng: null });
  }, [onChange]);

  const locationActive = geoStatus === 'granted' && filters.userLat !== null;

  return (
    <FilterSection
      title={t('jobsDir.location')}
      icon={MapPin}
      badge={locationActive ? 1 : (filters.city || filters.state || filters.country ? 1 : 0)}
    >
      <div className="space-y-3">

        {/* ── Use my location button / status ── */}
        {!locationActive ? (
          <button
            type="button"
            onClick={handleUseMyLocation}
            disabled={geoStatus === 'locating'}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-brand-600 bg-brand-500/10 text-brand-400 hover:bg-brand-500/20 transition-colors text-sm font-medium disabled:opacity-60 disabled:cursor-wait"
          >
            {geoStatus === 'locating' ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                {t('jobsDir.nearMeLocating')}
              </>
            ) : (
              <>
                <Navigation className="w-4 h-4" aria-hidden="true" />
                {t('jobsDir.nearMeBtn')}
              </>
            )}
          </button>
        ) : (
          /* Active geolocation indicator + clear button */
          <div className="flex items-center justify-between bg-brand-500/10 border border-brand-700/60 rounded-xl px-3 py-2">
            <span className="text-xs text-brand-300 flex items-center gap-1.5">
              <Navigation className="w-3.5 h-3.5" aria-hidden="true" />
              {t('jobsDir.nearMeGranted', { miles: filters.radiusMiles })}
            </span>
            <button
              type="button"
              onClick={handleClearLocation}
              className="text-gray-500 hover:text-gray-300 transition-colors"
              aria-label={t('jobsDir.clearLocation')}
            >
              <XCircle className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* ── Radius pills — only shown when location is active ── */}
        {locationActive && (
          <div>
            <p className="text-xs text-gray-500 mb-2">{t('jobsDir.radiusLabel')}</p>
            <div className="flex flex-wrap gap-1.5">
              {RADIUS_OPTIONS.map((mi) => (
                <button
                  key={mi}
                  type="button"
                  onClick={() => onChange({ radiusMiles: mi })}
                  aria-pressed={filters.radiusMiles === mi}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${
                    filters.radiusMiles === mi
                      ? 'bg-brand-500 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700 border border-gray-700'
                  }`}
                >
                  {t(`jobsDir.radius.${mi}`)}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Denied message ── */}
        {geoStatus === 'denied' && (
          <p className="text-xs text-amber-400 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
            {t('jobsDir.locationDenied')}
          </p>
        )}

        {/* ── Fallback city / state / country text inputs ── */}
        {!locationActive && (
          <>
            <div>
              <label htmlFor="city-filter" className="text-xs text-gray-500 mb-1.5 block">
                {t('jobsDir.cityLabel')}
              </label>
              <input
                id="city-filter"
                type="text"
                value={filters.city}
                onChange={(e) => onChange({ city: e.target.value })}
                placeholder={t('jobsDir.cityPlaceholder')}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div>
              <label htmlFor="state-filter" className="text-xs text-gray-500 mb-1.5 block">
                {t('jobsDir.stateLabel')}
              </label>
              <input
                id="state-filter"
                type="text"
                value={filters.state}
                onChange={(e) => onChange({ state: e.target.value })}
                placeholder={t('jobsDir.statePlaceholder')}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div>
              <label htmlFor="country-filter" className="text-xs text-gray-500 mb-1.5 block">
                {t('jobsDir.countryLabel')}
              </label>
              <input
                id="country-filter"
                type="text"
                value={filters.country ?? ''}
                onChange={(e) => onChange({ country: e.target.value })}
                placeholder={t('jobsDir.countryPlaceholder')}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          </>
        )}
      </div>
    </FilterSection>
  );
};

// ── Main FilterPanel ──────────────────────────────────────────────────────────
const FilterPanel: React.FC<FilterPanelProps> = ({ filters, onChange, onReset }) => {
  const { t } = useTranslation();
  const activeCount = countActiveJobFilters(filters);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-gray-800">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          {t('jobsDir.filters')}
          {activeCount > 0 && (
            <span className="px-1.5 py-0.5 bg-brand-500 text-white text-xs rounded-full font-bold">
              {activeCount}
            </span>
          )}
        </h2>
        {activeCount > 0 && (
          <button
            onClick={onReset}
            className="flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 transition-colors"
            aria-label={t('jobsDir.resetAll')}
          >
            <RotateCcw className="w-3 h-3" aria-hidden="true" />
            {t('jobsDir.resetAll')}
          </button>
        )}
      </div>

      <div className="px-4 py-2">

        {/* ── Quick toggles ─────────────────────────────────── */}
        <div className="py-3 border-b border-gray-800 space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            {t('jobsDir.quickFilters')}
          </p>

          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-sm text-gray-300 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
              {t('jobsDir.urgentOnly')}
            </span>
            <button
              role="switch"
              aria-checked={filters.urgentOnly}
              onClick={() => onChange({ urgentOnly: !filters.urgentOnly })}
              className={`relative w-9 h-5 rounded-full transition-colors ${
                filters.urgentOnly ? 'bg-brand-500' : 'bg-gray-700'
              }`}
            >
              <span
                className={`absolute top-0.5 start-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                  filters.urgentOnly ? 'translate-x-4 rtl:-translate-x-4' : ''
                }`}
              />
            </button>
          </label>

          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-sm text-gray-300 flex items-center gap-2">
              <Users className="w-3.5 h-3.5 text-violet-400" aria-hidden="true" />
              {t('jobsDir.noBidsYet')}
            </span>
            <button
              role="switch"
              aria-checked={filters.noBidsYet}
              onClick={() => onChange({
                noBidsYet: !filters.noBidsYet,
                hasBids: !filters.noBidsYet ? false : filters.hasBids,
              })}
              className={`relative w-9 h-5 rounded-full transition-colors ${
                filters.noBidsYet ? 'bg-brand-500' : 'bg-gray-700'
              }`}
            >
              <span
                className={`absolute top-0.5 start-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                  filters.noBidsYet ? 'translate-x-4 rtl:-translate-x-4' : ''
                }`}
              />
            </button>
          </label>

          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-sm text-gray-300 flex items-center gap-2">
              <Users className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
              {t('jobsDir.hasBids')}
            </span>
            <button
              role="switch"
              aria-checked={filters.hasBids}
              onClick={() => onChange({
                hasBids: !filters.hasBids,
                noBidsYet: !filters.hasBids ? false : filters.noBidsYet,
              })}
              className={`relative w-9 h-5 rounded-full transition-colors ${
                filters.hasBids ? 'bg-brand-500' : 'bg-gray-700'
              }`}
            >
              <span
                className={`absolute top-0.5 start-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                  filters.hasBids ? 'translate-x-4 rtl:-translate-x-4' : ''
                }`}
              />
            </button>
          </label>
        </div>

        {/* ── Location ──────────────────────────────────────── */}
        <LocationSection filters={filters} onChange={onChange} />

        {/* ── Category ──────────────────────────────────────── */}
        <FilterSection
          title={t('jobsDir.category')}
          icon={Layers}
          badge={filters.category ? 1 : 0}
        >
          <div className="space-y-1.5">
            <RadioRow
              name="job-cat"
              label={t('jobsDir.allCategories')}
              checked={!filters.category}
              onChange={() => onChange({ category: '' })}
            />
            {CATEGORIES.map((cat) => (
              <RadioRow
                key={cat}
                name="job-cat"
                label={translateJobCategory(t, cat)}
                checked={filters.category === cat}
                onChange={() => onChange({ category: cat })}
              />
            ))}
          </div>
        </FilterSection>

        {/* ── Posted within ─────────────────────────────────── */}
        <FilterSection
          title={t('jobsDir.postedWithin')}
          icon={Calendar}
          defaultOpen={false}
          badge={filters.postedWithin && filters.postedWithin !== 'any' ? 1 : 0}
        >
          <div className="flex flex-wrap gap-2">
            {POSTED_WITHIN_OPTIONS.map((opt) => (
              <button
                key={opt}
                onClick={() => onChange({ postedWithin: opt as PostedWithin })}
                aria-pressed={filters.postedWithin === opt}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${
                  filters.postedWithin === opt
                    ? 'bg-brand-500 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700 border border-gray-700'
                }`}
              >
                {t(`jobsDir.posted.${opt}`)}
              </button>
            ))}
          </div>
        </FilterSection>

        {/* ── Budget range ──────────────────────────────────── */}
        <FilterSection title={t('jobsDir.budgetRange')} icon={DollarSign}>
          <div className="space-y-3">
            <div className="flex gap-2 items-center">
              <div className="flex-1">
                <label className="text-xs text-gray-500 block mb-1">
                  {t('jobsDir.budgetMin')}
                </label>
                <input
                  type="number"
                  min={0}
                  value={filters.budgetRange?.[0] ?? ''}
                  onChange={(e) => {
                    const min = Number(e.target.value);
                    const max = filters.budgetRange?.[1] ?? 999999;
                    onChange({ budgetRange: min > 0 || max < 999999 ? [min, max] : null });
                  }}
                  placeholder="0"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
              <span className="text-gray-600 mt-5">–</span>
              <div className="flex-1">
                <label className="text-xs text-gray-500 block mb-1">
                  {t('jobsDir.budgetMax')}
                </label>
                <input
                  type="number"
                  min={0}
                  value={filters.budgetRange?.[1] ?? ''}
                  onChange={(e) => {
                    const max = Number(e.target.value);
                    const min = filters.budgetRange?.[0] ?? 0;
                    onChange({ budgetRange: max > 0 ? [min, max] : null });
                  }}
                  placeholder={t('jobsDir.budgetAny')}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
            </div>
            {/* Presets */}
            <div className="flex flex-wrap gap-1.5">
              {JOB_BUDGET_PRESETS.map(({ key, range }) => (
                <button
                  key={key}
                  onClick={() => onChange({ budgetRange: range })}
                  className="px-2.5 py-1 rounded-lg text-xs bg-gray-800 text-gray-400 hover:bg-gray-700 border border-gray-700 transition-colors"
                >
                  {t(`jobsDir.${key}`)}
                </button>
              ))}
            </div>
          </div>
        </FilterSection>

      </div>
    </div>
  );
};

export default FilterPanel;
