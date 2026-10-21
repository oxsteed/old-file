// Multi-location management panel for merchant settings (D1, F-29).
import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { createFoodLocation, listFoodLocations, updateFoodLocation } from '../../api/food';
import { suggestLocation } from '../../api/geo';
import { apiErrorMessage } from './foodShared';
import AddressAutocomplete from '../../components/AddressAutocomplete';
import TimezoneSelect, { DETECTED_TIMEZONE } from './TimezoneSelect.jsx';
import StoreMenuPanel from './StoreMenuPanel.jsx';
import RestaurantLocationAccessPanel from './RestaurantLocationAccessPanel.jsx';

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DEFAULT_OPEN_TIME = '11:00';
const DEFAULT_CLOSE_TIME = '22:00';
const LOCATION_STATUSES = ['active', 'paused', 'closed'];

const blankRange = (open = DEFAULT_OPEN_TIME, close = DEFAULT_CLOSE_TIME) => ({ open, close });
const blankDayHours = (open = DEFAULT_OPEN_TIME, close = DEFAULT_CLOSE_TIME, closed = false) => ({
  ranges: [blankRange(open, close)],
  closed,
});

function rangesFromEntry(entry) {
  if (Array.isArray(entry)) {
    const ranges = entry
      .filter((range) => range && typeof range === 'object')
      .map((range) => blankRange(range.open || DEFAULT_OPEN_TIME, range.close || DEFAULT_CLOSE_TIME));
    return ranges.length ? ranges : [blankRange()];
  }
  if (entry && typeof entry === 'object' && (entry.open || entry.close)) {
    return [blankRange(entry.open || DEFAULT_OPEN_TIME, entry.close || DEFAULT_CLOSE_TIME)];
  }
  return [blankRange()];
}

// Parse both legacy single ranges and F-10 split-shift arrays without
// collapsing ranges when an owner edits an unrelated location field.
function dayHoursFromLocation(location) {
  const hours = location && location.operating_hours && typeof location.operating_hours === 'object'
    ? location.operating_hours
    : null;
  const weekly = hours && hours.weekly && typeof hours.weekly === 'object' ? hours.weekly : hours;
  return WEEKDAY_KEYS.map((key) => {
    let entry = weekly && typeof weekly === 'object' ? weekly[key] : null;
    if (entry === 'closed') return blankDayHours(DEFAULT_OPEN_TIME, DEFAULT_CLOSE_TIME, true);
    if (entry && entry.closed) return { ranges: rangesFromEntry(entry.ranges || entry), closed: true };
    if (entry && (entry.open || entry.close) || Array.isArray(entry)) return { ranges: rangesFromEntry(entry), closed: false };
    return blankDayHours();
  });
}

function specialDatesFromLocation(location) {
  const hours = location && location.operating_hours && typeof location.operating_hours === 'object'
    ? location.operating_hours
    : {};
  const weekly = hours.weekly && typeof hours.weekly === 'object' ? hours.weekly : {};
  const map = hours.special_dates || hours.specialDates || weekly.special_dates || weekly.specialDates || {};
  if (!map || typeof map !== 'object') return [];
  return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([date, entry]) => {
    const closed = entry === 'closed' || Boolean(entry && entry.closed);
    const source = entry && typeof entry === 'object' && entry.ranges ? entry.ranges : entry;
    return { date, closed, ranges: rangesFromEntry(source) };
  });
}

function weekDayLabel(index) {
  // 2026-06-01 is a Monday; weekday names come from the browser locale data.
  const date = new Date(Date.UTC(2026, 5, 1 + index));
  try {
    return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date);
  } catch {
    return WEEKDAY_KEYS[index];
  }
}

function statusLabelKey(status) {
  if (status === 'paused') return 'food.merchant.locationPaused';
  if (status === 'closed') return 'food.merchant.locationClosed';
  return 'food.merchant.locationActive';
}

