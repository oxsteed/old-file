import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import CountrySelect from '../CountrySelect';
import PostalCodeInput from '../PostalCodeInput';
import RegionInput from '../RegionInput';
import { createBusinessWithSetup, listBusinessCategories } from '../../api/businesses';
import { getDefaultCurrency } from '../../lib/countries';
import '../../styles/BusinessCreationWizard.css';

const DRAFT_KEY = 'oxs:business-creation:v2';
const STEPS = ['kind', 'category', 'identity', 'review'];

function newIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `business-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function defaultDraft(country = 'US') {
  return {
    step: 0,
    idempotencyKey: newIdempotencyKey(),
    business_kind: '',
    industry_category: '',
    business_type: '',
    business_name: '',
    description: '',
    phone: '',
    website: '',
    address_street: '',
    address_city: '',
    address_state: '',
    address_zip: '',
    address_country: country || 'US',
    currency_code: getDefaultCurrency(country || 'US'),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  };
}

function readDraft(country) {
  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT_KEY));
    if (!saved || typeof saved !== 'object') return defaultDraft(country);
    return { ...defaultDraft(country), ...saved, step: Math.min(Math.max(Number(saved.step) || 0, 0), STEPS.length - 1) };
  } catch (_) {
    return defaultDraft(country);
  }
}

export default function BusinessCreationWizard({ initialCountry = 'US', onCancel, onCreated }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(() => readDraft(initialCountry));
  const [catalog, setCatalog] = useState({ categories: [], operatingModels: [] });
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    listBusinessCategories()
      .then((data) => {
        if (active) setCatalog({
          categories: data?.categories || [],
          operatingModels: data?.operatingModels || [],
        });
      })
      .catch(() => {
        if (active) setError(t('businessCreation.catalogError', 'Business types could not be loaded. Try again.'));
      })
      .finally(() => { if (active) setLoadingCatalog(false); });
    return () => { active = false; };
  }, [t]);

  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [draft]);

  const operatingModels = catalog.operatingModels.length ? catalog.operatingModels : [
    { id: 'restaurant', title: 'Restaurant', description: 'Customers browse a menu and place food orders.', category_ids: ['food'] },
    { id: 'service', title: 'Service Business', description: 'Customers browse services, request work, book appointments, or discover your shop in Skills.', category_ids: ['services', 'retail', 'beauty', 'consulting', 'health', 'auto'] },
  ];

  const selectedModel = operatingModels.find((model) => model.id === draft.business_kind);
  const visibleCategories = useMemo(() => {
    if (!selectedModel) return [];
    const allowed = new Set(selectedModel.category_ids || []);
    return catalog.categories.filter((category) => allowed.has(category.id));
  }, [catalog.categories, selectedModel]);
  const selectedCategory = catalog.categories.find((category) => category.id === draft.industry_category);

  function patch(values) {
    setDraft((current) => ({ ...current, ...values }));
    setError('');
  }

  function chooseKind(kind) {
    patch({
      business_kind: kind,
      industry_category: kind === 'restaurant' ? 'food' : '',
      business_type: '',
    });
  }

  function validateStep() {
    if (draft.step === 0 && !draft.business_kind) return t('businessCreation.chooseKindError', 'Choose how customers will use this business.');
    if (draft.step === 1 && !draft.industry_category) return t('businessCreation.chooseCategoryError', 'Choose a business category.');
    if (draft.step === 1 && !draft.business_type) return t('businessCreation.chooseSubtypeError', 'Choose the closest business type.');
    if (draft.step === 2 && !draft.business_name.trim()) return t('businessCreation.nameError', 'Business name is required.');
    if (draft.step === 2 && !draft.address_country) return t('businessCreation.countryError', 'Country is required.');
    if (draft.step === 2 && !draft.address_city.trim()) return t('businessCreation.cityError', 'City is required before customers can discover the business.');
    return '';
  }

  function next() {
    const validationError = validateStep();
    if (validationError) {
      setError(validationError);
      return;
    }
    patch({ step: Math.min(draft.step + 1, STEPS.length - 1) });
  }

  function back() {
    if (draft.step === 0) onCancel();
    else patch({ step: draft.step - 1 });
  }

  async function create() {
    const validationError = validateStep();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = Object.fromEntries(
        Object.entries(draft)
          .filter(([key]) => !['step', 'idempotencyKey'].includes(key))
          .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])
      );
      const result = await createBusinessWithSetup(payload, draft.idempotencyKey);
      localStorage.removeItem(DRAFT_KEY);
      onCreated(result);
    } catch (requestError) {
      const fields = requestError?.response?.data?.fields;
      const firstFieldError = fields && Object.values(fields)[0];
      setError(firstFieldError || requestError?.response?.data?.error || t('businessCreation.createError', 'The business could not be created. Try again.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bcw-overlay" role="dialog" aria-modal="true" aria-labelledby="bcw-title">
      <section className="bcw-panel">
        <header className="bcw-header">
          <div>
            <p className="bcw-eyebrow">{t('businessCreation.eyebrow', 'Business setup')}</p>
            <h2 id="bcw-title">{t('businessCreation.title', 'Create your business')}</h2>
          </div>
          <button type="button" className="bcw-close" onClick={onCancel} aria-label={t('common.close', 'Close')}>×</button>
        </header>

        <div className="bcw-progress" aria-label={t('businessCreation.progress', 'Setup progress')}>
          {STEPS.map((step, index) => (
            <span key={step} className={index <= draft.step ? 'active' : ''} />
          ))}
        </div>

        <div className="bcw-body">
          {draft.step === 0 && (
            <div className="bcw-scene">
              <div className="bcw-scene-copy">
                <p className="bcw-step">{t('businessCreation.stepOne', 'Step 1 of 4')}</p>
                <h3>{t('businessCreation.kindTitle', 'What will customers do?')}</h3>
                <p>{t('businessCreation.kindHelp', 'Choose the operating model first. You will select the specific industry next.')}</p>
              </div>
              <div className="bcw-kind-grid">
                {operatingModels.map((model) => (
                  <button
                    type="button"
                    key={model.id}
                    className={`bcw-kind-card ${draft.business_kind === model.id ? 'selected' : ''}`}
                    onClick={() => chooseKind(model.id)}
                  >
                    <span className="bcw-kind-icon" aria-hidden>{model.id === 'restaurant' ? '🍽' : '🛠'}</span>
                    <strong>{model.id === 'restaurant'
                      ? t('businessCreation.restaurant', 'Restaurant')
                      : t('businessCreation.service', 'Service Business')}</strong>
                    <small>{model.id === 'restaurant'
                      ? t('businessCreation.restaurantHelp', 'Customers browse a menu and place food orders.')
                      : t('businessCreation.serviceHelp', 'Customers browse services, request work, book, or discover your shop in Skills.')}</small>
                  </button>
                ))}
              </div>
            </div>
          )}

          {draft.step === 1 && (
            <div className="bcw-scene">
              <div className="bcw-scene-copy">
                <p className="bcw-step">{t('businessCreation.stepTwo', 'Step 2 of 4')}</p>
                <h3>{t('businessCreation.categoryTitle', 'Choose the closest category')}</h3>
                <p>{t('businessCreation.categoryHelp', 'This improves discovery. It does not change who owns or manages the business.')}</p>
              </div>
              {loadingCatalog ? <p className="bcw-loading">{t('common.loading', 'Loading...')}</p> : (
                <>
                  <div className="bcw-category-grid">
                    {visibleCategories.map((category) => (
                      <button
                        type="button"
                        key={category.id}
                        className={`bcw-category-card ${draft.industry_category === category.id ? 'selected' : ''}`}
                        onClick={() => patch({ industry_category: category.id, business_type: '' })}
                      >
                        <strong>{category.title}</strong>
                        <small>{category.tagline}</small>
                      </button>
                    ))}
                  </div>
                  {selectedCategory && (
                    <label className="bcw-field">
                      <span>{t('businessCreation.subtype', 'Business type')}</span>
                      <select value={draft.business_type} onChange={(event) => patch({ business_type: event.target.value })}>
                        <option value="">{t('businessCreation.selectSubtype', 'Select the closest match')}</option>
                        {(selectedCategory.subtypes || []).map((subtype) => <option key={subtype}>{subtype}</option>)}
                      </select>
                    </label>
                  )}
                </>
              )}
            </div>
          )}

          {draft.step === 2 && (
            <div className="bcw-scene">
              <div className="bcw-scene-copy">
                <p className="bcw-step">{t('businessCreation.stepThree', 'Step 3 of 4')}</p>
                <h3>{t('businessCreation.identityTitle', 'Add the essentials')}</h3>
                <p>{t('businessCreation.identityHelp', 'Only the name, country, and city are required now. Complete the public profile before publishing.')}</p>
              </div>
              <div className="bcw-form-grid">
                <label className="bcw-field bcw-wide">
                  <span>{t('businessCreation.businessName', 'Business name')} *</span>
                  <input value={draft.business_name} onChange={(event) => patch({ business_name: event.target.value })} autoFocus maxLength={160} />
                </label>
                <label className="bcw-field bcw-wide">
                  <span>{t('businessCreation.description', 'Short description')}</span>
                  <textarea value={draft.description} onChange={(event) => patch({ description: event.target.value })} rows={3} maxLength={2000} />
                </label>
                <label className="bcw-field">
                  <span>{t('businessCreation.country', 'Country')} *</span>
                  <CountrySelect
                    value={draft.address_country}
                    includeBlank={false}
                    onChange={(country) => patch({
                      address_country: country,
                      address_state: '',
                      address_zip: '',
                      currency_code: getDefaultCurrency(country),
                    })}
                  />
                </label>
                <label className="bcw-field">
                  <span>{t('businessCreation.city', 'City')} *</span>
                  <input value={draft.address_city} onChange={(event) => patch({ address_city: event.target.value })} maxLength={120} />
                </label>
                <label className="bcw-field">
                  <span>{t('businessCreation.region', 'State / region')}</span>
                  <RegionInput
                    country={draft.address_country}
                    value={draft.address_state}
                    onChange={(address_state) => patch({ address_state })}
                  />
                </label>
                <label className="bcw-field">
                  <span>{t('businessCreation.postal', 'Postal code')}</span>
                  <PostalCodeInput
                    country={draft.address_country}
                    value={draft.address_zip}
                    onChange={(address_zip) => patch({ address_zip })}
                  />
                </label>
                <label className="bcw-field">
                  <span>{t('businessCreation.phone', 'Phone')}</span>
                  <input type="tel" value={draft.phone} onChange={(event) => patch({ phone: event.target.value })} autoComplete="tel" />
                </label>
                <label className="bcw-field">
                  <span>{t('businessCreation.website', 'Website')}</span>
                  <input type="url" value={draft.website} onChange={(event) => patch({ website: event.target.value })} placeholder="https://" />
                </label>
              </div>
            </div>
          )}

          {draft.step === 3 && (
            <div className="bcw-scene">
              <div className="bcw-scene-copy">
                <p className="bcw-step">{t('businessCreation.stepFour', 'Step 4 of 4')}</p>
                <h3>{t('businessCreation.reviewTitle', 'Review the foundation')}</h3>
                <p>{t('businessCreation.reviewHelp', 'The business stays private until its vertical setup is complete and you publish it.')}</p>
              </div>
              <dl className="bcw-review">
                <div><dt>{t('businessCreation.operatingModel', 'Operating model')}</dt><dd>{draft.business_kind === 'restaurant' ? t('businessCreation.restaurant', 'Restaurant') : t('businessCreation.service', 'Service Business')}</dd></div>
                <div><dt>{t('businessCreation.category', 'Category')}</dt><dd>{selectedCategory?.title || draft.industry_category}</dd></div>
                <div><dt>{t('businessCreation.subtype', 'Business type')}</dt><dd>{draft.business_type}</dd></div>
                <div><dt>{t('businessCreation.businessName', 'Business name')}</dt><dd>{draft.business_name}</dd></div>
                <div><dt>{t('businessCreation.location', 'Location')}</dt><dd>{[draft.address_city, draft.address_state, draft.address_country].filter(Boolean).join(', ')}</dd></div>
                <div><dt>{t('businessCreation.currency', 'Currency')}</dt><dd>{draft.currency_code}</dd></div>
              </dl>
              <div className="bcw-private-note">
                <strong>{t('businessCreation.privateTitle', 'Private until ready')}</strong>
                <span>{draft.business_kind === 'restaurant'
                  ? t('businessCreation.restaurantNext', 'Next: add hours, ordering options, and at least one menu item.')
                  : t('businessCreation.serviceNext', 'Next: finish the public profile and add at least one service.')}</span>
              </div>
            </div>
          )}

          {error && <div className="bcw-error" role="alert">{error}</div>}
        </div>

        <footer className="bcw-footer">
          <button type="button" className="bcw-secondary" onClick={back} disabled={saving}>
            {draft.step === 0 ? t('common.cancel', 'Cancel') : t('common.back', 'Back')}
          </button>
          {draft.step < STEPS.length - 1 ? (
            <button type="button" className="bcw-primary" onClick={next} disabled={loadingCatalog && draft.step === 1}>
              {t('common.continue', 'Continue')}
            </button>
          ) : (
            <button type="button" className="bcw-primary" onClick={create} disabled={saving}>
              {saving ? t('businessCreation.creating', 'Creating...') : t('businessCreation.create', 'Create private business')}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
