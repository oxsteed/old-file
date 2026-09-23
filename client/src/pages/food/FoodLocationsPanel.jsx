// Multi-location management panel for merchant settings (D1).
import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { createFoodLocation, listFoodLocations } from '../../api/food';
import { suggestLocation } from '../../api/geo';
import { apiErrorMessage } from './foodShared';

export default function LocationsPanel({ t, restaurant, onChanged }) {
  const [locations, setLocations] = useState([]);
  const [form, setForm] = useState({
    name: '', addressCity: '', addressState: '', addressCountry: 'US', latitude: '', longitude: '',
  });
  const [saving, setSaving] = useState(false);
  const [geocoding, setGeocoding] = useState(false);

  const load = useCallback(() => {
    listFoodLocations(restaurant.id).then(setLocations).catch(() => setLocations([]));
  }, [restaurant.id]);

  useEffect(() => { load(); }, [load]);

  const resolveCoordinates = async () => {
    const query = [form.addressCity, form.addressState, form.addressCountry].filter(Boolean).join(', ');
    if (query.length < 2) return;
    setGeocoding(true);
    try {
      const [match] = await suggestLocation(query);
      if (!match) {
        toast.error(t('food.merchant.locationGeocodeEmpty', 'Could not find coordinates for this location'));
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
      toast.success(t('food.merchant.locationGeocoded', 'Coordinates found'));
    } catch (err) {
      toast.error(apiErrorMessage(err, t('food.merchant.locationGeocodeError', 'Could not find coordinates')));
    } finally {
      setGeocoding(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await createFoodLocation(restaurant.id, {
        name: form.name.trim(),
        addressCity: form.addressCity.trim() || undefined,
        addressState: form.addressState.trim() || undefined,
        addressCountry: form.addressCountry.trim() || 'US',
        latitude: form.latitude !== '' ? Number(form.latitude) : undefined,
        longitude: form.longitude !== '' ? Number(form.longitude) : undefined,
        isPrimary: locations.length === 0,
      });
      toast.success(t('food.merchant.locationCreated', 'Location added'));
      setForm({ name: '', addressCity: '', addressState: '', addressCountry: 'US', latitude: '', longitude: '' });
      load();
      onChanged?.();
    } catch (err) {
      toast.error(apiErrorMessage(err, t('food.merchant.locationError', 'Could not add location')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <h3>{t('food.merchant.locationsTitle', 'Locations')}</h3>
      <p className="fd-card-meta">{t('food.merchant.locationsHint', 'Add additional storefronts under the same brand.')}</p>
      {locations.length > 0 && (
        <ul className="fd-setup-steps">
          {locations.map((loc) => (
            <li key={loc.id} className="fd-setup-step fd-complete">
              <span>
                {loc.is_primary ? '★ ' : ''}{loc.name}
                {[loc.address_city, loc.address_state].filter(Boolean).join(', ')}
              </span>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="fd-row" style={{ flexWrap: 'wrap', gap: '0.75rem', marginTop: '0.75rem' }}>
        <div className="fd-field" style={{ flex: '1 1 160px' }}>
          <label htmlFor="fd-loc-name">{t('food.merchant.locationName', 'Location name')} *</label>
          <input id="fd-loc-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
        </div>
        <div className="fd-field" style={{ flex: '1 1 120px' }}>
          <label htmlFor="fd-loc-city">{t('food.merchant.city')}</label>
          <input id="fd-loc-city" value={form.addressCity} onChange={(e) => setForm((f) => ({ ...f, addressCity: e.target.value }))} />
        </div>
        <div className="fd-field" style={{ flex: '0 1 100px' }}>
          <label htmlFor="fd-loc-lat">{t('food.merchant.latitude')}</label>
          <input id="fd-loc-lat" value={form.latitude} onChange={(e) => setForm((f) => ({ ...f, latitude: e.target.value }))} />
        </div>
        <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={resolveCoordinates} disabled={geocoding} style={{ alignSelf: 'flex-end' }}>
          {geocoding ? t('food.common.loading') : t('food.merchant.findCoordinates', 'Find coordinates')}
        </button>
        <button type="submit" className="fd-btn fd-btn-sm" disabled={saving} style={{ alignSelf: 'flex-end' }}>
          {saving ? t('food.common.saving') : t('food.merchant.addLocation', 'Add location')}
        </button>
      </form>
    </div>
  );
}
