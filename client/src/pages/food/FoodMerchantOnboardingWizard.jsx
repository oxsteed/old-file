// Full-screen owner onboarding wizard (web) — mirrors Manager iOS flow.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

  const loadProgress = useCallback(() => {
    if (!restaurant?.id || restaurant.status === 'active') {
      setProgress(null);
      return Promise.resolve();
    }
    return getFoodSetupProgress(restaurant.id)
      .then(setProgress)
      .catch(() => setProgress(null));
  }, [restaurant?.id, restaurant?.status]);

  useEffect(() => {
    loadProgress();
  }, [loadProgress]);

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

  const stepIndex = STEPS.indexOf(step);
  const stepTitle = useMemo(() => ({
    welcome: t('food.onboarding.welcome', 'Welcome'),
    create: t('food.onboarding.create', 'Your restaurant'),
    profile: t('food.onboarding.profile', 'Profile'),
    location: t('food.onboarding.location', 'Location'),
    hours: t('food.onboarding.hours', 'Hours'),
    menu: t('food.onboarding.menu', 'Menu'),
    publish: t('food.onboarding.publish', 'Go live'),
    devices: t('food.onboarding.devices', 'Floor devices'),
    done: t('food.onboarding.done', 'Ready'),
  }[step]), [step, t]);

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
    <div className="fd-onboarding-overlay" role="dialog" aria-modal="true" aria-labelledby="fd-onboarding-title">
      <div className="fd-onboarding-panel">
        <header className="fd-onboarding-header">
          <div>
            <p className="fd-card-meta">{t('food.onboarding.title', 'Restaurant setup')}</p>
            <h2 id="fd-onboarding-title">{stepTitle}</h2>
            {restaurant && <p className="fd-card-meta">{restaurant.display_name}</p>}
          </div>
          <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={onClose}>
            {t('food.onboarding.later', 'Later')}
          </button>
        </header>

        <div className="fd-onboarding-body">
          {step === 'welcome' && (
            <p>{t('food.onboarding.welcomeBody', 'Set up your menu, go live, then connect Kiosk and Kitchen tablets so guests can order and cooks see tickets.')}</p>
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
            <div>
              {progress?.readyToPublish || restaurant?.status === 'active' ? (
                <p>{t('food.onboarding.publishReady', 'Everything is ready. Going live makes your restaurant visible to customers.')}</p>
              ) : (
                <p className="fd-pay-note">{STEP_HINT(progress?.nextStepId, t)}</p>
              )}
            </div>
          )}

          {step === 'devices' && restaurant && (
            <DeviceSetupChecklist
              restaurant={restaurant}
              t={t}
              onComplete={() => setStep('done')}
            />
          )}

          {step === 'done' && (
            <p>{t('food.onboarding.doneBody', 'Your restaurant floor is configured. Guests can order, kitchen sees tickets, and the queue board shows progress.')}</p>
          )}
        </div>

        <footer className="fd-onboarding-footer">
          {stepIndex > 0 && step !== 'done' && (
            <button type="button" className="fd-btn fd-btn-secondary" onClick={() => setStep(STEPS[Math.max(0, stepIndex - 1)])} disabled={working}>
              {t('food.common.back', 'Back')}
            </button>
          )}
          {step !== 'devices' && (
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
              {t('food.onboarding.finish', 'Done')}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function STEP_HINT(nextStepId, t) {
  const hints = {
    profile: t('food.merchant.setupWizardProfile', 'Add description and cuisine tags.'),
    location: t('food.merchant.setupWizardLocation', 'Set city and coordinates.'),
    hours: t('food.merchant.setupWizardHours', 'Set operating hours.'),
    menu: t('food.merchant.setupWizardMenu', 'Add at least one menu item.'),
  };
  return hints[nextStepId] || t('food.merchant.setupIncomplete', 'Complete remaining steps.');
}

function primaryLabel(step, t, restaurant) {
  if (step === 'welcome') return t('food.onboarding.getStarted', 'Get started');
  if (step === 'create') return t('food.merchant.createRestaurant', 'Create restaurant');
  if (step === 'publish') return restaurant?.status === 'active' ? t('food.common.continue', 'Continue') : t('food.merchant.goLive', 'Go live');
  if (step === 'done') return t('food.onboarding.finish', 'Done');
  return t('food.onboarding.saveContinue', 'Save & continue');
}

export function shouldShowMerchantOnboarding(restaurants, selected) {
  if (!restaurants.length) return true;
  if (!selected) return true;
  if (selected.status !== 'active') return true;
  return !isDeviceSetupComplete(selected.id);
}
