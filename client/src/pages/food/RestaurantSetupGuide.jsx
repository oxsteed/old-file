import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  createFoodLocation,
  createFoodMenuItem,
  getFoodSetupProgress,
  updateFoodRestaurant,
} from '../../api/food';
import { uploadBusinessPhotos } from '../../api/businesses';
import { apiErrorMessage } from './foodShared';
import { defaultWeekdayHours } from './FoodSetupWizard';
import CountrySelect from '../../components/CountrySelect';
import { getDefaultCurrency } from '../../lib/countries';
import AddressAutocomplete from '../../components/AddressAutocomplete';

const STEPS = ['profile', 'ordering', 'menu', 'review'];

const CURRENCIES = [
  'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'HTG', 'DOP', 'BRL', 'MXN',
  'ARS', 'CLP', 'COP', 'CRC', 'PAB', 'PEN', 'INR', 'JPY', 'KRW', 'HKD',
  'SGD', 'MYR', 'THB', 'IDR', 'PHP', 'VND', 'SEK', 'DKK', 'CHF', 'PLN',
  'CZK', 'HUF', 'RON', 'TRY', 'ILS', 'SAR', 'EGP', 'RWF', 'GHS', 'NGN',
  'ZAR', 'KES',
];

export default function RestaurantSetupGuide({ t, restaurants, selected, onClose, onRefresh, onSelectRestaurant }) {
  const [step, setStep] = useState('profile');
  const [restaurant, setRestaurant] = useState(selected || null);
  const [progress, setProgress] = useState(null);
  const [working, setWorking] = useState(false);
  const [uploading, setUploading] = useState('');
  const [pendingBrandFiles, setPendingBrandFiles] = useState({ logoUrl: null, coverPhotoUrl: null });
  const [profile, setProfile] = useState({ name: '', description: '', cuisine: '', phone: '', logoUrl: '', coverPhotoUrl: '' });
  const [ordering, setOrdering] = useState({ street: '', city: '', region: '', postal: '', country: 'US', latitude: '', longitude: '', currency: 'USD', open: '11:00', close: '22:00', pickup: true, delivery: false, dineIn: false });
  const [menuItem, setMenuItem] = useState({ name: '', price: '', description: '' });

  useEffect(() => {
    setRestaurant(selected || null);
    if (!selected) return;
    setProfile({
      name: selected.display_name || '',
      description: selected.description || '',
      cuisine: (selected.cuisine_tags || []).join(', '),
      phone: selected.phone || '',
      logoUrl: selected.logo_url || '',
      coverPhotoUrl: selected.cover_photo_url || '',
    });
    const modes = selected.fulfillment_modes || ['pickup'];
    setOrdering((current) => ({
      ...current,
      street: selected.address_street || '',
      city: selected.address_city || '',
      region: selected.address_state || '',
      postal: selected.address_zip || '',
      country: selected.address_country || 'US',
      latitude: selected.latitude ?? selected.address_lat ?? '',
      longitude: selected.longitude ?? selected.address_lng ?? '',
      currency: selected.currency_code || 'USD',
      pickup: modes.includes('pickup'),
      delivery: modes.includes('delivery'),
      dineIn: modes.includes('dine_in'),
    }));
  }, [selected]);

  const loadProgress = useCallback(async (restaurantId = restaurant?.id) => {
    if (!restaurantId) return null;
    try {
      const next = await getFoodSetupProgress(restaurantId);
      setProgress(next);
      return next;
    } catch (_) {
      return null;
    }
  }, [restaurant?.id]);

  useEffect(() => { loadProgress(); }, [loadProgress]);

  const syncBrandFiles = async (targetRestaurant, logoFile, coverFile) => {
    const businessId = targetRestaurant?.business_id || targetRestaurant?.businessId;
    if (!businessId) {
      throw new Error(t('food.setup.businessLinkMissing', 'The restaurant is not linked to a business yet. Save the restaurant and try again.'));
    }

    const result = await uploadBusinessPhotos(businessId, logoFile, coverFile);
    const logoUrl = result?.logo_url || result?.business?.logo_url;
    const coverPhotoUrl = result?.cover_photo_url || result?.business?.cover_photo_url;
    const updates = {};
    if (logoFile && logoUrl) updates.logoUrl = logoUrl;
    if (coverFile && coverPhotoUrl) updates.coverPhotoUrl = coverPhotoUrl;

    if ((logoFile && !logoUrl) || (coverFile && !coverPhotoUrl)) {
      throw new Error(t('food.setup.uploadMissingUrl', 'The image was stored, but the server did not return its public URL.'));
    }

    const updated = Object.keys(updates).length
      ? await updateFoodRestaurant(targetRestaurant.id, updates)
      : targetRestaurant;

    setProfile((current) => ({
      ...current,
      ...(logoUrl ? { logoUrl } : {}),
      ...(coverPhotoUrl ? { coverPhotoUrl } : {}),
    }));
    setRestaurant(updated);
    onRefresh(updated);
    return updated;
  };

  const upload = async (event, field) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const supportedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
    if (!supportedTypes.has(String(file.type || '').toLowerCase())) {
      toast.error(t('food.setup.imageFormatError', 'Choose a JPG, PNG, WebP, or GIF image.'));
      event.target.value = '';
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error(t('food.setup.imageSizeError', 'Choose an image smaller than 10 MB.'));
      event.target.value = '';
      return;
    }

    const businessId = restaurant?.business_id || restaurant?.businessId;
    if (!restaurant?.id || !businessId) {
      const previewUrl = URL.createObjectURL(file);
      setPendingBrandFiles((current) => {
        const previous = current[field]?.previewUrl;
        if (previous) URL.revokeObjectURL(previous);
        return { ...current, [field]: { file, previewUrl } };
      });
      setProfile((current) => ({ ...current, [field]: previewUrl }));
      return;
    }

    setUploading(field);
    try {
      await syncBrandFiles(
        restaurant,
        field === 'logoUrl' ? file : null,
        field === 'coverPhotoUrl' ? file : null
      );
    } catch (error) {
      toast.error(apiErrorMessage(error, t('food.setup.uploadError', 'Could not upload that image')));
    } finally {
      setUploading('');
    }
  };

  const saveStep = async () => {
    setWorking(true);
    try {
      if (step === 'profile') {
        if (!profile.name.trim()) {
          toast.error(t('food.merchant.nameRequired', 'Restaurant name is required'));
          return;
        }
        const payload = {
          displayName: profile.name.trim(),
          description: profile.description.trim() || undefined,
          cuisineTags: profile.cuisine.split(',').map((value) => value.trim()).filter(Boolean),
          phone: profile.phone.trim() || undefined,
          logoUrl: profile.logoUrl && !profile.logoUrl.startsWith('blob:') ? profile.logoUrl : undefined,
          coverPhotoUrl: profile.coverPhotoUrl && !profile.coverPhotoUrl.startsWith('blob:') ? profile.coverPhotoUrl : undefined,
        };
        if (!restaurant?.id) {
          throw new Error(t('food.setup.businessLinkMissing', 'Create the restaurant business before opening its setup guide.'));
        }
        let saved = await updateFoodRestaurant(restaurant.id, payload);
        setRestaurant(saved);
        onSelectRestaurant(saved.id);
        onRefresh(saved);

        const pendingLogo = pendingBrandFiles.logoUrl?.file || null;
        const pendingCover = pendingBrandFiles.coverPhotoUrl?.file || null;
        if (pendingLogo || pendingCover) {
          setUploading(pendingLogo && pendingCover ? 'brand' : pendingLogo ? 'logoUrl' : 'coverPhotoUrl');
          try {
            saved = await syncBrandFiles(saved, pendingLogo, pendingCover);
            Object.values(pendingBrandFiles).forEach((entry) => {
              if (entry?.previewUrl) URL.revokeObjectURL(entry.previewUrl);
            });
            setPendingBrandFiles({ logoUrl: null, coverPhotoUrl: null });
          } finally {
            setUploading('');
          }
        }

        await loadProgress(saved.id);
        setStep('ordering');
        return;
      }

      if (step === 'ordering') {
        const fulfillmentModes = [ordering.pickup && 'pickup', ordering.delivery && 'delivery', ordering.dineIn && 'dine_in'].filter(Boolean);
        if (!ordering.city.trim()) {
          toast.error(t('food.setup.cityRequired', 'Add the city where customers will find this restaurant.'));
          return;
        }
        if (!fulfillmentModes.length) {
          toast.error(t('food.setup.fulfillmentRequired', 'Choose at least one ordering option.'));
          return;
        }
        const saved = await updateFoodRestaurant(restaurant.id, {
          addressStreet: ordering.street.trim() || undefined,
          addressCity: ordering.city.trim(),
          addressState: ordering.region.trim() || undefined,
          addressZip: ordering.postal.trim() || undefined,
          addressCountry: ordering.country.trim() || 'US',
          latitude: ordering.latitude !== '' ? Number(ordering.latitude) : undefined,
          longitude: ordering.longitude !== '' ? Number(ordering.longitude) : undefined,
          currencyCode: ordering.currency,
          fulfillmentModes,
          operatingHours: defaultWeekdayHours(ordering.open, ordering.close),
          acceptsOnlineOrders: true,
          acceptsInStoreOrders: true,
        });
        const currentProgress = await loadProgress(restaurant.id);
        if (!currentProgress?.locationCount) {
          await createFoodLocation(restaurant.id, {
            name: t('food.setup.primaryLocation', 'Primary location'),
            addressStreet: ordering.street.trim() || undefined,
            addressCity: ordering.city.trim(),
            addressState: ordering.region.trim() || undefined,
            addressZip: ordering.postal.trim() || undefined,
            addressCountry: ordering.country.trim() || 'US',
            latitude: ordering.latitude !== '' ? Number(ordering.latitude) : undefined,
            longitude: ordering.longitude !== '' ? Number(ordering.longitude) : undefined,
            isPrimary: true,
            operatingHours: defaultWeekdayHours(ordering.open, ordering.close),
          });
        }
        setRestaurant(saved);
        onRefresh(saved);
        await loadProgress(restaurant.id);
        setStep('menu');
        return;
      }

      if (step === 'menu') {
        if (!(progress?.menuItemCount > 0) || menuItem.name.trim()) {
          const priceCents = Math.round(Number(menuItem.price) * 100);
          if (!menuItem.name.trim() || !Number.isFinite(priceCents) || priceCents < 0) {
            toast.error(t('food.merchant.menuPriceError', 'Enter a valid item name and price'));
            return;
          }
          await createFoodMenuItem(restaurant.id, {
            name: menuItem.name.trim(),
            priceCents,
            description: menuItem.description.trim() || undefined,
            publicationStatus: 'published',
          });
          setMenuItem({ name: '', price: '', description: '' });
        }
        await loadProgress(restaurant.id);
        setStep('review');
        return;
      }

      if (step === 'review') {
        const latest = await loadProgress(restaurant.id);
        if (!latest?.readyToPublish && restaurant.status !== 'active') {
          toast.error(t('food.merchant.setupIncomplete', 'Complete the missing setup items before going live.'));
          return;
        }
        if (restaurant.status !== 'active') {
          const saved = await updateFoodRestaurant(restaurant.id, { status: 'active' });
          setRestaurant(saved);
          onRefresh(saved);
          toast.success(t('food.merchant.nowLive', 'Your restaurant is live'));
        }
        onClose();
      }
    } catch (error) {
      toast.error(apiErrorMessage(error, t('food.common.error', 'Something went wrong')));
    } finally {
      setWorking(false);
    }
  };

  const stepIndex = STEPS.indexOf(step);
  const readiness = progress?.steps || [];

  return (
    <div className="fd-owner-setup-overlay" role="dialog" aria-modal="true" aria-labelledby="restaurant-setup-title">
      <div className="fd-owner-setup">
        <header className="fd-owner-setup-header">
          <div>
            <p>{t('food.setup.kicker', 'Restaurant setup')}</p>
            <h2 id="restaurant-setup-title">{setupTitle(step, t)}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={t('food.common.close', 'Close')}>×</button>
        </header>

        <nav className="fd-owner-setup-progress" aria-label={t('food.setup.progress', 'Setup progress')}>
          {STEPS.map((entry, index) => (
            <button key={entry} type="button" className={index === stepIndex ? 'fd-active' : index < stepIndex ? 'fd-complete' : ''} onClick={() => { if (restaurant || index === 0) setStep(entry); }} disabled={!restaurant && index > 0}>
              <span>{index < stepIndex ? '✓' : index + 1}</span>
              {setupShortTitle(entry, t)}
            </button>
          ))}
        </nav>

        <div className="fd-owner-setup-body">
          {step === 'profile' && (
            <div className="fd-owner-setup-section">
              <p className="fd-owner-setup-intro">{t('food.setup.profileIntro', 'Start with what customers need to recognize and trust your restaurant.')}</p>
              <div className="fd-field"><label htmlFor="setup-name">{t('food.merchant.name', 'Restaurant name')} *</label><input id="setup-name" value={profile.name} onChange={(event) => setProfile((current) => ({ ...current, name: event.target.value }))} maxLength={160} autoFocus /></div>
              <div className="fd-field"><label htmlFor="setup-description">{t('food.merchant.description', 'Description')}</label><textarea id="setup-description" value={profile.description} onChange={(event) => setProfile((current) => ({ ...current, description: event.target.value }))} rows={3} maxLength={2000} placeholder={t('food.setup.descriptionPlaceholder', 'Tell customers what you serve and what makes your restaurant special.')} /></div>
              <div className="fd-owner-setup-grid"><div className="fd-field"><label htmlFor="setup-cuisine">{t('food.merchant.cuisineTags', 'Cuisine')}</label><input id="setup-cuisine" value={profile.cuisine} onChange={(event) => setProfile((current) => ({ ...current, cuisine: event.target.value }))} placeholder="Caribbean, Creole" /></div><div className="fd-field"><label htmlFor="setup-phone">{t('food.merchant.phone', 'Phone')}</label><input id="setup-phone" type="tel" value={profile.phone} onChange={(event) => setProfile((current) => ({ ...current, phone: event.target.value }))} /></div></div>
              <div className="fd-owner-brand-upload"><ImageUpload t={t} label={t('food.setup.logo', 'Logo')} value={profile.logoUrl} busy={uploading === 'logoUrl' || uploading === 'brand'} onChange={(event) => upload(event, 'logoUrl')} /><ImageUpload t={t} label={t('food.setup.cover', 'Cover photo')} value={profile.coverPhotoUrl} busy={uploading === 'coverPhotoUrl' || uploading === 'brand'} wide onChange={(event) => upload(event, 'coverPhotoUrl')} /></div>
            </div>
          )}

          {step === 'ordering' && (
            <div className="fd-owner-setup-section">
              <p className="fd-owner-setup-intro">{t('food.setup.orderingIntro', 'Tell customers where, when, and how they can order.')}</p>
              <div className="fd-field"><label htmlFor="setup-street">{t('food.merchant.street', 'Street address')}</label><AddressAutocomplete id="setup-street" value={ordering.street} onChange={(value) => setOrdering((current) => ({ ...current, street: value, latitude: '', longitude: '' }))} onSelect={(place) => setOrdering((current) => ({ ...current, street: place.addressLine1 || place.display, city: place.city || current.city, region: place.state || current.region, postal: place.zip || current.postal, country: place.country || current.country, latitude: place.lat ?? current.latitude, longitude: place.lng ?? current.longitude }))} autoComplete="street-address" ariaLabel={t('food.merchant.street', 'Street address')} /></div>
              <div className="fd-owner-setup-grid"><div className="fd-field"><label htmlFor="setup-city">{t('food.merchant.city', 'City')} *</label><input id="setup-city" value={ordering.city} onChange={(event) => setOrdering((current) => ({ ...current, city: event.target.value }))} /></div><div className="fd-field"><label htmlFor="setup-region">{t('food.merchant.state', 'State / region')}</label><input id="setup-region" value={ordering.region} onChange={(event) => setOrdering((current) => ({ ...current, region: event.target.value }))} /></div><div className="fd-field"><label htmlFor="setup-postal">{t('food.merchant.zip', 'Postal code')}</label><input id="setup-postal" value={ordering.postal} onChange={(event) => setOrdering((current) => ({ ...current, postal: event.target.value }))} /></div></div>
              <div className="fd-owner-setup-grid"><div className="fd-field"><label htmlFor="setup-country">{t('food.merchant.country', 'Country')}</label><CountrySelect id="setup-country" value={ordering.country} includeBlank={false} onChange={(country) => setOrdering((current) => ({ ...current, country, currency: getDefaultCurrency(country) }))} /></div><div className="fd-field"><label htmlFor="setup-currency">{t('food.merchant.currency', 'Currency')}</label><select id="setup-currency" value={ordering.currency} onChange={(event) => setOrdering((current) => ({ ...current, currency: event.target.value }))}>{CURRENCIES.map((currency) => <option key={currency}>{currency}</option>)}</select></div></div>
              <fieldset className="fd-owner-choice-group"><legend>{t('food.setup.orderTypes', 'Ordering options')}</legend><label><input type="checkbox" checked={ordering.pickup} onChange={(event) => setOrdering((current) => ({ ...current, pickup: event.target.checked }))} /><span><strong>{t('food.setup.pickup', 'Pickup')}</strong><small>{t('food.setup.pickupHint', 'Customers collect orders at the restaurant.')}</small></span></label><label><input type="checkbox" checked={ordering.delivery} onChange={(event) => setOrdering((current) => ({ ...current, delivery: event.target.checked }))} /><span><strong>{t('food.setup.delivery', 'Delivery')}</strong><small>{t('food.setup.deliveryHint', 'Restaurant-managed delivery orders.')}</small></span></label><label><input type="checkbox" checked={ordering.dineIn} onChange={(event) => setOrdering((current) => ({ ...current, dineIn: event.target.checked }))} /><span><strong>{t('food.setup.dineIn', 'Dine in')}</strong><small>{t('food.setup.dineInHint', 'Orders are served at the restaurant.')}</small></span></label></fieldset>
              <div className="fd-owner-hours"><div><strong>{t('food.setup.defaultHours', 'Default weekly hours')}</strong><small>{t('food.setup.hoursHint', 'These hours apply to every day. You can customize individual days later.')}</small></div><label>{t('food.onboarding.opens', 'Opens')}<input type="time" value={ordering.open} onChange={(event) => setOrdering((current) => ({ ...current, open: event.target.value }))} /></label><label>{t('food.onboarding.closes', 'Closes')}<input type="time" value={ordering.close} onChange={(event) => setOrdering((current) => ({ ...current, close: event.target.value }))} /></label></div>
            </div>
          )}

          {step === 'menu' && (
            <div className="fd-owner-setup-section">
              <p className="fd-owner-setup-intro">{progress?.menuItemCount > 0 ? t('food.setup.menuExists', 'Your menu already has {{count}} items. Add another or continue to review.', { count: progress.menuItemCount }) : t('food.setup.menuIntro', 'Add one real item now. You can organize the full menu from the Menu workspace.')}</p>
              <div className="fd-field"><label htmlFor="setup-item-name">{t('food.merchant.itemName', 'Item name')}{progress?.menuItemCount ? '' : ' *'}</label><input id="setup-item-name" value={menuItem.name} onChange={(event) => setMenuItem((current) => ({ ...current, name: event.target.value }))} placeholder={t('food.setup.itemPlaceholder', 'Jerk chicken plate')} /></div>
              <div className="fd-owner-setup-grid"><div className="fd-field"><label htmlFor="setup-item-price">{t('food.merchant.itemPrice', 'Price')} ({restaurant?.currency_code || ordering.currency})</label><input id="setup-item-price" type="number" step="0.01" min="0" value={menuItem.price} onChange={(event) => setMenuItem((current) => ({ ...current, price: event.target.value }))} /></div><div className="fd-field fd-owner-setup-grid-wide"><label htmlFor="setup-item-description">{t('food.merchant.itemDescription', 'Description')}</label><input id="setup-item-description" value={menuItem.description} onChange={(event) => setMenuItem((current) => ({ ...current, description: event.target.value }))} /></div></div>
            </div>
          )}

          {step === 'review' && (
            <div className="fd-owner-review">
              <div className="fd-owner-review-hero"><span aria-hidden>{progress?.readyToPublish || restaurant?.status === 'active' ? '✓' : '!'}</span><div><h3>{progress?.readyToPublish || restaurant?.status === 'active' ? t('food.setup.readyTitle', 'Ready for customers') : t('food.setup.missingTitle', 'A few details still need attention')}</h3><p>{t('food.setup.reviewHint', 'Review the checklist, preview the customer page, and go live when everything looks right.')}</p></div></div>
              <ul>{readiness.map((item) => <li key={item.id} className={item.complete ? 'fd-complete' : ''}><span>{item.complete ? '✓' : '○'}</span><strong>{item.title}</strong>{!item.complete && <button type="button" onClick={() => setStep(item.id === 'menu' ? 'menu' : item.id === 'profile' ? 'profile' : 'ordering')}>{t('food.setup.fix', 'Fix')}</button>}</li>)}</ul>
              {restaurant && <a className="fd-btn fd-btn-secondary" href={`/restaurants/r/${restaurant.id}`} target="_blank" rel="noreferrer">{t('food.menuManager.preview', 'Preview customer menu')}</a>}
            </div>
          )}
        </div>

        <footer className="fd-owner-setup-footer">
          <button type="button" className="fd-btn fd-btn-secondary" onClick={() => stepIndex > 0 ? setStep(STEPS[stepIndex - 1]) : onClose()}>{stepIndex > 0 ? t('food.common.back', 'Back') : t('food.setup.finishLater', 'Finish later')}</button>
          <button type="button" className="fd-btn" onClick={saveStep} disabled={working || uploading}>{working ? t('food.common.saving', 'Saving…') : step === 'review' ? (restaurant?.status === 'active' ? t('food.setup.done', 'Done') : t('food.merchant.goLive', 'Go live')) : t('food.onboarding.saveContinue', 'Save & continue')}</button>
        </footer>
      </div>
    </div>
  );
}

