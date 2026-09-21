import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import toast from 'react-hot-toast';
import CountrySelect from '../CountrySelect';
import RegionInput from '../RegionInput';
import PostalCodeInput from '../PostalCodeInput';
import { getCountryName, getDialCode, getPostalLabel, getRegionLabel } from '../../lib/countries';
import {
  getBusinessOnboarding,
  listBusinessHours,
} from '../../api/businesses';
import {
  DESCRIPTION_MAX,
  HEADLINE_MAX,
  buildProfileChecks,
  displayToMiles,
  displayWebsite,
  formatPreviewPlace,
  hoursAreSet,
  isListedBusiness,
  milesToDisplay,
  normalizeWebsite,
  serializeProfileState,
  usesMiles,
} from '../../utils/businessProfileEditor';
import '../../styles/BusinessProfileEditor.css';

const BIZ_TYPES = [
  { value: 'Handyman', labelKey: 'bizTypeHandyman' },
  { value: 'Plumbing', labelKey: 'bizTypePlumbing' },
  { value: 'Electrical', labelKey: 'bizTypeElectrical' },
  { value: 'HVAC', labelKey: 'bizTypeHVAC' },
  { value: 'Landscaping', labelKey: 'bizTypeLandscaping' },
  { value: 'Cleaning', labelKey: 'bizTypeCleaning' },
  { value: 'Painting', labelKey: 'bizTypePainting' },
  { value: 'Carpentry', labelKey: 'bizTypeCarpentry' },
  { value: 'Roofing', labelKey: 'bizTypeRoofing' },
  { value: 'Flooring', labelKey: 'bizTypeFlooring' },
  { value: 'Moving', labelKey: 'bizTypeMoving' },
  { value: 'Pest Control', labelKey: 'bizTypePestControl' },
  { value: 'Pool Service', labelKey: 'bizTypePoolService' },
  { value: 'Auto Repair', labelKey: 'bizTypeAutoRepair' },
  { value: 'General Labor', labelKey: 'bizTypeGeneralLabor' },
  { value: 'Other', labelKey: 'bizTypeOther' },
];

const CHECK_I18N = {
  name: 'checkName',
  category: 'checkCategory',
  location: 'checkLocation',
  description: 'checkDescription',
  service: 'checkService',
  restaurant_profile: 'checkRestaurant',
  menu: 'checkMenu',
  photo: 'checkPhoto',
  contact: 'checkContact',
  hours: 'checkHours',
};

