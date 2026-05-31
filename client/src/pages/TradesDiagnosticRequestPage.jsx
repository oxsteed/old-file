import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { AlertTriangle, Car, CheckCircle2, ShieldCheck, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import api from '../api/axios';
import { createPublicTradesRequest, getPublicTradesOperations } from '../api/tradesOperations';
import { getMaintenanceBusiness } from '../api/maintenanceRequests';
import '../styles/MaintenanceRequestPage.css';

const INITIAL_FORM = {
  issue_type: 'System failure',
  title: '',
  description: '',
  urgency: 'normal',
  service_address: '',
  preferred_times: '',
  contact_phone: '',
  asset_label: '',
  asset_year: '',
  vin: '',
  mileage: '',
  safety_sensitive: false,
  symptoms_started_at: '',
  property_type: '',
  warning_lights: '',
  outage_scope: '',
  access_constraints: '',
  prior_repairs: '',
  photos: [],
};

export default function TradesDiagnosticRequestPage() {
  const { t } = useTranslation();
  const { businessId } = useParams();
  const [business, setBusiness] = useState(null);
  const [workspace, setWorkspace] = useState(null);
  const [garage, setGarage] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(null);
  const [form, setForm] = useState(INITIAL_FORM);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [bizData, tradesData] = await Promise.all([
          getMaintenanceBusiness(businessId),
          getPublicTradesOperations(businessId),
        ]);
        if (cancelled) return;
        setBusiness(bizData.business);
        setWorkspace(tradesData);
        setForm((current) => ({
          ...current,
          issue_type: tradesData?.settings?.supported_issue_types?.[0] || current.issue_type,
        }));
        if (tradesData?.business?.active_template === 'auto_mechanic') {
          api.get('/vehicles/my').then((res) => {
            if (!cancelled) setGarage(res.data || []);
          }).catch(() => {});
        }
      } catch {
        toast.error(t('tradesRequest.toast.loadFailed'));
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

  function handleGaragePick(vehicleId) {
    const vehicle = garage.find((item) => String(item.id) === String(vehicleId));
    if (!vehicle) return;
    setForm((current) => ({
      ...current,
      asset_label: [vehicle.make_name, vehicle.model_name].filter(Boolean).join(' '),
      asset_year: vehicle.year || '',
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (form.title.trim().length < 6) return toast.error(t('tradesRequest.toast.titleTooShort'));
    if (form.description.trim().length < 20) return toast.error(t('tradesRequest.toast.descriptionTooShort'));
    const payload = new FormData();
    Object.entries(form).forEach(([key, value]) => {
      if (key === 'photos') return;
      payload.append(key, value);
    });
    payload.append('template_slug', workspace?.business?.active_template || 'trades_pro');
    Array.from(form.photos || []).slice(0, 5).forEach((file) => payload.append('photos', file));

    setSubmitting(true);
    try {
      const request = await createPublicTradesRequest(businessId, payload);
      setSubmitted(request);
      toast.success(t('tradesRequest.toast.requestSent'));
    } catch (error) {
      toast.error(error?.response?.data?.error || t('tradesRequest.toast.sendFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  const activeTemplate = workspace?.business?.active_template || 'trades_pro';
  const isAuto = activeTemplate === 'auto_mechanic';
  const isElectrician = activeTemplate === 'electrician';

  if (loading) {
    return (
      <PageShell>
        <div className="mrq-page"><p className="mrq-muted">{t('tradesRequest.loading')}</p></div>
      </PageShell>
    );
  }

  if (submitted) {
    return (
      <PageShell>
        <PageMeta title={t('tradesRequest.meta.sentTitle')} noIndex />
        <main className="mrq-page">
          <section className="mrq-success">
            <CheckCircle2 size={42} />
            <p className="mrq-eyebrow">{t('tradesRequest.success.eyebrow')}</p>
            <h1>{submitted.title}</h1>
            <p>
              {t('tradesRequest.success.body', { provider: business?.business_name || t('tradesRequest.provider.generic') })}
            </p>
            <div className="mrq-success-actions">
              <Link className="mrq-btn primary" to={`/business/${businessId}`}>{t('tradesRequest.success.actions.backToProfile')}</Link>
              <Link className="mrq-btn" to="/dashboard">{t('tradesRequest.success.actions.goToDashboard')}</Link>
            </div>
          </section>
        </main>
      </PageShell>
    );
  }

  const defaultIssueTypes = [
    { value: 'System failure', label: t('tradesRequest.issueTypes.systemFailure') },
    { value: 'Safety concern', label: t('tradesRequest.issueTypes.safetyConcern') },
    { value: 'Intermittent issue', label: t('tradesRequest.issueTypes.intermittent') },
    { value: 'Install or replacement', label: t('tradesRequest.issueTypes.installOrReplacement') },
    { value: 'Maintenance request', label: t('tradesRequest.issueTypes.maintenance') },
  ];

  const issueTypeOptions = (workspace?.settings?.supported_issue_types || []).length
    ? workspace.settings.supported_issue_types.map((value) => ({ value, label: value }))
    : defaultIssueTypes;

  return (
    <PageShell>
      <PageMeta title={t('tradesRequest.meta.requestTitle', { provider: business?.business_name || 'OxSteed' })} noIndex />
      <main className="mrq-page">
        <section className="mrq-hero">
          <div>
            <p className="mrq-eyebrow"><Wrench size={16} /> {t('tradesRequest.hero.eyebrow')}</p>
            <h1>{t('tradesRequest.hero.title', { provider: business?.business_name || t('tradesRequest.provider.thisProvider') })}</h1>
            <p>
              {workspace?.settings?.intake_instructions || t('tradesRequest.hero.instructionsFallback')}
            </p>
          </div>
          <div className="mrq-hero-card">
            {isAuto ? <Car size={24} /> : <Wrench size={24} />}
            <strong>{workspace?.settings?.primary_quote_label || t('tradesRequest.hero.card.titleFallback')}</strong>
            <span>{t('tradesRequest.hero.card.subtitle')}</span>
          </div>
        </section>

        <form className="mrq-grid" onSubmit={handleSubmit}>
          <section className="mrq-panel">
            <h2><Wrench size={18} /> {t('tradesRequest.sections.problemDetails')}</h2>
            <div className="mrq-field">
              <label>{t('tradesRequest.fields.issueType')}</label>
              <select value={form.issue_type} onChange={(e) => updateField('issue_type', e.target.value)}>
                {issueTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className="mrq-field">
              <label>{t('tradesRequest.fields.shortTitle')}</label>
              <input value={form.title} onChange={(e) => updateField('title', e.target.value)} placeholder={isAuto ? t('tradesRequest.placeholders.shortTitleAuto') : t('tradesRequest.placeholders.shortTitleGeneric')} maxLength={200} />
            </div>
            <div className="mrq-field">
              <label>{t('tradesRequest.fields.symptoms')}</label>
              <textarea value={form.description} onChange={(e) => updateField('description', e.target.value)} rows={6} placeholder={t('tradesRequest.placeholders.symptoms')} />
            </div>
            <div className="mrq-field">
              <label>{t('tradesRequest.fields.urgency')}</label>
              <div className="mrq-segments">
                {['emergency', 'urgent', 'normal', 'low'].map((value) => (
                  <button key={value} type="button" className={form.urgency === value ? 'active' : ''} onClick={() => updateField('urgency', value)}>
                    {t(`tradesRequest.urgency.${value}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className="mrq-two">
              <div className="mrq-field">
                <label>{t('tradesRequest.fields.startedAt')}</label>
                <input value={form.symptoms_started_at} onChange={(e) => updateField('symptoms_started_at', e.target.value)} placeholder={t('tradesRequest.placeholders.startedAt')} />
              </div>
              <div className="mrq-field">
                <label>{t('tradesRequest.fields.safetySensitive')}</label>
                <select value={String(form.safety_sensitive)} onChange={(e) => updateField('safety_sensitive', e.target.value === 'true')}>
                  <option value="false">{t('tradesRequest.safetySensitive.no')}</option>
                  <option value="true">{t('tradesRequest.safetySensitive.yes')}</option>
                </select>
              </div>
            </div>
          </section>

          <section className="mrq-panel">
            <h2>{isAuto ? <Car size={18} /> : <ShieldCheck size={18} />} {t('tradesRequest.sections.assetAndAccess')}</h2>
            {isAuto && garage.length > 0 ? (
              <div className="mrq-field">
                <label>{t('tradesRequest.fields.garagePick')}</label>
                <select defaultValue="" onChange={(e) => handleGaragePick(e.target.value)}>
                  <option value="">{t('tradesRequest.fields.garagePickPlaceholder')}</option>
                  {garage.map((vehicle) => (
                    <option key={vehicle.id} value={vehicle.id}>
                      {[vehicle.year, vehicle.make_name, vehicle.model_name].filter(Boolean).join(' ')}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="mrq-two">
              <div className="mrq-field">
                <label>{isAuto ? t('tradesRequest.fields.asset.vehicleOrAsset') : t('tradesRequest.fields.asset.systemOrAsset')}</label>
                <input value={form.asset_label} onChange={(e) => updateField('asset_label', e.target.value)} placeholder={isAuto ? t('tradesRequest.placeholders.assetAuto') : t('tradesRequest.placeholders.assetGeneric')} />
              </div>
              <div className="mrq-field">
                <label>{isAuto ? t('tradesRequest.fields.asset.year') : t('tradesRequest.fields.asset.propertyType')}</label>
                <input value={isAuto ? form.asset_year : form.property_type} onChange={(e) => updateField(isAuto ? 'asset_year' : 'property_type', e.target.value)} placeholder={isAuto ? t('tradesRequest.placeholders.assetYear') : t('tradesRequest.placeholders.propertyType')} />
              </div>
            </div>
            {isAuto ? (
              <div className="mrq-two">
                <div className="mrq-field">
                  <label>{t('tradesRequest.fields.asset.vin')}</label>
                  <input value={form.vin} onChange={(e) => updateField('vin', e.target.value)} placeholder={t('tradesRequest.placeholders.optionalVin')} />
                </div>
                <div className="mrq-field">
                  <label>{t('tradesRequest.fields.asset.mileage')}</label>
                  <input value={form.mileage} onChange={(e) => updateField('mileage', e.target.value)} placeholder={t('tradesRequest.placeholders.optionalMileage')} />
                </div>
              </div>
            ) : (
              <div className="mrq-two">
                <div className="mrq-field">
                  <label>{isElectrician ? t('tradesRequest.fields.site.outageScope') : t('tradesRequest.fields.site.accessConstraints')}</label>
                  <input value={isElectrician ? form.outage_scope : form.access_constraints} onChange={(e) => updateField(isElectrician ? 'outage_scope' : 'access_constraints', e.target.value)} placeholder={isElectrician ? t('tradesRequest.placeholders.outageScope') : t('tradesRequest.placeholders.accessConstraints')} />
                </div>
                <div className="mrq-field">
                  <label>{isElectrician ? t('tradesRequest.fields.site.warningLights') : t('tradesRequest.fields.site.priorRepairs')}</label>
                  <input value={isElectrician ? form.warning_lights : form.prior_repairs} onChange={(e) => updateField(isElectrician ? 'warning_lights' : 'prior_repairs', e.target.value)} placeholder={isElectrician ? t('tradesRequest.placeholders.warningLights') : t('tradesRequest.placeholders.priorRepairs')} />
                </div>
              </div>
            )}
            <div className="mrq-field">
              <label>{isAuto ? t('tradesRequest.fields.site.serviceLocationAuto') : t('tradesRequest.fields.site.serviceAddressGeneric')}</label>
              <textarea value={form.service_address} onChange={(e) => updateField('service_address', e.target.value)} rows={3} placeholder={isAuto ? t('tradesRequest.placeholders.serviceLocationAuto') : t('tradesRequest.placeholders.serviceAddressGeneric')} />
            </div>
            <div className="mrq-field">
              <label>{t('tradesRequest.fields.site.preferredWindows')}</label>
              <textarea value={form.preferred_times} onChange={(e) => updateField('preferred_times', e.target.value)} rows={3} placeholder={t('tradesRequest.placeholders.preferredWindows')} />
            </div>
            <div className="mrq-field">
              <label>{t('tradesRequest.fields.site.bestPhone')}</label>
              <input value={form.contact_phone} onChange={(e) => updateField('contact_phone', e.target.value)} placeholder={t('tradesRequest.placeholders.optional')} />
            </div>
          </section>

          <section className="mrq-panel mrq-panel-wide">
            <h2><Wrench size={18} /> {t('tradesRequest.sections.photosAndExpectations')}</h2>
            <label className="mrq-upload">
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={(e) => updateField('photos', Array.from(e.target.files || []).slice(0, 5))} />
              <span>
                {(form.photos || []).length
                  ? t('tradesRequest.photos.selected', { count: (form.photos || []).length })
                  : t('tradesRequest.photos.addUpTo')}
              </span>
            </label>
            <div className="mrq-note">
              <ShieldCheck size={18} />
              <p>
                {t('tradesRequest.notes.organizer')}
              </p>
            </div>
            <div className="mrq-note warning">
              <AlertTriangle size={18} />
              <p>
                {workspace?.settings?.emergency_phone
                  ? t('tradesRequest.notes.emergencyWithPhone', { phone: workspace.settings.emergency_phone })
                  : t('tradesRequest.notes.emergencyFallback')}
              </p>
            </div>
            <button className="mrq-btn primary submit" type="submit" disabled={submitting}>
              {submitting ? t('tradesRequest.actions.sending') : t('tradesRequest.actions.sendRequest')}
            </button>
          </section>
        </form>
      </main>
    </PageShell>
  );
}
