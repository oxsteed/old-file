import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  MapPin,
  DollarSign,
  RotateCcw,
  Layers,
  CheckCircle2,
  Truck,
  Wallet,
  Navigation,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ToolDirectoryFilters, ToolCondition, DistanceRadius } from '../../types/toolDirectory';
import {
  TOOL_CATEGORIES,
  TOOL_CONDITIONS,
  TOOL_PRICE_PRESETS,
  DISTANCE_RADIUS_OPTIONS,
  countActiveToolFilters,
} from '../../types/toolDirectory';
import { translateToolDirectoryCategory } from '../../utils/toolRentalsTaxonomy';

interface FilterPanelProps {
  filters: ToolDirectoryFilters;
  onChange: (updated: Partial<ToolDirectoryFilters>) => void;
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
        className="w-full flex items-center justify-between py-3.5 px-1 text-left group"
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

// ── Checkbox row ──────────────────────────────────────────────────────────────
const CheckboxRow: React.FC<{
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}> = ({ label, checked, onChange }) => (
  <label className="flex items-center gap-2.5 cursor-pointer group">
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-brand-500 focus:ring-brand-500 focus:ring-offset-gray-900 cursor-pointer"
      aria-label={label}
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

// ── Main FilterPanel ──────────────────────────────────────────────────────────
const FilterPanel: React.FC<FilterPanelProps> = ({ filters, onChange, onReset }) => {
  const { t } = useTranslation();
  const activeCount = countActiveToolFilters(filters);

  const toggleArrayItem = <T extends string>(
    arr: T[],
    item: T,
    key: keyof ToolDirectoryFilters,
  ) => {
    const next = arr.includes(item) ? arr.filter((v) => v !== item) : [...arr, item];
    onChange({ [key]: next } as Partial<ToolDirectoryFilters>);
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-gray-800">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          {t('toolRentalsDir.filters')}
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
            aria-label={t('toolRentalsDir.resetAll')}
          >
            <RotateCcw className="w-3 h-3" aria-hidden="true" />
            {t('toolRentalsDir.resetAll')}
          </button>
        )}
      </div>

      <div className="px-4 py-2">

        {/* ── Quick toggles ─────────────────────────────────── */}
        <div className="py-3 border-b border-gray-800 space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{t('toolRentalsDir.quickFilters')}</p>
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-sm text-gray-300 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />
              {t('toolRentalsDir.availableNow')}
            </span>
            <button
              role="switch"
              aria-checked={filters.availableNow}
              onClick={() => onChange({ availableNow: !filters.availableNow })}
              className={`relative w-9 h-5 rounded-full transition-colors ${
                filters.availableNow ? 'bg-brand-500' : 'bg-gray-700'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                  filters.availableNow ? 'translate-x-4' : ''
                }`}
              />
            </button>
          </label>
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-sm text-gray-300 flex items-center gap-2">
              <Truck className="w-3.5 h-3.5 text-sky-400" aria-hidden="true" />
              {t('toolRentalsDir.deliveryAvailable')}
            </span>
            <button
              role="switch"
              aria-checked={filters.deliveryAvailable}
              onClick={() => onChange({ deliveryAvailable: !filters.deliveryAvailable })}
              className={`relative w-9 h-5 rounded-full transition-colors ${
                filters.deliveryAvailable ? 'bg-brand-500' : 'bg-gray-700'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                  filters.deliveryAvailable ? 'translate-x-4' : ''
                }`}
              />
            </button>
          </label>
        </div>

        {/* ── Location ──────────────────────────────────────── */}
        <FilterSection title={t('toolRentalsDir.location')} icon={MapPin}>
          <div className="space-y-3">
            <div>
              <label htmlFor="tool-city-filter" className="text-xs text-gray-500 mb-1.5 block">
                {t('toolRentalsDir.city')}
              </label>
              <input
                id="tool-city-filter"
                type="text"
                value={filters.city}
                onChange={(e) => onChange({ city: e.target.value })}
                placeholder={t('toolRentalsDir.cityPlaceholder')}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            {/* Distance radius */}
            <div>
              <label className="text-xs text-gray-500 mb-1.5 flex items-center gap-1">
                <Navigation className="w-3 h-3" aria-hidden="true" />
                {t('toolRentalsDir.radius')}
              </label>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => onChange({ radius: null })}
                  className={`px-2.5 py-1 rounded-xl text-xs font-medium transition-colors ${
                    filters.radius === null
                      ? 'bg-brand-500 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700 border border-gray-700'
                  }`}
                  aria-pressed={filters.radius === null}
                >
                  {t('toolRentalsDir.radiusAny')}
                </button>
                {DISTANCE_RADIUS_OPTIONS.map((r) => (
                  <button
                    key={r}
                    onClick={() => onChange({ radius: r as DistanceRadius })}
                    className={`px-2.5 py-1 rounded-xl text-xs font-medium transition-colors ${
                      filters.radius === r
                        ? 'bg-brand-500 text-white'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700 border border-gray-700'
                    }`}
                    aria-pressed={filters.radius === r}
                  >
                    {t('toolRentalsDir.radiusMi', { miles: r })}
                  </button>
                ))}
              </div>
              {filters.radius !== null && (
                <p className="text-xs text-gray-600 mt-1.5">{t('toolRentalsDir.radiusNote')}</p>
              )}
            </div>
          </div>
        </FilterSection>

