// Full-screen owner onboarding — "Opening Night" creative flow (web).
import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  createFoodRestaurant,
  createFoodMenuItem,
  updateFoodRestaurant,
  getFoodSetupProgress,
} from '../../api/food';
import { defaultWeekdayHours } from './FoodSetupWizard';
import DeviceSetupChecklist, { isDeviceSetupComplete } from './FoodDeviceSetupChecklist';
import { apiErrorMessage } from './foodShared';
import AddressAutocomplete from '../../components/AddressAutocomplete';

const STEPS = ['welcome', 'create', 'profile', 'location', 'hours', 'menu', 'publish', 'devices', 'done'];

const SCENE_ICONS = {
  welcome: '✦', create: '◎', profile: '❝', location: '⌖',
  hours: '◷', menu: '◈', publish: '⚡', devices: '▣', done: '✓',
};

function sceneHeadline(step, t) {
  const map = {
    welcome: t('food.onboarding.scene.welcome.headline', 'Run the room.'),
    create:  t('food.onboarding.scene.create.headline',  'What are we opening?'),
    profile: t('food.onboarding.scene.profile.headline', 'Tell guests who you are.'),
    location:t('food.onboarding.scene.location.headline','Put yourself on the map.'),
    hours:   t('food.onboarding.scene.hours.headline',   'When do doors open?'),
    menu:    t('food.onboarding.scene.menu.headline',    'Plate something real.'),
    publish: t('food.onboarding.scene.publish.headline', 'Flip the sign to OPEN.'),
    devices: t('food.onboarding.scene.devices.headline', 'Wire the floor.'),
    done:    t('food.onboarding.scene.done.headline',    "You're in service."),
  };
  return map[step] || '';
}

function sceneSub(step, t) {
  const map = {
    welcome: t('food.onboarding.scene.welcome.sub', 'One path from empty kitchen to a live floor.'),
    create:  t('food.onboarding.scene.create.sub',  'Start with a name — the rest follows.'),
    profile: t('food.onboarding.scene.profile.sub', 'Personality travels further than a logo alone.'),
    location:t('food.onboarding.scene.location.sub','Help nearby guests and delivery apps find you.'),
    hours:   t('food.onboarding.scene.hours.sub',   'Set your regular hours — you can change them anytime.'),
    menu:    t('food.onboarding.scene.menu.sub',    'One item is enough to take your first real order.'),
    publish: t('food.onboarding.scene.publish.sub', 'Live means findable by every guest nearby.'),
    devices: t('food.onboarding.scene.devices.sub', 'Kiosk, kitchen screen, queue board — then a test loop.'),
    done:    t('food.onboarding.scene.done.sub',    'Guests order. Kitchen fires. The board tells the story.'),
  };
  return map[step] || '';
}

