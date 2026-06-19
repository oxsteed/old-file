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

const STEPS = ['welcome', 'create', 'profile', 'location', 'hours', 'menu', 'publish', 'devices', 'done'];

const SCENE_META = {
  welcome: { headline: 'Run the room.', sub: 'One path from empty kitchen to a live floor.', icon: '✦' },
  create: { headline: 'What are we opening?', sub: 'Start with a name — the rest follows.', icon: '◎' },
  profile: { headline: 'Tell guests who you are.', sub: 'Personality travels further than a logo alone.', icon: '❝' },
  location: { headline: 'Put yourself on the map.', sub: 'City and coordinates for nearby discovery.', icon: '⌖' },
  hours: { headline: 'When do doors open?', sub: 'Same rhythm every day for now.', icon: '◷' },
  menu: { headline: 'Plate something real.', sub: 'One dish is enough for a first real order.', icon: '◈' },
  publish: { headline: 'Flip the sign to OPEN.', sub: 'Live means findable.', icon: '⚡' },
  devices: { headline: 'Wire the floor.', sub: 'Kiosk, kitchen, queue — then one test loop.', icon: '▣' },
  done: { headline: "You're in service.", sub: 'Guests order. Kitchen fires. The board tells the story.', icon: '✓' },
};

function apiErrorMessage(err, fallback) {
  const message = err?.response?.data?.error?.message || err?.response?.data?.message || err?.response?.data?.error;
  return typeof message === 'string' ? message : fallback;
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
    displayName: '', description: '', cuisine: '', addressCity: '', addressCountry: 'US', currencyCode: 'USD',
  });
  const [profileForm, setProfileForm] = useState({ description: '', cuisine: '' });
  const [locationForm, setLocationForm] = useState({ city: '', latitude: '', longitude: '' });
  const [hoursForm, setHoursForm] = useState({ open: '11:00', close: '22:00' });
  const [menuForm, setMenuForm] = useState({ name: '', price: '' });

  const restaurant = selected;
  const stepIndex = STEPS.indexOf(step);
  const scene = SCENE_META[step] || SCENE_META.welcome;

  const loadProgress = useCallback(() => {
    if (!restaurant?.id || restaurant.status === 'active') {
      setProgress(null);
      return Promise.resolve();
    }
    return getFoodSetupProgress(restaurant.id)
      .then(setProgress)
      .catch(() => setProgress(null));
  }, [restaurant?.id, restaurant?.status]);

  useEffect(() => { loadProgress(); }, [loadProgress]);

  useEffect(() => {
    if (restaurants.length === 0) {
      setStep('welcome');
      return;
    }
    if (!restaurant) return;
    if (restaurant.status !== 'active') {
      const next = progress?.nextStepId;
      if (next === 'profile') setStep('profile');
      else if (next === 'location') setStep('location');
      else if (next === 'hours') setStep('hours');
      else if (next === 'menu') setStep('menu');
      else if (progress?.readyToPublish) setStep('publish');
      else setStep('profile');
      return;
    }
    if (!isDeviceSetupComplete(restaurant.id)) setStep('devices');
    else setStep('done');
  }, [restaurants.length, restaurant?.id, restaurant?.status, progress?.nextStepId, progress?.readyToPublish]);

  useEffect(() => {
    if (!restaurant) return;
    setProfileForm({
      description: restaurant.description || '',
      cuisine: (restaurant.cuisine_tags || []).join(', '),
    });
    setLocationForm({
      city: restaurant.address_city || '',
      latitude: restaurant.latitude ?? '',
      longitude: restaurant.longitude ?? '',
    });
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
        const created = await createFoodRestaurant({
          displayName: createForm.displayName.trim(),
          description: createForm.description.trim() || undefined,
          cuisineTags: createForm.cuisine.split(',').map((s) => s.trim()).filter(Boolean),
          addressCity: createForm.addressCity.trim() || undefined,
          addressCountry: createForm.addressCountry.trim() || 'US',
          currencyCode: createForm.currencyCode.trim() || 'USD',
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
          addressCity: locationForm.city.trim() || undefined,
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

  return (
    <div className="fd-onboarding-overlay fd-onboarding-opening" role="dialog" aria-modal="true" aria-labelledby="fd-onboarding-title">
      <div className="fd-onboarding-panel">
        <header className="fd-onboarding-header">
          <div className="fd-onboarding-brand">
            <span className="fd-onboarding-flame" aria-hidden>🔥</span>
            <div>
              <p className="fd-onboarding-eyebrow">Opening Night</p>
              <p className="fd-onboarding-brand-name">OxSteed Restaurants</p>
            </div>
          </div>
          <button type="button" className="fd-btn fd-btn-ghost fd-btn-sm" onClick={onClose}>
            {t('food.onboarding.later', 'Not now')}
          </button>
        </header>

        {step !== 'done' && (
          <div className="fd-onboarding-spine" aria-hidden>
            {STEPS.filter((s) => s !== 'done').map((s, i) => (
              <span key={s} className={`fd-onboarding-spine-dot${i <= stepIndex ? ' fd-active' : ''}`} />
            ))}
          </div>
        )}

        <div className="fd-onboarding-body">
          <div className="fd-onboarding-hero">
            <span className="fd-onboarding-scene-icon" aria-hidden>{scene.icon}</span>
            <h2 id="fd-onboarding-title">{scene.headline}</h2>
            <p className="fd-onboarding-scene-sub">{scene.sub}</p>
            {restaurant && step !== 'welcome' && step !== 'create' && (
              <p className="fd-onboarding-restaurant">{restaurant.display_name}</p>
            )}
          </div>

          <div className="fd-onboarding-form-wrap">
            {step === 'welcome' && (
              <ul className="fd-onboarding-chips">
                <li>Kiosk at the counter</li>
                <li>Kitchen on the line</li>
                <li>Queue on the wall</li>
              </ul>
            )}

            {step === 'create' && (
              <div className="fd-field-grid">
                <div className="fd-field">
                  <label>{t('food.merchant.name')} *</label>
                  <input value={createForm.displayName} onChange={(e) => setCreateForm((f) => ({ ...f, displayName: e.target.value }))} />
                </div>
                <div className="fd-field">
                  <label>{t('food.merchant.description')}</label>
                  <textarea value={createForm.description} onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))} rows={3} />
                </div>
                <div className="fd-field">
                  <label>{t('food.merchant.cuisineTags')}</label>
                  <input value={createForm.cuisine} onChange={(e) => setCreateForm((f) => ({ ...f, cuisine: e.target.value }))} />
                </div>
                <div className="fd-field">
                  <label>{t('food.merchant.city')}</label>
                  <input value={createForm.addressCity} onChange={(e) => setCreateForm((f) => ({ ...f, addressCity: e.target.value }))} />
                </div>
              </div>
            )}

            {step === 'profile' && (
              <div className="fd-field-grid">
                <div className="fd-field">
                  <label>{t('food.merchant.description')}</label>
                  <textarea value={profileForm.description} onChange={(e) => setProfileForm((f) => ({ ...f, description: e.target.value }))} rows={3} />
                </div>
                <div className="fd-field">
                  <label>{t('food.merchant.cuisineTags')}</label>
                  <input value={profileForm.cuisine} onChange={(e) => setProfileForm((f) => ({ ...f, cuisine: e.target.value }))} />
                </div>
              </div>
            )}

            {step === 'location' && (
              <div className="fd-field-grid">
                <div className="fd-field">
                  <label>{t('food.merchant.city')}</label>
                  <input value={locationForm.city} onChange={(e) => setLocationForm((f) => ({ ...f, city: e.target.value }))} />
                </div>
                <div className="fd-field">
                  <label>{t('food.merchant.latitude', 'Latitude')}</label>
                  <input value={locationForm.latitude} onChange={(e) => setLocationForm((f) => ({ ...f, latitude: e.target.value }))} />
                </div>
                <div className="fd-field">
                  <label>{t('food.merchant.longitude', 'Longitude')}</label>
                  <input value={locationForm.longitude} onChange={(e) => setLocationForm((f) => ({ ...f, longitude: e.target.value }))} />
                </div>
              </div>
            )}

            {step === 'hours' && (
              <div className="fd-field-grid">
                <div className="fd-field">
                  <label>{t('food.onboarding.opens', 'Opens')}</label>
                  <input value={hoursForm.open} onChange={(e) => setHoursForm((f) => ({ ...f, open: e.target.value }))} />
                </div>
                <div className="fd-field">
                  <label>{t('food.onboarding.closes', 'Closes')}</label>
                  <input value={hoursForm.close} onChange={(e) => setHoursForm((f) => ({ ...f, close: e.target.value }))} />
                </div>
              </div>
            )}

            {step === 'menu' && (
              <div className="fd-field-grid">
                {(progress?.menuItemCount || 0) > 0 && (
                  <p className="fd-pay-note">{t('food.onboarding.menuExists', '{{count}} item(s) already on menu', { count: progress.menuItemCount })}</p>
                )}
                <div className="fd-field">
                  <label>{t('food.merchant.itemName', 'Item name')}</label>
                  <input value={menuForm.name} onChange={(e) => setMenuForm((f) => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="fd-field">
                  <label>{t('food.merchant.price', 'Price')}</label>
                  <input value={menuForm.price} onChange={(e) => setMenuForm((f) => ({ ...f, price: e.target.value }))} placeholder="8.99" />
                </div>
              </div>
            )}

            {step === 'publish' && (
              <div className={`fd-open-sign${progress?.readyToPublish ? ' fd-open-sign--live' : ''}`}>
                {progress?.readyToPublish ? 'OPEN' : 'CLOSED'}
              </div>
            )}

            {step === 'devices' && restaurant && (
              <DeviceSetupChecklist
                restaurant={restaurant}
                t={t}
                onComplete={() => setStep('done')}
              />
            )}
          </div>
        </div>

        <footer className="fd-onboarding-footer">
          {stepIndex > 0 && step !== 'done' && (
            <button type="button" className="fd-btn fd-btn-secondary" onClick={() => setStep(STEPS[Math.max(0, stepIndex - 1)])} disabled={working}>
              {t('food.common.back', 'Back')}
            </button>
          )}
          {step !== 'devices' && step !== 'done' && (
            <button type="button" className="fd-btn fd-btn-primary" onClick={handlePrimary} disabled={working}>
              {primaryLabel(step, t, restaurant)}
            </button>
          )}
          {step === 'devices' && isDeviceSetupComplete(restaurant?.id) && (
            <button type="button" className="fd-btn fd-btn-primary" onClick={() => setStep('done')}>
              {t('food.common.continue', 'Continue')}
            </button>
          )}
          {step === 'done' && (
            <button type="button" className="fd-btn fd-btn-primary" onClick={onClose}>
              {t('food.onboarding.finish', 'Enter Manager')}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function primaryLabel(step, t, restaurant) {
  if (step === 'welcome') return t('food.onboarding.begin', 'Begin opening night');
  if (step === 'create') return t('food.merchant.createRestaurant', 'Create restaurant');
  if (step === 'publish') return restaurant?.status === 'active' ? t('food.common.continue', 'Continue') : t('food.merchant.goLive', 'Go live');
  return t('food.onboarding.saveContinue', 'Save & continue');
}

export function shouldShowMerchantOnboarding(restaurants, selected) {
  if (!restaurants.length) return true;
  if (!selected) return true;
  if (selected.status !== 'active') return true;
  return !isDeviceSetupComplete(selected.id);
}