function ImageUpload({ t, label, value, busy, wide, onChange }) {
  return <label className={`fd-owner-image-upload${wide ? ' fd-owner-image-upload--wide' : ''}`}><span>{label}</span><div>{value ? <img src={value} alt="" /> : <strong aria-hidden>{wide ? '▧' : '◎'}</strong>}</div><em>{busy ? t('food.common.saving', 'Uploading…') : t('food.setup.chooseImage', 'Choose image')}</em><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden disabled={busy} onChange={onChange} /></label>;
}

function setupTitle(step, t) {
  if (step === 'profile') return t('food.setup.profileTitle', 'Introduce your restaurant');
  if (step === 'ordering') return t('food.setup.orderingTitle', 'Set ordering details');
  if (step === 'menu') return t('food.setup.menuTitle', 'Start your menu');
  return t('food.setup.reviewTitle', 'Review and open');
}

function setupShortTitle(step, t) {
  if (step === 'profile') return t('food.setup.shortProfile', 'Restaurant');
  if (step === 'ordering') return t('food.setup.shortOrdering', 'Orders');
  if (step === 'menu') return t('food.setup.shortMenu', 'Menu');
  return t('food.setup.shortReview', 'Launch');
}

export function shouldShowRestaurantSetup(restaurants, selected) {
  if (!restaurants.length || !selected) return true;
  return selected.status !== 'active';
}
