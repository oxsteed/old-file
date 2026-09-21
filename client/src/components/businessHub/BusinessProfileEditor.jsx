import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import toast from 'react-hot-toast';
import CountrySelect from '../CountrySelect';
import RegionInput from '../RegionInput';
import PostalCodeInput from '../PostalCodeInput';
import ProfileStudioShell from '../profileStudio/ProfileStudioShell';
import ProfilePreviewCard from '../profileStudio/ProfilePreviewCard';
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
              : item.section
                ? t('profileStudio.jumpToSection', { section: item.sectionLabel || item.section })
                : null;
        if (!item.done && (item.tab || item.section) && jumpLabel) {
          return (
            <li key={item.id}>
              <button
                type="button"
                className="bpe-jump"
                onClick={() => onJump(item.tab || item.section, item)}
              >
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
  const baselineSnapRef = useRef(null);
  const [radiusDisplay, setRadiusDisplay] = useState(() => milesToDisplay(form?.service_radius_miles, country));
  const [copied, setCopied] = useState(false);
  const [serviceCount, setServiceCount] = useState(0);
  const [menuCount, setMenuCount] = useState(0);
  const [restaurantReady, setRestaurantReady] = useState(false);
  const [hoursReady, setHoursReady] = useState(false);
  const [activeSection, setActiveSection] = useState('photos');
  // Local preview overrides so Discard can restore photo URLs without parent API changes.
  const [localLogo, setLocalLogo] = useState(undefined);
  const [localCover, setLocalCover] = useState(undefined);

  const effectiveLogo = localLogo !== undefined ? localLogo : logoPreview;
  const effectiveCover = localCover !== undefined ? localCover : coverPreview;

  const dirty = form
    ? serializeProfileState(form, effectiveLogo, effectiveCover) !== baselineRef.current
    : false;

  useEffect(() => {
    if (!form || saving) return;
    baselineRef.current = serializeProfileState(form, logoPreview, coverPreview);
    baselineSnapRef.current = {
      form: { ...form },
      logo: logoPreview || null,
      cover: coverPreview || null,
    };
    setLocalLogo(undefined);
    setLocalCover(undefined);
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
      logoPreview: effectiveLogo,
      coverPreview: effectiveCover,
      serviceCount,
      hoursReady,
      isRestaurant,
      restaurantReady,
      menuCount,
    }),
    [form, effectiveLogo, effectiveCover, serviceCount, hoursReady, isRestaurant, restaurantReady, menuCount],
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

  const photosComplete = !!(effectiveLogo || effectiveCover);
  const identityComplete = !!(form?.business_name && form?.business_type && form?.description);
  const contactComplete = !!(form?.phone || form?.website);
  const locationComplete = !!(form?.address_city && form?.address_country);

  const sections = useMemo(() => ([
    { id: 'photos', label: t('businessHub.sectionPhotos'), complete: photosComplete },
    { id: 'identity', label: t('businessHub.sectionBusinessIdentity'), complete: identityComplete },
    { id: 'contact', label: t('businessHub.sectionContact'), complete: contactComplete },
    { id: 'location', label: t('businessHub.sectionLocation'), complete: locationComplete },
    { id: 'readiness', label: t('profileStudio.sectionReadiness'), complete: listingReady },
  ]), [t, photosComplete, identityComplete, contactComplete, locationComplete, listingReady]);

  const panelHints = {
    photos: t('businessHub.profileEditor.dropHint'),
    identity: t('profileStudio.hintIdentity'),
    contact: t('profileStudio.hintContact'),
    location: t('profileStudio.hintLocation'),
    readiness: t('profileStudio.hintReadiness'),
  };

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

  function handleJump(tabOrSection, item) {
    if (item?.section) {
      setActiveSection(item.section);
      return;
    }
    if (tabOrSection === 'restaurant' && restaurantSetupHref) {
      window.location.assign(restaurantSetupHref);
      return;
    }
    // Map checklist ids that live in this editor to studio sections
    const sectionMap = {
      name: 'identity',
      category: 'identity',
      description: 'identity',
      photo: 'photos',
      contact: 'contact',
      location: 'location',
    };
    if (sectionMap[item?.id]) {
      setActiveSection(sectionMap[item.id]);
      return;
    }
    if (tabOrSection && onJumpTab) onJumpTab(tabOrSection);
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

  function handleLogoFile(file) {
    setLocalLogo(undefined);
    onLogoChange(file);
  }

  function handleCoverFile(file) {
    setLocalCover(undefined);
    onCoverChange(file);
  }

  function handleDiscard() {
    const snap = baselineSnapRef.current;
    if (!snap) return;
    onChange({ ...snap.form });
    // Clear any pending File uploads in the parent, then restore preview URLs locally.
    onLogoChange(null);
    onCoverChange(null);
    setLocalLogo(snap.logo);
    setLocalCover(snap.cover);
    setRadiusDisplay(milesToDisplay(snap.form.service_radius_miles, snap.form.address_country || 'US'));
  }

  if (!form) return null;

  const headline = String(form.profile_headline || '');
  const about = String(form.description || '');
  const websiteShown = displayWebsite(form.website);

  const preview = (
    <ProfilePreviewCard
      variant="business"
      cover={effectiveCover}
      avatar={effectiveLogo}
      name={form.business_name || ''}
      tagline={headline}
      typeLabel={typeLabel ? t(`businessHub.${typeLabel.labelKey}`) : ''}
      meta={place ? [place, countryName].filter(Boolean).join(' · ') : ''}
      contact={[form.phone, websiteShown].filter(Boolean).join(' · ')}
      about={about}
      publicHref={publicPath || ''}
      publicLabel={t('businessHub.profileEditor.openPage')}
    />
  );

  const headerExtra = (
    <>
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
    </>
  );

  const saveExtra = currentRole === 'owner' && !listed ? (
    <button
      type="button"
      className="ps-btn"
      onClick={handlePublishClick}
      disabled={publishing || saving || !listingReady || !onPublish}
      title={!listingReady ? t('businessHub.profileEditor.publishHint') : undefined}
    >
      {publishing ? t('businessHub.profileEditor.publishing') : t('businessHub.profileEditor.publish')}
    </button>
  ) : null;

  let sectionBody = null;

  if (activeSection === 'photos') {
    sectionBody = (
      <div className="bpe-photos">
        <PhotoDrop
          inputId="bh-logo-input"
          preview={effectiveLogo}
          alt={t('businessHub.logoPreviewAlt')}
          variant="square"
          emptyLabel={t('businessHub.businessLogo')}
          changeLabel={t('businessHub.changeLogo')}
          uploadLabel={t('businessHub.uploadLogo')}
          removeLabel={t('businessHub.remove')}
          onFile={handleLogoFile}
          onRemove={() => {
            setLocalLogo(null);
            onLogoChange(null);
            onChange({ logo_url: '' });
          }}
        />
        <PhotoDrop
          inputId="bh-cover-input"
          preview={effectiveCover}
          alt={t('businessHub.coverPreviewAlt')}
          variant="wide"
          emptyLabel={t('businessHub.coverPhoto')}
          changeLabel={t('businessHub.changeCover')}
          uploadLabel={t('businessHub.uploadCover')}
          removeLabel={t('businessHub.remove')}
          onFile={handleCoverFile}
          onRemove={() => {
            setLocalCover(null);
            onCoverChange(null);
            onChange({ cover_photo_url: '' });
          }}
        />
      </div>
    );
  } else if (activeSection === 'identity') {
    sectionBody = (
      <>
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
      </>
    );
  } else if (activeSection === 'contact') {
    sectionBody = (
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
    );
  } else if (activeSection === 'location') {
    sectionBody = (
      <>
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
      </>
    );
  } else if (activeSection === 'readiness') {
    sectionBody = (
      <div className="bpe-checks bpe-checks-inline">
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
      </div>
    );
  }

  return (
    <div className="bpe bpe-studio">
      {currentRole === 'manager' && (
        <p className="bpe-manager" style={{ marginBottom: '0.5rem' }}>
          <Trans i18nKey="businessHub.managerNote">
            You are editing as a <strong>Manager</strong>. Changes apply to the business owner&apos;s public profile.
          </Trans>
        </p>
      )}

      <ProfileStudioShell
        title={t('businessHub.profileEditor.title')}
        subtitle={t('businessHub.profileEditor.subtitle')}
        sections={sections}
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        dirty={dirty}
        saving={saving}
        onSave={onSave}
        onDiscard={handleDiscard}
        saveLabel={saving ? t('businessHub.btnSaving') : t('businessHub.btnSaveProfile')}
        preview={preview}
        headerExtra={headerExtra}
        readinessPill={{
          label: t('businessHub.profileEditor.listingProgress', { done: listingDone, total: listingTotal }),
          ready: listingReady,
        }}
        panelHint={panelHints[activeSection]}
        saveExtra={saveExtra}
      >
        {sectionBody}
        {err ? (
          <div className="bpe-error" style={{ marginTop: '1rem' }}>
            {typeof err === 'string' ? err : (err?.message || String(err))}
          </div>
        ) : null}
      </ProfileStudioShell>
    </div>
  );
}
