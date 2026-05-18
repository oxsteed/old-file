import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { AlertTriangle, Car, CheckCircle2, ShieldCheck, Wrench } from 'lucide-react';
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
        toast.error('Could not load this trades profile.');
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
    if (form.title.trim().length < 6) return toast.error('Add a short summary of the issue.');
    if (form.description.trim().length < 20) return toast.error('Add more detail so the technician can triage properly.');
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
      toast.success('Diagnostic request sent.');
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Could not send diagnostic request.');
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
        <div className="mrq-page"><p className="mrq-muted">Loading diagnostic intake...</p></div>
      </PageShell>
    );
  }

  if (submitted) {
    return (
      <PageShell>
        <PageMeta title="Diagnostic request sent - OxSteed" noIndex />
        <main className="mrq-page">
          <section className="mrq-success">
            <CheckCircle2 size={42} />
            <p className="mrq-eyebrow">Request sent</p>
            <h1>{submitted.title}</h1>
            <p>
              {business?.business_name || 'The provider'} can now triage the issue, document diagnosis,
              build written recommendations, and move approved work into repair follow-up.
            </p>
            <div className="mrq-success-actions">
              <Link className="mrq-btn primary" to={`/business/${businessId}`}>Back to profile</Link>
              <Link className="mrq-btn" to="/dashboard">Go to dashboard</Link>
            </div>
          </section>
        </main>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageMeta title={`Request diagnostic - ${business?.business_name || 'OxSteed'}`} noIndex />
      <main className="mrq-page">
        <section className="mrq-hero">
          <div>
            <p className="mrq-eyebrow"><Wrench size={16} /> Technical service intake</p>
            <h1>Request a diagnostic from {business?.business_name || 'this provider'}</h1>
            <p>
              {workspace?.settings?.intake_instructions || 'Share the symptoms, urgency, asset details, and timing so the business can triage, diagnose, and quote the right next step.'}
            </p>
          </div>
          <div className="mrq-hero-card">
            {isAuto ? <Car size={24} /> : <Wrench size={24} />}
            <strong>{workspace?.settings?.primary_quote_label || 'Diagnostic and estimate'}</strong>
            <span>Built for technical intake, written findings, and estimate follow-up instead of vague booking requests.</span>
          </div>
        </section>

        <form className="mrq-grid" onSubmit={handleSubmit}>
          <section className="mrq-panel">
            <h2><Wrench size={18} /> Problem details</h2>
            <div className="mrq-field">
              <label>Issue type</label>
              <select value={form.issue_type} onChange={(e) => updateField('issue_type', e.target.value)}>
                {(workspace?.settings?.supported_issue_types || ['System failure', 'Safety concern', 'Intermittent issue', 'Install or replacement', 'Maintenance request']).map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </div>
            <div className="mrq-field">
              <label>Short title</label>
              <input value={form.title} onChange={(e) => updateField('title', e.target.value)} placeholder={isAuto ? 'Engine light on and rough idle' : 'Kitchen circuit keeps tripping'} maxLength={200} />
            </div>
            <div className="mrq-field">
              <label>Describe the symptoms</label>
              <textarea value={form.description} onChange={(e) => updateField('description', e.target.value)} rows={6} placeholder="What is failing, when it happens, what changed, and anything that makes it worse or intermittent." />
            </div>
            <div className="mrq-field">
              <label>Urgency</label>
              <div className="mrq-segments">
                {['emergency', 'urgent', 'normal', 'low'].map((value) => (
                  <button key={value} type="button" className={form.urgency === value ? 'active' : ''} onClick={() => updateField('urgency', value)}>
                    {value.charAt(0).toUpperCase() + value.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="mrq-two">
              <div className="mrq-field">
                <label>When did it start?</label>
                <input value={form.symptoms_started_at} onChange={(e) => updateField('symptoms_started_at', e.target.value)} placeholder="Today, last week, after heavy rain, after last service..." />
              </div>
              <div className="mrq-field">
                <label>Safety-sensitive?</label>
                <select value={String(form.safety_sensitive)} onChange={(e) => updateField('safety_sensitive', e.target.value === 'true')}>
                  <option value="false">No immediate safety risk</option>
                  <option value="true">Yes, safety or breakdown risk</option>
                </select>
              </div>
            </div>
          </section>

          <section className="mrq-panel">
            <h2>{isAuto ? <Car size={18} /> : <ShieldCheck size={18} />} Asset and access</h2>
            {isAuto && garage.length > 0 ? (
              <div className="mrq-field">
                <label>Choose from my garage</label>
                <select defaultValue="" onChange={(e) => handleGaragePick(e.target.value)}>
                  <option value="">Select a saved vehicle</option>
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
                <label>{isAuto ? 'Vehicle or asset' : 'System or asset'}</label>
                <input value={form.asset_label} onChange={(e) => updateField('asset_label', e.target.value)} placeholder={isAuto ? '2017 Toyota Camry' : 'Main panel, breaker 14, HVAC condenser'} />
              </div>
              <div className="mrq-field">
                <label>{isAuto ? 'Year' : 'Property type'}</label>
                <input value={isAuto ? form.asset_year : form.property_type} onChange={(e) => updateField(isAuto ? 'asset_year' : 'property_type', e.target.value)} placeholder={isAuto ? '2017' : 'Residential, commercial, shop'} />
              </div>
            </div>
            {isAuto ? (
              <div className="mrq-two">
                <div className="mrq-field">
                  <label>VIN</label>
                  <input value={form.vin} onChange={(e) => updateField('vin', e.target.value)} placeholder="Optional VIN" />
                </div>
                <div className="mrq-field">
                  <label>Mileage</label>
                  <input value={form.mileage} onChange={(e) => updateField('mileage', e.target.value)} placeholder="Optional mileage" />
                </div>
              </div>
            ) : (
              <div className="mrq-two">
                <div className="mrq-field">
                  <label>{isElectrician ? 'Outage scope' : 'Access constraints'}</label>
                  <input value={isElectrician ? form.outage_scope : form.access_constraints} onChange={(e) => updateField(isElectrician ? 'outage_scope' : 'access_constraints', e.target.value)} placeholder={isElectrician ? 'Whole panel, one room, only certain outlets' : 'Gate code, roof access, customer must be present'} />
                </div>
                <div className="mrq-field">
                  <label>{isElectrician ? 'Warning lights / breakers' : 'Prior repairs'}</label>
                  <input value={isElectrician ? form.warning_lights : form.prior_repairs} onChange={(e) => updateField(isElectrician ? 'warning_lights' : 'prior_repairs', e.target.value)} placeholder={isElectrician ? 'Panel light, tripped breaker, burning smell' : 'Any recent service, repair, or workaround'} />
                </div>
              </div>
            )}
            <div className="mrq-field">
              <label>{isAuto ? 'Service location or drop-off note' : 'Service address or site notes'}</label>
              <textarea value={form.service_address} onChange={(e) => updateField('service_address', e.target.value)} rows={3} placeholder={isAuto ? 'Shop drop-off, on-site visit, or where the vehicle is located' : 'Address, access notes, parking, or site constraints'} />
            </div>
            <div className="mrq-field">
              <label>Preferred diagnostic windows</label>
              <textarea value={form.preferred_times} onChange={(e) => updateField('preferred_times', e.target.value)} rows={3} placeholder="When someone can inspect, call, or schedule service." />
            </div>
            <div className="mrq-field">
              <label>Best phone number</label>
              <input value={form.contact_phone} onChange={(e) => updateField('contact_phone', e.target.value)} placeholder="Optional" />
            </div>
          </section>

          <section className="mrq-panel mrq-panel-wide">
            <h2><Wrench size={18} /> Photos and response expectations</h2>
            <label className="mrq-upload">
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={(e) => updateField('photos', Array.from(e.target.files || []).slice(0, 5))} />
              <span>{(form.photos || []).length ? `${form.photos.length} photo(s) selected` : 'Add up to 5 photos'}</span>
            </label>
            <div className="mrq-note">
              <ShieldCheck size={18} />
              <p>
                OxSteed helps organize diagnostic intake, written recommendations, and follow-up. The provider decides the repair path,
                estimate terms, and whether emergency or on-site service is available.
              </p>
            </div>
            <div className="mrq-note warning">
              <AlertTriangle size={18} />
              <p>
                For immediate danger or urgent failure, contact emergency services
                {workspace?.settings?.emergency_phone ? ` or ${workspace.settings.emergency_phone}` : ' or the provider emergency line'} first.
              </p>
            </div>
            <button className="mrq-btn primary submit" type="submit" disabled={submitting}>
              {submitting ? 'Sending...' : 'Send diagnostic request'}
            </button>
          </section>
        </form>
      </main>
    </PageShell>
  );
}
