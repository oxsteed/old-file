import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Briefcase, CheckCircle2, FileText, Scale, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import { createPublicProfessionalIntake, getPublicProfessionalOperations } from '../api/professionalOperations';
import '../styles/MaintenanceRequestPage.css';

const INITIAL_FORM = {
  service_need: '',
  business_context: '',
  timeline_notes: '',
  document_summary: '',
  package_interest: '',
  budget_notes: '',
  contact_name: '',
  contact_email: '',
  contact_phone: '',
  preferred_contact_channel: 'email',
};

export default function ProfessionalIntakeRequestPage() {
  const { t } = useTranslation('professionalIntakePage');
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
        const data = await getPublicProfessionalOperations(businessId);
        if (cancelled) return;
        setWorkspace(data);
        setForm((current) => ({ ...current, preferred_contact_channel: data?.settings?.preferred_contact_channel || 'email' }));
      } catch {
        toast.error(t('errors.loadFailed'));
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
    if (form.service_need.trim().length < 3) return toast.error(t('errors.missingServiceNeed'));
    setSubmitting(true);
    try {
      const request = await createPublicProfessionalIntake(businessId, {
        ...form,
        template_slug: workspace?.business?.active_template || 'consulting_coaching',
      });
      setSubmitted(request);
      toast.success(t('messages.submitted'));
    } catch (error) {
      toast.error(error?.response?.data?.error || t('errors.submitFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  const activeTemplate = workspace?.business?.active_template || 'consulting_coaching';
  const businessName = workspace?.business?.business_name || t('businessNameFallback');
  const Icon = activeTemplate === 'accountant' ? TrendingUp : activeTemplate === 'legal_admin' ? Scale : Briefcase;

  if (loading) {
    return (
    <PageShell>
        <div className="mrq-page"><p className="mrq-muted">{t('loading')}</p></div>
      </PageShell>
    );
  }

  if (submitted) {
    return (
      <PageShell>
        <PageMeta title={t('submitted.pageTitle')} noIndex />
        <main className="mrq-page">
          <section className="mrq-success">
            <CheckCircle2 size={42} />
            <p className="mrq-eyebrow">{t('submitted.title')}</p>
            <h1>{submitted.service_need}</h1>
            <p>
              {t('submitted.description', {
                business: businessName,
              })}
            </p>
            <div className="mrq-success-actions">
              <Link className="mrq-btn primary" to={`/business/${businessId}`}>{t('submitted.backToProfile')}</Link>
              <Link className="mrq-btn" to="/dashboard">{t('submitted.goToDashboard')}</Link>
            </div>
          </section>
        </main>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageMeta title={t('page.title', { business: businessName })} noIndex />
      <main className="mrq-page">
        <section className="mrq-hero">
          <div>
            <p className="mrq-eyebrow"><FileText size={16} /> {t('header.title')}</p>
            <h1>{t('header.start', { business: businessName })}</h1>
            <p>
              {workspace?.settings?.engagement_policy || t('header.policyFallback')}
            </p>
          </div>
          <div className="mrq-hero-card">
            <Icon size={24} />
            <strong>{workspace?.settings?.consultation_label || t('header.consultationLabel')}</strong>
            <span>{t('header.cardDescription')}</span>
          </div>
        </section>

        <form className="mrq-grid" onSubmit={handleSubmit}>
          <section className="mrq-panel">
            <h2><Icon size={18} /> {t('form.sections.context')}</h2>
            <div className="mrq-field">
              <label>{t('form.serviceNeed.label')}</label>
              <input value={form.service_need} onChange={(e) => updateField('service_need', e.target.value)} placeholder={activeTemplate === 'accountant' ? t('form.serviceNeed.placeholder.accountant') : activeTemplate === 'legal_admin' ? t('form.serviceNeed.placeholder.legal') : t('form.serviceNeed.placeholder.default')} maxLength={180} />
            </div>
            <div className="mrq-field">
              <label>{t('form.context.label')}</label>
              <textarea value={form.business_context} onChange={(e) => updateField('business_context', e.target.value)} rows={5} placeholder={t('form.context.placeholder')} />
            </div>
            <div className="mrq-two">
              <div className="mrq-field">
                <label>{t('form.timeline.label')}</label>
                <input value={form.timeline_notes} onChange={(e) => updateField('timeline_notes', e.target.value)} placeholder={t('form.timeline.placeholder')} />
              </div>
              <div className="mrq-field">
                <label>{t('form.package.label')}</label>
                <input value={form.package_interest} onChange={(e) => updateField('package_interest', e.target.value)} placeholder={t('form.package.placeholder')} />
              </div>
            </div>
          </section>

          <section className="mrq-panel">
            <h2><FileText size={18} /> {t('form.sections.documents')}</h2>
            <div className="mrq-field">
              <label>{t('form.documentSummary.label')}</label>
              <textarea value={form.document_summary} onChange={(e) => updateField('document_summary', e.target.value)} rows={5} placeholder={t('form.documentSummary.placeholder')} />
            </div>
            <div className="mrq-field">
              <label>{t('form.budget.label')}</label>
              <input value={form.budget_notes} onChange={(e) => updateField('budget_notes', e.target.value)} placeholder={t('form.budget.placeholder')} />
            </div>
            <div className="mt-4 rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-4 text-sm text-gray-300">
              <p><strong>{t('form.documentChecklist.title')}:</strong> {(workspace?.settings?.document_checklist || []).join(', ') || t('form.documentChecklist.fallback')}</p>
              <p className="mt-3"><strong>{t('form.obligationChecklist.title')}:</strong> {(workspace?.settings?.obligation_types || []).join(', ') || t('form.obligationChecklist.fallback')}</p>
            </div>
          </section>

          <section className="mrq-panel">
            <h2><Briefcase size={18} /> {t('form.sections.contact')}</h2>
            <div className="mrq-field">
              <label>{t('form.contactName.label')}</label>
              <input value={form.contact_name} onChange={(e) => updateField('contact_name', e.target.value)} placeholder={t('form.contactName.placeholder')} />
            </div>
            <div className="mrq-two">
              <div className="mrq-field">
                <label>{t('form.contactEmail.label')}</label>
              <input value={form.contact_email} onChange={(e) => updateField('contact_email', e.target.value)} placeholder={t('form.contactEmail.placeholder')} />
              </div>
              <div className="mrq-field">
                <label>{t('form.contactPhone.label')}</label>
                <input value={form.contact_phone} onChange={(e) => updateField('contact_phone', e.target.value)} placeholder={t('form.contactPhone.placeholder')} />
              </div>
            </div>
            <div className="mrq-field">
              <label>{t('form.contactChannel.label')}</label>
              <select value={form.preferred_contact_channel} onChange={(e) => updateField('preferred_contact_channel', e.target.value)}>
                <option value="email">{t('form.contactChannel.options.email')}</option>
                <option value="call">{t('form.contactChannel.options.call')}</option>
                <option value="meeting">{t('form.contactChannel.options.meeting')}</option>
                <option value="message">{t('form.contactChannel.options.message')}</option>
              </select>
            </div>
            <button className="mrq-btn primary" type="submit" disabled={submitting}>
              {submitting ? t('form.actions.sending') : t('form.actions.submit')}
            </button>
          </section>
        </form>
      </main>
    </PageShell>
  );
}
