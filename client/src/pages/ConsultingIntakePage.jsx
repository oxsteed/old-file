import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';
import api from '../api/axios';
import {
  ALL_COUNTRIES,
  COUNTRIES_WITH_REGIONS,
  COUNTRY_CODES_SORTED,
} from '../lib/countries';

// Phase data structure (names will be translated at runtime)
const BUSINESS_PHASES = Array.from({ length: 25 }, (_, i) => ({
  id: i + 1,
  nameKey: `phase${i + 1}`,
}));

// Setup items grouped by category (labels will be translated at runtime)
const SETUP_ITEMS_GROUPED_KEYS = {
  groupBusinessFormation: [
    { id: 'llc_filing', labelKey: 'llcFiling' },
    { id: 'ein_registration', labelKey: 'einRegistration' },
    { id: 'business_address', labelKey: 'businessAddress' },
    { id: 'operating_docs', labelKey: 'operatingDocs' },
  ],
  groupDigitalIdentity: [
    { id: 'domain_registration', labelKey: 'domainRegistration' },
    { id: 'business_email', labelKey: 'businessEmail' },
    { id: 'business_phone', labelKey: 'businessPhone' },
    { id: 'logo_branding', labelKey: 'logoBranding' },
  ],
  groupOnlinePresence: [
    { id: 'website_build', labelKey: 'websiteBuild' },
    { id: 'contact_form', labelKey: 'contactForm' },
    { id: 'google_business', labelKey: 'googleBusiness' },
    { id: 'social_media', labelKey: 'socialMedia' },
  ],
  groupBusinessOperations: [
    { id: 'payment_processor', labelKey: 'paymentProcessor' },
    { id: 'scheduling_system', labelKey: 'schedulingSystem' },
    { id: 'client_intake', labelKey: 'clientIntake' },
    { id: 'invoice_templates', labelKey: 'invoiceTemplates' },
    { id: 'bookkeeping_system', labelKey: 'bookkeepingSystem' },
  ],
  groupLaunchSupport: [
    { id: 'outreach_templates', labelKey: 'outreachTemplates' },
    { id: 'referral_system', labelKey: 'referralSystem' },
    { id: 'online_listings', labelKey: 'onlineListings' },
    { id: 'launch_support', labelKey: 'launchSupport' },
  ],
};

// Countries with states/provinces
// Country / region metadata is now sourced from `client/src/lib/countries.js`
// (single source of truth across the app). The exported names here are kept
// stable so that the rest of this file does not need to be touched.

