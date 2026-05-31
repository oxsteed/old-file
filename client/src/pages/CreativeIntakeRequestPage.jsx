import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { Camera, CheckCircle2, Layers3, Palette, PenTool } from 'lucide-react';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import { createPublicCreativeIntake, getPublicCreativeOperations } from '../api/creativeOperations';
import '../styles/MaintenanceRequestPage.css';

const INITIAL_FORM = {
  project_type: '',
  project_goal: '',
  style_direction: '',
  deadline_notes: '',
  asset_needs: '',
  revision_scope: '',
  package_interest: '',
  budget_notes: '',
  contact_name: '',
  contact_email: '',
  contact_phone: '',
  preferred_contact_channel: 'email',
  reference_links: '',
  photos: [],
};

export default function CreativeIntakeRequestPage() {
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
        const data = await getPublicCreativeOperations(businessId);
        if (cancelled) return;
        setWorkspace(data);
        setForm((current) => ({ ...current, preferred_contact_channel: data?.settings?.preferred_contact_channel || 'email' }));
      } catch {
        toast.error(t('creativeIntakePage.errors.loadFailed'));
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
    if (form.project_type.trim().length < 3) return toast.error(t('creativeIntakePage.errors.missingProjectType'));
    const payload = new FormData();
    Object.entries(form).forEach(([key, value]) => {
      if (key === 'photos') return;
      if (key === 'reference_links') {
        String(value || '').split('\n').map((item) => item.trim()).filter(Boolean).forEach((link) => payload.append('reference_links[]', link));
        return;
      }
      payload.append(key, value);
    });
    payload.append('template_slug', workspace?.business?.active_template || 'creative_studio');
    Array.from(form.photos || []).slice(0, 5).forEach((file) => payload.append('photos', file));

    setSubmitting(true);
    try {
      const request = await createPublicCreativeIntake(businessId, payload);
      setSubmitted(request);
      toast.success(t('creativeIntakePage.messages.submitted'));
    } catch (error) {
      toast.error(error?.response?.data?.error || t('creativeIntakePage.errors.submitFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  const activeTemplate = workspace?.business?.active_template || 'creative_studio';
  const isPhotographer = activeTemplate === 'photographer';
  const isDesigner = activeTemplate === 'graphic_design';
  const businessName = workspace?.business?.business_name || t('creativeIntakePage.businessNameFallback');
  const configuredFallback = t('creativeIntakePage.form.fallbacks.configuredInsideHub');
  const projectTypePlaceholder = isPhotographer ? t('creativeIntakePage.form.projectType.placeholderPhotographer') : isDesigner ? t('creativeIntakePage.form.projectType.placeholderDesigner') : t('creativeIntakePage.form.projectType.placeholderDefault');

  if (loading) {
    return (
      <PageShell>
        <div className="mrq-page"><p className="mrq-muted">{t('creativeIntakePage.loading')}</p></div>
      </PageShell>
    );
  }

  if (submitted) {
    return (
      <PageShell>
        <PageMeta title={t('creativeIntakePage.submitted.pageTitle')} noIndex />
        <main className="mrq-page">
          <section className="mrq-success">
            <CheckCircle2 size={42} />
            <p className="mrq-eyebrow">{t('creativeIntakePage.submitted.eyebrow')}</p>
            <h1>{submitted.project_type}</h1>
            <p>{t('creativeIntakePage.submitted.description', { business: businessName })}</p>
            <div className="mrq-success-actions">
              <Link className="mrq-btn primary" to={`/business/${businessId}`}>{t('creativeIntakePage.submitted.backToProfile')}</Link>
              <Link className="mrq-btn" to="/dashboard">{t('creativeIntakePage.submitted.goToDashboard')}</Link>
            </div>
          </section>
        </main>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageMeta title={t('creativeIntakePage.page.title', { business: businessName })} noIndex />
      <main className="mrq-page">
        <section className="mrq-hero">
          <div>
            <p className="mrq-eyebrow"><Layers3 size={16} /> {t('creativeIntakePage.hero.eyebrow')}</p>
            <h1>{t('creativeIntakePage.hero.title', { business: businessName })}</h1>
            <p>
              {workspace?.settings?.revision_policy || t('creativeIntakePage.hero.subtitle')}
            </p>
          </div>
          <div className="mrq-hero-card">
            {isPhotographer ? <Camera size={24} /> : isDesigner ? <PenTool size={24} /> : <Palette size={24} />}
            <strong>{workspace?.settings?.discovery_call_label || t('creativeIntakePage.hero.cardTitle')}</strong>
            <span>{t('creativeIntakePage.hero.cardDescription')}</span>
          </div>
        </section>

        <form className="mrq-grid" onSubmit={handleSubmit}>
          <section className="mrq-panel">
            <h2><Palette size={18} /> {t('creativeIntakePage.sections.projectBrief')}</h2>
            <div className="mrq-field">
              <label>{t('creativeIntakePage.form.projectType.label')}</label>
              <input value={form.project_type} onChange={(e) => updateField('project_type', e.target.value)} placeholder={projectTypePlaceholder} maxLength={180} />
            </div>
            <div className="mrq-field">
              <label>{t('creativeIntakePage.form.projectGoal.label')}</label>
              <textarea value={form.project_goal} onChange={(e) => updateField('project_goal', e.target.value)} rows={5} placeholder={t('creativeIntakePage.form.projectGoal.placeholder')} />
            </div>
            <div className="mrq-field">
              <label>{t('creativeIntakePage.form.styleDirection.label')}</label>
              <textarea value={form.style_direction} onChange={(e) => updateField('style_direction', e.target.value)} rows={4} placeholder={t('creativeIntakePage.form.styleDirection.placeholder')} />
            </div>
            <div className="mrq-two">
              <div className="mrq-field">
                <label>{t('creativeIntakePage.form.deadlineNotes.label')}</label>
                <input value={form.deadline_notes} onChange={(e) => updateField('deadline_notes', e.target.value)} placeholder={t('creativeIntakePage.form.deadlineNotes.placeholder')} />
              </div>
              <div className="mrq-field">
                <label>{t('creativeIntakePage.form.packageInterest.label')}</label>
                <input value={form.package_interest} onChange={(e) => updateField('package_interest', e.target.value)} placeholder={t('creativeIntakePage.form.packageInterest.placeholder')} />
              </div>
            </div>
          </section>

          <section className="mrq-panel">
            <h2>{isPhotographer ? <Camera size={18} /> : <PenTool size={18} />} {t('creativeIntakePage.sections.assetsAndDelivery')}</h2>
            <div className="mrq-field">
              <label>{t('creativeIntakePage.form.assetsNeeded.label')}</label>
              <textarea value={form.asset_needs} onChange={(e) => updateField('asset_needs', e.target.value)} rows={4} placeholder={t('creativeIntakePage.form.assetsNeeded.placeholder')} />
            </div>
            <div className="mrq-two">
              <div className="mrq-field">
                <label>{t('creativeIntakePage.form.revisionScope.label')}</label>
                <input value={form.revision_scope} onChange={(e) => updateField('revision_scope', e.target.value)} placeholder={t('creativeIntakePage.form.revisionScope.placeholder')} />
              </div>
              <div className="mrq-field">
                <label>{t('creativeIntakePage.form.budgetNotes.label')}</label>
                <input value={form.budget_notes} onChange={(e) => updateField('budget_notes', e.target.value)} placeholder={t('creativeIntakePage.form.budgetNotes.placeholder')} />
              </div>
            </div>
            <div className="mrq-field">
              <label>{t('creativeIntakePage.form.referenceLinks.label')}</label>
              <textarea value={form.reference_links} onChange={(e) => updateField('reference_links', e.target.value)} rows={4} placeholder={t('creativeIntakePage.form.referenceLinks.placeholder')} />
            </div>
            <div className="mrq-field">
              <label>{t('creativeIntakePage.form.uploadReferences.label')}</label>
              <input type="file" accept="image/*" multiple onChange={(e) => updateField('photos', Array.from(e.target.files || []).slice(0, 5))} />
            </div>
          </section>

          <section className="mrq-panel">
            <h2><Layers3 size={18} /> {t('creativeIntakePage.sections.contactAndProcess')}</h2>
            <div className="mrq-field">
              <label>{t('creativeIntakePage.form.contactName.label')}</label>
              <input value={form.contact_name} onChange={(e) => updateField('contact_name', e.target.value)} placeholder={t('creativeIntakePage.form.contactName.placeholder')} />
            </div>
            <div className="mrq-two">
              <div className="mrq-field">
                <label>{t('creativeIntakePage.form.contactEmail.label')}</label>
                <input value={form.contact_email} onChange={(e) => updateField('contact_email', e.target.value)} placeholder={t('creativeIntakePage.form.contactEmail.placeholder')} />
              </div>
              <div className="mrq-field">
                <label>{t('creativeIntakePage.form.contactPhone.label')}</label>
                <input value={form.contact_phone} onChange={(e) => updateField('contact_phone', e.target.value)} placeholder={t('creativeIntakePage.form.contactPhone.placeholder')} />
              </div>
            </div>
            <div className="mrq-field">
              <label>{t('creativeIntakePage.form.contactChannel.label')}</label>
              <select value={form.preferred_contact_channel} onChange={(e) => updateField('preferred_contact_channel', e.target.value)}>
                <option value="email">{t('creativeIntakePage.form.contactChannel.options.email')}</option>
                <option value="call">{t('creativeIntakePage.form.contactChannel.options.call')}</option>
                <option value="meeting">{t('creativeIntakePage.form.contactChannel.options.meeting')}</option>
                <option value="message">{t('creativeIntakePage.form.contactChannel.options.message')}</option>
              </select>
            </div>
            <div className="mt-4 rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-4 text-sm text-gray-300">
              <p><strong>{t('creativeIntakePage.form.labels.revisionPolicy')}</strong> {workspace?.settings?.revision_policy || configuredFallback}</p>
              <p className="mt-3"><strong>{t('creativeIntakePage.form.labels.approvalPolicy')}</strong> {workspace?.settings?.approval_policy || configuredFallback}</p>
            </div>
            <button className="mrq-btn primary" type="submit" disabled={submitting}>
              {submitting ? t('creativeIntakePage.form.actions.sending') : t('creativeIntakePage.form.actions.submit')}
            </button>
          </section>
        </form>
      </main>
    </PageShell>
  );
}
