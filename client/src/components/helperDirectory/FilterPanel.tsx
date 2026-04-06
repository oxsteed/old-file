import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  Award,
  MapPin,
  Star,
  DollarSign,
  RotateCcw,
  BadgeCheck,
  Layers,
} from 'lucide-react';
import type { DirectoryFilters } from '../../types/helperDirectory';
import {
  CATEGORIES,
  SKILLS_BY_CATEGORY,
  LICENSES,
  INSURANCE_TYPES,
  RATING_OPTIONS,
  DISTANCE_OPTIONS,
  countActiveFilters,
} from '../../types/helperDirectory';

interface FilterPanelProps {
  filters: DirectoryFilters;
  onChange: (updated: Partial<DirectoryFilters>) => void;
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
  accent?: string;
}> = ({ label, checked, onChange, accent }) => (
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
    {accent && <span className={`text-xs ${accent}`}>•</span>}
  </label>
);

// ── Skill sub-category collapsible ────────────────────────────────────────────
const SkillGroup: React.FC<{
  category: string;
  skills: string[];
  selected: string[];
  onToggle: (skill: string) => void;
}> = ({ category, skills, selected, onToggle }) => {
  const [open, setOpen] = useState(false);
  const activeCount = skills.filter((s) => selected.includes(s)).length;

  return (
    <div>
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex items-center justify-between w-full py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
        aria-expanded={open}
      >
        <span className="flex items-center gap-1.5">
          {category}
          {activeCount > 0 && (
            <span className="w-4 h-4 rounded-full bg-brand-500/80 text-white text-xs flex items-center justify-center">
              {activeCount}
            </span>
          )}
        </span>
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {open && (
        <div className="pl-3 mt-1 space-y-1.5 border-l border-gray-800">
          {skills.map((sk) => (
            <CheckboxRow
              key={sk}
              label={sk}
              checked={selected.includes(sk)}
              onChange={() => onToggle(sk)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ── Main FilterPanel ──────────────────────────────────────────────────────────
const FilterPanel: React.FC<FilterPanelProps> = ({ filters, onChange, onReset }) => {
  const activeCount = countActiveFilters(filters);

  const toggleArrayItem = <T extends string>(
    arr: T[],
    item: T,
    key: keyof DirectoryFilters,
  ) => {
    const next = arr.includes(item) ? arr.filter((v) => v !== item) : [...arr, item];
    onChange({ [key]: next } as Partial<DirectoryFilters>);
  };

  const toggleSkill = (skill: string) => {
    const next = filters.skills.includes(skill)
      ? filters.skills.filter((s) => s !== skill)
      : [...filters.skills, skill];
    onChange({ skills: next });
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-gray-800">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          Filters
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
            aria-label="Reset all filters"
          >
            <RotateCcw className="w-3 h-3" aria-hidden="true" />
            Reset all
          </button>
        )}
      </div>

      <div className="px-4 py-2">

        {/* ── Quick toggles ─────────────────────────────────── */}
        <div className="py-3 border-b border-gray-800 space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Quick filters</p>
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-sm text-gray-300 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />
              Available today
            </span>
            <button
              role="switch"
              aria-checked={filters.availableToday}
              onClick={() => onChange({ availableToday: !filters.availableToday })}
              className={`relative w-9 h-5 rounded-full transition-colors ${
                filters.availableToday ? 'bg-brand-500' : 'bg-gray-700'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                  filters.availableToday ? 'translate-x-4' : ''
                }`}
              />
            </button>
          </label>
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-sm text-gray-300 flex items-center gap-2">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
              Background checked
            </span>
            <button
              role="switch"
              aria-checked={filters.backgroundChecked}
              onClick={() => onChange({ backgroundChecked: !filters.backgroundChecked })}
              className={`relative w-9 h-5 rounded-full transition-colors ${
                filters.backgroundChecked ? 'bg-brand-500' : 'bg-gray-700'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                  filters.backgroundChecked ? 'translate-x-4' : ''
                }`}
              />
            </button>
          </label>
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-sm text-gray-300 flex items-center gap-2">
              <BadgeCheck className="w-3.5 h-3.5 text-sky-400" aria-hidden="true" />
              OxSteed verified
            </span>
            <button
              role="switch"
              aria-checked={filters.verified}
              onClick={() => onChange({ verified: !filters.verified })}
              className={`relative w-9 h-5 rounded-full transition-colors ${
                filters.verified ? 'bg-brand-500' : 'bg-gray-700'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                  filters.verified ? 'translate-x-4' : ''
                }`}
              />
            </button>
          </label>
        </div>

        {/* ── Location & distance ───────────────────────────── */}
        <FilterSection title="Location & Distance" icon={MapPin}>
          <div className="space-y-3">
            <div>
              <label htmlFor="zip-filter" className="text-xs text-gray-500 mb-1.5 block">
                Your zip code
              </label>
              <input
                id="zip-filter"
                type="text"
                inputMode="numeric"
                maxLength={5}
                value={filters.zipCode}
                onChange={(e) => onChange({ zipCode: e.target.value.replace(/\D/g, '') })}
                placeholder="e.g. 78701"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-2">Max distance</p>
              <div className="flex flex-wrap gap-2">
                {DISTANCE_OPTIONS.map((d) => (
                  <button
                    key={d}
                    onClick={() =>
                      onChange({ maxDistance: filters.maxDistance === d ? 0 : d })
                    }
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                      filters.maxDistance === d
                        ? 'bg-brand-500 text-white'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700 border border-gray-700'
                    }`}
                  >
                    {d} mi
                  </button>
                ))}
              </div>
            </div>
          </div>
        </FilterSection>

        {/* ── Category ──────────────────────────────────────── */}
        <FilterSection
          title="Category"
          icon={Layers}
          badge={filters.categories.length}
        >
          <div className="space-y-1.5">
            {CATEGORIES.map((cat) => (
              <CheckboxRow
                key={cat}
                label={cat}
                checked={filters.categories.includes(cat)}
                onChange={() => toggleArrayItem(filters.categories, cat, 'categories')}
              />
            ))}
          </div>
        </FilterSection>

        {/* ── Skills ────────────────────────────────────────── */}
        <FilterSection
          title="Skills"
          icon={Award}
          defaultOpen={false}
          badge={filters.skills.length}
        >
          <div className="space-y-0.5">
            {Object.entries(SKILLS_BY_CATEGORY).map(([cat, skills]) => (
              <SkillGroup
                key={cat}
                category={cat}
                skills={skills}
                selected={filters.skills}
                onToggle={toggleSkill}
              />
            ))}
          </div>
        </FilterSection>

        {/* ── Licenses ──────────────────────────────────────── */}
        <FilterSection
          title="Licenses & Certifications"
          icon={Award}
          defaultOpen={false}
          badge={filters.licenses.length}
        >
          <div className="space-y-1.5">
            {LICENSES.map((lic) => (
              <CheckboxRow
                key={lic}
                label={lic}
                checked={filters.licenses.includes(lic)}
                onChange={() => toggleArrayItem(filters.licenses as string[], lic, 'licenses')}
              />
            ))}
          </div>
        </FilterSection>

        {/* ── Insurance ─────────────────────────────────────── */}
        <FilterSection
          title="Insurance & Bonding"
          icon={ShieldCheck}
          defaultOpen={false}
          badge={filters.insurance.length}
        >
          <div className="space-y-1.5">
            {INSURANCE_TYPES.map((ins) => (
              <CheckboxRow
                key={ins}
                label={ins}
                checked={filters.insurance.includes(ins)}
                onChange={() => toggleArrayItem(filters.insurance as string[], ins, 'insurance')}
              />
            ))}
          </div>
        </FilterSection>

        {/* ── Rating ────────────────────────────────────────── */}
        <FilterSection title="Minimum Rating" icon={Star}>
          <div className="flex flex-wrap gap-2">
            {RATING_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => onChange({ minRating: opt.value })}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${
                  filters.minRating === opt.value
                    ? 'bg-brand-500 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700 border border-gray-700'
                }`}
                aria-pressed={filters.minRating === opt.value}
              >
                {opt.value > 0 && (
                  <Star className="w-3 h-3 fill-current" aria-hidden="true" />
                )}
                {opt.label}
              </button>
            ))}
          </div>
        </FilterSection>

        {/* ── Price range ───────────────────────────────────── */}
        <FilterSection title="Price Range (per hour)" icon={DollarSign}>
          <div className="space-y-3">
            <div className="flex gap-2 items-center">
              <div className="flex-1">
                <label className="text-xs text-gray-500 block mb-1">Min ($)</label>
                <input
                  type="number"
                  min={0}
                  max={500}
                  value={filters.priceRange?.[0] ?? ''}
                  onChange={(e) => {
                    const min = Number(e.target.value);
                    const max = filters.priceRange?.[1] ?? 500;
                    onChange({ priceRange: min > 0 || max < 500 ? [min, max] : null });
                  }}
                  placeholder="0"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
              <span className="text-gray-600 mt-5">–</span>
              <div className="flex-1">
                <label className="text-xs text-gray-500 block mb-1">Max ($)</label>
                <input
                  type="number"
                  min={0}
                  max={1000}
                  value={filters.priceRange?.[1] ?? ''}
                  onChange={(e) => {
                    const max = Number(e.target.value);
                    const min = filters.priceRange?.[0] ?? 0;
                    onChange({ priceRange: max > 0 ? [min, max] : null });
                  }}
                  placeholder="Any"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
            </div>
            {/* Quick presets */}
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: 'Under $50', range: [0, 50] as [number, number] },
                { label: '$50–$100', range: [50, 100] as [number, number] },
                { label: '$100–$200', range: [100, 200] as [number, number] },
                { label: '$200+', range: [200, 9999] as [number, number] },
              ].map(({ label, range }) => (
                <button
                  key={label}
                  onClick={() => onChange({ priceRange: range })}
                  className="px-2.5 py-1 rounded-lg text-xs bg-gray-800 text-gray-400 hover:bg-gray-700 border border-gray-700 transition-colors"
                >
                  {label}
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
