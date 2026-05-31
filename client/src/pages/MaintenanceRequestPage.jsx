import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { AlertTriangle, Building2, Camera, CheckCircle2, Clock, Home, ShieldCheck, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import { createMaintenanceRequest, getMaintenanceBusiness } from '../api/maintenanceRequests';
import '../styles/MaintenanceRequestPage.css';

const ISSUE_CATEGORY_FALLBACKS = [
  'Plumbing',
  'Electrical',
  'Appliance',
  'Heating / Cooling',
  'Doors / Locks',
  'Pest concern',
  'Safety concern',
  'General repair',
];

const INITIAL_FORM = {
  issue_category: 'Plumbing',
  title: '',
  description: '',
  urgency: 'normal',
  property_label: '',
  unit_label: '',
  access_notes: '',
  preferred_times: '',
  permission_to_enter: false,
  contact_phone: '',
  location_area: '',
  symptom_started_at: '',
  best_update_channel: 'sms',
  entry_preference: '',
  resident_present_required: false,
  pets_on_site: false,
  asset_label: '',
  billable_party: 'owner',
  photos: [],
};

export default function MaintenanceRequestPage() {
  const { businessId } = useParams();
  const [business, setBusiness] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(null);
  const [form, setForm] = useState(INITIAL_FORM);
  const { t } = useTranslation();

  const issueCategories = useMemo(() => {
    const translated = t('maintenanceRequestPage.issueCategories', { returnObjects: true });
    return Array.isArray(translated) && translated.length ? translated : ISSUE_CATEGORY_FALLBACKS;
  }, [t]);

  const selectedIssueCategories = useMemo(() => {
    const supported = business?.propertyOperations?.supported_issue_categories;
    if (Array.isArray(supported) && supported.length) return supported;
    return issueCategories;
  }, [business?.propertyOperations?.supported_issue_categories, issueCategories]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getMaintenanceBusiness(businessId)
      .then((data) => {
        if (!cancelled) {
          setBusiness({ ...data.business, propertyOperations: data.propertyOperations || null });
          if (data.propertyOperations?.supported_issue_categories?.length) {
            setForm((current) => ({
              ...current,
              issue_category: data.propertyOperations.supported_issue_categories[0],
            }));
          }
        }
      })
      .catch(() => toast.error(t('maintenanceRequestPage.messages.loadFailed')))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [businessId]);

  const photoNames = useMemo(() => Array.from(form.photos || []).map((file) => file.name).join(', '), [form.photos]);

  function updateField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (form.title.trim().length < 6) {
      toast.error(t('maintenanceRequestPage.validation.titleMinLength'));
      return;
    }
    if (form.description.trim().length < 20) {
      toast.error(t('maintenanceRequestPage.validation.descriptionMinLength'));
      return;
    }
    const payload = new FormData();
    Object.entries(form).forEach(([key, value]) => {
      if (key === 'photos') return;
      payload.append(key, value);
    });
    Array.from(form.photos || []).slice(0, 5).forEach((file) => payload.append('photos', file));

    setSubmitting(true);
    try {
      const request = await createMaintenanceRequest(businessId, payload);
      setSubmitted(request);
      toast.success(t('maintenanceRequestPage.messages.sent'));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('maintenanceRequestPage.messages.sendFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <PageShell>
        <div className="mrq-page"><p className="mrq-muted">{t('maintenanceRequestPage.loading')}</p></div>
      </PageShell>
    );
  }

  if (submitted) {
    return (
      <PageShell>
        <PageMeta title={t('maintenanceRequestPage.meta.sentTitle')} noIndex />
        <main className="mrq-page">
          <section className="mrq-success">
            <CheckCircle2 size={42} />
            <p className="mrq-eyebrow">{t('maintenanceRequestPage.submitted.title')}</p>
            <h1>{submitted.title}</h1>
            <p>
              {t('maintenanceRequestPage.submitted.message', {
                businessName: business?.business_name || t('maintenanceRequestPage.submitted.businessFallback'),
              })}
            </p>
            <div className="mrq-success-actions">
              <Link className="mrq-btn primary" to={`/business/${businessId}`}>{t('maintenanceRequestPage.submitted.backToProfile')}</Link>
              <Link className="mrq-btn" to="/dashboard">{t('maintenanceRequestPage.submitted.goToDashboard')}</Link>
            </div>
          </section>
        </main>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageMeta
        title={t('maintenanceRequestPage.meta.reportTitle', {
          businessName: business?.business_name || t('maintenanceRequestPage.hero.businessFallback'),
        })}
        noIndex
      />
      <main className="mrq-page">
        <section className="mrq-hero">
          <div>
            <p className="mrq-eyebrow"><Building2 size={16} /> {t('maintenanceRequestPage.hero.eyebrow')}</p>
            <h1>
              {t('maintenanceRequestPage.hero.title', {
                businessName: business?.business_name || t('maintenanceRequestPage.hero.businessFallback'),
              })}
            </h1>
            <p>
              {business?.propertyOperations?.tenant_portal_intro || t('maintenanceRequestPage.hero.intro')}
            </p>
          </div>
          <div className="mrq-hero-card">
            <Wrench size={24} />
            <strong>{t('maintenanceRequestPage.hero.helpTitle')}</strong>
            <span>{t('maintenanceRequestPage.hero.helpDescription')}</span>
          </div>
        </section>

        <form className="mrq-grid" onSubmit={handleSubmit}>
          <section className="mrq-panel">
            <h2><Home size={18} /> {t('maintenanceRequestPage.sections.issueDetails')}</h2>
            <div className="mrq-field">
              <label>{t('maintenanceRequestPage.fields.issueCategory')}</label>
              <select value={form.issue_category} onChange={(e) => updateField('issue_category', e.target.value)}>
                {selectedIssueCategories.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </div>
            <div className="mrq-field">
              <label>{t('maintenanceRequestPage.fields.shortTitle')}</label>
              <input
                value={form.title}
                onChange={(e) => updateField('title', e.target.value)}
                placeholder={t('maintenanceRequestPage.placeholders.title')}
                maxLength={200}
              />
            </div>
            <div className="mrq-field">
              <label>{t('maintenanceRequestPage.fields.happening')}</label>
              <textarea
                value={form.description}
                onChange={(e) => updateField('description', e.target.value)}
                rows={6}
                placeholder={t('maintenanceRequestPage.placeholders.description')}
              />
            </div>
            <div className="mrq-field">
              <label>{t('maintenanceRequestPage.fields.urgency')}</label>
              <div className="mrq-segments">
                {[
                  ['emergency', t('maintenanceRequestPage.urgency.emergency')],
                  ['urgent', t('maintenanceRequestPage.urgency.urgent')],
                  ['normal', t('maintenanceRequestPage.urgency.normal')],
                  ['low', t('maintenanceRequestPage.urgency.low')],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={form.urgency === value ? 'active' : ''}
                    onClick={() => updateField('urgency', value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mrq-two">
              <div className="mrq-field">
                <label>{t('maintenanceRequestPage.fields.locationArea')}</label>
                <input
                  value={form.location_area}
                  onChange={(e) => updateField('location_area', e.target.value)}
                  placeholder={t('maintenanceRequestPage.placeholders.locationArea')}
                />
              </div>
              <div className="mrq-field">
                <label>{t('maintenanceRequestPage.fields.assetLabel')}</label>
                <input
                  value={form.asset_label}
                  onChange={(e) => updateField('asset_label', e.target.value)}
                  placeholder={t('maintenanceRequestPage.placeholders.assetLabel')}
                />
              </div>
            </div>
            <div className="mrq-field">
              <label>{t('maintenanceRequestPage.fields.symptomStartedAt')}</label>
              <input
                value={form.symptom_started_at}
                onChange={(e) => updateField('symptom_started_at', e.target.value)}
                placeholder={t('maintenanceRequestPage.placeholders.symptomStartedAt')}
              />
            </div>
          </section>

          <section className="mrq-panel">
            <h2><Clock size={18} /> {t('maintenanceRequestPage.sections.propertyAndAccess')}</h2>
            <div className="mrq-two">
              <div className="mrq-field">
                <label>{t('maintenanceRequestPage.fields.propertyLabel')}</label>
                <input
                  value={form.property_label}
                  onChange={(e) => updateField('property_label', e.target.value)}
                  placeholder={t('maintenanceRequestPage.placeholders.propertyLabel')}
                />
              </div>
              <div className="mrq-field">
                <label>{t('maintenanceRequestPage.fields.unitLabel')}</label>
                <input
                  value={form.unit_label}
                  onChange={(e) => updateField('unit_label', e.target.value)}
                  placeholder={t('maintenanceRequestPage.placeholders.unitLabel')}
                />
              </div>
            </div>
            <div className="mrq-field">
              <label>{t('maintenanceRequestPage.fields.preferredRepairWindows')}</label>
              <textarea
                value={form.preferred_times}
                onChange={(e) => updateField('preferred_times', e.target.value)}
                rows={3}
                placeholder={t('maintenanceRequestPage.placeholders.preferredWindows')}
              />
            </div>
            <div className="mrq-field">
              <label>{t('maintenanceRequestPage.fields.accessNotes')}</label>
              <textarea
                value={form.access_notes}
                onChange={(e) => updateField('access_notes', e.target.value)}
                rows={3}
                placeholder={t('maintenanceRequestPage.placeholders.accessNotes')}
              />
            </div>
            <div className="mrq-two">
              <div className="mrq-field">
                <label>{t('maintenanceRequestPage.fields.entryPreference')}</label>
                <input
                  value={form.entry_preference}
                  onChange={(e) => updateField('entry_preference', e.target.value)}
                  placeholder={t('maintenanceRequestPage.placeholders.entryPreference')}
                />
              </div>
              <div className="mrq-field">
                <label>{t('maintenanceRequestPage.fields.bestUpdateChannel')}</label>
                <select value={form.best_update_channel} onChange={(e) => updateField('best_update_channel', e.target.value)}>
                  <option value="sms">{t('maintenanceRequestPage.updateChannels.sms')}</option>
                  <option value="phone">{t('maintenanceRequestPage.updateChannels.phone')}</option>
                  <option value="email">{t('maintenanceRequestPage.updateChannels.email')}</option>
                </select>
              </div>
            </div>
            <label className="mrq-check">
              <input
                type="checkbox"
                checked={form.permission_to_enter}
                onChange={(e) => updateField('permission_to_enter', e.target.checked)}
              />
              <span>{t('maintenanceRequestPage.checks.permissionToEnter')}</span>
            </label>
            <label className="mrq-check">
              <input
                type="checkbox"
                checked={form.resident_present_required}
                onChange={(e) => updateField('resident_present_required', e.target.checked)}
              />
              <span>{t('maintenanceRequestPage.checks.residentPresentRequired')}</span>
            </label>
            <label className="mrq-check">
              <input
                type="checkbox"
                checked={form.pets_on_site}
                onChange={(e) => updateField('pets_on_site', e.target.checked)}
              />
              <span>{t('maintenanceRequestPage.checks.petsOnSite')}</span>
            </label>
            <div className="mrq-field">
              <label>{t('maintenanceRequestPage.fields.contactPhone')}</label>
              <input
                value={form.contact_phone}
                onChange={(e) => updateField('contact_phone', e.target.value)}
                placeholder={t('maintenanceRequestPage.placeholders.contactPhone')}
              />
            </div>
            <div className="mrq-field">
              <label>{t('maintenanceRequestPage.fields.billableParty')}</label>
              <select value={form.billable_party} onChange={(e) => updateField('billable_party', e.target.value)}>
                <option value="owner">{t('maintenanceRequestPage.billableParty.owner')}</option>
                <option value="tenant">{t('maintenanceRequestPage.billableParty.tenant')}</option>
                <option value="hoa">{t('maintenanceRequestPage.billableParty.hoa')}</option>
                <option value="internal">{t('maintenanceRequestPage.billableParty.internal')}</option>
              </select>
            </div>
          </section>

          <section className="mrq-panel mrq-panel-wide">
            <h2><Camera size={18} /> {t('maintenanceRequestPage.sections.photos')}</h2>
            <label className="mrq-upload">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                multiple
                onChange={(e) => updateField('photos', Array.from(e.target.files || []).slice(0, 5))}
              />
              <span>{photoNames || t('maintenanceRequestPage.photoUpload')}</span>
            </label>
            <div className="mrq-note">
              <ShieldCheck size={18} />
              <p>
                {t('maintenanceRequestPage.notes.management')}
              </p>
            </div>
            <div className="mrq-note warning">
              <AlertTriangle size={18} />
              <p>
                {t('maintenanceRequestPage.notes.warning', {
                  emergencyLine: business?.propertyOperations?.emergency_phone
                    ? ` ${business.propertyOperations.emergency_phone}`
                    : t('maintenanceRequestPage.notes.emergencyFallback'),
                })}
              </p>
            </div>
            <button className="mrq-btn primary submit" type="submit" disabled={submitting}>
              {submitting ? t('maintenanceRequestPage.buttons.sending') : t('maintenanceRequestPage.buttons.send')}
            </button>
          </section>
        </form>
      </main>
    </PageShell>
  );
}