export default function LocationsPanel({ t, restaurant, onChanged, bare }) {
  const [locations, setLocations] = useState([]);
  const blankForm = useCallback(() => ({
    name: '', addressCity: '', addressState: '', addressCountry: 'US', latitude: '', longitude: '',
    phone: '', timezone: restaurant.timezone || DETECTED_TIMEZONE, status: 'active', isPrimary: false,
    taxRatePercent: '', serviceFeePercent: '', taxInclusive: false, taxJurisdiction: '',
    onlinePacingMax: '', inStorePacingMax: '', prepTimeExtensionMin: '0',
  }), [restaurant.timezone]);
  const [form, setForm] = useState(blankForm);
  const [editingId, setEditingId] = useState(null);
  const [dayHours, setDayHours] = useState(() => WEEKDAY_KEYS.map(() => blankDayHours()));
  const [specialDates, setSpecialDates] = useState([]);
  const [hoursDirty, setHoursDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [geocoding, setGeocoding] = useState(false);

  const load = useCallback(() => {
    listFoodLocations(restaurant.id).then(setLocations).catch(() => setLocations([]));
  }, [restaurant.id]);

  useEffect(() => { load(); }, [load]);

  const resetForm = useCallback(() => {
    setForm(blankForm());
    setEditingId(null);
    setDayHours(WEEKDAY_KEYS.map(() => blankDayHours()));
    setSpecialDates([]);
    setHoursDirty(false);
  }, [blankForm]);

  const startEdit = (loc) => {
    setEditingId(loc.id);
    setForm({
      name: loc.name || '',
      addressCity: loc.address_city || '',
      addressState: loc.address_state || '',
      addressCountry: loc.address_country || 'US',
      latitude: loc.latitude === null || loc.latitude === undefined ? '' : String(loc.latitude),
      longitude: loc.longitude === null || loc.longitude === undefined ? '' : String(loc.longitude),
      phone: loc.phone || '',
      timezone: loc.timezone || restaurant.timezone || DETECTED_TIMEZONE,
      status: LOCATION_STATUSES.includes(loc.status) ? loc.status : 'active',
      isPrimary: !!loc.is_primary,
      taxRatePercent: loc.tax_rate_bps == null ? '' : String(Number(loc.tax_rate_bps) / 100),
      serviceFeePercent: loc.service_fee_bps == null ? '' : String(Number(loc.service_fee_bps) / 100),
      taxInclusive: !!loc.tax_inclusive,
      taxJurisdiction: loc.tax_jurisdiction || '',
      onlinePacingMax: loc.online_order_pacing_max_per_15_min == null ? '' : String(loc.online_order_pacing_max_per_15_min),
      inStorePacingMax: loc.in_store_order_pacing_max_per_15_min == null ? '' : String(loc.in_store_order_pacing_max_per_15_min),
      prepTimeExtensionMin: loc.prep_time_extension_min == null ? '0' : String(loc.prep_time_extension_min),
    });
    setDayHours(dayHoursFromLocation(loc));
    setSpecialDates(specialDatesFromLocation(loc));
    setHoursDirty(false);
  };

  const updateDay = (index, patch) => {
    setDayHours((current) => current.map((day, i) => (i === index ? { ...day, ...patch } : day)));
    setHoursDirty(true);
  };

  const updateRange = (dayIndex, rangeIndex, patch) => {
    setDayHours((current) => current.map((day, i) => {
      if (i !== dayIndex) return day;
      return { ...day, ranges: day.ranges.map((range, j) => (j === rangeIndex ? { ...range, ...patch } : range)) };
    }));
    setHoursDirty(true);
  };

  const addRange = (dayIndex) => {
    setDayHours((current) => current.map((day, i) => (
      i === dayIndex ? { ...day, ranges: [...day.ranges, blankRange()] } : day
    )));
    setHoursDirty(true);
  };

  const removeRange = (dayIndex, rangeIndex) => {
    setDayHours((current) => current.map((day, i) => {
      if (i !== dayIndex || day.ranges.length <= 1) return day;
      return { ...day, ranges: day.ranges.filter((_, j) => j !== rangeIndex) };
    }));
    setHoursDirty(true);
  };

  const addSpecialDate = () => {
    setSpecialDates((current) => [...current, { date: '', closed: false, ranges: [blankRange()] }]);
    setHoursDirty(true);
  };

  const updateSpecialDate = (index, patch) => {
    setSpecialDates((current) => current.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
    setHoursDirty(true);
  };

  const updateSpecialDateRange = (dateIndex, rangeIndex, patch) => {
    setSpecialDates((current) => current.map((entry, i) => i === dateIndex
      ? { ...entry, ranges: entry.ranges.map((range, j) => (j === rangeIndex ? { ...range, ...patch } : range)) }
      : entry));
    setHoursDirty(true);
  };

  const removeSpecialDate = (index) => {
    setSpecialDates((current) => current.filter((_, i) => i !== index));
    setHoursDirty(true);
  };

  const resolveCoordinates = async () => {
    const query = [form.addressCity, form.addressState, form.addressCountry].filter(Boolean).join(', ');
    if (query.length < 2) return;
    setGeocoding(true);
    try {
      const [match] = await suggestLocation(query);
      if (!match) {
        toast.error(t('food.merchant.locationGeocodeEmpty'));
        return;
      }
      setForm((current) => ({
        ...current,
        addressCity: match.city || current.addressCity,
        addressState: match.state || current.addressState,
        addressCountry: match.country || current.addressCountry,
        latitude: match.lat ?? current.latitude,
        longitude: match.lng ?? current.longitude,
      }));
      toast.success(t('food.merchant.locationGeocoded'));
    } catch (err) {
      toast.error(apiErrorMessage(err, t('food.merchant.locationGeocodeError')));
    } finally {
      setGeocoding(false);
    }
  };

  const buildOperatingHours = () => ({
    weekly: Object.fromEntries(WEEKDAY_KEYS.map((key, index) => {
      const day = dayHours[index];
      const ranges = day.ranges.map((range) => ({ open: range.open, close: range.close }));
      return day.closed ? [key, { closed: true, ranges }] : [key, ranges.length === 1 ? ranges[0] : ranges];
    })),
    special_dates: Object.fromEntries(specialDates.filter((entry) => entry.date).map((entry) => {
      const ranges = entry.ranges.map((range) => ({ open: range.open, close: range.close }));
      return [entry.date, entry.closed ? { closed: true, ranges } : ranges.length === 1 ? ranges[0] : ranges];
    })),
  });

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    const specialDateKeys = specialDates.map((entry) => entry.date).filter(Boolean);
    if (new Set(specialDateKeys).size !== specialDateKeys.length) {
      toast.error(t('food.merchant.specialDateDuplicate'));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        addressCity: form.addressCity.trim() || undefined,
        addressState: form.addressState.trim() || undefined,
        addressCountry: form.addressCountry.trim() || 'US',
        latitude: form.latitude !== '' ? Number(form.latitude) : undefined,
        longitude: form.longitude !== '' ? Number(form.longitude) : undefined,
        phone: form.phone.trim() || undefined,
        timezone: form.timezone || undefined,
        status: form.status,
        isPrimary: editingId ? form.isPrimary : (locations.length === 0 || form.isPrimary),
        taxRateBps: form.taxRatePercent === '' ? null : Math.round(Number(form.taxRatePercent) * 100),
        serviceFeeBps: form.serviceFeePercent === '' ? null : Math.round(Number(form.serviceFeePercent) * 100),
        taxInclusive: form.taxInclusive,
        taxJurisdiction: form.taxJurisdiction.trim() || null,
        onlineOrderPacingMaxPer15Min: form.onlinePacingMax === '' ? null : Number(form.onlinePacingMax),
        inStoreOrderPacingMaxPer15Min: form.inStorePacingMax === '' ? null : Number(form.inStorePacingMax),
        prepTimeExtensionMin: form.prepTimeExtensionMin === '' ? 0 : Number(form.prepTimeExtensionMin),
        ...(hoursDirty ? { operatingHours: buildOperatingHours() } : {}),
      };
      if (editingId) {
        await updateFoodLocation(restaurant.id, editingId, payload);
        toast.success(t('food.merchant.locationUpdated'));
      } else {
        await createFoodLocation(restaurant.id, payload);
        toast.success(t('food.merchant.locationCreated'));
      }
      resetForm();
      load();
      onChanged?.();
    } catch (err) {
      toast.error(apiErrorMessage(err, t('food.merchant.locationError')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={bare ? undefined : { marginTop: '1.5rem' }}>
      {!bare && (
        <>
          <h3>{t('food.merchant.locationsTitle')}</h3>
          <p className="fd-card-meta">{t('food.merchant.locationsHint')}</p>
        </>
      )}
      {locations.length > 0 && (
        <ul className="fd-setup-steps">
          {locations.map((loc) => (
            <li key={loc.id} className="fd-setup-step fd-complete">
              <span>
                {loc.is_primary ? '★ ' : ''}{loc.name}
                {[loc.address_city, loc.address_state].filter(Boolean).join(', ')}
                {' · '}{t(statusLabelKey(loc.status))}
                {loc.timezone ? ` · ${loc.timezone}` : ''}
              </span>
              <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => startEdit(loc)} data-track="ui.dbbd615872.4">
                {t('food.merchant.locationEdit')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} style={{ marginTop: '0.75rem' }} data-track="ui.dbbd615872.1">
        <div className="fd-row" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
          <div className="fd-field" style={{ flex: '1 1 160px' }}>
            <label htmlFor="fd-loc-name">{t('food.merchant.locationName')} *</label>
            <input id="fd-loc-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
          </div>
          <div className="fd-field" style={{ flex: '1 1 120px' }}>
            <label htmlFor="fd-loc-city">{t('food.merchant.city')}</label>
            <AddressAutocomplete
              id="fd-loc-city"
              value={form.addressCity}
              onChange={(value) => setForm((current) => ({ ...current, addressCity: value, latitude: '', longitude: '' }))}
              onSelect={(place) => setForm((current) => ({
                ...current,
                addressCity: place.city || place.display,
                addressState: place.state || current.addressState,
                addressCountry: place.country || current.addressCountry,
                latitude: place.lat ?? current.latitude,
                longitude: place.lng ?? current.longitude,
              }))}
              autoComplete="address-level2"
              ariaLabel={t('food.merchant.city')}
            />
          </div>
          <div className="fd-field" style={{ flex: '1 1 100px' }}>
            <label htmlFor="fd-loc-state">{t('food.merchant.state')}</label>
            <input id="fd-loc-state" value={form.addressState} onChange={(e) => setForm((f) => ({ ...f, addressState: e.target.value }))} />
          </div>
          <div className="fd-field" style={{ flex: '0 1 110px' }}>
            <label htmlFor="fd-loc-phone">{t('food.merchant.phone')}</label>
            <input id="fd-loc-phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} maxLength={40} />
          </div>
        </div>
        <div className="fd-row" style={{ flexWrap: 'wrap', gap: '0.75rem', marginTop: '0.75rem' }}>
          <div className="fd-field" style={{ flex: '1 1 200px' }}>
            <label htmlFor="fd-loc-tz">{t('food.merchant.timezone')}</label>
            <TimezoneSelect id="fd-loc-tz" value={form.timezone} onChange={(value) => setForm((f) => ({ ...f, timezone: value }))} />
          </div>
          <div className="fd-field" style={{ flex: '0 1 140px' }}>
            <label htmlFor="fd-loc-status">{t('food.merchant.locationStatus')}</label>
            <select id="fd-loc-status" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
              {LOCATION_STATUSES.map((status) => (
                <option key={status} value={status}>{t(statusLabelKey(status))}</option>
              ))}
            </select>
          </div>
          <div className="fd-field" style={{ flex: '0 1 130px' }}>
            <label htmlFor="fd-loc-tax">{t('food.merchant.taxRate')}</label>
            <input id="fd-loc-tax" type="number" min="0" max="100" step="0.001" value={form.taxRatePercent} onChange={(e) => setForm((f) => ({ ...f, taxRatePercent: e.target.value }))} placeholder={t('food.merchant.taxRateHint')} />
          </div>
          <div className="fd-field" style={{ flex: '0 1 130px' }}>
            <label htmlFor="fd-loc-service-fee">{t('food.orders.serviceFee', 'Service fee')} (%)</label>
            <input id="fd-loc-service-fee" type="number" min="0" max="100" step="0.001" value={form.serviceFeePercent} onChange={(e) => setForm((f) => ({ ...f, serviceFeePercent: e.target.value }))} />
          </div>
          <div className="fd-field" style={{ flex: '1 1 160px' }}>
            <label htmlFor="fd-loc-tax-jurisdiction">{t('food.merchant.taxJurisdiction', 'Tax jurisdiction')}</label>
            <input id="fd-loc-tax-jurisdiction" value={form.taxJurisdiction} onChange={(e) => setForm((f) => ({ ...f, taxJurisdiction: e.target.value }))} maxLength={160} />
          </div>
          <label className="fd-field" style={{ flex: '0 1 180px', justifyContent: 'flex-end' }}>
            <span><input type="checkbox" checked={form.taxInclusive} onChange={(e) => setForm((f) => ({ ...f, taxInclusive: e.target.checked }))} data-track="ui.dbbd615872.10" />{' '}{t('food.merchant.taxInclusive', 'Tax inclusive')}</span>
          </label>
          <div className="fd-field" style={{ flex: '0 1 150px' }}>
            <label htmlFor="fd-loc-online-pacing">{t('food.merchant.onlinePacingMax')}</label>
            <input id="fd-loc-online-pacing" type="number" min="0" max="1000" step="1" value={form.onlinePacingMax} onChange={(e) => setForm((f) => ({ ...f, onlinePacingMax: e.target.value }))} placeholder={t('food.merchant.pacingInherit')} />
          </div>
          <div className="fd-field" style={{ flex: '0 1 150px' }}>
            <label htmlFor="fd-loc-store-pacing">{t('food.merchant.inStorePacingMax')}</label>
            <input id="fd-loc-store-pacing" type="number" min="0" max="1000" step="1" value={form.inStorePacingMax} onChange={(e) => setForm((f) => ({ ...f, inStorePacingMax: e.target.value }))} placeholder={t('food.merchant.pacingInherit')} />
          </div>
          <div className="fd-field" style={{ flex: '0 1 150px' }}>
            <label htmlFor="fd-loc-prep-extension">{t('food.merchant.prepExtension')}</label>
            <input id="fd-loc-prep-extension" type="number" min="0" max="240" step="1" value={form.prepTimeExtensionMin} onChange={(e) => setForm((f) => ({ ...f, prepTimeExtensionMin: e.target.value }))} />
          </div>
          <div className="fd-field" style={{ flex: '0 1 100px' }}>
            <label htmlFor="fd-loc-lat">{t('food.merchant.latitude')}</label>
            <input id="fd-loc-lat" value={form.latitude} onChange={(e) => setForm((f) => ({ ...f, latitude: e.target.value }))} />
          </div>
          <div className="fd-field" style={{ flex: '0 1 100px' }}>
            <label htmlFor="fd-loc-lng">{t('food.merchant.longitude')}</label>
            <input id="fd-loc-lng" value={form.longitude} onChange={(e) => setForm((f) => ({ ...f, longitude: e.target.value }))} />
          </div>
          <label className="fd-field" style={{ flex: '1 1 180px', justifyContent: 'flex-end' }}>
            <span>
              <input
                type="checkbox"
                checked={form.isPrimary}
                onChange={(e) => setForm((f) => ({ ...f, isPrimary: e.target.checked }))} data-track="ui.dbbd615872.5"
              />{' '}
              {t('food.merchant.locationMakePrimary')}
            </span>
          </label>
        </div>
        <fieldset style={{ border: 'none', padding: 0, margin: '0.75rem 0 0' }}>
          <legend className="fd-card-meta" style={{ marginBottom: '0.5rem' }}>{t('food.merchant.hoursTitle')}</legend>
          {dayHours.map((day, index) => (
            <div key={WEEKDAY_KEYS[index]} style={{ marginBottom: '0.65rem' }}>
              <div className="fd-row" style={{ gap: '0.5rem', alignItems: 'center', marginBottom: '0.25rem' }}>
                <span style={{ flex: '0 0 44px' }}>{weekDayLabel(index)}</span>
                <label>
                  <input
                    type="checkbox"
                    checked={day.closed}
                    onChange={(e) => updateDay(index, { closed: e.target.checked })} data-track="ui.dbbd615872.6"
                  />{' '}
                  {t('food.merchant.hoursClosed')}
                </label>
                {!day.closed && (
                  <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => addRange(index)} data-track="ui.dbbd615872.8">
                    {t('food.merchant.addHoursRange')}
                  </button>
                )}
              </div>
              {day.ranges.map((range, rangeIndex) => (
                <div key={`${WEEKDAY_KEYS[index]}-${rangeIndex}`} className="fd-row" style={{ gap: '0.5rem', alignItems: 'center', margin: '0.25rem 0 0 3rem', flexWrap: 'wrap' }}>
                  <span className="fd-card-meta" style={{ flex: '0 0 44px' }}>{t('food.merchant.hoursRangeLabel', { number: rangeIndex + 1 })}</span>
                  <label>
                    {t('food.merchant.openTime')}{' '}
                    <input type="time" aria-label={`${weekDayLabel(index)} ${t('food.merchant.openTime')} ${rangeIndex + 1}`} value={range.open} disabled={day.closed} onChange={(e) => updateRange(index, rangeIndex, { open: e.target.value })} />
                  </label>
                  <label>
                    {t('food.merchant.closeTime')}{' '}
                    <input type="time" aria-label={`${weekDayLabel(index)} ${t('food.merchant.closeTime')} ${rangeIndex + 1}`} value={range.close} disabled={day.closed} onChange={(e) => updateRange(index, rangeIndex, { close: e.target.value })} />
                  </label>
                  {day.ranges.length > 1 && (
                    <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => removeRange(index, rangeIndex)} disabled={day.closed} data-track="ui.dbbd615872.9">
                      {t('food.merchant.removeHoursRange')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))}
        </fieldset>
        <fieldset style={{ border: 'none', padding: 0, margin: '0.75rem 0 0' }}>
          <legend className="fd-card-meta" style={{ marginBottom: '0.25rem' }}>{t('food.merchant.specialDatesTitle')}</legend>
          <p className="fd-card-meta" style={{ margin: '0 0 0.5rem' }}>{t('food.merchant.specialDatesHint')}</p>
          {specialDates.map((entry, index) => (
            <div key={`${entry.date || 'new'}-${index}`} className="fd-row" style={{ gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
              <label>
                {t('food.merchant.specialDate')}{' '}
                <input type="date" aria-label={`${t('food.merchant.specialDate')} ${index + 1}`} value={entry.date} onChange={(e) => updateSpecialDate(index, { date: e.target.value })} />
              </label>
              <label>
                <input type="checkbox" checked={entry.closed} onChange={(e) => updateSpecialDate(index, { closed: e.target.checked })} data-track="ui.dbbd615872.11" />{' '}
                {t('food.merchant.specialDateClosed')}
              </label>
              {!entry.closed && entry.ranges.map((range, rangeIndex) => (
                <span key={`${index}-${rangeIndex}`}>
                  <label>{t('food.merchant.openTime')}{' '}<input type="time" aria-label={`${t('food.merchant.specialDate')} ${index + 1} ${t('food.merchant.openTime')}`} value={range.open} onChange={(e) => updateSpecialDateRange(index, rangeIndex, { open: e.target.value })} /></label>{' '}
                  <label>{t('food.merchant.closeTime')}{' '}<input type="time" aria-label={`${t('food.merchant.specialDate')} ${index + 1} ${t('food.merchant.closeTime')}`} value={range.close} onChange={(e) => updateSpecialDateRange(index, rangeIndex, { close: e.target.value })} /></label>
                </span>
              ))}
              <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => removeSpecialDate(index)} data-track="ui.dbbd615872.12">{t('food.merchant.specialDateRemove')}</button>
            </div>
          ))}
          <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={addSpecialDate} data-track="ui.dbbd615872.13">{t('food.merchant.specialDateAdd')}</button>
        </fieldset>
        <div className="fd-row" style={{ gap: '0.75rem', marginTop: '0.75rem' }}>
          <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={resolveCoordinates} disabled={geocoding} data-track="ui.dbbd615872.2">
            {geocoding ? t('food.common.loading') : t('food.merchant.findCoordinates')}
          </button>
          <button type="submit" className="fd-btn fd-btn-sm" disabled={saving} data-track="ui.dbbd615872.3">
            {saving
              ? t('food.common.saving')
              : editingId ? t('food.merchant.locationSaveChanges') : t('food.merchant.addLocation')}
          </button>
          {editingId && (
            <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={resetForm} disabled={saving} data-track="ui.dbbd615872.7">
              {t('food.common.cancel')}
            </button>
          )}
        </div>
      </form>
      {editingId && <StoreMenuPanel restaurant={restaurant} locationId={editingId} t={t} />}
      <RestaurantLocationAccessPanel restaurant={restaurant} t={t} />
    </div>
  );
}
