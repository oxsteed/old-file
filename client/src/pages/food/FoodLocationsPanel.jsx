// Multi-location management panel for merchant settings (D1, F-29).
import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { createFoodLocation, listFoodLocations, updateFoodLocation } from '../../api/food';
import { suggestLocation } from '../../api/geo';
import { apiErrorMessage } from './foodShared';
import AddressAutocomplete from '../../components/AddressAutocomplete';
import TimezoneSelect, { DETECTED_TIMEZONE } from './TimezoneSelect.jsx';
import StoreMenuPanel from './StoreMenuPanel.jsx';

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DEFAULT_OPEN_TIME = '11:00';
const DEFAULT_CLOSE_TIME = '22:00';
const LOCATION_STATUSES = ['active', 'paused', 'closed'];

const blankDayHours = (open = DEFAULT_OPEN_TIME, close = DEFAULT_CLOSE_TIME, closed = false) => ({ open, close, closed });

// Parse a location's operating_hours into the single-range editor shape.
// Multi-range days (F-10) show their first range; the saved value is only
// sent when the owner actually edits the hours, so untouched multi-range
// schedules are never collapsed by an unrelated edit.
function dayHoursFromLocation(location) {
  const hours = location && location.operating_hours && typeof location.operating_hours === 'object'
    ? location.operating_hours
    : null;
  const weekly = hours && hours.weekly && typeof hours.weekly === 'object' ? hours.weekly : hours;
  return WEEKDAY_KEYS.map((key) => {
    let entry = weekly && typeof weekly === 'object' ? weekly[key] : null;
    if (Array.isArray(entry)) entry = entry[0] || null;
    if (entry === 'closed') return blankDayHours(DEFAULT_OPEN_TIME, DEFAULT_CLOSE_TIME, true);
    if (entry && entry.closed) return blankDayHours(entry.open || DEFAULT_OPEN_TIME, entry.close || DEFAULT_CLOSE_TIME, true);
    if (entry && (entry.open || entry.close)) {
      return blankDayHours(entry.open || DEFAULT_OPEN_TIME, entry.close || DEFAULT_CLOSE_TIME, false);
    }
    return blankDayHours();
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
  }), [restaurant.timezone]);
  const [form, setForm] = useState(blankForm);
  const [editingId, setEditingId] = useState(null);
  const [dayHours, setDayHours] = useState(() => WEEKDAY_KEYS.map(() => blankDayHours()));
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
    });
    setDayHours(dayHoursFromLocation(loc));
    setHoursDirty(false);
  };

  const updateDay = (index, patch) => {
    setDayHours((current) => current.map((day, i) => (i === index ? { ...day, ...patch } : day)));
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
      return day.closed
        ? [key, { closed: true, open: day.open, close: day.close }]
        : [key, { open: day.open, close: day.close }];
    })),
  });

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
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
            <div key={WEEKDAY_KEYS[index]} className="fd-row" style={{ gap: '0.5rem', alignItems: 'center', marginBottom: '0.35rem' }}>
              <span style={{ flex: '0 0 44px' }}>{weekDayLabel(index)}</span>
              <label>
                <input
                  type="checkbox"
                  checked={day.closed}
                  onChange={(e) => updateDay(index, { closed: e.target.checked })} data-track="ui.dbbd615872.6"
                />{' '}
                {t('food.merchant.hoursClosed')}
              </label>
              <label>
                {t('food.merchant.openTime')}{' '}
                <input type="time" value={day.open} disabled={day.closed} onChange={(e) => updateDay(index, { open: e.target.value })} />
              </label>
              <label>
                {t('food.merchant.closeTime')}{' '}
                <input type="time" value={day.close} disabled={day.closed} onChange={(e) => updateDay(index, { close: e.target.value })} />
              </label>
            </div>
          ))}
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
    </div>
  );
}
