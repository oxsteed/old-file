import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';
import api from '../api/axios';

// Phase data - 25 phases with names
const BUSINESS_PHASES = [
  { id: 1, name: 'Skill Clarity' },
  { id: 2, name: 'Offer Selection' },
  { id: 3, name: 'Customer Definition' },
  { id: 4, name: 'Pricing Setup' },
  { id: 5, name: 'Business Name Decision' },
  { id: 6, name: 'Domain Registration' },
  { id: 7, name: 'Brand Starter Kit' },
  { id: 8, name: 'Business Email Setup' },
  { id: 9, name: 'Phone Number Setup' },
  { id: 10, name: 'Business Address Setup' },
  { id: 11, name: 'LLC or Entity Filing' },
  { id: 12, name: 'EIN Registration' },
  { id: 13, name: 'Operating Docs Folder' },
  { id: 14, name: 'Business Bank Account' },
  { id: 15, name: 'Payment Processor Setup' },
  { id: 16, name: 'Accounting Starter System' },
  { id: 17, name: 'Website Launch' },
  { id: 18, name: 'Contact Form & Lead Capture' },
  { id: 19, name: 'Scheduling System' },
  { id: 20, name: 'Service Agreement Templates' },
  { id: 21, name: 'Client Intake Workflow' },
  { id: 22, name: 'Social Proof Setup' },
  { id: 23, name: 'Google Business & Online Listings' },
  { id: 24, name: 'Launch Outreach System' },
  { id: 25, name: 'First Client Operating System' },
];

// Setup items grouped by category
const SETUP_ITEMS_GROUPED = {
  'Business Formation': [
    { id: 'llc_filing', label: 'LLC or Business Entity Filing' },
    { id: 'ein_registration', label: 'EIN (Federal Tax ID) Registration' },
    { id: 'business_address', label: 'Business Mailing Address Setup' },
    { id: 'operating_docs', label: 'Operating Documents Folder (organized digital records)' },
  ],
  'Digital Identity': [
    { id: 'domain_registration', label: 'Domain Name Registration' },
    { id: 'business_email', label: 'Professional Email (e.g. you@yourbusiness.com)' },
    { id: 'business_phone', label: 'Dedicated Business Phone Number' },
    { id: 'logo_branding', label: 'Logo & Basic Brand Kit (colors, fonts, simple logo)' },
  ],
  'Online Presence': [
    { id: 'website_build', label: 'Website Build (homepage, services, about, contact)' },
    { id: 'contact_form', label: 'Contact Form & Lead Capture' },
    { id: 'google_business', label: 'Google Business Profile Setup' },
    { id: 'social_media', label: 'Social Media Handle Reservation' },
  ],
  'Business Operations': [
    { id: 'payment_processor', label: 'Payment Processor Setup (Stripe, Square, or PayPal)' },
    { id: 'scheduling_system', label: 'Online Scheduling System (booking page)' },
    { id: 'client_intake', label: 'Client Intake Form & Workflow' },
    { id: 'invoice_templates', label: 'Invoice & Proposal Templates' },
    { id: 'bookkeeping_system', label: 'Basic Bookkeeping Starter System' },
  ],
  'Launch Support': [
    { id: 'outreach_templates', label: 'First Client Outreach Templates' },
    { id: 'referral_system', label: 'Referral Request System' },
    { id: 'online_listings', label: 'Online Business Listings Setup' },
    { id: 'launch_support', label: 'Post-Launch 30-Day Support' },
  ],
};

const PACKAGES = {
  initial: {
    name: 'Initial Consultation',
    price: 100,
    timeline: 'Up to 2 hours',
    forWho: 'People who want to explore whether a consulting program is right for them',
    features: [
      'Strategy deep-dive call (up to 2 hours)',
      'Business assessment & opportunity audit',
      'Implementation roadmap & timeline',
      'Custom recommendation for next steps',
      'Q&A on your specific situation',
    ],
  },
  foundation: {
    name: 'Business Foundation',
    price: 750,
    timeline: '1–2 weeks',
    forWho: 'People who just need the legal and identity layer set up',
    features: [
      'Business name guidance',
      'Domain registration',
      'Professional email setup',
      'Business phone number',
      'Business address setup',
      'LLC filing guidance + EIN support',
      'Organized documents folder',
    ],
  },
  launch: {
    name: 'Business Launch',
    price: 1500,
    timeline: '2–3 weeks',
    forWho: 'People who want a fully operational business presence',
    features: [
      'Everything in Foundation plus:',
      'Logo & basic brand kit',
      '4-page website (Home, Services, About, Contact)',
      'Contact form & lead capture',
      'Online scheduling setup',
      'Payment processor setup',
      'Invoice template',
      'Launch checklist & go-live review',
    ],
    popular: true,
  },
  accelerator: {
    name: 'Business Accelerator',
    price: 3000,
    timeline: '3–4 weeks',
    forWho: 'People who want everything done and a system to grow',
    features: [
      'Everything in Launch plus:',
      'Google Business Profile setup',
      'Social media handle reservation',
      'Client intake workflow',
      'Bookkeeping starter system',
      'Referral request system',
      'Online listings setup',
      '30-day post-launch check-in call',
      'First client outreach templates',
    ],
  },
};

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
];

