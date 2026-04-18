import { memo } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { US_STATES, BIZ_TYPES } from './constants';

function ProfileTab({ form, logoPreview, coverPreview, saving, err, currentRole, onChange, onLogoChange, onCoverChange, onSave, bizId }) {
  const { t } = useTranslation();
  if (!form) return null;

  function pf(e) {
    const { name, value } = e.target;
    onChange({ [name]: value });
  }

  return (
    <div className="bh-profile-tab">
      <div className="bh-profile-header">
        <div>
          <h2 className="bh-profile-title">{t('businessHub.publicProfile')}</h2>
          <p className="bh-profile-subtitle">
            {t('businessHub.publicProfileSubtitle')}
          </p>
          {currentRole === 'manager' && (
            <p className="bh-profile-note" style={{ marginTop: '0.4rem', color: '#818cf8', fontSize: '0.82rem' }}>
              <Trans i18nKey="businessHub.managerNote">
                You are editing as a <strong>Manager</strong>. Changes apply to the business owner's public profile.
              </Trans>
            </p>
          )}
        </div>
        {bizId && (
          <a
            href={`/business/${bizId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="bh-btn sm"
          >
            {t('businessHub.preview')} ↗
          </a>
        )}
      </div>

      {/* ── Photos ──────────────────────────────────────────────────── */}
      <section className="bh-profile-section">
        <h3 className="bh-profile-section-title">{t('businessHub.sectionPhotos')}</h3>
        <div className="bh-photo-row">

          {/* Logo */}
          <div className="bh-photo-field">
            <label className="bh-photo-label">{t('businessHub.businessLogo')}</label>
            <div className="bh-photo-preview bh-photo-preview--logo">
              {logoPreview
                ? <img src={logoPreview} alt={t('businessHub.logoPreviewAlt')} className="bh-photo-img" />
                : <span className="bh-photo-placeholder">{t('businessHub.noLogo')}</span>}
            </div>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="bh-photo-input"
              onChange={e => onLogoChange(e.target.files?.[0] || null)}
              id="bh-logo-input"
            />
            <label htmlFor="bh-logo-input" className="bh-btn sm" style={{ cursor: 'pointer', display: 'inline-block' }}>
              {logoPreview ? t('businessHub.changeLogo') : t('businessHub.uploadLogo')}
            </label>
            {logoPreview && (
              <button
                className="bh-btn sm danger"
                onClick={() => { onLogoChange(null); onChange({ logo_url: '' }); }}
                style={{ marginLeft: '0.5rem' }}
              >
                {t('businessHub.remove')}
              </button>
            )}
          </div>

          {/* Cover photo */}
          <div className="bh-photo-field">
            <label className="bh-photo-label">{t('businessHub.coverPhoto')}</label>
            <div className="bh-photo-preview bh-photo-preview--cover">
              {coverPreview
                ? <img src={coverPreview} alt={t('businessHub.coverPreviewAlt')} className="bh-photo-img" />
                : <span className="bh-photo-placeholder">{t('businessHub.noCoverPhoto')}</span>}
            </div>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="bh-photo-input"
              onChange={e => onCoverChange(e.target.files?.[0] || null)}
              id="bh-cover-input"
            />
            <label htmlFor="bh-cover-input" className="bh-btn sm" style={{ cursor: 'pointer', display: 'inline-block' }}>
              {coverPreview ? t('businessHub.changeCover') : t('businessHub.uploadCover')}
            </label>
            {coverPreview && (
              <button
                className="bh-btn sm danger"
                onClick={() => { onCoverChange(null); onChange({ cover_photo_url: '' }); }}
                style={{ marginLeft: '0.5rem' }}
              >
                {t('businessHub.remove')}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ── Business identity ────────────────────────────────────────── */}
      <section className="bh-profile-section">
        <h3 className="bh-profile-section-title">{t('businessHub.sectionBusinessIdentity')}</h3>
        <div className="bh-field-row">
          <div className="bh-field">
            <label>{t('businessHub.fieldBusinessNameRequired')}</label>
            <input name="business_name" value={form.business_name} onChange={pf} placeholder={t('businessHub.placeholderBizName')} />
          </div>
          <div className="bh-field">
            <label>{t('businessHub.fieldBusinessType')}</label>
            <select name="business_type" value={form.business_type} onChange={pf}>
              <option value="">{t('businessHub.selectTypePlaceholder')}</option>
              {BIZ_TYPES.map(bt => <option key={bt.value} value={bt.value}>{t(`businessHub.${bt.labelKey}`)}</option>)}
            </select>
          </div>
        </div>
        <div className="bh-field">
          <label>{t('businessHub.fieldTagline')}</label>
          <input
            name="profile_headline"
            value={form.profile_headline}
            onChange={pf}
            placeholder={t('businessHub.placeholderTagline')}
            maxLength={120}
          />
          <span className="bh-field-hint">{t('businessHub.taglineHint')}</span>
        </div>
        <div className="bh-field">
          <label>{t('businessHub.fieldAbout')}</label>
          <textarea
            name="description"
            value={form.description}
            onChange={pf}
            rows={4}
            placeholder={t('businessHub.placeholderAbout')}
          />
        </div>
      </section>

      {/* ── Contact info ────────────────────────────────────────────── */}
      <section className="bh-profile-section">
        <h3 className="bh-profile-section-title">{t('businessHub.sectionContact')}</h3>
        <div className="bh-field-row">
          <div className="bh-field">
            <label>{t('businessHub.fieldPhone')}</label>
            <input name="phone" value={form.phone} onChange={pf} placeholder={t('businessHub.placeholderPhone')} type="tel" />
          </div>
          <div className="bh-field">
            <label>{t('businessHub.fieldWebsite')}</label>
            <input name="website" value={form.website} onChange={pf} placeholder={t('businessHub.placeholderWebsiteFull')} type="url" />
          </div>
        </div>
      </section>

      {/* ── Location & service area ──────────────────────────────────── */}
      <section className="bh-profile-section">
        <h3 className="bh-profile-section-title">{t('businessHub.sectionServiceArea')}</h3>
        <div className="bh-field">
          <label>{t('businessHub.fieldAddress')}</label>
          <input name="address_street" value={form.address_street} onChange={pf} placeholder={t('businessHub.placeholderStreet')} />
        </div>
        <div className="bh-field-row">
          <div className="bh-field">
            <input name="address_city" value={form.address_city} onChange={pf} placeholder={t('businessHub.placeholderCity')} />
          </div>
          <div className="bh-field">
            <select name="address_state" value={form.address_state} onChange={pf}>
              <option value="">{t('businessHub.selectState')}</option>
              {US_STATES.map(st => <option key={st} value={st}>{st}</option>)}
            </select>
          </div>
          <div className="bh-field">
            <input name="address_zip" value={form.address_zip} onChange={pf} placeholder={t('businessHub.placeholderZip')} />
          </div>
        </div>
        <div className="bh-field">
          <label>{t('businessHub.fieldServiceRadius')}</label>
          <input type="number" name="service_radius_miles" value={form.service_radius_miles} onChange={pf} placeholder="10" min="0" max="100" />
          <span className="bh-field-hint">{t('businessHub.serviceRadiusHint')}</span>
        </div>
      </section>

      {err && <div className="bh-error" style={{ marginTop: '1rem' }}>{err}</div>}
      <div className="bh-profile-actions">
        <button className="bh-btn primary" onClick={onSave} disabled={saving}>
          {saving ? t('businessHub.btnSaving') : t('businessHub.btnSaveProfile')}
        </button>
      </div>
    </div>
  );
}

export default memo(ProfileTab);
