import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { AlertTriangle, Building2, Camera, CheckCircle2, Clock, Home, ShieldCheck, Wrench } from 'lucide-react';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import { createMaintenanceRequest, getMaintenanceBusiness } from '../api/maintenanceRequests';
import '../styles/MaintenanceRequestPage.css';

const ISSUE_CATEGORIES = [
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
  photos: [],
};

export default function MaintenanceRequestPage() {
  const { businessId } = useParams();
  const [business, setBusiness] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(null);
  const [form, setForm] = useState(INITIAL_FORM);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getMaintenanceBusiness(businessId)
      .then((data) => {
        if (!cancelled) setBusiness(data.business);
      })
      .catch(() => toast.error('Could not load this property profile.'))
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
      toast.error('Add a short title for the issue.');
      return;
    }
    if (form.description.trim().length < 20) {
      toast.error('Add more detail so the property manager can respond properly.');
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
      toast.success('Maintenance request sent.');
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Could not send maintenance request.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <PageShell>
        <div className="mrq-page"><p className="mrq-muted">Loading maintenance request...</p></div>
      </PageShell>
    );
  }

  if (submitted) {
    return (
      <PageShell>
        <PageMeta title="Maintenance request sent - OxSteed" noIndex />
        <main className="mrq-page">
          <section className="mrq-success">
            <CheckCircle2 size={42} />
            <p className="mrq-eyebrow">Request sent</p>
            <h1>{submitted.title}</h1>
            <p>
              {business?.business_name || 'The property manager'} can now accept, schedule, assign,
              convert this into work, and keep repair records connected to OxSteed.
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
      <PageMeta title={`Report maintenance issue - ${business?.business_name || 'OxSteed'}`} noIndex />
      <main className="mrq-page">
        <section className="mrq-hero">
          <div>
            <p className="mrq-eyebrow"><Building2 size={16} /> Property maintenance</p>
            <h1>Report an issue to {business?.business_name || 'this property manager'}</h1>
            <p>
              Send the details the owner needs to decide, schedule, assign a helper, and keep a clean repair record.
            </p>
          </div>
          <div className="mrq-hero-card">
            <Wrench size={24} />
            <strong>What helps most</strong>
            <span>Photos, unit details, access notes, urgency, and times that work for entry.</span>
          </div>
        </section>

        <form className="mrq-grid" onSubmit={handleSubmit}>
          <section className="mrq-panel">
            <h2><Home size={18} /> Issue details</h2>
            <div className="mrq-field">
              <label>Issue category</label>
              <select value={form.issue_category} onChange={(e) => updateField('issue_category', e.target.value)}>
                {ISSUE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </div>
            <div className="mrq-field">
              <label>Short title</label>
              <input value={form.title} onChange={(e) => updateField('title', e.target.value)} placeholder="Kitchen sink leaking under cabinet" maxLength={200} />
            </div>
            <div className="mrq-field">
              <label>What is happening?</label>
              <textarea value={form.description} onChange={(e) => updateField('description', e.target.value)} rows={6} placeholder="Describe when it started, where it is, what changed, and whether anything is unsafe or actively leaking." />
            </div>
            <div className="mrq-field">
              <label>Urgency</label>
              <div className="mrq-segments">
                {[
                  ['emergency', 'Emergency'],
                  ['urgent', 'Urgent'],
                  ['normal', 'Normal'],
                  ['low', 'Low'],
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
          </section>

          <section className="mrq-panel">
            <h2><Clock size={18} /> Property and access</h2>
            <div className="mrq-two">
              <div className="mrq-field">
                <label>Property or address label</label>
                <input value={form.property_label} onChange={(e) => updateField('property_label', e.target.value)} placeholder="Main St duplex" />
              </div>
              <div className="mrq-field">
                <label>Unit</label>
                <input value={form.unit_label} onChange={(e) => updateField('unit_label', e.target.value)} placeholder="Apt 2B" />
              </div>
            </div>
            <div className="mrq-field">
              <label>Preferred repair windows</label>
              <textarea value={form.preferred_times} onChange={(e) => updateField('preferred_times', e.target.value)} rows={3} placeholder="Weekdays after 4 PM, Saturday morning, etc." />
            </div>
            <div className="mrq-field">
              <label>Access notes</label>
              <textarea value={form.access_notes} onChange={(e) => updateField('access_notes', e.target.value)} rows={3} placeholder="Pets, gate code, parking, permission rules, or how to reach you." />
            </div>
            <label className="mrq-check">
              <input
                type="checkbox"
                checked={form.permission_to_enter}
                onChange={(e) => updateField('permission_to_enter', e.target.checked)}
              />
              <span>I give permission to enter if the property manager schedules the repair according to the notes above.</span>
            </label>
            <div className="mrq-field">
              <label>Best phone number</label>
              <input value={form.contact_phone} onChange={(e) => updateField('contact_phone', e.target.value)} placeholder="Optional" />
            </div>
          </section>

          <section className="mrq-panel mrq-panel-wide">
            <h2><Camera size={18} /> Photos and expectations</h2>
            <label className="mrq-upload">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                multiple
                onChange={(e) => updateField('photos', Array.from(e.target.files || []).slice(0, 5))}
              />
              <span>{photoNames || 'Add up to 5 photos'}</span>
            </label>
            <div className="mrq-note">
              <ShieldCheck size={18} />
              <p>
                OxSteed helps organize the request, messages, scheduling, and records. The property manager decides how to respond,
                who performs the repair, and what access or payment arrangements apply.
              </p>
            </div>
            <div className="mrq-note warning">
              <AlertTriangle size={18} />
              <p>For immediate danger, active flooding, fire, gas smell, or urgent safety risk, contact emergency services or your property emergency line first.</p>
            </div>
            <button className="mrq-btn primary submit" type="submit" disabled={submitting}>
              {submitting ? 'Sending...' : 'Send maintenance request'}
            </button>
          </section>
        </form>
      </main>
    </PageShell>
  );
}
