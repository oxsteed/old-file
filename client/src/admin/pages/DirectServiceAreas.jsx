import { useEffect, useState } from 'react';
import { Check, Loader2, MapPinned, Pencil, Plus, RefreshCw, Search, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import adminApi from '../../lib/adminApi';
import { useAbortableFetch } from '../lib/useAbortableFetch';
import AdminErrorState from '../lib/AdminErrorState';

const EMPTY_FORM = {
  label: '',
  anchorZip: '',
  anchorLat: '',
  anchorLng: '',
  radiusMiles: '60',
  active: true,
  notes: '',
};

function formFromArea(area) {
  return {
    label: area.label || '',
    anchorZip: area.anchorZip || '',
    anchorLat: String(area.lat ?? ''),
    anchorLng: String(area.lng ?? ''),
    radiusMiles: String(area.radiusMiles ?? 60),
    active: Boolean(area.active),
    notes: area.notes || '',
  };
}

function Field({ label, children, hint }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</span>
      {children}
      {hint && <span className="text-xs text-gray-500">{hint}</span>}
    </label>
  );
}

function Input({ className = '', ...props }) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white outline-none placeholder:text-gray-500 focus:border-orange-500 focus:ring-1 focus:ring-orange-500 ${className}`}
    />
  );
}

export default function DirectServiceAreas() {
  const { t } = useTranslation();
  const [areas, setAreas] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');

  // Abortable areas load. The previous list stays visible while a refetch is
  // in flight; failures surface as an error state, never an empty list.
  const { data: areasData, error, loading, reload } = useAbortableFetch(async (signal) => {
    const { data } = await adminApi.get('/direct/admin/service-areas', { signal });
    return data.serviceAreas || [];
  }, []);

  useEffect(() => {
    if (areasData) setAreas(areasData);
  }, [areasData]);

  const loadAreas = reload;

  const visibleAreas = areas.filter((area) => {
    const haystack = `${area.label || ''} ${area.anchorZip || ''}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase())
      && (activeFilter === 'all' || (activeFilter === 'active' ? area.active : !area.active));
  });

  const updateForm = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const findZipCoordinates = async () => {
    const zipCode = form.anchorZip.trim();
    if (!/^\d{5}$/.test(zipCode)) {
      toast.error(t('directCatalogAdmin.enterFiveDigitZip', { defaultValue: 'Enter a five-digit ZIP code first.' }));
      return;
    }
    setLocating(true);
    try {
      const { data } = await adminApi.post('/direct/service-availability', { zipCode });
      const location = data.location;
      setForm((current) => ({
        ...current,
        anchorLat: String(location.lat),
        anchorLng: String(location.lng),
        label: current.label || location.label?.replace(/\s+\d{5}$/, '') || '',
      }));
      toast.success(t('directCatalogAdmin.coordinatesFound', { defaultValue: 'Coordinates found for {{label}}.' }).replace('{{label}}', location.label || zipCode));
    } catch (error) {
      toast.error(error.response?.data?.error || t('directCatalogAdmin.couldNotFindZip', { defaultValue: 'Could not find that ZIP code.' }));
    } finally {
      setLocating(false);
    }
  };

  const resetForm = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const saveArea = async (event) => {
    event.preventDefault();
    const payload = {
      label: form.label.trim(),
      anchorZip: form.anchorZip.trim(),
      anchorLat: Number(form.anchorLat),
      anchorLng: Number(form.anchorLng),
      radiusMiles: Number(form.radiusMiles),
      active: form.active,
      notes: form.notes.trim() || null,
    };
    if (!payload.label || !/^\d{5}$/.test(payload.anchorZip) || !Number.isFinite(payload.anchorLat) || !Number.isFinite(payload.anchorLng) || !Number.isFinite(payload.radiusMiles) || payload.radiusMiles <= 0) {
      toast.error(t('directCatalogAdmin.areaValidationError', { defaultValue: 'Add a label, valid ZIP, map coordinates, and a positive radius.' }));
      return;
    }

    setSaving(true);
    try {
      const response = editingId
        ? await adminApi.patch(`/direct/admin/service-areas/${editingId}`, payload)
        : await adminApi.post('/direct/admin/service-areas', payload);
      const saved = response.data.serviceArea;
      setAreas((current) => editingId
        ? current.map((area) => area.id === editingId ? saved : area)
        : [...current, saved]);
      toast.success(editingId ? t('directCatalogAdmin.serviceAreaUpdated', { defaultValue: 'Service area updated.' }) : t('directCatalogAdmin.serviceAreaAdded', { defaultValue: 'Service area added.' }));
      resetForm();
    } catch (error) {
      toast.error(error.response?.data?.error || t('directCatalogAdmin.couldNotSaveServiceArea', { defaultValue: 'Could not save the service area.' }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-orange-500/10 p-2 text-orange-400"><MapPinned size={22} /></div>
          <div>
            <h1 className="text-2xl font-bold text-white">{t('directCatalogAdmin.serviceAreasTitle', { defaultValue: 'Direct service areas' })}</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-400">{t('directCatalogAdmin.serviceAreasSubtitle', { defaultValue: 'Manage the active locations and radius used by the public Direct coverage checker and quote intake.' })}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={loadAreas} disabled={loading} aria-label={t('common.refresh')} className="inline-flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:border-gray-500 hover:text-white disabled:opacity-50">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> {t('directCatalogAdmin.refresh', { defaultValue: 'Refresh' })}
          </button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <form onSubmit={saveArea} className="rounded-xl border border-gray-800 bg-gray-900 p-6">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">{editingId ? t('directCatalogAdmin.editServiceArea', { defaultValue: 'Edit service area' }) : t('directCatalogAdmin.addServiceArea', { defaultValue: 'Add service area' })}</h2>
              <p className="mt-1 text-sm text-gray-500">{t('directCatalogAdmin.zipLookupHint', { defaultValue: 'A ZIP lookup fills the map coordinates for you.' })}</p>
            </div>
            {editingId && <button type="button" onClick={resetForm} className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-white"><X size={15} /> {t('directCatalogAdmin.cancel', { defaultValue: 'Cancel' })}</button>}
          </div>
          <div className="space-y-4">
            <Field label={t('directCatalogAdmin.areaNameLabel', { defaultValue: 'Area name' })} hint={t('directCatalogAdmin.areaNameHint', { defaultValue: 'Example: Dayton, OH' })}>
              <Input value={form.label} onChange={(event) => updateForm('label', event.target.value)} placeholder={t('directCatalogAdmin.areaNamePlaceholder', { defaultValue: 'Dayton, OH' })} required />
            </Field>
            <Field label={t('directCatalogAdmin.anchorZipLabel', { defaultValue: 'Anchor ZIP code' })} hint={t('directCatalogAdmin.anchorZipHint', { defaultValue: 'The center point used for distance checks.' })}>
              <div className="flex gap-2">
                <Input value={form.anchorZip} onChange={(event) => updateForm('anchorZip', event.target.value.replace(/\D/g, '').slice(0, 5))} inputMode="numeric" placeholder={t('directCatalogAdmin.anchorZipPlaceholder', { defaultValue: '45402' })} required />
                <button type="button" onClick={findZipCoordinates} disabled={locating} className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-gray-700 px-3 text-sm font-semibold text-white hover:bg-gray-600 disabled:opacity-50">
                  {locating ? <Loader2 size={15} className="animate-spin" /> : <MapPinned size={15} />} {t('directCatalogAdmin.findZip', { defaultValue: 'Find ZIP' })}
                </button>
              </div>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('directCatalogAdmin.latitudeLabel', { defaultValue: 'Latitude' })}><Input value={form.anchorLat} onChange={(event) => updateForm('anchorLat', event.target.value)} type="number" step="any" placeholder="39.7589" required /></Field>
              <Field label={t('directCatalogAdmin.longitudeLabel', { defaultValue: 'Longitude' })}><Input value={form.anchorLng} onChange={(event) => updateForm('anchorLng', event.target.value)} type="number" step="any" placeholder="-84.1916" required /></Field>
            </div>
            <Field label={t('directCatalogAdmin.radiusMilesLabel', { defaultValue: 'Radius in miles' })} hint={t('directCatalogAdmin.radiusMilesHint', { defaultValue: 'Only locations inside this radius are considered available.' })}>
              <Input value={form.radiusMiles} onChange={(event) => updateForm('radiusMiles', event.target.value)} type="number" min="1" step="0.1" required />
            </Field>
            <Field label={t('directCatalogAdmin.internalNotesLabel', { defaultValue: 'Internal notes' })}><textarea value={form.notes} onChange={(event) => updateForm('notes', event.target.value)} rows={3} className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white outline-none placeholder:text-gray-500 focus:border-orange-500 focus:ring-1 focus:ring-orange-500" placeholder={t('directCatalogAdmin.notesPlaceholder', { defaultValue: 'Dispatch notes or launch context' })} /></Field>
            <label className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-950/50 p-3 text-sm text-gray-300">
              <input type="checkbox" checked={form.active} onChange={(event) => updateForm('active', event.target.checked)} className="h-4 w-4 accent-orange-500" />
              {t('directCatalogAdmin.activeOnPublicChecker', { defaultValue: 'Active on the public coverage checker' })}
            </label>
            <button type="submit" disabled={saving} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 py-3 text-sm font-semibold text-white hover:bg-orange-500 disabled:opacity-50">
              {saving ? <Loader2 size={16} className="animate-spin" /> : editingId ? <Check size={16} /> : <Plus size={16} />}
              {editingId ? t('directCatalogAdmin.saveChanges', { defaultValue: 'Save changes' }) : t('directCatalogAdmin.addServiceArea', { defaultValue: 'Add service area' })}
            </button>
          </div>
        </form>

        <section className="rounded-xl border border-gray-800 bg-gray-900 p-6">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">{t('directCatalogAdmin.configuredCoverage', { defaultValue: 'Configured coverage' })}</h2>
              <p className="mt-1 text-sm text-gray-500">{t('directCatalogAdmin.configuredCoverageSub', { defaultValue: 'Inactive areas stay available for future relaunches but do not affect customers.' })}</p>
            </div>
            <span className="rounded-full border border-gray-700 px-3 py-1 text-xs font-semibold text-gray-300">{t('directCatalogAdmin.activeCount', { defaultValue: '{{count}} active' }).replace('{{count}}', String(areas.filter((area) => area.active).length))}</span>
          </div>
          <div className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <label className="relative block">
              <Search size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('directCatalogAdmin.searchAreaPlaceholder', { defaultValue: 'Search area name or ZIP' })} className="ps-9" aria-label={t('directCatalogAdmin.searchAreasAria', { defaultValue: 'Search configured service areas' })} />
            </label>
            <select value={activeFilter} onChange={(event) => setActiveFilter(event.target.value)} className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-gray-300 outline-none focus:border-orange-500" aria-label={t('directCatalogAdmin.filterAreasAria', { defaultValue: 'Filter service areas' })}>
              <option value="all">{t('directCatalogAdmin.allAreas', { defaultValue: 'All areas' })}</option>
              <option value="active">{t('directCatalogAdmin.activeOnly', { defaultValue: 'Active only' })}</option>
              <option value="inactive">{t('directCatalogAdmin.inactiveOnly', { defaultValue: 'Inactive only' })}</option>
            </select>
          </div>
          {loading && areas.length === 0 ? (
            <div className="flex h-48 items-center justify-center text-orange-400"><Loader2 className="animate-spin" /></div>
          ) : error ? (
            <AdminErrorState onRetry={reload} />
          ) : areas.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-700 p-8 text-center text-sm text-gray-500">{t('directCatalogAdmin.noServiceAreas', { defaultValue: 'No service areas configured.' })}</div>
          ) : visibleAreas.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-700 p-8 text-center text-sm text-gray-500">{t('directCatalogAdmin.noAreasMatchView', { defaultValue: 'No service areas match this view.' })}</div>
          ) : (
            <div className="space-y-3">
              {visibleAreas.map((area) => (
                <article key={area.id} className="rounded-lg border border-gray-800 bg-gray-950/60 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-base font-semibold text-white">
                        <span className={`h-2.5 w-2.5 rounded-full ${area.active ? 'bg-emerald-400' : 'bg-gray-600'}`} />
                        {area.label}
                      </div>
                      <p className="mt-1 text-sm text-gray-400">{t('directCatalogAdmin.areaZipRadius', { defaultValue: 'ZIP {{zip}}, {{radius}} mile radius' }).replace('{{zip}}', area.anchorZip).replace('{{radius}}', String(area.radiusMiles))}</p>
                      <p className="mt-1 text-xs text-gray-600">{t('directCatalogAdmin.centerCoords', { defaultValue: 'Center: {{lat}}, {{lng}}' }).replace('{{lat}}', String(area.lat ?? '')).replace('{{lng}}', String(area.lng ?? ''))}</p>
                    </div>
                    <button type="button" onClick={() => { setEditingId(area.id); setForm(formFromArea(area)); }} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:border-orange-500/50 hover:text-white"><Pencil size={14} /> {t('directCatalogAdmin.editWord', { defaultValue: 'Edit' })}</button>
                  </div>
                  {area.notes && <p className="mt-3 border-t border-gray-800 pt-3 text-sm leading-5 text-gray-500">{area.notes}</p>}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