        {/* ── Category ──────────────────────────────────────── */}
        <FilterSection
          title={t('toolRentalsDir.category')}
          icon={Layers}
          badge={filters.categories.length}
        >
          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {TOOL_CATEGORIES.map((cat) => (
              <CheckboxRow
                key={cat}
                label={translateToolDirectoryCategory(t, cat)}
                checked={filters.categories.includes(cat)}
                onChange={() => toggleArrayItem(filters.categories, cat, 'categories')}
              />
            ))}
          </div>
        </FilterSection>

        {/* ── Condition ─────────────────────────────────────── */}
        <FilterSection
          title={t('toolRentalsDir.conditionLabel')}
          icon={CheckCircle2}
          defaultOpen={false}
          badge={filters.conditions.length}
        >
          <div className="space-y-1.5">
            {TOOL_CONDITIONS.map((cond) => (
              <CheckboxRow
                key={cond}
                label={t(`toolRentalsDir.condition.${cond}`)}
                checked={filters.conditions.includes(cond as ToolCondition)}
                onChange={() => toggleArrayItem(filters.conditions as ToolCondition[], cond as ToolCondition, 'conditions')}
              />
            ))}
          </div>
        </FilterSection>

        {/* ── Deposit ───────────────────────────────────────── */}
        <FilterSection title={t('toolRentalsDir.depositTitle')} icon={Wallet} defaultOpen={false}>
          <div className="flex flex-wrap gap-2">
            {([
              { value: null, key: 'depositAny' },
              { value: false, key: 'noDeposit' },
              { value: true, key: 'depositRequired' },
            ] as const).map((opt) => (
              <button
                key={String(opt.value)}
                onClick={() => onChange({ requiresDeposit: opt.value })}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${
                  filters.requiresDeposit === opt.value
                    ? 'bg-brand-500 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700 border border-gray-700'
                }`}
                aria-pressed={filters.requiresDeposit === opt.value}
              >
                {t(`toolRentalsDir.${opt.key}`)}
              </button>
            ))}
          </div>
        </FilterSection>

        {/* ── Price range ───────────────────────────────────── */}
        <FilterSection title={t('toolRentalsDir.pricePerDay')} icon={DollarSign}>
          <div className="space-y-3">
            <div className="flex gap-2 items-center">
              <div className="flex-1">
                <label className="text-xs text-gray-500 block mb-1">{t('toolRentalsDir.priceMin')}</label>
                <input
                  type="number"
                  min={0}
                  max={1000}
                  value={filters.priceRange?.[0] ?? ''}
                  onChange={(e) => {
                    const min = Number(e.target.value);
                    const max = filters.priceRange?.[1] ?? 1000;
                    onChange({ priceRange: min > 0 || max < 1000 ? [min, max] : null });
                  }}
                  placeholder="0"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
              <span className="text-gray-600 mt-5">-</span>
              <div className="flex-1">
                <label className="text-xs text-gray-500 block mb-1">{t('toolRentalsDir.priceMax')}</label>
                <input
                  type="number"
                  min={0}
                  max={9999}
                  value={filters.priceRange?.[1] ?? ''}
                  onChange={(e) => {
                    const max = Number(e.target.value);
                    const min = filters.priceRange?.[0] ?? 0;
                    onChange({ priceRange: max > 0 ? [min, max] : null });
                  }}
                  placeholder={t('toolRentalsDir.priceAny')}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
            </div>
            {/* Quick presets */}
            <div className="flex flex-wrap gap-1.5">
              {TOOL_PRICE_PRESETS.map(({ key, range }) => (
                <button
                  key={key}
                  onClick={() => onChange({ priceRange: range })}
                  className="px-2.5 py-1 rounded-lg text-xs bg-gray-800 text-gray-400 hover:bg-gray-700 border border-gray-700 transition-colors"
                >
                  {t(`toolRentalsDir.${key}`)}
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
