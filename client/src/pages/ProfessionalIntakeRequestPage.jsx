import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Briefcase, CheckCircle2, FileText, Scale, TrendingUp } from 'lucide-react';
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
        toast.error('Could not load this professional-services profile.');
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
    if (form.service_need.trim().length < 3) return toast.error('Tell the business what you need help with.');
    setSubmitting(true);
    try {
      const request = await createPublicProfessionalIntake(businessId, {
        ...form,
        template_slug: workspace?.business?.active_template || 'consulting_coaching',
      });
      setSubmitted(request);
      toast.success('Engagement intake sent.');
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Could not send engagement intake.');
    } finally {
      setSubmitting(false);
    }
  }

  const activeTemplate = workspace?.business?.active_template || 'consulting_coaching';
  const businessName = workspace?.business?.business_name || 'this professional business';
  const Icon = activeTemplate === 'accountant' ? TrendingUp : activeTemplate === 'legal_admin' ? Scale : Briefcase;

  if (loading) {
    return (
      <PageShell>
        <div className="mrq-page"><p className="mrq-muted">Loading engagement intake...</p></div>
      </PageShell>
    );
  }

  if (submitted) {
    return (
      <PageShell>
        <PageMeta title="Engagement intake sent - OxSteed" noIndex />
        <main className="mrq-page">
          <section className="mrq-success">
            <CheckCircle2 size={42} />
            <p className="mrq-eyebrow">Intake sent</p>
            <h1>{submitted.service_need}</h1>
            <p>
              {businessName} can now review the engagement scope, required documents, timeline, and package fit before moving you into consultation, proposal, or recurring obligation follow-up.
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
      <PageMeta title={`Engagement intake - ${businessName}`} noIndex />
      <main className="mrq-page">
        <section className="mrq-hero">
          <div>
            <p className="mrq-eyebrow"><FileText size={16} /> Engagement intake</p>
            <h1>Start your engagement with {businessName}</h1>
            <p>
              {workspace?.settings?.engagement_policy || 'Share the service need, context, documents, and timeline so the business can route you into the right engagement or retainer path.'}
            </p>
          </div>
          <div className="mrq-hero-card">
            <Icon size={24} />
            <strong>{workspace?.settings?.consultation_label || 'Engagement intake and consultation planning'}</strong>
            <span>Built for documented scoping, recurring obligations, and trust-sensitive follow-up instead of a vague contact request.</span>
          </div>
        </section>

        <form className="mrq-grid" onSubmit={handleSubmit}>
          <section className="mrq-panel">
            <h2><Icon size={18} /> Service need and context</h2>
            <div className="mrq-field">
              <label>Service need</label>
              <input value={form.service_need} onChange={(e) => updateField('service_need', e.target.value)} placeholder={activeTemplate === 'accountant' ? 'Bookkeeping cleanup, tax filing, monthly reporting' : activeTemplate === 'legal_admin' ? 'Document prep, filing support, admin follow-up' : 'Coaching, strategic advisory, accountability support'} maxLength={180} />
            </div>
            <div className="mrq-field">
              <label>Business or personal context</label>
              <textarea value={form.business_context} onChange={(e) => updateField('business_context', e.target.value)} rows={5} placeholder="Explain the situation, what is urgent, and what outcome you need." />
            </div>
            <div className="mrq-two">
              <div className="mrq-field">
                <label>Timeline notes</label>
                <input value={form.timeline_notes} onChange={(e) => updateField('timeline_notes', e.target.value)} placeholder="Filing deadline, launch date, next review, urgent issue" />
              </div>
              <div className="mrq-field">
                <label>Package or retainer interest</label>
                <input value={form.package_interest} onChange={(e) => updateField('package_interest', e.target.value)} placeholder="One-time filing, monthly retainer, strategy package" />
              </div>
            </div>
          </section>

          <section className="mrq-panel">
            <h2><FileText size={18} /> Documents and expectations</h2>
            <div className="mrq-field">
              <label>Document summary</label>
              <textarea value={form.document_summary} onChange={(e) => updateField('document_summary', e.target.value)} rows={5} placeholder="What documents already exist, what is missing, and what may need review?" />
            </div>
            <div className="mrq-field">
              <label>Budget notes</label>
              <input value={form.budget_notes} onChange={(e) => updateField('budget_notes', e.target.value)} placeholder="Optional budget or engagement guardrails" />
            </div>
            <div className="mt-4 rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-4 text-sm text-gray-300">
              <p><strong>Document checklist:</strong> {(workspace?.settings?.document_checklist || []).join(', ') || 'Configured inside Business Hub.'}</p>
              <p className="mt-3"><strong>Recurring obligations:</strong> {(workspace?.settings?.obligation_types || []).join(', ') || 'Configured inside Business Hub.'}</p>
            </div>
          </section>

          <section className="mrq-panel">
            <h2><Briefcase size={18} /> Contact and next step</h2>
            <div className="mrq-field">
              <label>Contact name</label>
              <input value={form.contact_name} onChange={(e) => updateField('contact_name', e.target.value)} placeholder="Primary contact" />
            </div>
            <div className="mrq-two">
              <div className="mrq-field">
                <label>Email</label>
                <input value={form.contact_email} onChange={(e) => updateField('contact_email', e.target.value)} placeholder="you@example.com" />
              </div>
              <div className="mrq-field">
                <label>Phone</label>
                <input value={form.contact_phone} onChange={(e) => updateField('contact_phone', e.target.value)} placeholder="Optional phone" />
              </div>
            </div>
            <div className="mrq-field">
              <label>Preferred contact channel</label>
              <select value={form.preferred_contact_channel} onChange={(e) => updateField('preferred_contact_channel', e.target.value)}>
                <option value="email">Email</option>
                <option value="call">Call</option>
                <option value="meeting">Meeting</option>
                <option value="message">Message</option>
              </select>
            </div>
            <button className="mrq-btn primary" type="submit" disabled={submitting}>
              {submitting ? 'Sending...' : 'Send engagement intake'}
            </button>
          </section>
        </form>
      </main>
    </PageShell>
  );
}
