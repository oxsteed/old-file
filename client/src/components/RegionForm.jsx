import { useState, useEffect } from 'react';
import { Loader2, AlertCircle, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import adminApi from '../lib/adminApi';
import CountrySelect from './CountrySelect';
import RegionInput from './RegionInput';

/**
 * Create or edit an admin region.
 *
 * Props:
 *   region    – existing region for edit mode (optional)
 *   onSaved   – callback(region) on success
 *   onCancel  – callback when user cancels
 */
const BOUNDARY_TYPES = [
  { value: 'zip_range',       labelKey: 'zipRanges' },
  { value: 'city_state',      labelKey: 'cityState' },
  { value: 'geo_radius',      labelKey: 'geoRadius' },
  { value: 'country_region',  labelKey: 'countryRegion' },
  { value: 'country_only',    labelKey: 'countryOnly' },
];

function defaultBoundary(type) {
  switch (type) {
    case 'zip_range':      return { type, ranges: [{ start: 90000, end: 90999 }] };
    case 'city_state':     return { type, entries: [{ city: '', state: '' }] };
    case 'geo_radius':     return { type, center: { lat: 0, lng: 0 }, radius_miles: 25 };
    case 'country_region': return { type, entries: [{ country: 'US', region: '' }] };
    case 'country_only':   return { type, countries: ['US'] };
    default:               return { type };
  }
}

export default function RegionForm({ region, onSaved, onCancel }) {
  const { t } = useTranslation();
  const editing = !!region?.id;

  const [name,        setName]        = useState(region?.name || '');
  const [description, setDescription] = useState(region?.description || '');
  const [boundary,    setBoundary]    = useState(
    region?.boundary_definition || defaultBoundary('zip_range')
  );
  const [submitting,  setSubmitting]  = useState(false);
  const [serverError, setServerError] = useState(null);

  useEffect(() => {
    if (region) {
      setName(region.name || '');
      setDescription(region.description || '');
      setBoundary(region.boundary_definition || defaultBoundary('zip_range'));
    }
  }, [region?.id]); // eslint-disable-line

  const setType = (type) => setBoundary(defaultBoundary(type));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setServerError(null);

    if (!name.trim()) {
      setServerError(t('regionForm.nameRequired'));
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        boundary_definition: boundary,
      };

      const { data } = editing
        ? await adminApi.put(`/admin/super/regions/${region.id}`, payload)
        : await adminApi.post('/admin/super/regions', payload);

      if (onSaved) onSaved(data.region);
    } catch (err) {
      setServerError(err.response?.data?.error || t('regionForm.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    'w-full px-3 py-2 rounded-md bg-gray-900 border border-gray-700 ' +
    'text-gray-100 placeholder-gray-500 focus:outline-none ' +
    'focus:border-orange-500 focus:ring-1 focus:ring-orange-500';
  const labelCls = 'block text-xs font-medium text-gray-400 mb-1';

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {serverError && (
        <div className="flex items-start gap-2 p-3 rounded-md bg-red-950 border border-red-800 text-red-300 text-sm">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
          <span>{serverError}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>{t('regionForm.name')}</label>
          <input
            type="text"
            className={inputCls}
            value={name}
            onChange={e => setName(e.target.value)}
            required
            placeholder={t('regionForm.namePlaceholder')}
          />
        </div>
        <div>
          <label className={labelCls}>{t('regionForm.boundaryType')}</label>
          <select
            className={inputCls}
            value={boundary.type}
            onChange={e => setType(e.target.value)}
          >
            {BOUNDARY_TYPES.map(type => (
              <option key={type.value} value={type.value}>{t(`regionForm.boundaryTypes.${type.labelKey}`)}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className={labelCls}>{t('regionForm.description')}</label>
        <textarea
          className={inputCls + ' min-h-[60px]'}
          value={description}
          onChange={e => setDescription(e.target.value)}
        />
      </div>

      {boundary.type === 'zip_range' && (
        <ZipRangeEditor boundary={boundary} setBoundary={setBoundary} t={t} />
      )}
      {boundary.type === 'city_state' && (
        <CityStateEditor boundary={boundary} setBoundary={setBoundary} t={t} />
      )}
      {boundary.type === 'geo_radius' && (
        <GeoRadiusEditor boundary={boundary} setBoundary={setBoundary} t={t} />
      )}
      {boundary.type === 'country_region' && (
        <CountryRegionEditor boundary={boundary} setBoundary={setBoundary} t={t} />
      )}
      {boundary.type === 'country_only' && (
        <CountryOnlyEditor boundary={boundary} setBoundary={setBoundary} t={t} />
      )}

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-800">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="px-4 py-2 rounded-md text-sm text-gray-300 hover:text-white"
          >
            {t('regionForm.cancel')}
          </button>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-50"
        >
          {submitting && <Loader2 size={16} className="animate-spin" />}
          {submitting ? t('regionForm.saving') : (editing ? t('regionForm.updateRegion') : t('regionForm.createRegion'))}
        </button>
      </div>
    </form>
  );
}

// ── Sub-editors ──────────────────────────────────────────────────────────────

function ZipRangeEditor({ boundary, setBoundary, t }) {
  const update = (idx, field, value) => {
    const ranges = [...boundary.ranges];
    ranges[idx] = { ...ranges[idx], [field]: value === '' ? '' : Number(value) };
    setBoundary({ ...boundary, ranges });
  };
  const add = () => setBoundary({
    ...boundary,
    ranges: [...boundary.ranges, { start: 0, end: 0 }],
  });
  const remove = (idx) => setBoundary({
    ...boundary,
    ranges: boundary.ranges.filter((_, i) => i !== idx),
  });

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium text-gray-300">{t('regionForm.zipRanges')}</h4>
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300"
        >
          <Plus size={12} /> {t('regionForm.addRange')}
        </button>
      </div>
      <div className="space-y-2">
        {boundary.ranges.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="number"
              className="flex-1 px-2 py-1.5 rounded bg-gray-900 border border-gray-700 text-gray-100 text-sm"
              value={r.start}
              onChange={e => update(i, 'start', e.target.value)}
              placeholder={t('regionForm.start')}
            />
            <span className="text-gray-500">–</span>
            <input
              type="number"
              className="flex-1 px-2 py-1.5 rounded bg-gray-900 border border-gray-700 text-gray-100 text-sm"
              value={r.end}
              onChange={e => update(i, 'end', e.target.value)}
              placeholder={t('regionForm.end')}
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className="p-1.5 rounded text-gray-500 hover:text-red-400 hover:bg-red-950"
              disabled={boundary.ranges.length === 1}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function CityStateEditor({ boundary, setBoundary, t }) {
  const update = (idx, field, value) => {
    const entries = [...boundary.entries];
    entries[idx] = {
      ...entries[idx],
      [field]: field === 'state' ? value.toUpperCase() : value,
    };
    setBoundary({ ...boundary, entries });
  };
  const add = () => setBoundary({
    ...boundary,
    entries: [...boundary.entries, { city: '', state: '' }],
  });
  const remove = (idx) => setBoundary({
    ...boundary,
    entries: boundary.entries.filter((_, i) => i !== idx),
  });

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium text-gray-300">{t('regionForm.cities')}</h4>
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300"
        >
          <Plus size={12} /> {t('regionForm.addCity')}
        </button>
      </div>
      <div className="space-y-2">
        {boundary.entries.map((e, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="text"
              className="flex-1 px-2 py-1.5 rounded bg-gray-900 border border-gray-700 text-gray-100 text-sm"
              value={e.city}
              onChange={ev => update(i, 'city', ev.target.value)}
              placeholder={t('regionForm.city')}
            />
            <input
              type="text"
              className="w-20 px-2 py-1.5 rounded bg-gray-900 border border-gray-700 text-gray-100 text-sm"
              value={e.state}
              onChange={ev => update(i, 'state', ev.target.value)}
              maxLength={2}
              placeholder={t('regionForm.stateCode')}
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className="p-1.5 rounded text-gray-500 hover:text-red-400 hover:bg-red-950"
              disabled={boundary.entries.length === 1}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function CountryRegionEditor({ boundary, setBoundary, t }) {
  const update = (idx, field, value) => {
    const entries = [...boundary.entries];
    if (field === 'country') {
      entries[idx] = { country: value, region: '' };
    } else {
      entries[idx] = { ...entries[idx], region: value };
    }
    setBoundary({ ...boundary, entries });
  };
  const add = () => setBoundary({
    ...boundary,
    entries: [...boundary.entries, { country: 'US', region: '' }],
  });
  const remove = (idx) => setBoundary({
    ...boundary,
    entries: boundary.entries.filter((_, i) => i !== idx),
  });

  const cellCls =
    'w-full px-2 py-1.5 rounded bg-gray-900 border border-gray-700 ' +
    'text-gray-100 text-sm focus:outline-none focus:border-orange-500';

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium text-gray-300">{t('regionForm.countryRegionPairs')}</h4>
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300"
        >
          <Plus size={12} /> {t('regionForm.addPair')}
        </button>
      </div>
      <div className="space-y-2">
        {boundary.entries.map((e, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-44">
              <CountrySelect
                value={e.country}
                onChange={v => update(i, 'country', v)}
                includeBlank={false}
                className={cellCls}
              />
            </div>
            <div className="flex-1">
              <RegionInput
                country={e.country}
                value={e.region}
                onChange={v => update(i, 'region', v)}
                className={cellCls}
                placeholder={t('regionForm.stateProvinceRegion')}
              />
            </div>
            <button
              type="button"
              onClick={() => remove(i)}
              className="p-1.5 rounded text-gray-500 hover:text-red-400 hover:bg-red-950"
              disabled={boundary.entries.length === 1}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function CountryOnlyEditor({ boundary, setBoundary, t }) {
  const update = (idx, value) => {
    const countries = [...boundary.countries];
    countries[idx] = (value || '').toUpperCase();
    setBoundary({ ...boundary, countries });
  };
  const add = () => setBoundary({
    ...boundary,
    countries: [...boundary.countries, 'US'],
  });
  const remove = (idx) => setBoundary({
    ...boundary,
    countries: boundary.countries.filter((_, i) => i !== idx),
  });

  const cellCls =
    'w-full px-2 py-1.5 rounded bg-gray-900 border border-gray-700 ' +
    'text-gray-100 text-sm focus:outline-none focus:border-orange-500';

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium text-gray-300">{t('regionForm.countries')}</h4>
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300"
        >
          <Plus size={12} /> {t('regionForm.addCountry')}
        </button>
      </div>
      <div className="space-y-2">
        {boundary.countries.map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="flex-1">
              <CountrySelect
                value={c}
                onChange={v => update(i, v)}
                includeBlank={false}
                className={cellCls}
              />
            </div>
            <button
              type="button"
              onClick={() => remove(i)}
              className="p-1.5 rounded text-gray-500 hover:text-red-400 hover:bg-red-950"
              disabled={boundary.countries.length === 1}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function GeoRadiusEditor({ boundary, setBoundary, t }) {
  const labelCls = 'block text-xs font-medium text-gray-400 mb-1';
  const inputCls =
    'w-full px-3 py-2 rounded-md bg-gray-900 border border-gray-700 ' +
    'text-gray-100 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500';

  return (
    <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div>
        <label className={labelCls}>{t('regionForm.centerLatitude')}</label>
        <input
          type="number"
          step="0.000001"
          className={inputCls}
          value={boundary.center.lat}
          onChange={e => setBoundary({
            ...boundary,
            center: { ...boundary.center, lat: Number(e.target.value) },
          })}
        />
      </div>
      <div>
        <label className={labelCls}>{t('regionForm.centerLongitude')}</label>
        <input
          type="number"
          step="0.000001"
          className={inputCls}
          value={boundary.center.lng}
          onChange={e => setBoundary({
            ...boundary,
            center: { ...boundary.center, lng: Number(e.target.value) },
          })}
        />
      </div>
      <div>
        <label className={labelCls}>{t('regionForm.radiusMiles')}</label>
        <input
          type="number"
          step="0.1"
          min="0"
          className={inputCls}
          value={boundary.radius_miles}
          onChange={e => setBoundary({
            ...boundary,
            radius_miles: Number(e.target.value),
          })}
        />
      </div>
    </section>
  );
}