export default function MerchantOnboardingWizard({
  t,
  restaurants,
  selected,
  onClose,
  onRefresh,
  onSelectRestaurant,
}) {
  const [step, setStep] = useState('welcome');
  const [progress, setProgress] = useState(null);
  const [working, setWorking] = useState(false);

  const [createForm, setCreateForm] = useState({
    displayName: '', description: '', cuisine: '', phone: '',
  });
  const [profileForm, setProfileForm] = useState({ description: '', cuisine: '' });
  const [locationForm, setLocationForm] = useState({
    addressStreet: '', city: '', addressState: '', addressZip: '',
    addressCountry: 'US', currencyCode: 'USD', latitude: '', longitude: '',
  });
  const [hoursForm, setHoursForm] = useState({ open: '11:00', close: '22:00' });
  const [menuForm, setMenuForm] = useState({ name: '', price: '' });

  const restaurant = selected;
  const stepIndex = STEPS.indexOf(step);

  const loadProgress = useCallback(async () => {
    if (!restaurant?.id) return;
    try {
      const p = await getFoodSetupProgress(restaurant.id);
      setProgress(p);
    } catch (_) {
      // non-blocking
    }
  }, [restaurant?.id]);

  useEffect(() => { loadProgress(); }, [loadProgress]);

  // Auto-advance to the right step on mount
  useEffect(() => {
    if (restaurants.length === 0) { setStep('welcome'); return; }
    if (!restaurant) { setStep('welcome'); return; }
    if (restaurant.status !== 'active') {
      if (progress?.nextStepId) {
        setStep(progress.nextStepId);
        return;
      }
      if (progress?.readyToPublish) { setStep('publish'); return; }
      setStep('profile');
      return;
    }
    if (!isDeviceSetupComplete(restaurant.id)) setStep('devices');
    else setStep('done');
  }, [restaurants.length, restaurant?.id, restaurant?.status, progress?.nextStepId, progress?.readyToPublish]);

  // Sync profile / location forms from restaurant
  useEffect(() => {
    if (!restaurant) return;
    setProfileForm({
      description: restaurant.description || '',
      cuisine: (restaurant.cuisine_tags || []).join(', '),
    });
    setLocationForm((f) => ({
      ...f,
      addressStreet: restaurant.address_street || '',
      city: restaurant.address_city || '',
      addressState: restaurant.address_state || '',
      addressZip: restaurant.address_zip || '',
      addressCountry: restaurant.address_country || 'US',
      currencyCode: restaurant.currency_code || 'USD',
      latitude: restaurant.latitude ?? '',
      longitude: restaurant.longitude ?? '',
    }));
  }, [restaurant]);

  const patchRestaurant = async (body) => {
    const updated = await updateFoodRestaurant(restaurant.id, body);
    onRefresh(updated);
    await loadProgress();
    return updated;
  };

  const handlePrimary = async () => {
    setWorking(true);
    try {
      if (step === 'welcome') {
        setStep(restaurants.length === 0 ? 'create' : (restaurant?.status === 'active' ? 'devices' : 'profile'));
        return;
      }

      if (step === 'create') {
        if (!createForm.displayName.trim()) {
          toast.error(t('food.merchant.nameRequired', 'Restaurant name is required'));
          return;
        }
        const created = await createFoodRestaurant({
          displayName: createForm.displayName.trim(),
          description: createForm.description.trim() || undefined,
          cuisineTags: createForm.cuisine.split(',').map((s) => s.trim()).filter(Boolean),
          phone: createForm.phone.trim() || undefined,
        });
        onSelectRestaurant(created.id);
        onRefresh(created);
        setStep('profile');
        return;
      }

      if (step === 'profile') {
        await patchRestaurant({
          description: profileForm.description.trim() || undefined,
          cuisineTags: profileForm.cuisine.split(',').map((s) => s.trim()).filter(Boolean),
        });
        setStep('location');
        return;
      }

      if (step === 'location') {
        await patchRestaurant({
          addressStreet: locationForm.addressStreet.trim() || undefined,
          addressCity: locationForm.city.trim() || undefined,
          addressState: locationForm.addressState.trim() || undefined,
          addressZip: locationForm.addressZip.trim() || undefined,
          addressCountry: locationForm.addressCountry.trim() || 'US',
          currencyCode: locationForm.currencyCode.trim() || 'USD',
          latitude: locationForm.latitude !== '' ? Number(locationForm.latitude) : undefined,
          longitude: locationForm.longitude !== '' ? Number(locationForm.longitude) : undefined,
        });
        setStep('hours');
        return;
      }

      if (step === 'hours') {
        await patchRestaurant({
          operatingHours: defaultWeekdayHours(hoursForm.open, hoursForm.close),
          acceptsInStoreOrders: true,
          acceptsOnlineOrders: true,
        });
        setStep('menu');
        return;
      }

      if (step === 'menu') {
        if ((progress?.menuItemCount || 0) === 0) {
          const price = Math.round(Number(menuForm.price) * 100);
          if (!menuForm.name.trim() || !Number.isFinite(price) || price < 0) {
            toast.error(t('food.merchant.menuPriceError', 'Enter a valid item name and price'));
            return;
          }
          await createFoodMenuItem(restaurant.id, {
            name: menuForm.name.trim(),
            priceCents: price,
          });
          await loadProgress();
        }
        setStep('publish');
        return;
      }

      if (step === 'publish') {
        if (restaurant.status === 'active') {
          setStep('devices');
          return;
        }
        if (!progress?.readyToPublish) {
          toast.error(t('food.merchant.setupIncomplete', 'Complete all setup steps first'));
          return;
        }
        await patchRestaurant({ status: 'active' });
        toast.success(t('food.merchant.nowLive', 'Your restaurant is live'));
        await loadProgress();
        setStep('devices');
        return;
      }

      if (step === 'done') {
        onClose();
      }
    } catch (err) {
      toast.error(apiErrorMessage(err, t('food.common.error')));
    } finally {
      setWorking(false);
    }
  };

  // ── Publish readiness items ──────────────────────────────────────────────
  const readinessItems = restaurant ? [
    {
      key: 'created',
      label: t('food.onboarding.readiness.restaurant', 'Restaurant created'),
      ok: true,
    },
    {
      key: 'profile',
      label: t('food.onboarding.readiness.description', 'Description added'),
      ok: !!(restaurant.description?.trim()),
    },
    {
      key: 'location',
      label: t('food.onboarding.readiness.location', 'City or address set'),
      ok: !!(restaurant.address_city?.trim()),
    },
    {
      key: 'menu',
      label: t('food.onboarding.readiness.menu', 'At least one menu item'),
      ok: (progress?.menuItemCount || 0) > 0,
    },
  ] : [];

  return (
    <div className="fd-onboarding-overlay fd-onboarding-opening" role="dialog" aria-modal="true" aria-labelledby="fd-onboarding-title">
      <div className="fd-onboarding-panel">
        {/* Header */}
        <header className="fd-onboarding-header">
          <div className="fd-onboarding-brand">
            <span className="fd-onboarding-flame" aria-hidden>🔥</span>
            <div>
              <p className="fd-onboarding-eyebrow">{t('food.onboarding.eyebrow', 'Opening Night')}</p>
              <p className="fd-onboarding-brand-name">OxSteed Restaurants</p>
            </div>
          </div>
          <button
            type="button"
            className="fd-btn fd-btn-ghost fd-btn-sm"
            onClick={() => {
              sessionStorage.setItem('ox.food.onboarding.dismissed', '1');
              onClose();
            }}
          >
            {t('food.onboarding.later', 'Not now')}
          </button>
        </header>

        {/* Progress spine */}
        {step !== 'done' && (
          <div className="fd-onboarding-spine" aria-hidden>
            {STEPS.filter((s) => s !== 'done').map((s, i) => (
              <span key={s} className={`fd-onboarding-spine-dot${i <= stepIndex ? ' fd-active' : ''}`} />
            ))}
          </div>
        )}

        {/* Body */}
        <div className="fd-onboarding-body">
          {/* Scene hero */}
          {step !== 'done' && (
            <div className="fd-onboarding-hero">
              <span className="fd-onboarding-scene-icon" aria-hidden>{SCENE_ICONS[step]}</span>
              <h2 id="fd-onboarding-title">{sceneHeadline(step, t)}</h2>
              <p className="fd-onboarding-scene-sub">{sceneSub(step, t)}</p>
              {restaurant && step !== 'welcome' && step !== 'create' && (
                <p className="fd-onboarding-restaurant">{restaurant.display_name}</p>
              )}
            </div>
          )}

          {/* Step content */}
          <div className="fd-onboarding-form-wrap">

            {/* ── Welcome ── */}
            {step === 'welcome' && (
              <ul className="fd-onboarding-chips">
                <li>{t('food.onboarding.chip1', 'Your brand, your floor — we run the infrastructure')}</li>
                <li>{t('food.onboarding.chip2', 'Kiosk, kitchen screen, and queue board included')}</li>
                <li>{t('food.onboarding.chip3', 'Same-day setup, live the moment you flip the sign')}</li>
              </ul>
            )}

            {/* ── Create ── */}
            {step === 'create' && (
              <div className="fd-field-grid">
                <div className="fd-field">
                  <label htmlFor="ob-name">{t('food.merchant.name', 'Restaurant name')} *</label>
                  <input
                    id="ob-name"
                    value={createForm.displayName}
                    onChange={(e) => setCreateForm((f) => ({ ...f, displayName: e.target.value }))}
                    placeholder={t('food.merchant.namePlaceholder', 'e.g. The Corner Kitchen')}
                    autoFocus
                  />
                </div>
                <div className="fd-field">
                  <label htmlFor="ob-desc">{t('food.merchant.description', 'Short description')}</label>
                  <textarea
                    id="ob-desc"
                    value={createForm.description}
                    onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
                    rows={2}
                    placeholder={t('food.merchant.descriptionPlaceholder', 'What makes you worth a visit?')}
                  />
                </div>
                <div className="fd-field">
                  <label htmlFor="ob-cuisine">{t('food.merchant.cuisineTags', 'Cuisine style')}</label>
                  <input
                    id="ob-cuisine"
                    value={createForm.cuisine}
                    onChange={(e) => setCreateForm((f) => ({ ...f, cuisine: e.target.value }))}
                    placeholder={t('food.merchant.cuisinePlaceholder', 'e.g. Caribbean, Creole, Fusion')}
                  />
                </div>
                <div className="fd-field">
                  <label htmlFor="ob-phone">{t('food.merchant.phone', 'Phone number')}</label>
                  <input
                    id="ob-phone"
                    type="tel"
                    value={createForm.phone}
                    onChange={(e) => setCreateForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="+1 (555) 000-0000"
                  />
                </div>
              </div>
            )}

            {/* ── Profile ── */}
            {step === 'profile' && (
              <div className="fd-field-grid">
                <div className="fd-field">
                  <label htmlFor="ob-prof-desc">{t('food.merchant.description', 'Description')}</label>
                  <textarea
                    id="ob-prof-desc"
                    value={profileForm.description}
                    onChange={(e) => setProfileForm((f) => ({ ...f, description: e.target.value }))}
                    rows={3}
                    placeholder={t('food.merchant.descriptionPlaceholder', 'What makes you worth a visit?')}
                  />
                </div>
                <div className="fd-field">
                  <label htmlFor="ob-prof-cuisine">{t('food.merchant.cuisineTags', 'Cuisine style')}</label>
                  <input
                    id="ob-prof-cuisine"
                    value={profileForm.cuisine}
                    onChange={(e) => setProfileForm((f) => ({ ...f, cuisine: e.target.value }))}
                    placeholder={t('food.merchant.cuisinePlaceholder', 'e.g. Caribbean, Creole, Fusion')}
                  />
                </div>
              </div>
            )}

            {/* ── Location ── */}
            {step === 'location' && (
              <div className="fd-field-grid">
                  <div className="fd-field">
                    <label htmlFor="ob-street">{t('food.merchant.street', 'Street address')}</label>
                    <AddressAutocomplete
                      id="ob-street"
                      value={locationForm.addressStreet}
                      onChange={(value) => setLocationForm((current) => ({ ...current, addressStreet: value, latitude: '', longitude: '' }))}
                      onSelect={(place) => setLocationForm((current) => ({
                        ...current,
                        addressStreet: place.addressLine1 || place.display,
                        city: place.city || current.city,
                        addressState: place.state || current.addressState,
                        addressZip: place.zip || current.addressZip,
                        addressCountry: place.country || current.addressCountry,
                        latitude: place.lat ?? current.latitude,
                        longitude: place.lng ?? current.longitude,
                      }))}
                      placeholder="123 Main St"
                      autoComplete="street-address"
                      ariaLabel={t('food.merchant.street', 'Street address')}
                    />
                  </div>
                <div className="fd-onboarding-field-row">
                  <div className="fd-field">
                    <label htmlFor="ob-city">{t('food.merchant.city', 'City')}</label>
                    <input
                      id="ob-city"
                      value={locationForm.city}
                      onChange={(e) => setLocationForm((f) => ({ ...f, city: e.target.value }))}
                      placeholder={t('food.merchant.cityPlaceholder', 'Your city')}
                    />
                  </div>
                  <div className="fd-field">
                    <label htmlFor="ob-state">{t('food.merchant.state', 'State / Province')}</label>
                    <input
                      id="ob-state"
                      value={locationForm.addressState}
                      onChange={(e) => setLocationForm((f) => ({ ...f, addressState: e.target.value }))}
                      placeholder="FL"
                    />
                  </div>
                </div>
                <div className="fd-onboarding-field-row">
                  <div className="fd-field">
                    <label htmlFor="ob-zip">{t('food.merchant.zip', 'ZIP / Postal')}</label>
                    <input
                      id="ob-zip"
                      value={locationForm.addressZip}
                      onChange={(e) => setLocationForm((f) => ({ ...f, addressZip: e.target.value }))}
                      placeholder="33101"
                    />
                  </div>
                  <div className="fd-field">
                    <label htmlFor="ob-country">{t('food.merchant.country', 'Country')}</label>
                    <input
                      id="ob-country"
                      value={locationForm.addressCountry}
                      onChange={(e) => setLocationForm((f) => ({ ...f, addressCountry: e.target.value }))}
                      placeholder="US"
                    />
                  </div>
                </div>
                <div className="fd-field">
                  <label htmlFor="ob-currency">{t('food.merchant.currency', 'Currency')}</label>
                  <select
                    id="ob-currency"
                    value={locationForm.currencyCode}
                    onChange={(e) => setLocationForm((f) => ({ ...f, currencyCode: e.target.value }))}
                    className="fd-select"
                  >
                    <option value="USD">USD — US Dollar</option>
                    <option value="EUR">EUR — Euro</option>
                    <option value="GBP">GBP — British Pound</option>
                    <option value="CAD">CAD — Canadian Dollar</option>
                    <option value="HTG">HTG — Haitian Gourde</option>
                    <option value="DOP">DOP — Dominican Peso</option>
                    <option value="BRL">BRL — Brazilian Real</option>
                    <option value="MXN">MXN — Mexican Peso</option>
                    <option value="RWF">RWF — Rwandan Franc</option>
                  </select>
                </div>
                <details className="fd-onboarding-advanced">
                  <summary>{t('food.merchant.advancedCoords', 'Advanced: GPS coordinates (optional)')}</summary>
                  <div className="fd-onboarding-field-row fd-onboarding-advanced-fields">
                    <div className="fd-field">
                      <label htmlFor="ob-lat">{t('food.merchant.latitude', 'Latitude')}</label>
                      <input
                        id="ob-lat"
                        value={locationForm.latitude}
                        onChange={(e) => setLocationForm((f) => ({ ...f, latitude: e.target.value }))}
                        placeholder="25.7617"
                      />
                    </div>
                    <div className="fd-field">
                      <label htmlFor="ob-lng">{t('food.merchant.longitude', 'Longitude')}</label>
                      <input
                        id="ob-lng"
                        value={locationForm.longitude}
                        onChange={(e) => setLocationForm((f) => ({ ...f, longitude: e.target.value }))}
                        placeholder="-80.1918"
                      />
                    </div>
                  </div>
                </details>
              </div>
            )}

            {/* ── Hours ── */}
            {step === 'hours' && (
              <div className="fd-field-grid">
                <p className="fd-onboarding-hint">{t('food.onboarding.hoursHint', 'Applied Mon–Fri by default. You can adjust individual days later.')}</p>
                <div className="fd-onboarding-field-row">
                  <div className="fd-field">
                    <label htmlFor="ob-open">{t('food.onboarding.opens', 'Opens')}</label>
                    <input
                      id="ob-open"
                      type="time"
                      value={hoursForm.open}
                      onChange={(e) => setHoursForm((f) => ({ ...f, open: e.target.value }))}
                    />
                  </div>
                  <div className="fd-field">
                    <label htmlFor="ob-close">{t('food.onboarding.closes', 'Closes')}</label>
                    <input
                      id="ob-close"
                      type="time"
                      value={hoursForm.close}
                      onChange={(e) => setHoursForm((f) => ({ ...f, close: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ── Menu ── */}
            {step === 'menu' && (
              <div className="fd-field-grid">
                {(progress?.menuItemCount || 0) > 0 ? (
                  <p className="fd-onboarding-hint fd-onboarding-hint--good">
                    ✓ {t('food.onboarding.menuExists', '{{count}} item(s) already on your menu', { count: progress.menuItemCount })}
                    {' '}{t('food.onboarding.menuSkip', '— you can continue or add another.')}
                  </p>
                ) : (
                  <p className="fd-onboarding-hint">{t('food.onboarding.menuFirstHint', 'Add your first dish. You can build out the full menu from the dashboard.')}</p>
                )}
                <div className="fd-field">
                  <label htmlFor="ob-item-name">{t('food.merchant.itemName', 'Item name')}</label>
                  <input
                    id="ob-item-name"
                    value={menuForm.name}
                    onChange={(e) => setMenuForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder={t('food.merchant.itemNamePlaceholder', 'e.g. Jerk Chicken Plate')}
                  />
                </div>
                <div className="fd-field">
                  <label htmlFor="ob-item-price">{t('food.merchant.price', 'Price')}</label>
                  <input
                    id="ob-item-price"
                    value={menuForm.price}
                    onChange={(e) => setMenuForm((f) => ({ ...f, price: e.target.value }))}
                    placeholder="12.99"
                    type="number"
                    min="0"
                    step="0.01"
                  />
                </div>
              </div>
            )}

            {/* ── Publish ── */}
            {step === 'publish' && (
              <div className="fd-onboarding-readiness">
                <p className="fd-onboarding-readiness-title">
                  {progress?.readyToPublish
                    ? t('food.onboarding.readiness.ready', 'Everything looks good — ready to go live.')
                    : t('food.onboarding.readiness.incomplete', 'Complete these steps to go live.')}
                </p>
                <ul className="fd-onboarding-readiness-list">
                  {readinessItems.map((item) => (
                    <li
                      key={item.key}
                      className={`fd-onboarding-readiness-item${item.ok ? ' fd-readiness-ok' : ' fd-readiness-missing'}`}
                    >
                      <span className="fd-readiness-icon" aria-hidden>{item.ok ? '✓' : '○'}</span>
                      <span>{item.label}</span>
                    </li>
                  ))}
                </ul>
                {restaurant?.status === 'active' && (
                  <p className="fd-onboarding-hint fd-onboarding-hint--good">
                    ✓ {t('food.onboarding.alreadyLive', 'Your restaurant is already live.')}
                  </p>
                )}
              </div>
            )}

            {/* ── Devices ── */}
            {step === 'devices' && restaurant && (
              <DeviceSetupChecklist
                restaurant={restaurant}
                t={t}
                onComplete={() => setStep('done')}
              />
            )}

          </div>
        </div>

        {/* Done screen — shown outside the form-wrap for full layout control */}
        {step === 'done' && (
          <div className="fd-onboarding-done">
            <div className="fd-onboarding-done-icon" aria-hidden>✓</div>
            <h2 id="fd-onboarding-title" className="fd-onboarding-done-headline">
              {sceneHeadline('done', t)}
            </h2>
            {restaurant && (
              <p className="fd-onboarding-done-name">{restaurant.display_name}</p>
            )}
            <p className="fd-onboarding-done-sub">
              {restaurant
                ? t('food.onboarding.doneMessage', '{{name}} is now discoverable. Guests can find and order right now.', { name: restaurant.display_name })
                : t('food.onboarding.scene.done.sub', 'Guests order. Kitchen fires. The board tells the story.')}
            </p>
          </div>
        )}

        {/* Footer */}
        <footer className="fd-onboarding-footer">
          {stepIndex > 0 && step !== 'done' && (
            <button
              type="button"
              className="fd-btn fd-btn-secondary"
              onClick={() => setStep(STEPS[Math.max(0, stepIndex - 1)])}
              disabled={working}
            >
              {t('food.common.back', 'Back')}
            </button>
          )}
          {step !== 'devices' && step !== 'done' && (
            <button
              type="button"
              className="fd-btn fd-btn-primary"
              onClick={handlePrimary}
              disabled={working}
            >
              {working ? t('food.common.saving', 'Saving…') : primaryLabel(step, t, restaurant, progress)}
            </button>
          )}
          {step === 'devices' && isDeviceSetupComplete(restaurant?.id) && (
            <button type="button" className="fd-btn fd-btn-primary" onClick={() => setStep('done')}>
              {t('food.common.continue', 'Continue')}
            </button>
          )}
          {step === 'done' && (
            <button type="button" className="fd-btn fd-btn-primary fd-btn-lg" onClick={onClose}>
              {t('food.onboarding.finish', 'Enter your dashboard')}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function primaryLabel(step, t, restaurant, progress) {
  if (step === 'welcome') return t('food.onboarding.begin', 'Begin opening night');
  if (step === 'create') return t('food.merchant.createRestaurant', 'Create restaurant');
  if (step === 'menu' && (progress?.menuItemCount || 0) > 0) return t('food.common.continue', 'Continue');
  if (step === 'publish') {
    return restaurant?.status === 'active'
      ? t('food.common.continue', 'Continue')
      : t('food.merchant.goLive', 'Go live');
  }
  return t('food.onboarding.saveContinue', 'Save & continue');
}

export function shouldShowMerchantOnboarding(restaurants, selected) {
  if (!restaurants.length) return true;
  if (!selected) return true;
  if (selected.status !== 'active') return true;
  return !isDeviceSetupComplete(selected.id);
}