function PhotoDrop({
  inputId,
  preview,
  alt,
  variant,
  emptyLabel,
  changeLabel,
  uploadLabel,
  removeLabel,
  onFile,
  onRemove,
}) {
  const [over, setOver] = useState(false);

  function takeFiles(files) {
    const file = files?.[0];
    if (!file || !String(file.type || '').startsWith('image/')) return;
    onFile(file);
  }

  function openPicker() {
    document.getElementById(inputId)?.click();
  }

  return (
    <div className={`bpe-photo ${variant}`}>
      <div
        className={`bpe-drop ${variant}${over ? ' over' : ''}${preview ? ' has' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); takeFiles(e.dataTransfer.files); }}
        onClick={openPicker}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openPicker();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={emptyLabel}
      >
        {preview ? (
          <img src={preview} alt={alt} />
        ) : (
          <div className="bpe-drop-empty">{emptyLabel}</div>
        )}
        {preview && (
          <button
            type="button"
            className="bpe-photo-remove"
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
          >
            {removeLabel}
          </button>
        )}
        <div className="bpe-photo-overlay">
          <label htmlFor={inputId} onClick={(e) => e.stopPropagation()}>
            {preview ? changeLabel : uploadLabel}
          </label>
        </div>
      </div>
      <input
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        hidden
        onChange={(e) => {
          takeFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

function CheckList({ items, t, onJump }) {
  const rows = Array.isArray(items) ? items : [];
  return (
    <ul className="bpe-check-list">
      {rows.map((item) => {
        const label = t(`businessHub.profileEditor.${CHECK_I18N[item.id] || item.id}`);
        const jumpLabel = item.tab === 'services'
          ? t('businessHub.profileEditor.jumpService')
          : item.tab === 'calendar'
            ? t('businessHub.profileEditor.jumpHours')
            : item.tab === 'restaurant'
              ? t('businessHub.profileEditor.jumpRestaurant')
              : null;
        if (!item.done && item.tab && jumpLabel) {
          return (
            <li key={item.id}>
              <button type="button" className="bpe-jump" onClick={() => onJump(item.tab)}>
                <span className="bpe-dot" aria-hidden="true" />
                <span>{jumpLabel}</span>
              </button>
            </li>
          );
        }
        return (
          <li key={item.id}>
            <span className={`bpe-dot${item.done ? ' on' : ''}`} aria-hidden="true" />
            <span>{label}</span>
          </li>
        );
      })}
    </ul>
  );
}

export default function BusinessProfileEditor({
  form,
  logoPreview,
  coverPreview,
  saving,
  err,
  currentRole,
  currentBiz,
  onChange,
  onLogoChange,
  onCoverChange,
  onSave,
  onPublish,
  publishing,
  onJumpTab,
  bizId,
  restaurantSetupHref,
}) {
  const { t } = useTranslation();
  const country = form?.address_country || 'US';
  const listed = isListedBusiness(currentBiz);
  const isRestaurant = currentBiz?.business_kind === 'restaurant'
    || (!currentBiz?.business_kind && currentBiz?.business_mode === 'food');
  const baselineRef = useRef('');
  const [radiusDisplay, setRadiusDisplay] = useState(() => milesToDisplay(form?.service_radius_miles, country));
  const [copied, setCopied] = useState(false);
  const [serviceCount, setServiceCount] = useState(0);
  const [menuCount, setMenuCount] = useState(0);
  const [restaurantReady, setRestaurantReady] = useState(false);
  const [hoursReady, setHoursReady] = useState(false);

  const dirty = form
    ? serializeProfileState(form, logoPreview, coverPreview) !== baselineRef.current
    : false;

  useEffect(() => {
    if (!form || saving) return;
    baselineRef.current = serializeProfileState(form, logoPreview, coverPreview);
    setRadiusDisplay(milesToDisplay(form.service_radius_miles, form.address_country || 'US'));
  }, [bizId, saving]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setRadiusDisplay(milesToDisplay(form?.service_radius_miles, country));
  }, [country]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!bizId) return undefined;
    let cancelled = false;
    (async () => {
      const [onboarding, hoursRows] = await Promise.all([
        getBusinessOnboarding(bizId).catch(() => null),
        listBusinessHours(bizId).catch(() => []),
      ]);
      if (cancelled) return;
      setServiceCount(Number(onboarding?.business?.service_count || 0));
      setMenuCount(Number(onboarding?.business?.menu_item_count || 0));
      setRestaurantReady(Boolean(onboarding?.business?.restaurant_id));
      setHoursReady(hoursAreSet(hoursRows));
    })();
    return () => { cancelled = true; };
  }, [bizId]);

  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!saving && dirty) onSave();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saving, dirty, onSave]);

  useEffect(() => {
    if (!dirty) return undefined;
    const onBefore = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBefore);
    return () => window.removeEventListener('beforeunload', onBefore);
  }, [dirty]);

  const checks = useMemo(
    () => buildProfileChecks({
      form,
      logoPreview,
      coverPreview,
      serviceCount,
      hoursReady,
      isRestaurant,
      restaurantReady,
      menuCount,
    }),
    [form, logoPreview, coverPreview, serviceCount, hoursReady, isRestaurant, restaurantReady, menuCount],
  );

  const listingDone = checks.listing.filter((row) => row.done).length;
  const listingTotal = checks.listing.length;
  const listingReady = listingDone === listingTotal;
  const mileCountry = usesMiles(country);
  const dial = getDialCode(country);
  const typeLabel = BIZ_TYPES.find((row) => row.value === form?.business_type);
  const place = formatPreviewPlace(form);
  const countryName = getCountryName(country);
  const publicPath = bizId ? `/business/${bizId}` : '';

  const patch = useCallback((name, value) => {
    onChange({ [name]: value });
  }, [onChange]);

  function pf(e) {
    const { name, value } = e.target;
    if (name === 'description') {
      patch(name, String(value || '').slice(0, DESCRIPTION_MAX));
      return;
    }
    if (name === 'profile_headline') {
      patch(name, String(value || '').slice(0, HEADLINE_MAX));
      return;
    }
    patch(name, value);
  }

  function handleRadius(value) {
    setRadiusDisplay(value);
    patch('service_radius_miles', displayToMiles(value, country));
  }

  function handleWebsiteBlur() {
    const next = normalizeWebsite(form?.website);
    if (next !== (form?.website || '')) patch('website', next);
  }

  function handleJump(tab) {
    if (tab === 'restaurant' && restaurantSetupHref) {
      window.location.assign(restaurantSetupHref);
      return;
    }
    if (tab && onJumpTab) onJumpTab(tab);
  }

  async function handlePublishClick() {
    if (!onPublish) return;
    if (dirty) {
      const saved = await onSave();
      if (saved === false) return;
    }
    await onPublish();
  }

  async function copyPublicLink() {
    if (!bizId) return;
    const url = `${window.location.origin}${publicPath}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(t('businessHub.profileEditor.copied'));
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('businessHub.profileEditor.copyFail'));
    }
  }

  if (!form) return null;

  const headline = String(form.profile_headline || '');
  const about = String(form.description || '');
  const websiteShown = displayWebsite(form.website);

  return (
    <div className="bpe">
      <div className="bpe-top">
        <div>
          <p className="bpe-kicker">{t('businessHub.profileEditor.kicker')}</p>
          <h2>{t('businessHub.profileEditor.title')}</h2>
          <p className="bpe-sub">{t('businessHub.profileEditor.subtitle')}</p>
          {currentRole === 'manager' && (
            <p className="bpe-manager">
              <Trans i18nKey="businessHub.managerNote">
                You are editing as a <strong>Manager</strong>. Changes apply to the business owner's public profile.
              </Trans>
            </p>
          )}
        </div>
        <div className="bpe-top-actions">
          <span className={`bpe-status ${listed ? 'live' : 'draft'}`}>
            {listed ? t('businessHub.profileEditor.live') : t('businessHub.profileEditor.draft')}
          </span>
          {bizId && (
            <>
              <button type="button" className="bpe-ghost" onClick={copyPublicLink}>
                {copied ? t('businessHub.profileEditor.copied') : t('businessHub.profileEditor.copyLink')}
              </button>
              <a
                href={publicPath}
                target="_blank"
                rel="noopener noreferrer"
                className="bpe-ghost"
              >
                {t('businessHub.profileEditor.openPage')}
              </a>
            </>
          )}
        </div>
      </div>

      <div className="bpe-stage">
        <article className="bpe-preview" aria-label={t('businessHub.profileEditor.previewLabel')}>
          <div className="bpe-preview-cover">
            <span className="bpe-preview-kicker">{t('businessHub.profileEditor.previewLabel')}</span>
            {coverPreview ? <img src={coverPreview} alt="" /> : null}
          </div>
          <div className="bpe-preview-body">
            <div className="bpe-logo">
              {logoPreview
                ? <img src={logoPreview} alt="" />
                : (form.business_name || '').trim().slice(0, 1).toUpperCase()}
            </div>
            <h3 className={`bpe-preview-name${form.business_name ? '' : ' bpe-muted'}`}>
              {form.business_name || t('businessHub.profileEditor.previewEmptyName')}
            </h3>
            {typeLabel && (
              <span className="bpe-preview-type">{t(`businessHub.${typeLabel.labelKey}`)}</span>
            )}
            <p className={`bpe-preview-tagline${headline ? '' : ' bpe-muted'}`}>
              {headline || t('businessHub.profileEditor.previewEmptyTagline')}
            </p>
            <p className={`bpe-preview-place${place ? '' : ' bpe-muted'}`}>
              {place
                ? [place, countryName].filter(Boolean).join(' · ')
                : t('businessHub.profileEditor.previewEmptyPlace')}
            </p>
            {(form.phone || websiteShown) && (
              <p className="bpe-preview-contact">
                {[form.phone, websiteShown].filter(Boolean).join(' · ')}
              </p>
            )}
            {about && <p className="bpe-preview-about">{about}</p>}
          </div>
        </article>

        <aside className="bpe-checks">
          <div className="bpe-progress" aria-hidden="true">
            <span style={{ width: `${Math.round((listingDone / Math.max(listingTotal, 1)) * 100)}%` }} />
          </div>
          <h3>{t('businessHub.profileEditor.listingTitle')}</h3>
          <p className="bpe-hint">
            {t('businessHub.profileEditor.listingProgress', { done: listingDone, total: listingTotal })}
          </p>
          <CheckList items={checks.listing} t={t} onJump={handleJump} />
          <h3>{t('businessHub.profileEditor.customerTitle')}</h3>
          <CheckList items={checks.customer} t={t} onJump={handleJump} />
        </aside>
      </div>

      <section className="bpe-card bpe-photos-card">
        <div className="bpe-photos-head">
          <h3>{t('businessHub.sectionPhotos')}</h3>
          <p className="bpe-hint">{t('businessHub.profileEditor.dropHint')}</p>
        </div>
        <div className="bpe-photos">
          <PhotoDrop
            inputId="bh-logo-input"
            preview={logoPreview}
            alt={t('businessHub.logoPreviewAlt')}
            variant="square"
            emptyLabel={t('businessHub.businessLogo')}
            changeLabel={t('businessHub.changeLogo')}
            uploadLabel={t('businessHub.uploadLogo')}
            removeLabel={t('businessHub.remove')}
            onFile={onLogoChange}
            onRemove={() => { onLogoChange(null); onChange({ logo_url: '' }); }}
          />
          <PhotoDrop
            inputId="bh-cover-input"
            preview={coverPreview}
            alt={t('businessHub.coverPreviewAlt')}
            variant="wide"
            emptyLabel={t('businessHub.coverPhoto')}
            changeLabel={t('businessHub.changeCover')}
            uploadLabel={t('businessHub.uploadCover')}
            removeLabel={t('businessHub.remove')}
            onFile={onCoverChange}
            onRemove={() => { onCoverChange(null); onChange({ cover_photo_url: '' }); }}
          />
        </div>
      </section>

      <section className="bpe-card">
        <h3>{t('businessHub.sectionBusinessIdentity')}</h3>
        <div>
          <label htmlFor="bh-business-name">{t('businessHub.fieldBusinessNameRequired')}</label>
          <input
            id="bh-business-name"
            className="bpe-field"
            name="business_name"
            value={form.business_name || ''}
            onChange={pf}
            placeholder={t('businessHub.placeholderBizName')}
          />
        </div>
        <div className="bpe-grid-2" style={{ marginTop: '0.9rem' }}>
          <div>
            <label htmlFor="bh-business-type">{t('businessHub.fieldBusinessType')}</label>
            <select
              id="bh-business-type"
              name="business_type"
              value={form.business_type || ''}
              onChange={pf}
            >
              <option value="">{t('businessHub.selectTypePlaceholder')}</option>
              {BIZ_TYPES.map((bt) => (
                <option key={bt.value} value={bt.value}>{t(`businessHub.${bt.labelKey}`)}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="bh-headline">{t('businessHub.fieldTagline')}</label>
            <input
              id="bh-headline"
              className="bpe-field"
              name="profile_headline"
              value={headline}
              onChange={pf}
              placeholder={t('businessHub.placeholderTagline')}
              maxLength={HEADLINE_MAX}
            />
            <p className="bpe-count">{t('businessHub.profileEditor.aboutCount', { count: headline.length, max: HEADLINE_MAX })}</p>
          </div>
        </div>
        <div style={{ marginTop: '0.9rem' }}>
          <label htmlFor="bh-about">{t('businessHub.fieldAbout')}</label>
          <textarea
            id="bh-about"
            name="description"
            value={about}
            onChange={pf}
            rows={4}
            maxLength={DESCRIPTION_MAX}
            placeholder={t('businessHub.placeholderAbout')}
          />
          <p className="bpe-count">{t('businessHub.profileEditor.aboutCount', { count: about.length, max: DESCRIPTION_MAX })}</p>
        </div>
      </section>

      <section className="bpe-card">
        <h3>{t('businessHub.sectionContact')}</h3>
        <div className="bpe-grid-2">
          <div>
            <label htmlFor="bh-phone">{t('businessHub.fieldPhone')}</label>
            <div className="bpe-phonewrap">
              {dial ? <span className="bpe-dial">{`+${dial}`}</span> : null}
              <input
                id="bh-phone"
                className="bpe-field"
                name="phone"
                value={form.phone || ''}
                onChange={pf}
                placeholder={t('businessHub.placeholderPhone')}
                type="tel"
              />
            </div>
          </div>
          <div>
            <label htmlFor="bh-website">{t('businessHub.fieldWebsite')}</label>
            <input
              id="bh-website"
              className="bpe-field"
              name="website"
              value={form.website || ''}
              onChange={pf}
              onBlur={handleWebsiteBlur}
              placeholder={t('businessHub.placeholderWebsiteFull')}
              type="text"
              inputMode="url"
              autoComplete="url"
            />
            <p className="bpe-hint">{t('businessHub.profileEditor.websiteHint')}</p>
          </div>
        </div>
      </section>

      <section className="bpe-card">
        <h3>{t('businessHub.sectionLocation')}</h3>
        <div>
          <label htmlFor="bh-street">{t('businessHub.fieldStreetAddress')}</label>
          <input
            id="bh-street"
            className="bpe-field"
            name="address_street"
            value={form.address_street || ''}
            onChange={pf}
            placeholder={t('businessHub.placeholderStreet')}
          />
          <p className="bpe-hint">{t('businessHub.streetHint')}</p>
        </div>
        <div style={{ marginTop: '0.9rem' }}>
          <label htmlFor="bh-country">{t('businessHub.fieldCountry')}</label>
          <CountrySelect
            id="bh-country"
            value={country}
            onChange={(code) => onChange({ address_country: code, address_state: '' })}
            includeBlank={false}
            className="bpe-field"
          />
        </div>
        <div className="bpe-grid-3" style={{ marginTop: '0.9rem' }}>
          <div>
            <label htmlFor="bh-city">{t('businessHub.fieldCity')}</label>
            <input
              id="bh-city"
              className="bpe-field"
              name="address_city"
              value={form.address_city || ''}
              onChange={pf}
              placeholder={t('businessHub.placeholderCity')}
            />
          </div>
          <div>
            <label htmlFor="bh-region">{getRegionLabel(country)}</label>
            <RegionInput
              id="bh-region"
              country={country}
              name="address_state"
              value={form.address_state || ''}
              onChange={(v) => onChange({ address_state: v })}
              placeholder={t('businessHub.selectStatePlaceholder')}
              className="bpe-field"
            />
          </div>
          <div>
            <label htmlFor="bh-postal">{getPostalLabel(country)}</label>
            <PostalCodeInput
              id="bh-postal"
              country={country}
              name="address_zip"
              value={form.address_zip || ''}
              onChange={(v) => onChange({ address_zip: v })}
              className="bpe-field"
            />
          </div>
        </div>
        <div className="bpe-grid-3" style={{ marginTop: '0.9rem' }}>
          <div>
            <label htmlFor="bh-radius">{t('businessHub.profileEditor.radiusLabel')}</label>
            <div className="bpe-radius">
              <input
                id="bh-radius"
                className="bpe-field"
                type="number"
                name="service_radius_miles"
                value={radiusDisplay}
                onChange={(e) => handleRadius(e.target.value)}
                placeholder={t('businessHub.placeholderRadius')}
                min="1"
                max={mileCountry ? 200 : 320}
              />
              <span>{mileCountry ? t('businessHub.profileEditor.radiusUnitMi') : t('businessHub.profileEditor.radiusUnitKm')}</span>
            </div>
            <p className="bpe-hint">
              {mileCountry
                ? t('businessHub.profileEditor.radiusHintMi')
                : t('businessHub.profileEditor.radiusHintKm')}
            </p>
          </div>
        </div>
      </section>

      {err ? (
        <div className="bpe-error">
          {typeof err === 'string' ? err : (err?.message || String(err))}
        </div>
      ) : null}

      <div className="bpe-savebar">
        <div className="bpe-save-copy">
          <p className="bpe-dirty" aria-live="polite">
            {dirty ? t('businessHub.profileEditor.unsaved') : t('businessHub.profileEditor.savedHint')}
          </p>
          <p className="bpe-hint">{t('businessHub.profileEditor.saveShortcut')}</p>
        </div>
        <div className="bpe-save-actions">
          {currentRole === 'owner' && !listed && (
            <button
              type="button"
              className="bpe-btn"
              onClick={handlePublishClick}
              disabled={publishing || saving || !listingReady || !onPublish}
              title={!listingReady ? t('businessHub.profileEditor.publishHint') : undefined}
            >
              {publishing ? t('businessHub.profileEditor.publishing') : t('businessHub.profileEditor.publish')}
            </button>
          )}
          <button
            type="button"
            className="bpe-btn primary"
            onClick={onSave}
            disabled={saving || !dirty}
          >
            {saving ? t('businessHub.btnSaving') : t('businessHub.btnSaveProfile')}
          </button>
        </div>
      </div>
    </div>
  );
}