export default function ConsultingIntakePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);

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
    operating_state: '',

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
        toast.error('Please fill in all required fields');
        return false;
      }
      return true;
    } else if (step === 2) {
      if (!form.skill_description || !form.target_market || !form.has_revenue || !form.business_name_decided || !form.operating_state) {
        toast.error('Please fill in all required fields');
        return false;
      }
      if (form.business_name_decided === 'yes' && !form.business_name) {
        toast.error('Please enter your business name');
        return false;
      }
      return true;
    } else if (step === 3) {
      if (!form.urgency || form.setup_items_selected.length === 0) {
        toast.error('Please select your urgency and at least one setup item');
        return false;
      }
      return true;
    } else if (step === 4) {
      if (!form.package_selected) {
        toast.error('Please select a package');
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
      const packagePrice = PACKAGES[form.package_selected].price;

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
        operating_state: form.operating_state,
        setup_items_selected: form.setup_items_selected,
        select_all_chosen: form.select_all_chosen,
        current_phase: form.current_phase ? parseInt(form.current_phase) : null,
        additional_notes: form.additional_notes,
        urgency: form.urgency,
        package_selected: form.package_selected,
        package_price: packagePrice,
      });

      toast.success('Your request has been submitted! Check your email for confirmation.');
      setTimeout(() => navigate('/'), 2000);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to submit. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Get all setup items as flat array
  const allSetupItems = Object.values(SETUP_ITEMS_GROUPED).flatMap(group => group);

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
              <span style={{ opacity: step >= 1 ? 1 : 0.5 }}>Contact</span>
              <span style={{ opacity: step >= 2 ? 1 : 0.5 }}>Skill & Offer</span>
              <span style={{ opacity: step >= 3 ? 1 : 0.5 }}>Setup Needs</span>
              <span style={{ opacity: step >= 4 ? 1 : 0.5 }}>Package</span>
              <span style={{ opacity: step >= 5 ? 1 : 0.5 }}>Confirm</span>
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
              {step === 1 && 'Your Contact Information'}
              {step === 2 && 'Tell Us About Your Skill'}
              {step === 3 && 'What Do You Need Set Up?'}
              {step === 4 && 'Choose Your Package'}
              {step === 5 && 'Review & Submit'}
            </h1>

            <p style={{ margin: '0 0 2rem', fontSize: '1rem', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
              {step === 1 && 'Let us know the best way to reach you.'}
              {step === 2 && 'We help people turn skills into real businesses. Tell us what you do so we can customize your setup plan.'}
              {step === 3 && 'Select everything that applies. We handle the implementation so you can focus on your craft.'}
              {step === 4 && 'All packages are flat-fee, delivered in 2–4 weeks. No hourly billing. No surprises.'}
              {step === 5 && 'Here is a summary of your request. We will confirm your package and schedule your kickoff call within 24 hours.'}
            </p>

            {/* STEP 1: CONTACT */}
            {step === 1 && <Step1Contact form={form} handleInputChange={handleInputChange} />}

            {/* STEP 2: SKILL & OFFER */}
            {step === 2 && <Step2SkillOffer form={form} handleInputChange={handleInputChange} />}

            {/* STEP 3: SETUP NEEDS */}
            {step === 3 && (
              <Step3SetupNeeds
                form={form}
                handleInputChange={handleInputChange}
                handleCheckbox={handleCheckbox}
                handleSelectAll={handleSelectAll}
                allSetupItems={allSetupItems}
              />
            )}

            {/* STEP 4: PACKAGE SELECTION */}
            {step === 4 && <Step4PackageSelection form={form} setForm={setForm} />}

            {/* STEP 5: CONFIRMATION */}
            {step === 5 && <Step5Confirmation form={form} />}

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
                  Back
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
                Cancel
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
                {loading ? 'Submitting...' : step === 5 ? 'Submit & Get Started' : 'Next'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}

// STEP 1: CONTACT
function Step1Contact({ form, handleInputChange }) {
  const referralOptions = [
    { value: 'marketplace', label: 'OxSteed Marketplace' },
    { value: 'google', label: 'Google Search' },
    { value: 'referral', label: 'Referral from a Friend' },
    { value: 'social', label: 'Social Media' },
    { value: 'other', label: 'Other' },
  ];

  return (
    <>
      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>Email *</label>
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
          <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>First Name *</label>
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
          <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>Last Name *</label>
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
        <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>Phone Number *</label>
        <input
          type="tel"
          name="phone"
          value={form.phone}
          onChange={handleInputChange}
          style={{ width: '100%', padding: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.95rem' }}
          placeholder="(555) 123-4567"
          required
        />
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>How did you hear about us?</label>
        <select
          name="referral_source"
          value={form.referral_source}
          onChange={handleInputChange}
          style={{ width: '100%', padding: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.95rem' }}
        >
          <option value="">Select an option</option>
          {referralOptions.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    </>
  );
}

// STEP 2: SKILL & OFFER
function Step2SkillOffer({ form, handleInputChange }) {
  return (
    <>
      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>What is your primary skill or service? *</label>
        <input
          type="text"
          name="skill_description"
          value={form.skill_description}
          onChange={handleInputChange}
          style={{ width: '100%', padding: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.95rem' }}
          placeholder="e.g. Pressure washing, Graphic design, Bookkeeping, Tutoring"
          required
        />
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>Who do you want to serve with this skill? *</label>
        <input
          type="text"
          name="target_market"
          value={form.target_market}
          onChange={handleInputChange}
          style={{ width: '100%', padding: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.95rem' }}
          placeholder="e.g. Homeowners in my area, small business owners, local restaurants"
          required
        />
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.75rem' }}>Have you made any money from this skill yet? *</label>
        <div style={{ display: 'flex', gap: '1rem' }}>
          {[
            { value: 'no', label: 'No, not yet' },
            { value: 'informal', label: 'Yes, informally (cash/Venmo)' },
            { value: 'formal', label: 'Yes, I have paying clients' },
          ].map(opt => (
            <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="radio"
                name="has_revenue"
                value={opt.value}
                checked={form.has_revenue === opt.value}
                onChange={handleInputChange}
              />
              <span style={{ fontSize: '0.95rem' }}>{opt.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.75rem' }}>Do you already have a business name in mind? *</label>
        <div style={{ display: 'flex', gap: '1rem' }}>
          {[
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No, I need help choosing one' },
          ].map(opt => (
            <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="radio"
                name="business_name_decided"
                value={opt.value}
                checked={form.business_name_decided === opt.value}
                onChange={handleInputChange}
              />
              <span style={{ fontSize: '0.95rem' }}>{opt.label}</span>
            </label>
          ))}
        </div>
      </div>

      {form.business_name_decided === 'yes' && (
        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>What is it? *</label>
          <input
            type="text"
            name="business_name"
            value={form.business_name}
            onChange={handleInputChange}
            style={{ width: '100%', padding: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.95rem' }}
            placeholder="Enter your preferred business name"
            required
          />
        </div>
      )}

      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>What US state will this business operate in? *</label>
        <select
          name="operating_state"
          value={form.operating_state}
          onChange={handleInputChange}
          style={{ width: '100%', padding: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.95rem' }}
          required
        >
          <option value="">Select a state</option>
          {US_STATES.map(state => (
            <option key={state} value={state}>{state}</option>
          ))}
        </select>
      </div>
    </>
  );
}

// STEP 3: SETUP NEEDS
function Step3SetupNeeds({ form, handleInputChange, handleCheckbox, handleSelectAll, allSetupItems }) {
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
          Select All ({form.setup_items_selected.length} / {allSetupItems.length} items)
        </label>
      </div>

      {/* Grouped Checkboxes */}
      {Object.entries(SETUP_ITEMS_GROUPED).map(([group, items]) => (
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
        <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>Current business phase (1–25) *</label>
        <select
          name="current_phase"
          value={form.current_phase}
          onChange={handleInputChange}
          style={{ width: '100%', padding: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.95rem' }}
        >
          <option value="">Select a phase</option>
          {BUSINESS_PHASES.map(phase => (
            <option key={phase.id} value={phase.id}>
              Phase {phase.id} – {phase.name}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>Tell us more (optional)</label>
        <textarea
          name="additional_notes"
          value={form.additional_notes}
          onChange={handleInputChange}
          style={{ width: '100%', padding: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.95rem', resize: 'vertical', minHeight: '100px' }}
          placeholder="Describe your situation, timeline, or anything specific you want us to know..."
        />
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.75rem' }}>Urgency *</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {[
            { value: 'exploring', label: 'Just exploring' },
            { value: 'two_weeks', label: 'Ready to start within 2 weeks' },
            { value: 'asap', label: 'I need this done as soon as possible' },
          ].map(opt => (
            <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="radio"
                name="urgency"
                value={opt.value}
                checked={form.urgency === opt.value}
                onChange={handleInputChange}
              />
              <span style={{ fontSize: '0.95rem' }}>{opt.label}</span>
            </label>
          ))}
        </div>
      </div>
    </>
  );
}

// STEP 4: PACKAGE SELECTION
function Step4PackageSelection({ form, setForm }) {
  return (
    <>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: '1.5rem',
        marginBottom: '2rem',
      }}>
        {Object.entries(PACKAGES).map(([key, pkg]) => (
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
                MOST POPULAR
              </div>
            )}

            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.25rem', fontWeight: 700 }}>{pkg.name}</h3>
            <p style={{ margin: '0 0 1.5rem', fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-primary)' }}>${pkg.price}</p>
            <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>Timeline: {pkg.timeline}</p>
            <p style={{ margin: '0 0 1rem', fontSize: '0.9rem', fontWeight: 500 }}>Best for: {pkg.forWho}</p>

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
        Not sure which package fits? Select the one that seems closest and we will confirm the right fit during your kickoff call. All packages include a 30-minute kickoff call.
      </div>
    </>
  );
}

// STEP 5: CONFIRMATION
function Step5Confirmation({ form }) {
  const pkgName = form.package_selected && PACKAGES[form.package_selected]?.name;
  const pkgPrice = form.package_selected && PACKAGES[form.package_selected]?.price;
  const selectedCount = form.setup_items_selected.length;
  const selectedLabels = Object.values(SETUP_ITEMS_GROUPED)
    .flatMap(group => group)
    .filter(item => form.setup_items_selected.includes(item.id))
    .slice(0, 5);

  return (
    <>
      <div style={{ background: 'var(--color-bg)', borderRadius: '8px', padding: '1.5rem', marginBottom: '1.5rem' }}>
        <h3 style={{ margin: '0 0 1rem', fontSize: '1.1rem', fontWeight: 600 }}>Your Information</h3>

        <div style={{ fontSize: '0.9rem', lineHeight: 1.8 }}>
          <p><strong>Name:</strong> {form.first_name} {form.last_name}</p>
          <p><strong>Email:</strong> {form.email}</p>
          <p><strong>Phone:</strong> {form.phone}</p>
          {form.referral_source && <p><strong>How you heard about us:</strong> {form.referral_source}</p>}

          <p style={{ marginTop: '1rem' }}><strong>Skill:</strong> {form.skill_description}</p>
          <p><strong>Target Market:</strong> {form.target_market}</p>
          <p><strong>Business Name:</strong> {form.business_name || 'Not yet decided'}</p>
          <p><strong>State:</strong> {form.operating_state}</p>

          <p style={{ marginTop: '1rem' }}><strong>Selected Package:</strong> {pkgName} (${pkgPrice})</p>
          <p><strong>Urgency:</strong> {form.urgency === 'exploring' && 'Just exploring'}{form.urgency === 'two_weeks' && 'Ready to start within 2 weeks'}{form.urgency === 'asap' && 'ASAP'}</p>
          <p><strong>Setup Items:</strong> {form.select_all_chosen ? 'All items' : `${selectedCount > 5 ? `${selectedCount} items (showing first 5):` : selectedCount + ' items:'}`}</p>
          {!form.select_all_chosen && selectedLabels.map((item, idx) => (
            <p key={item.id} style={{ margin: '0.25rem 0', marginLeft: '1rem' }}>✓ {item.label}</p>
          ))}
        </div>
      </div>

      <div style={{ background: 'rgba(249, 115, 22, 0.05)', padding: '1.5rem', borderRadius: '8px', marginBottom: '1.5rem', borderLeft: '4px solid var(--color-primary)' }}>
        <p style={{ margin: '0 0 1rem', fontSize: '0.9rem', fontWeight: 600 }}>What Happens Next</p>
        <ol style={{ margin: 0, paddingLeft: '1.5rem', fontSize: '0.9rem', lineHeight: 1.6 }}>
          <li>We review your request (usually within 24 hours)</li>
          <li>You'll receive a scheduling link to book your kickoff call</li>
          <li>We send you a pre-kickoff questionnaire to complete</li>
          <li>Your setup work begins after the kickoff call</li>
        </ol>
      </div>

      <div style={{ background: 'rgba(239, 68, 68, 0.05)', padding: '1rem', borderRadius: '8px', fontSize: '0.85rem', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
        <strong>Important:</strong> OxSteed Business Launch provides business setup implementation support only. We do not provide legal, tax, or financial advice. For questions involving legal entity selection, tax obligations, or regulated financial matters, please consult a licensed professional.
      </div>
    </>
  );
}
