import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { submitConsultingRequest, getAreasOfHelp, getServiceTiers } from '../api/consulting';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';

export default function ConsultingIntakePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1); // 1: Contact, 2: Services, 3: Confirmation
  const [areasOfHelp, setAreasOfHelp] = useState([]);
  const [serviceTiers, setServiceTiers] = useState([]);

  const [form, setForm] = useState({
    email: user?.email || '',
    first_name: user?.first_name || '',
    last_name: user?.last_name || '',
    business_name: '',
    phone: '',
    current_phase: '',
    service_tier: 'initial',
    areas_of_help: [],
    description: '',
    preferred_date: '',
    preferred_time_slot: 'flexible',
  });

  useEffect(() => {
    fetchAreasOfHelp();
    fetchServiceTiers();
  }, []);

  async function fetchAreasOfHelp() {
    try {
      const areas = await getAreasOfHelp();
      setAreasOfHelp(areas);
    } catch (err) {
      console.error('Failed to fetch areas of help', err);
    }
  }

  async function fetchServiceTiers() {
    try {
      const tiers = await getServiceTiers();
      setServiceTiers(tiers);
    } catch (err) {
      console.error('Failed to fetch service tiers', err);
    }
  }

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleAreaToggle = (area) => {
    setForm(prev => ({
      ...prev,
      areas_of_help: prev.areas_of_help.includes(area)
        ? prev.areas_of_help.filter(a => a !== area)
        : [...prev.areas_of_help, area],
    }));
  };

  const handleSubmit = async () => {
    if (step === 1) {
      // Validate contact info
      if (!form.email || !form.first_name || !form.last_name) {
        toast.error(t('consulting.errorMissingInfo'));
        return;
      }
      setStep(2);
    } else if (step === 2) {
      setStep(3);
    } else if (step === 3) {
      await submitForm();
    }
  };

  async function submitForm() {
    setLoading(true);
    try {
      await submitConsultingRequest(form);
      toast.success(t('consulting.successSubmitted'));
      setTimeout(() => {
        navigate('/dashboard');
      }, 2000);
    } catch (err) {
      toast.error(err.response?.data?.error || t('consulting.errorSubmit'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageShell>
      <PageMeta
        title={t('consulting.intakePageTitle')}
        description={t('consulting.intakePageDesc')}
        url={`${window.location.origin}/consulting-intake`}
      />

      <div style={{ minHeight: '100vh', background: 'var(--color-bg)', padding: '2rem 1rem' }}>
        <div style={{ maxWidth: '700px', margin: '0 auto' }}>
          {/* Progress */}
          <div style={{ marginBottom: '3rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', fontSize: '0.85rem' }}>
              <span style={{ opacity: step >= 1 ? 1 : 0.5 }}>{t('consulting.stepContact')}</span>
              <span style={{ opacity: step >= 2 ? 1 : 0.5 }}>{t('consulting.stepServices')}</span>
              <span style={{ opacity: step >= 3 ? 1 : 0.5 }}>{t('consulting.stepConfirm')}</span>
            </div>
            <div style={{ width: '100%', height: '4px', background: 'var(--color-border)', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                background: 'var(--color-primary)',
                width: `${(step / 3) * 100}%`,
                transition: 'width 0.3s ease'
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
            {/* Title */}
            <h1 style={{ margin: '0 0 1rem', fontSize: '1.75rem', fontWeight: 700 }}>
              {step === 1 && t('consulting.title')}
              {step === 2 && t('consulting.servicesTitle')}
              {step === 3 && t('consulting.confirmTitle')}
            </h1>

            {/* Subtitle */}
            <p style={{ margin: '0 0 2rem', fontSize: '1rem', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
              {step === 1 && t('consulting.subtitle')}
              {step === 2 && t('consulting.servicesSubtitle')}
              {step === 3 && t('consulting.confirmSubtitle')}
            </p>

            {/* Step 1: Contact Information */}
            {step === 1 && (
              <>
                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>{t('consulting.email')}</label>
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
                    <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>{t('consulting.firstName')}</label>
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
                    <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>{t('consulting.lastName')}</label>
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
                  <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>{t('consulting.businessName')} ({t('common.optional')})</label>
                  <input
                    type="text"
                    name="business_name"
                    value={form.business_name}
                    onChange={handleInputChange}
                    style={{ width: '100%', padding: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.95rem' }}
                    placeholder={t('consulting.businessNamePlaceholder')}
                  />
                </div>

                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>{t('consulting.phone')} ({t('common.optional')})</label>
                  <input
                    type="tel"
                    name="phone"
                    value={form.phone}
                    onChange={handleInputChange}
                    style={{ width: '100%', padding: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.95rem' }}
                    placeholder="(555) 123-4567"
                  />
                </div>
              </>
            )}

            {/* Step 2: Services & Preferences */}
            {step === 2 && (
              <>
                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>{t('consulting.serviceTier')}</label>
                  <select
                    name="service_tier"
                    value={form.service_tier}
                    onChange={handleInputChange}
                    style={{ width: '100%', padding: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.95rem' }}
                  >
                    <option value="initial">${t('consulting.initialConsultation')}</option>
                    <option value="foundation">Foundation Blueprint</option>
                    <option value="implementation">Implementation Partnership</option>
                    <option value="transformation">Transformation Alliance</option>
                  </select>
                </div>

                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.75rem' }}>{t('consulting.areasOfHelp')}</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
                    {areasOfHelp.map(area => (
                      <label key={area} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={form.areas_of_help.includes(area)}
                          onChange={() => handleAreaToggle(area)}
                          style={{ cursor: 'pointer' }}
                        />
                        <span style={{ fontSize: '0.9rem' }}>{t(`consulting.area.${area}`)}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>{t('consulting.currentPhase')} ({t('common.optional')})</label>
                  <select
                    name="current_phase"
                    value={form.current_phase}
                    onChange={handleInputChange}
                    style={{ width: '100%', padding: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.95rem' }}
                  >
                    <option value="">{t('consulting.currentPhasePlaceholder')}</option>
                    {Array.from({ length: 30 }, (_, i) => i + 1).map(phase => (
                      <option key={phase} value={phase}>
                        Phase {phase}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>{t('consulting.additionalInfo')} ({t('common.optional')})</label>
                  <textarea
                    name="description"
                    value={form.description}
                    onChange={handleInputChange}
                    style={{ width: '100%', padding: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.95rem', resize: 'vertical', minHeight: '100px' }}
                    placeholder={t('consulting.additionalInfoPlaceholder')}
                  />
                </div>
              </>
            )}

            {/* Step 3: Confirmation */}
            {step === 3 && (
              <div style={{ background: 'var(--color-bg)', borderRadius: '8px', padding: '1.5rem', marginBottom: '1.5rem' }}>
                <h3 style={{ margin: '0 0 1rem', fontSize: '1.1rem', fontWeight: 600 }}>
                  {t('consulting.confirmSummary')}
                </h3>

                <div style={{ fontSize: '0.9rem', lineHeight: 1.8 }}>
                  <p><strong>{t('consulting.email')}:</strong> {form.email}</p>
                  <p><strong>{t('consulting.name')}:</strong> {form.first_name} {form.last_name}</p>
                  {form.business_name && <p><strong>{t('consulting.businessName')}:</strong> {form.business_name}</p>}
                  <p><strong>{t('consulting.serviceTier')}:</strong> {form.service_tier === 'initial' ? '$100 Initial Consultation' : form.service_tier}</p>
                  {form.areas_of_help.length > 0 && (
                    <p><strong>{t('consulting.areasOfHelp')}:</strong> {form.areas_of_help.map(a => t(`consulting.area.${a}`)).join(', ')}</p>
                  )}
                  {form.current_phase && <p><strong>{t('consulting.currentPhase')}:</strong> Phase {form.current_phase}</p>}
                </div>

                <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'rgba(249,115,22,0.05)', borderRadius: '8px', border: '1px solid rgba(249,115,22,0.2)' }}>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                    {t('consulting.nextSteps')}
                  </p>
                </div>
              </div>
            )}

            {/* Buttons */}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '2rem' }}>
              {step > 1 && (
                <button
                  onClick={() => setStep(step - 1)}
                  style={{ padding: '0.75rem 1.5rem', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text)', fontSize: '0.95rem', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' }}
                  disabled={loading}
                >
                  {t('common.back')}
                </button>
              )}
              <button
                onClick={() => navigate('/')}
                style={{ padding: '0.75rem 1.5rem', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text)', fontSize: '0.95rem', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' }}
                disabled={loading}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSubmit}
                style={{ padding: '0.75rem 1.5rem', borderRadius: '8px', border: 'none', background: 'var(--color-primary)', color: 'white', fontSize: '0.95rem', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1, transition: 'all 0.2s' }}
                disabled={loading}
              >
                {loading ? t('common.loading') : step === 3 ? t('common.submit') : t('common.next')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
