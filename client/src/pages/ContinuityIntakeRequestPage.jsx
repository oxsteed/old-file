import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { BookOpen, CheckCircle2, HeartHandshake, PawPrint, ShieldCheck } from 'lucide-react';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import { createPublicContinuityIntake, getPublicContinuityOperations } from '../api/continuityOperations';
import '../styles/MaintenanceRequestPage.css';

const INITIAL_FORM = {
  primary_goal: '',
  support_context: '',
  schedule_notes: '',
  package_interest: '',
  age_or_level: '',
  guardian_name: '',
  guardian_phone: '',
  special_considerations: '',
  current_routine: '',
  progress_target: '',
  budget_notes: '',
  contact_name: '',
  contact_email: '',
  contact_phone: '',
  preferred_contact_channel: 'message',
  relationship_type: 'client',
  guardian_acknowledged: false,
  policy_acknowledged: false,
  safety_acknowledged: false,
};

const EDUCATION_TEMPLATES = ['tutoring_education', 'math_tutor', 'child_development'];
const CARE_TEMPLATES = ['care_trust', 'pet_services', 'dog_walker'];

export default function ContinuityIntakeRequestPage() {
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
        const data = await getPublicContinuityOperations(businessId);
        if (cancelled) return;
        setWorkspace(data);
        setForm((current) => ({
          ...current,
          preferred_contact_channel: data?.settings?.preferred_contact_channel || 'message',
        }));
      } catch {
        toast.error(t('continuityIntakePage.errors.loadFailed'));
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
    if (form.primary_goal.trim().length < 3) return toast.error(t('continuityIntakePage.errors.missingGoal'));
    if (!form.policy_acknowledged) return toast.error(t('continuityIntakePage.errors.missingAcknowledgement'));

    setSubmitting(true);
    try {
      const request = await createPublicContinuityIntake(businessId, {
        ...form,
        template_slug: workspace?.business?.active_template || 'wellness_therapy',
        consent_flags: {
          guardian_acknowledged: form.guardian_acknowledged,
          policy_acknowledged: form.policy_acknowledged,
          safety_acknowledged: form.safety_acknowledged,
        },
      });
      setSubmitted(request);
      toast.success(t('continuityIntakePage.messages.submitted'));
    } catch (error) {
      toast.error(error?.response?.data?.error || t('continuityIntakePage.errors.submitFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  const activeTemplate = workspace?.business?.active_template || 'wellness_therapy';
  const businessName = workspace?.business?.business_name || t('continuityIntakePage.businessNameFallback');
  const isEducation = EDUCATION_TEMPLATES.includes(activeTemplate);
  const isCare = CARE_TEMPLATES.includes(activeTemplate);
  const isPet = ['pet_services', 'dog_walker'].includes(activeTemplate);
  const Icon = isEducation ? BookOpen : isPet ? PawPrint : HeartHandshake;
  const primaryGoalPlaceholder = isEducation
    ? t('continuityIntakePage.form.primaryGoal.placeholderEducation')
    : isCare
    ? t('continuityIntakePage.form.primaryGoal.placeholderCare')
    : t('continuityIntakePage.form.primaryGoal.placeholderDefault');
  const ageOrLevelPlaceholder = isEducation
    ? t('continuityIntakePage.form.ageOrLevel.placeholderEducation')
    : isPet
    ? t('continuityIntakePage.form.ageOrLevel.placeholderPet')
    : t('continuityIntakePage.form.ageOrLevel.placeholderCare');

  if (loading) {
    return (
      <PageShell>
        <div className="mrq-page"><p className="mrq-muted">{t('continuityIntakePage.loading')}</p></div>
      </PageShell>
    );
  }

  if (submitted) {
    return (
      <PageShell>
        <PageMeta title={t('continuityIntakePage.submitted.pageTitle')} noIndex />
        <main className="mrq-page">
          <section className="mrq-success">
            <CheckCircle2 size={42} />
            <p className="mrq-eyebrow">{t('continuityIntakePage.submitted.eyebrow')}</p>
            <h1>{submitted.primary_goal}</h1>
            <p>{t('continuityIntakePage.submitted.description', { business: businessName })}</p>
            <div className="mrq-success-actions">
              <Link className="mrq-btn primary" to={`/business/${businessId}`}>{t('continuityIntakePage.submitted.backToProfile')}</Link>
              <Link className="mrq-btn" to="/dashboard">{t('continuityIntakePage.submitted.goToDashboard')}</Link>
            </div>
          </section>
        </main>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageMeta title={t('continuityIntakePage.page.title', { business: businessName })} noIndex />
      <main className="mrq-page">
        <section className="mrq-hero">
          <div>
            <p className="mrq-eyebrow"><Icon size={16} /> {t('continuityIntakePage.hero.eyebrow')}</p>
            <h1>{t('continuityIntakePage.hero.title', { business: businessName })}</h1>
            <p>{workspace?.settings?.continuity_pitch || t('continuityIntakePage.hero.subtitle')}</p>
          </div>
          <div className="mrq-hero-card">
            <Icon size={24} />
            <strong>{workspace?.settings?.intake_label || t('continuityIntakePage.hero.cardTitle')}</strong>
            <span>{t('continuityIntakePage.hero.cardDescription')}</span>
          </div>
        </section>

        <form className="mrq-grid" onSubmit={handleSubmit}>
          <section className="mrq-panel">
            <h2><Icon size={18} /> {t('continuityIntakePage.sections.goalContext')}</h2>
            <div className="mrq-field">
              <label>{t('continuityIntakePage.form.primaryGoal.label')}</label>
              <input
                value={form.primary_goal}
                onChange={(e) => updateField('primary_goal', e.target.value)}
                placeholder={primaryGoalPlaceholder}
                maxLength={180}
              />
            </div>
            <div className="mrq-field">
              <label>{t('continuityIntakePage.form.supportContext.label')}</label>
              <textarea
                value={form.support_context}
                onChange={(e) => updateField('support_context', e.target.value)}
                rows={5}
                placeholder={t('continuityIntakePage.form.supportContext.placeholder')}
              />
            </div>
            <div className="mrq-two">
              <div className="mrq-field">
                <label>{t('continuityIntakePage.form.scheduleNotes.label')}</label>
                <input
                  value={form.schedule_notes}
                  onChange={(e) => updateField('schedule_notes', e.target.value)}
                  placeholder={t('continuityIntakePage.form.scheduleNotes.placeholder')}
                />
              </div>
              <div className="mrq-field">
                <label>{t('continuityIntakePage.form.progressTarget.label')}</label>
                <input
                  value={form.progress_target}
                  onChange={(e) => updateField('progress_target', e.target.value)}
                  placeholder={t('continuityIntakePage.form.progressTarget.placeholder')}
                />
              </div>
            </div>
            <div className="mrq-two">
              <div className="mrq-field">
                <label>{t('continuityIntakePage.form.packageInterest.label')}</label>
                <input
                  value={form.package_interest}
                  onChange={(e) => updateField('package_interest', e.target.value)}
                  placeholder={t('continuityIntakePage.form.packageInterest.placeholder')}
                />
              </div>
              <div className="mrq-field">
                <label>{t('continuityIntakePage.form.ageOrLevel.label')}</label>
                <input
                  value={form.age_or_level}
                  onChange={(e) => updateField('age_or_level', e.target.value)}
                  placeholder={ageOrLevelPlaceholder}
                />
              </div>
            </div>
          </section>

          <section className="mrq-panel">
            <h2><ShieldCheck size={18} /> {t('continuityIntakePage.sections.routineTrust')}</h2>
            <div className="mrq-field">
              <label>{t('continuityIntakePage.form.currentRoutine.label')}</label>
              <textarea
                value={form.current_routine}
                onChange={(e) => updateField('current_routine', e.target.value)}
                rows={4}
                placeholder={t('continuityIntakePage.form.currentRoutine.placeholder')}
              />
            </div>
            <div className="mrq-field">
              <label>{t('continuityIntakePage.form.specialConsiderations.label')}</label>
              <textarea
                value={form.special_considerations}
                onChange={(e) => updateField('special_considerations', e.target.value)}
                rows={4}
                placeholder={t('continuityIntakePage.form.specialConsiderations.placeholder')}
              />
            </div>
            <div className="mrq-two">
              <div className="mrq-field">
                <label>{t('continuityIntakePage.form.guardianName.label')}</label>
                <input
                  value={form.guardian_name}
                  onChange={(e) => updateField('guardian_name', e.target.value)}
                  placeholder={t('continuityIntakePage.form.guardianName.placeholder')}
                />
              </div>
              <div className="mrq-field">
                <label>{t('continuityIntakePage.form.guardianPhone.label')}</label>
                <input
                  value={form.guardian_phone}
                  onChange={(e) => updateField('guardian_phone', e.target.value)}
                  placeholder={t('continuityIntakePage.form.guardianPhone.placeholder')}
                />
              </div>
            </div>
            <div className="mt-4 rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-4 text-sm text-gray-300">
              <p><strong>{t('continuityIntakePage.form.labels.trustSignals')}</strong> {(workspace?.settings?.trust_artifacts || []).join(', ') || t('continuityIntakePage.form.fallbacks.configuredInsideHub')}</p>
              <p className="mt-3"><strong>{t('continuityIntakePage.form.labels.prepExpectations')}</strong> {workspace?.settings?.prep_expectations || t('continuityIntakePage.form.fallbacks.configuredInsideHub')}</p>
            </div>
          </section>

          <section className="mrq-panel">
            <h2><HeartHandshake size={18} /> {t('continuityIntakePage.sections.contactAcknowledgement')}</h2>
            <div className="mrq-field">
              <label>{t('continuityIntakePage.form.contactName.label')}</label>
              <input
                value={form.contact_name}
                onChange={(e) => updateField('contact_name', e.target.value)}
                placeholder={t('continuityIntakePage.form.contactName.placeholder')}
              />
            </div>
            <div className="mrq-two">
              <div className="mrq-field">
                <label>{t('continuityIntakePage.form.contactEmail.label')}</label>
                <input
                  value={form.contact_email}
                  onChange={(e) => updateField('contact_email', e.target.value)}
                  placeholder={t('continuityIntakePage.form.contactEmail.placeholder')}
                />
              </div>
              <div className="mrq-field">
                <label>{t('continuityIntakePage.form.contactPhone.label')}</label>
                <input
                  value={form.contact_phone}
                  onChange={(e) => updateField('contact_phone', e.target.value)}
                  placeholder={t('continuityIntakePage.form.contactPhone.placeholder')}
                />
              </div>
            </div>
            <div className="mrq-two">
              <div className="mrq-field">
                <label>{t('continuityIntakePage.form.contactChannel.label')}</label>
                <select value={form.preferred_contact_channel} onChange={(e) => updateField('preferred_contact_channel', e.target.value)}>
                  <option value="message">{t('continuityIntakePage.form.contactChannel.options.message')}</option>
                  <option value="email">{t('continuityIntakePage.form.contactChannel.options.email')}</option>
                  <option value="call">{t('continuityIntakePage.form.contactChannel.options.call')}</option>
                  <option value="text">{t('continuityIntakePage.form.contactChannel.options.text')}</option>
                  <option value="meeting">{t('continuityIntakePage.form.contactChannel.options.meeting')}</option>
                </select>
              </div>
              <div className="mrq-field">
                <label>{t('continuityIntakePage.form.relationshipType.label')}</label>
                <select value={form.relationship_type} onChange={(e) => updateField('relationship_type', e.target.value)}>
                  <option value="client">{t('continuityIntakePage.form.relationshipType.options.client')}</option>
                  <option value="student">{t('continuityIntakePage.form.relationshipType.options.student')}</option>
                  <option value="family">{t('continuityIntakePage.form.relationshipType.options.family')}</option>
                  <option value="pet">{t('continuityIntakePage.form.relationshipType.options.pet')}</option>
                  <option value="patient">{t('continuityIntakePage.form.relationshipType.options.patient')}</option>
                  <option value="athlete">{t('continuityIntakePage.form.relationshipType.options.athlete')}</option>
                </select>
              </div>
            </div>
            <div className="mrq-field">
              <label>{t('continuityIntakePage.form.budgetNotes.label')}</label>
              <input
                value={form.budget_notes}
                onChange={(e) => updateField('budget_notes', e.target.value)}
                placeholder={t('continuityIntakePage.form.budgetNotes.placeholder')}
              />
            </div>
            <div className="mrq-checklist mt-4">
              <label><input type="checkbox" checked={form.guardian_acknowledged} onChange={(e) => updateField('guardian_acknowledged', e.target.checked)} /> {t('continuityIntakePage.form.acknowledgement.guardian')}</label>
              <label><input type="checkbox" checked={form.safety_acknowledged} onChange={(e) => updateField('safety_acknowledged', e.target.checked)} /> {t('continuityIntakePage.form.acknowledgement.safety')}</label>
              <label><input type="checkbox" checked={form.policy_acknowledged} onChange={(e) => updateField('policy_acknowledged', e.target.checked)} /> {t('continuityIntakePage.form.acknowledgement.policy')}</label>
            </div>
            <button className="mrq-btn primary" type="submit" disabled={submitting}>
              {submitting ? t('continuityIntakePage.form.actions.sending') : t('continuityIntakePage.form.actions.submit')}
            </button>
          </section>
        </form>
      </main>
    </PageShell>
  );
}
