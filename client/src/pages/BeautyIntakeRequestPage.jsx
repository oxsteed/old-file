import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Droplets, Scissors, ShieldCheck, Sparkles } from 'lucide-react';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import { createPublicBeautyIntake, getPublicBeautyOperations } from '../api/beautyOperations';
import '../styles/MaintenanceRequestPage.css';

const INITIAL_FORM = {
  desired_service: '',
  desired_look: '',
  preferred_staff: '',
  preferred_time_notes: '',
  package_interest: '',
  budget_notes: '',
  contact_name: '',
  contact_email: '',
  contact_phone: '',
  inspiration_notes: '',
  hair_length: '',
  hair_history: '',
  beard_preferences: '',
  skin_sensitivities: '',
  contraindications: '',
  patch_test: false,
  photo_release: false,
  fragrance_sensitivity: false,
  prep_acknowledged: false,
  no_show_acknowledged: false,
  photos: [],
};

export default function BeautyIntakeRequestPage() {
  const { t } = useTranslation();
  const { businessId } = useParams();
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(null);
  const [form, setForm] = useState(INITIAL_FORM);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const data = await getPublicBeautyOperations(businessId);
        if (cancelled) return;
        setWorkspace(data);
      } catch {
        toast.error(t('beautyIntakePage.errors.loadFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [businessId]);

  function updateField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (form.desired_service.trim().length < 3) return toast.error(t('beautyIntakePage.errors.missingService'));
    if (!form.prep_acknowledged || !form.no_show_acknowledged) return toast.error(t('beautyIntakePage.errors.missingAcknowledgement'));
    const payload = new FormData();
    Object.entries(form).forEach(([key, value]) => {
      if (key === 'photos') return;
      payload.append(key, value);
    });
    payload.append('template_slug', workspace?.business?.active_template || 'beauty_style');
    Array.from(form.photos || []).slice(0, 5).forEach((file) => payload.append('photos', file));

    setSubmitting(true);
    try {
      const request = await createPublicBeautyIntake(businessId, payload);
      setSubmitted(request);
      toast.success(t('beautyIntakePage.messages.submitted'));
    } catch (error) {
      toast.error(error?.response?.data?.error || t('beautyIntakePage.errors.submitFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  const activeTemplate = workspace?.business?.active_template || 'beauty_style';
  const isBarber = activeTemplate === 'barbershop';
  const isHair = activeTemplate === 'hair_stylist' || activeTemplate === 'beauty_style';
  const isSpa = activeTemplate === 'spa_skincare';
  const businessName = workspace?.business?.business_name || t('beautyIntakePage.businessNameFallback');
  const configuredFallback = t('beautyIntakePage.form.fallbacks.configuredInsideHub');
  const desiredServicePlaceholder = isBarber ? t('beautyIntakePage.form.desiredService.placeholderBarber') : isSpa ? t('beautyIntakePage.form.desiredService.placeholderSpa') : t('beautyIntakePage.form.desiredService.placeholderDefault');
  const desiredLookPlaceholder = isBarber ? t('beautyIntakePage.form.desiredLook.placeholderBarber') : isSpa ? t('beautyIntakePage.form.desiredLook.placeholderSpa') : t('beautyIntakePage.form.desiredLook.placeholderDefault');

  if (loading) {
    return (
      <PageShell>
        <div className="mrq-page"><p className="mrq-muted">{t('beautyIntakePage.loading')}</p></div>
      </PageShell>
    );
  }

  if (submitted) {
    return (
      <PageShell>
        <PageMeta title={t('beautyIntakePage.submitted.pageTitle')} noIndex />
        <main className="mrq-page">
          <section className="mrq-success">
            <CheckCircle2 size={42} />
            <p className="mrq-eyebrow">{t('beautyIntakePage.submitted.eyebrow')}</p>
            <h1>{submitted.desired_service}</h1>
            <p>{t('beautyIntakePage.submitted.description', { business: businessName })}</p>
            <div className="mrq-success-actions">
              <Link className="mrq-btn primary" to={`/business/${businessId}`}>{t('beautyIntakePage.submitted.backToProfile')}</Link>
              <Link className="mrq-btn" to="/dashboard">{t('beautyIntakePage.submitted.goToDashboard')}</Link>
            </div>
          </section>
        </main>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageMeta title={t('beautyIntakePage.page.title', { business: businessName })} noIndex />
      <main className="mrq-page">
        <section className="mrq-hero">
          <div>
            <p className="mrq-eyebrow"><Sparkles size={16} /> {t('beautyIntakePage.hero.eyebrow')}</p>
            <h1>{t('beautyIntakePage.hero.title', { business: businessName })}</h1>
            <p>
              {workspace?.settings?.prep_instructions || t('beautyIntakePage.hero.subtitle')}
            </p>
          </div>
          <div className="mrq-hero-card">
            {isSpa ? <Droplets size={24} /> : <Scissors size={24} />}
            <strong>{workspace?.settings?.consultation_offer_label || t('beautyIntakePage.hero.cardTitle')}</strong>
            <span>{t('beautyIntakePage.hero.cardDescription')}</span>
          </div>
        </section>

        <form className="mrq-grid" onSubmit={handleSubmit}>
          <section className="mrq-panel">
            <h2><Sparkles size={18} /> {t('beautyIntakePage.sections.serviceGoals')}</h2>
            <div className="mrq-field">
              <label>{t('beautyIntakePage.form.desiredService.label')}</label>
              <input value={form.desired_service} onChange={(e) => updateField('desired_service', e.target.value)} placeholder={desiredServicePlaceholder} maxLength={180} />
            </div>
            <div className="mrq-field">
              <label>{t('beautyIntakePage.form.desiredLook.label')}</label>
              <input value={form.desired_look} onChange={(e) => updateField('desired_look', e.target.value)} placeholder={desiredLookPlaceholder} maxLength={255} />
            </div>
            <div className="mrq-field">
              <label>{t('beautyIntakePage.form.inspirationNotes.label')}</label>
              <textarea value={form.inspiration_notes} onChange={(e) => updateField('inspiration_notes', e.target.value)} rows={5} placeholder={t('beautyIntakePage.form.inspirationNotes.placeholder')} />
            </div>
            <div className="mrq-two">
              <div className="mrq-field">
                <label>{t('beautyIntakePage.form.preferredStaff.label')}</label>
                <input value={form.preferred_staff} onChange={(e) => updateField('preferred_staff', e.target.value)} placeholder={t('beautyIntakePage.form.preferredStaff.placeholder')} />
              </div>
              <div className="mrq-field">
                <label>{t('beautyIntakePage.form.preferredTimeNotes.label')}</label>
                <input value={form.preferred_time_notes} onChange={(e) => updateField('preferred_time_notes', e.target.value)} placeholder={t('beautyIntakePage.form.preferredTimeNotes.placeholder')} />
              </div>
            </div>
            <div className="mrq-two">
              <div className="mrq-field">
                <label>{t('beautyIntakePage.form.packageInterest.label')}</label>
                <input value={form.package_interest} onChange={(e) => updateField('package_interest', e.target.value)} placeholder={t('beautyIntakePage.form.packageInterest.placeholder')} />
              </div>
              <div className="mrq-field">
                <label>{t('beautyIntakePage.form.budgetNotes.label')}</label>
                <input value={form.budget_notes} onChange={(e) => updateField('budget_notes', e.target.value)} placeholder={t('beautyIntakePage.form.budgetNotes.placeholder')} />
              </div>
            </div>
          </section>

          <section className="mrq-panel">
            <h2>{isSpa ? <Droplets size={18} /> : <Scissors size={18} />} {t('beautyIntakePage.sections.prepSensitivities')}</h2>
            {isHair ? (
              <div className="mrq-two">
                <div className="mrq-field">
                  <label>{t('beautyIntakePage.form.hairLength.label')}</label>
                  <input value={form.hair_length} onChange={(e) => updateField('hair_length', e.target.value)} placeholder={t('beautyIntakePage.form.hairLength.placeholder')} />
                </div>
                <div className="mrq-field">
                  <label>{t('beautyIntakePage.form.hairHistory.label')}</label>
                  <input value={form.hair_history} onChange={(e) => updateField('hair_history', e.target.value)} placeholder={t('beautyIntakePage.form.hairHistory.placeholder')} />
                </div>
              </div>
            ) : null}
            {isBarber ? (
              <div className="mrq-field">
                  <label>{t('beautyIntakePage.form.beardPreferences.label')}</label>
                <input value={form.beard_preferences} onChange={(e) => updateField('beard_preferences', e.target.value)} placeholder={t('beautyIntakePage.form.beardPreferences.placeholder')} />
              </div>
            ) : null}
            {isSpa ? (
              <div className="mrq-two">
                <div className="mrq-field">
                  <label>{t('beautyIntakePage.form.skinSensitivities.label')}</label>
                  <input value={form.skin_sensitivities} onChange={(e) => updateField('skin_sensitivities', e.target.value)} placeholder={t('beautyIntakePage.form.skinSensitivities.placeholder')} />
                </div>
                <div className="mrq-field">
                  <label>{t('beautyIntakePage.form.contraindications.label')}</label>
                  <input value={form.contraindications} onChange={(e) => updateField('contraindications', e.target.value)} placeholder={t('beautyIntakePage.form.contraindications.placeholder')} />
                </div>
              </div>
            ) : null}
            <div className="mrq-field">
              <label>{t('beautyIntakePage.form.referencePhotos.label')}</label>
              <input type="file" accept="image/*" multiple onChange={(e) => updateField('photos', Array.from(e.target.files || []).slice(0, 5))} />
            </div>
            <div className="mrq-field">
              <label>{t('beautyIntakePage.form.contactName.label')}</label>
              <input value={form.contact_name} onChange={(e) => updateField('contact_name', e.target.value)} placeholder={t('beautyIntakePage.form.contactName.placeholder')} />
            </div>
            <div className="mrq-two">
              <div className="mrq-field">
                <label>{t('beautyIntakePage.form.contactEmail.label')}</label>
                <input value={form.contact_email} onChange={(e) => updateField('contact_email', e.target.value)} placeholder={t('beautyIntakePage.form.contactEmail.placeholder')} />
              </div>
              <div className="mrq-field">
                <label>{t('beautyIntakePage.form.contactPhone.label')}</label>
                <input value={form.contact_phone} onChange={(e) => updateField('contact_phone', e.target.value)} placeholder={t('beautyIntakePage.form.contactPhone.placeholder')} />
              </div>
            </div>
          </section>

          <section className="mrq-panel">
            <h2><ShieldCheck size={18} /> {t('beautyIntakePage.sections.policyAndConsent')}</h2>
            <div className="mrq-checklist">
              <label><input type="checkbox" checked={form.patch_test} onChange={(e) => updateField('patch_test', e.target.checked)} /> {t('beautyIntakePage.form.consent.patchTest')}</label>
              <label><input type="checkbox" checked={form.photo_release} onChange={(e) => updateField('photo_release', e.target.checked)} /> {t('beautyIntakePage.form.consent.photoRelease')}</label>
              <label><input type="checkbox" checked={form.fragrance_sensitivity} onChange={(e) => updateField('fragrance_sensitivity', e.target.checked)} /> {t('beautyIntakePage.form.consent.fragranceSensitivity')}</label>
            </div>
            <div className="mt-4 rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-4 text-sm text-gray-300">
              <p><strong>{t('beautyIntakePage.form.labels.depositPolicy')}</strong> {workspace?.settings?.deposit_policy || configuredFallback}</p>
              <p className="mt-3"><strong>{t('beautyIntakePage.form.labels.prepGuidance')}</strong> {workspace?.settings?.prep_instructions || configuredFallback}</p>
            </div>
            <div className="mrq-checklist mt-4">
              <label><input type="checkbox" checked={form.prep_acknowledged} onChange={(e) => updateField('prep_acknowledged', e.target.checked)} /> {t('beautyIntakePage.form.acknowledgement.prep')}</label>
              <label><input type="checkbox" checked={form.no_show_acknowledged} onChange={(e) => updateField('no_show_acknowledged', e.target.checked)} /> {t('beautyIntakePage.form.acknowledgement.noShow')}</label>
            </div>
            <button className="mrq-btn primary" type="submit" disabled={submitting}>
              {submitting ? t('beautyIntakePage.form.actions.sending') : t('beautyIntakePage.form.actions.submit')}
            </button>
          </section>
        </form>
      </main>
    </PageShell>
  );
}