export default function ConsultingIntakePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useTranslation(['consulting']);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);

  // Build localized business phases
  const businessPhases = BUSINESS_PHASES.map(phase => ({
    id: phase.id,
    name: t(`consulting.intake.businessPhases.${phase.nameKey}`),
  }));

  // Build localized setup items grouped
  const setupItemsGrouped = Object.entries(SETUP_ITEMS_GROUPED_KEYS).reduce((acc, [groupKey, items]) => {
    const groupName = t(`consulting.intake.setupItems.${groupKey}`);
    acc[groupName] = items.map(item => ({
      ...item,
      label: t(`consulting.intake.setupItems.${item.labelKey}`),
    }));
    return acc;
  }, {});

  // Build localized packages
  const packages = {
    initial: {
      name: t('consulting.intake.packageDetails.initial.name'),
      price: 100,
      timeline: t('consulting.intake.packageDetails.initial.timeline'),
      forWho: t('consulting.intake.packageDetails.initial.forWho'),
      features: [
        t('consulting.intake.packageDetails.initial.features.0'),
        t('consulting.intake.packageDetails.initial.features.1'),
        t('consulting.intake.packageDetails.initial.features.2'),
        t('consulting.intake.packageDetails.initial.features.3'),
        t('consulting.intake.packageDetails.initial.features.4'),
      ],
    },
    foundation: {
      name: t('consulting.intake.packageDetails.foundation.name'),
      price: 750,
      timeline: t('consulting.intake.packageDetails.foundation.timeline'),
      forWho: t('consulting.intake.packageDetails.foundation.forWho'),
      features: [
        t('consulting.intake.packageDetails.foundation.features.0'),
        t('consulting.intake.packageDetails.foundation.features.1'),
        t('consulting.intake.packageDetails.foundation.features.2'),
        t('consulting.intake.packageDetails.foundation.features.3'),
        t('consulting.intake.packageDetails.foundation.features.4'),
        t('consulting.intake.packageDetails.foundation.features.5'),
        t('consulting.intake.packageDetails.foundation.features.6'),
      ],
    },
    launch: {
      name: t('consulting.intake.packageDetails.launch.name'),
      price: 1500,
      timeline: t('consulting.intake.packageDetails.launch.timeline'),
      forWho: t('consulting.intake.packageDetails.launch.forWho'),
      features: [
        t('consulting.intake.packageDetails.launch.features.0'),
        t('consulting.intake.packageDetails.launch.features.1'),
        t('consulting.intake.packageDetails.launch.features.2'),
        t('consulting.intake.packageDetails.launch.features.3'),
        t('consulting.intake.packageDetails.launch.features.4'),
        t('consulting.intake.packageDetails.launch.features.5'),
        t('consulting.intake.packageDetails.launch.features.6'),
        t('consulting.intake.packageDetails.launch.features.7'),
      ],
      popular: true,
    },
    accelerator: {
      name: t('consulting.intake.packageDetails.accelerator.name'),
      price: 3000,
      timeline: t('consulting.intake.packageDetails.accelerator.timeline'),
      forWho: t('consulting.intake.packageDetails.accelerator.forWho'),
      features: [
        t('consulting.intake.packageDetails.accelerator.features.0'),
        t('consulting.intake.packageDetails.accelerator.features.1'),
        t('consulting.intake.packageDetails.accelerator.features.2'),
        t('consulting.intake.packageDetails.accelerator.features.3'),
        t('consulting.intake.packageDetails.accelerator.features.4'),
        t('consulting.intake.packageDetails.accelerator.features.5'),
        t('consulting.intake.packageDetails.accelerator.features.6'),
        t('consulting.intake.packageDetails.accelerator.features.7'),
        t('consulting.intake.packageDetails.accelerator.features.8'),
      ],
    },
  };

  const [form, setForm] = useState({
    // Step 1
    email: user?.email || '',
    first_name: user?.first_name || '',
    last_name: user?.last_name || '',
    phone: '',
    referral_source: '',

    // Step 2
    skill_description: '',
    target_market: '',
    has_revenue: '',
    business_name_decided: '',
    business_name: '',
    operating_country: user?.country || '',
    operating_state: user?.state || '',

    // Step 3
    setup_items_selected: [],
    select_all_chosen: false,
    current_phase: '',
    additional_notes: '',
    urgency: '',

    // Step 4
    package_selected: '',
  });

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleCheckbox = (itemId) => {
    setForm(prev => ({
      ...prev,
      setup_items_selected: prev.setup_items_selected.includes(itemId)
        ? prev.setup_items_selected.filter(id => id !== itemId)
        : [...prev.setup_items_selected, itemId],
    }));
  };

  const handleSelectAll = () => {
    if (form.select_all_chosen) {
      setForm(prev => ({
        ...prev,
        select_all_chosen: false,
        setup_items_selected: [],
      }));
    } else {
      const allItems = Object.values(SETUP_ITEMS_GROUPED)
        .flatMap(group => group.map(item => item.id));
      setForm(prev => ({
        ...prev,
        select_all_chosen: true,
        setup_items_selected: allItems,
      }));
    }
  };

  const validateStep = () => {
    if (step === 1) {
      if (!form.email || !form.first_name || !form.last_name || !form.phone) {
        toast.error(t('consulting.intake.formErrors.missingFields'));
        return false;
      }
      return true;
    } else if (step === 2) {
      if (!form.skill_description || !form.target_market || !form.has_revenue || !form.business_name_decided || !form.operating_country || !form.operating_state) {
        toast.error(t('consulting.intake.formErrors.missingFields'));
        return false;
      }
      if (form.business_name_decided === 'yes' && !form.business_name) {
        toast.error(t('consulting.intake.formErrors.businessNameRequired'));
        return false;
      }
      return true;
    } else if (step === 3) {
      if (!form.urgency || form.setup_items_selected.length === 0) {
        toast.error(t('consulting.intake.formErrors.urgencyAndItems'));
        return false;
      }
      return true;
    } else if (step === 4) {
      if (!form.package_selected) {
        toast.error(t('consulting.intake.formErrors.packageRequired'));
        return false;
      }
      return true;
    }
    return true;
  };

  const handleNext = () => {
    if (validateStep()) {
      setStep(step + 1);
    }
  };

  const handleSubmit = async () => {
    if (!validateStep()) return;

    setLoading(true);
    try {
      const packagePrice = packages[form.package_selected].price;

      const response = await api.post('/consulting/business-launch/submit', {
        email: form.email,
        first_name: form.first_name,
        last_name: form.last_name,
        phone: form.phone,
        referral_source: form.referral_source,
        skill_description: form.skill_description,
        target_market: form.target_market,
        has_revenue: form.has_revenue,
        business_name_decided: form.business_name_decided === 'yes',
        business_name: form.business_name || null,
        operating_country: form.operating_country,
        operating_state: form.operating_state,
        setup_items_selected: form.setup_items_selected,
        select_all_chosen: form.select_all_chosen,
        current_phase: form.current_phase ? parseInt(form.current_phase) : null,
        additional_notes: form.additional_notes,
        urgency: form.urgency,
        package_selected: form.package_selected,
        package_price: packagePrice,
      });

      toast.success(t('consulting.intake.formSuccess'));
      setTimeout(() => navigate('/'), 2000);
    } catch (err) {
      toast.error(err.response?.data?.error || t('common.errorSubmitting'));
    } finally {
      setLoading(false);
    }
  };

  // Get all setup items as flat array
  const allSetupItems = Object.values(setupItemsGrouped).flatMap(group => group);

  return (
    <PageShell>
      <PageMeta
        title="OxSteed Business Launch Program"
        description="Turn your skill into a real business. Setup, branding, website, and launch support included."
        url={`${window.location.origin}/consulting-intake`}
      />

      <div style={{ minHeight: '100vh', background: 'var(--color-bg)', padding: '2rem 1rem' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          {/* Progress Bar */}
          <div style={{ marginBottom: '3rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', fontSize: '0.85rem', fontWeight: 500 }}>
              <span style={{ opacity: step >= 1 ? 1 : 0.5 }}>{t('consulting.intake.progressContact')}</span>
              <span style={{ opacity: step >= 2 ? 1 : 0.5 }}>{t('consulting.intake.progressSkillOffer')}</span>
              <span style={{ opacity: step >= 3 ? 1 : 0.5 }}>{t('consulting.intake.progressSetupNeeds')}</span>
              <span style={{ opacity: step >= 4 ? 1 : 0.5 }}>{t('consulting.intake.progressPackage')}</span>
              <span style={{ opacity: step >= 5 ? 1 : 0.5 }}>{t('consulting.intake.progressConfirm')}</span>
            </div>
            <div style={{ width: '100%', height: '4px', background: 'var(--color-border)', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                background: 'var(--color-primary)',
                width: `${(step / 5) * 100}%`,
                transition: 'width 0.3s ease',
              }} />
            </div>
          </div>

          {/* Card */}
          <div style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: '16px',
            padding: '2.5rem',
            boxShadow: 'var(--shadow-md)',
          }}>
            {/* Title & Subtitle */}
            <h1 style={{ margin: '0 0 1rem', fontSize: '1.75rem', fontWeight: 700 }}>
              {step === 1 && t('consulting.intake.step1Title')}
              {step === 2 && t('consulting.intake.step2Title')}
              {step === 3 && t('consulting.intake.step3Title')}
              {step === 4 && t('consulting.intake.step4Title')}
              {step === 5 && t('consulting.intake.step5Title')}
            </h1>

            <p style={{ margin: '0 0 2rem', fontSize: '1rem', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
              {step === 1 && t('consulting.intake.step1Subtitle')}
              {step === 2 && t('consulting.intake.step2Subtitle')}
              {step === 3 && t('consulting.intake.step3Subtitle')}
              {step === 4 && t('consulting.intake.step4Subtitle')}
              {step === 5 && t('consulting.intake.step5Subtitle')}
            </p>

            {/* STEP 1: CONTACT */}
            {step === 1 && <Step1Contact form={form} handleInputChange={handleInputChange} t={t} />}

            {/* STEP 2: SKILL & OFFER */}
            {step === 2 && <Step2SkillOffer form={form} handleInputChange={handleInputChange} t={t} />}

            {/* STEP 3: SETUP NEEDS */}
            {step === 3 && (
              <Step3SetupNeeds
                form={form}
                handleInputChange={handleInputChange}
                handleCheckbox={handleCheckbox}
                handleSelectAll={handleSelectAll}
                allSetupItems={allSetupItems}
                businessPhases={businessPhases}
                setupItemsGrouped={setupItemsGrouped}
                t={t}
              />
            )}

            {/* STEP 4: PACKAGE SELECTION */}
            {step === 4 && <Step4PackageSelection form={form} setForm={setForm} packages={packages} t={t} />}

            {/* STEP 5: CONFIRMATION */}
            {step === 5 && <Step5Confirmation form={form} packages={packages} businessPhases={businessPhases} setupItemsGrouped={setupItemsGrouped} t={t} />}

            {/* Buttons */}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '2rem' }}>
              {step > 1 && (
                <button
                  onClick={() => setStep(step - 1)}
                  style={{
                    padding: '0.75rem 1.5rem',
                    borderRadius: '8px',
                    border: '1px solid var(--color-border)',
                    background: 'transparent',
                    color: 'var(--color-text)',
                    fontSize: '0.95rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                  disabled={loading}
                >
                  {t('consulting.intake.buttons.back')}
                </button>
              )}
              <button
                onClick={() => navigate('/')}
                style={{
                  padding: '0.75rem 1.5rem',
                  borderRadius: '8px',
                  border: '1px solid var(--color-border)',
                  background: 'transparent',
                  color: 'var(--color-text)',
                  fontSize: '0.95rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
                disabled={loading}
              >
                {t('consulting.intake.buttons.cancel')}
              </button>
              <button
                onClick={step === 5 ? handleSubmit : handleNext}
                style={{
                  padding: '0.75rem 1.5rem',
                  borderRadius: '8px',
                  border: 'none',
                  background: 'var(--color-primary)',
                  color: 'white',
                  fontSize: '0.95rem',
                  fontWeight: 600,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.7 : 1,
                  transition: 'all 0.2s',
                }}
                disabled={loading}
              >
                {loading ? t('consulting.intake.buttons.submitting') : step === 5 ? t('consulting.intake.buttons.submit') : t('consulting.intake.buttons.next')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}

// STEP 1: CONTACT
function Step1Contact({ form, handleInputChange, t }) {
  const referralOptions = [
    { value: 'marketplace', labelKey: 'consulting.intake.referralSource.marketplace' },
    { value: 'google', labelKey: 'consulting.intake.referralSource.google' },
    { value: 'referral', labelKey: 'consulting.intake.referralSource.referral' },
    { value: 'social', labelKey: 'consulting.intake.referralSource.social' },
    { value: 'other', labelKey: 'consulting.intake.referralSource.other' },
  ];

  return (
    <>
      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>{t('consulting.intake.formFields.emailLabel')} *</label>
        <input
          type="email"
          name="email"
          value={form.email}
          onChange={handleInputChange}
          style={{ width: '100%', padding: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.95rem' }}
          required
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>{t('consulting.intake.formFields.firstNameLabel')} *</label>
          <input
            type="text"
            name="first_name"
            value={form.first_name}
            onChange={handleInputChange}
            style={{ width: '100%', padding: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.95rem' }}
            required
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>{t('consulting.intake.formFields.lastNameLabel')} *</label>
          <input
            type="text"
            name="last_name"
            value={form.last_name}
            onChange={handleInputChange}
            style={{ width: '100%', padding: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.95rem' }}
            required
          />
        </div>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>{t('consulting.intake.formFields.phoneLabel')} *</label>
        <input
          type="tel"
          name="phone"
          value={form.phone}
          onChange={handleInputChange}
          style={{ width: '100%', padding: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.95rem' }}
          placeholder={t('consulting.intake.formFields.phoneNumberPlaceholder')}
          required
        />
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>{t('consulting.intake.formFields.howDidYouHear')}</label>
        <select
          name="referral_source"
          value={form.referral_source}
          onChange={handleInputChange}
          style={{ width: '100%', padding: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.95rem' }}
        >
          <option value="">{t('consulting.intake.formFields.selectOption')}</option>
          {referralOptions.map(opt => (
            <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
          ))}
        </select>
      </div>
    </>
  );
}

// STEP 2: SKILL & OFFER
function Step2SkillOffer({ form, handleInputChange, t }) {
  const revenueOptions = [
    { value: 'no', labelKey: 'consulting.intake.revenueOptions.no' },
    { value: 'informal', labelKey: 'consulting.intake.revenueOptions.informal' },
    { value: 'formal', labelKey: 'consulting.intake.revenueOptions.formal' },
  ];

  const businessNameOptions = [
    { value: 'yes', labelKey: 'consulting.intake.businessNameOptions.yes' },
    { value: 'no', labelKey: 'consulting.intake.businessNameOptions.no' },
  ];

  return (
    <>
      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>{t('consulting.intake.formFields.skillQuestion')} *</label>
        <input
          type="text"
          name="skill_description"
          value={form.skill_description}
          onChange={handleInputChange}
          style={{ width: '100%', padding: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.95rem' }}
          placeholder={t('consulting.intake.formFields.skillPlaceholder')}
          required
        />
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>{t('consulting.intake.formFields.targetMarketQuestion')} *</label>
        <input
          type="text"
          name="target_market"
          value={form.target_market}
          onChange={handleInputChange}
          style={{ width: '100%', padding: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.95rem' }}
          placeholder={t('consulting.intake.formFields.targetMarketPlaceholder')}
          required
        />
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.75rem' }}>{t('consulting.intake.formFields.revenueQuestion')} *</label>
        <div style={{ display: 'flex', gap: '1rem' }}>
          {revenueOptions.map(opt => (
            <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="radio"
                name="has_revenue"
                value={opt.value}
                checked={form.has_revenue === opt.value}
                onChange={handleInputChange}
              />
              <span style={{ fontSize: '0.95rem' }}>{t(opt.labelKey)}</span>
            </label>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.75rem' }}>{t('consulting.intake.formFields.businessNameQuestion')} *</label>
        <div style={{ display: 'flex', gap: '1rem' }}>
          {businessNameOptions.map(opt => (
            <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="radio"
                name="business_name_decided"
                value={opt.value}
                checked={form.business_name_decided === opt.value}
                onChange={handleInputChange}
              />
              <span style={{ fontSize: '0.95rem' }}>{t(opt.labelKey)}</span>
            </label>
          ))}
        </div>
      </div>

      {form.business_name_decided === 'yes' && (
        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>{t('consulting.intake.formFields.businessNameInputLabel')} *</label>
          <input
            type="text"
            name="business_name"
            value={form.business_name}
            onChange={handleInputChange}
            style={{ width: '100%', padding: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.95rem' }}
            placeholder={t('consulting.intake.formFields.businessNamePlaceholder')}
            required
          />
        </div>
      )}

      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>{t('consulting.intake.formFields.countryQuestion')} *</label>
        <select
          name="operating_country"
          value={form.operating_country}
          onChange={handleInputChange}
          style={{ width: '100%', padding: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.95rem' }}
          required
        >
          <option value="">{t('consulting.intake.formFields.selectCountry')}</option>
          {COUNTRY_CODES_SORTED.map(code => (
            <option key={code} value={code}>{ALL_COUNTRIES[code]}</option>
          ))}
        </select>
      </div>

      {form.operating_country && (
        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>
            {COUNTRIES_WITH_REGIONS[form.operating_country]?.regionLabel || 'City'} *
          </label>

          {COUNTRIES_WITH_REGIONS[form.operating_country] ? (
            // Countries WITH predefined regions/states
            <select
              name="operating_state"
              value={form.operating_state}
              onChange={handleInputChange}
              style={{ width: '100%', padding: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.95rem' }}
              required
            >
              <option value="">{t('consulting.intake.formFields.selectRegion')}</option>
              {COUNTRIES_WITH_REGIONS[form.operating_country].regions.map(region => (
                <option key={region} value={region}>{region}</option>
              ))}
            </select>
          ) : (
            // Countries WITHOUT predefined regions (show text input for city)
            <input
              type="text"
              name="operating_state"
              value={form.operating_state}
              onChange={handleInputChange}
              placeholder={t('consulting.intake.formFields.cityPlaceholder')}
              style={{ width: '100%', padding: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.95rem' }}
              required
            />
          )}
        </div>
      )}
    </>
  );
}

// STEP 3: SETUP NEEDS
function Step3SetupNeeds({ form, handleInputChange, handleCheckbox, handleSelectAll, allSetupItems, businessPhases, setupItemsGrouped, t }) {
  const urgencyOptions = [
    { value: 'exploring', labelKey: 'consulting.intake.urgencyOptions.exploring' },
    { value: 'two_weeks', labelKey: 'consulting.intake.urgencyOptions.twoWeeks' },
    { value: 'asap', labelKey: 'consulting.intake.urgencyOptions.asap' },
  ];

  return (
    <>
      {/* Select All Toggle */}
      <div style={{ marginBottom: '2rem', padding: '1rem', background: 'var(--color-bg)', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <input
          type="checkbox"
          checked={form.select_all_chosen}
          onChange={handleSelectAll}
          style={{ cursor: 'pointer', width: '18px', height: '18px' }}
        />
        <label style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.95rem' }}>
          {t('consulting.intake.selectAllLabel')} ({form.setup_items_selected.length} / {allSetupItems.length} items)
        </label>
      </div>

      {/* Grouped Checkboxes */}
      {Object.entries(setupItemsGrouped).map(([group, items]) => (
        <div key={group} style={{ marginBottom: '2rem' }}>
          <h4 style={{ margin: '0 0 1rem', fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-text)' }}>{group}</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.75rem' }}>
            {items.map(item => (
              <label key={item.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: 'pointer', padding: '0.5rem' }}>
                <input
                  type="checkbox"
                  checked={form.setup_items_selected.includes(item.id)}
                  onChange={() => handleCheckbox(item.id)}
                  style={{ marginTop: '3px', cursor: 'pointer', width: '18px', height: '18px', minWidth: '18px' }}
                />
                <span style={{ fontSize: '0.95rem', lineHeight: 1.5 }}>{item.label}</span>
              </label>
            ))}
          </div>
        </div>
      ))}

      <div style={{ marginBottom: '1.5rem', marginTop: '2rem', borderTop: '1px solid var(--color-border)', paddingTop: '2rem' }}>
        <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>{t('consulting.intake.formFields.businessPhaseQuestion')} *</label>
        <select
          name="current_phase"
          value={form.current_phase}
          onChange={handleInputChange}
          style={{ width: '100%', padding: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.95rem' }}
        >
          <option value="">{t('consulting.intake.formFields.selectPhase')}</option>
          {businessPhases.map(phase => (
            <option key={phase.id} value={phase.id}>
              {t('consulting.intake.phaseLabel', { id: phase.id, name: phase.name })}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>{t('consulting.intake.formFields.additionalNotes')}</label>
        <textarea
          name="additional_notes"
          value={form.additional_notes}
          onChange={handleInputChange}
          style={{ width: '100%', padding: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.95rem', resize: 'vertical', minHeight: '100px' }}
          placeholder={t('consulting.intake.formFields.additionalNotesPlaceholder')}
        />
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.75rem' }}>{t('consulting.intake.formFields.urgencyLabel')} *</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {urgencyOptions.map(opt => (
            <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="radio"
                name="urgency"
                value={opt.value}
                checked={form.urgency === opt.value}
                onChange={handleInputChange}
              />
              <span style={{ fontSize: '0.95rem' }}>{t(opt.labelKey)}</span>
            </label>
          ))}
        </div>
      </div>
    </>
  );
}

// STEP 4: PACKAGE SELECTION
function Step4PackageSelection({ form, setForm, packages, t }) {
  return (
    <>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: '1.5rem',
        marginBottom: '2rem',
      }}>
        {Object.entries(packages).map(([key, pkg]) => (
          <div
            key={key}
            onClick={() => setForm(prev => ({ ...prev, package_selected: key }))}
            style={{
              padding: '1.5rem',
              border: form.package_selected === key ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
              borderRadius: '12px',
              background: 'var(--color-bg)',
              cursor: 'pointer',
              transition: 'all 0.2s',
              position: 'relative',
              backgroundColor: form.package_selected === key ? 'rgba(249, 115, 22, 0.05)' : 'var(--color-bg)',
            }}
          >
            {pkg.popular && (
              <div style={{ position: 'absolute', top: '-12px', left: '50%', transform: 'translateX(-50%)', background: 'var(--color-primary)', color: 'white', padding: '0.25rem 0.75rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600 }}>
                {t('consulting.intake.packageDetails.mostPopular')}
              </div>
            )}

            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.25rem', fontWeight: 700 }}>{pkg.name}</h3>
            <p style={{ margin: '0 0 1.5rem', fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-primary)' }}>${pkg.price}</p>
            <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>{t('consulting.intake.packageDetails.timeline')}: {pkg.timeline}</p>
            <p style={{ margin: '0 0 1rem', fontSize: '0.9rem', fontWeight: 500 }}>{t('consulting.intake.packageDetails.bestFor')}: {pkg.forWho}</p>

            <div style={{ fontSize: '0.9rem', lineHeight: 1.6, color: 'var(--color-text)' }}>
              {pkg.features.map((feature, idx) => (
                <div key={idx} style={{ marginBottom: '0.5rem' }}>
                  {feature.startsWith('Everything') ? (
                    <strong>{feature}</strong>
                  ) : (
                    <>✓ {feature}</>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div style={{ background: 'rgba(249, 115, 22, 0.05)', padding: '1rem', borderRadius: '8px', fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
        {t('consulting.intake.packageHelper')}
      </div>
    </>
  );
}

// STEP 5: CONFIRMATION
function Step5Confirmation({ form, packages, businessPhases, setupItemsGrouped, t }) {
  const pkgName = form.package_selected && packages[form.package_selected]?.name;
  const pkgPrice = form.package_selected && packages[form.package_selected]?.price;
  const selectedCount = form.setup_items_selected.length;
  const selectedLabels = Object.values(setupItemsGrouped)
    .flatMap(group => group)
    .filter(item => form.setup_items_selected.includes(item.id))
    .slice(0, 5);

  const urgencyLabel = {
    exploring: t('consulting.intake.urgencyOptions.exploring'),
    two_weeks: t('consulting.intake.urgencyOptions.twoWeeks'),
    asap: t('consulting.intake.urgencyOptions.asap'),
  }[form.urgency];

  return (
    <>
      <div style={{ background: 'var(--color-bg)', borderRadius: '8px', padding: '1.5rem', marginBottom: '1.5rem' }}>
        <h3 style={{ margin: '0 0 1rem', fontSize: '1.1rem', fontWeight: 600 }}>{t('consulting.intake.confirmation.yourInformation')}</h3>

        <div style={{ fontSize: '0.9rem', lineHeight: 1.8 }}>
          <p><strong>{t('consulting.intake.confirmation.name')}:</strong> {form.first_name} {form.last_name}</p>
          <p><strong>{t('consulting.intake.confirmation.email')}:</strong> {form.email}</p>
          <p><strong>{t('consulting.intake.confirmation.phone')}:</strong> {form.phone}</p>
          {form.referral_source && <p><strong>{t('consulting.intake.confirmation.howYouHeard')}:</strong> {t(`consulting.intake.referralSource.${form.referral_source}`)}</p>}

          <p style={{ marginTop: '1rem' }}><strong>{t('consulting.intake.confirmation.skill')}:</strong> {form.skill_description}</p>
          <p><strong>{t('consulting.intake.confirmation.targetMarket')}:</strong> {form.target_market}</p>
          <p><strong>{t('consulting.intake.confirmation.businessName')}:</strong> {form.business_name || t('consulting.intake.confirmation.notYetDecided')}</p>
          <p><strong>{t('consulting.intake.confirmation.country')}:</strong> {ALL_COUNTRIES[form.operating_country] || form.operating_country}</p>
          <p><strong>{COUNTRIES_WITH_REGIONS[form.operating_country]?.regionLabel || 'City'}:</strong> {form.operating_state}</p>

          <p style={{ marginTop: '1rem' }}><strong>{t('consulting.intake.confirmation.selectedPackage')}:</strong> {pkgName} (${pkgPrice})</p>
          <p><strong>{t('consulting.intake.confirmation.urgency')}:</strong> {urgencyLabel}</p>
          <p><strong>{t('consulting.intake.confirmation.setupItems')}:</strong> {form.select_all_chosen ? t('consulting.intake.confirmation.allItems') : `${selectedCount > 5 ? `${selectedCount} ${t('consulting.intake.confirmation.items')} (${t('consulting.intake.confirmation.showingFirstFive')}):` : selectedCount + ' ' + t('consulting.intake.confirmation.items') + ':'}`}</p>
          {!form.select_all_chosen && selectedLabels.map((item, idx) => (
            <p key={item.id} style={{ margin: '0.25rem 0', marginLeft: '1rem' }}>✓ {item.label}</p>
          ))}
        </div>
      </div>

      <div style={{ background: 'rgba(249, 115, 22, 0.05)', padding: '1.5rem', borderRadius: '8px', marginBottom: '1.5rem', borderLeft: '4px solid var(--color-primary)' }}>
        <p style={{ margin: '0 0 1rem', fontSize: '0.9rem', fontWeight: 600 }}>{t('consulting.intake.confirmation.whatHappensNext')}</p>
        <ol style={{ margin: 0, paddingLeft: '1.5rem', fontSize: '0.9rem', lineHeight: 1.6 }}>
          <li>{t('consulting.intake.confirmation.step1')}</li>
          <li>{t('consulting.intake.confirmation.step2')}</li>
          <li>{t('consulting.intake.confirmation.step3')}</li>
          <li>{t('consulting.intake.confirmation.step4')}</li>
        </ol>
      </div>

      <div style={{ background: 'rgba(239, 68, 68, 0.05)', padding: '1rem', borderRadius: '8px', fontSize: '0.85rem', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
        <strong>{t('consulting.intake.confirmation.importantLabel')}:</strong> {t('consulting.intake.confirmation.disclaimer')}
      </div>
    </>
  );
}
