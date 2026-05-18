import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
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
        toast.error('Could not load this creative profile.');
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
    if (form.project_type.trim().length < 3) return toast.error('Tell the business what kind of project you need.');
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
      toast.success('Creative discovery sent.');
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Could not send creative discovery.');
    } finally {
      setSubmitting(false);
    }
  }

  const activeTemplate = workspace?.business?.active_template || 'creative_studio';
  const isPhotographer = activeTemplate === 'photographer';
  const isDesigner = activeTemplate === 'graphic_design';
  const businessName = workspace?.business?.business_name || 'this creative business';

  if (loading) {
    return (
      <PageShell>
        <div className="mrq-page"><p className="mrq-muted">Loading creative discovery...</p></div>
      </PageShell>
    );
  }

  if (submitted) {
    return (
      <PageShell>
        <PageMeta title="Creative discovery sent - OxSteed" noIndex />
        <main className="mrq-page">
          <section className="mrq-success">
            <CheckCircle2 size={42} />
            <p className="mrq-eyebrow">Discovery sent</p>
            <h1>{submitted.project_type}</h1>
            <p>
              {businessName} can now review the project goal, style direction, package fit, and delivery timing before moving you into discovery, proposal, or production.
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
      <PageMeta title={`Creative discovery - ${businessName}`} noIndex />
      <main className="mrq-page">
        <section className="mrq-hero">
          <div>
            <p className="mrq-eyebrow"><Layers3 size={16} /> Creative discovery</p>
            <h1>Start a project with {businessName}</h1>
            <p>
              {workspace?.settings?.revision_policy || 'Share the project goal, style direction, references, and deadline so the business can route you into the right creative package or proposal.'}
            </p>
          </div>
          <div className="mrq-hero-card">
            {isPhotographer ? <Camera size={24} /> : isDesigner ? <PenTool size={24} /> : <Palette size={24} />}
            <strong>{workspace?.settings?.discovery_call_label || 'Creative discovery intake'}</strong>
            <span>Built for discovery, proposal clarity, approvals, and delivery follow-through instead of generic contact messages.</span>
          </div>
        </section>

        <form className="mrq-grid" onSubmit={handleSubmit}>
          <section className="mrq-panel">
            <h2><Palette size={18} /> Project brief</h2>
            <div className="mrq-field">
              <label>Project type</label>
              <input value={form.project_type} onChange={(e) => updateField('project_type', e.target.value)} placeholder={isPhotographer ? 'Portrait session, brand shoot, event coverage' : isDesigner ? 'Logo system, packaging, pitch deck' : 'Campaign, content system, creative direction'} maxLength={180} />
            </div>
            <div className="mrq-field">
              <label>Project goal</label>
              <textarea value={form.project_goal} onChange={(e) => updateField('project_goal', e.target.value)} rows={5} placeholder="What are you trying to achieve, who is it for, and what outcome matters most?" />
            </div>
            <div className="mrq-field">
              <label>Style direction</label>
              <textarea value={form.style_direction} onChange={(e) => updateField('style_direction', e.target.value)} rows={4} placeholder="Describe the aesthetic, mood, brand references, or visual language you want." />
            </div>
            <div className="mrq-two">
              <div className="mrq-field">
                <label>Deadline notes</label>
                <input value={form.deadline_notes} onChange={(e) => updateField('deadline_notes', e.target.value)} placeholder="Launch date, event date, handoff timing" />
              </div>
              <div className="mrq-field">
                <label>Package interest</label>
                <input value={form.package_interest} onChange={(e) => updateField('package_interest', e.target.value)} placeholder="Session package, brand system, retainer" />
              </div>
            </div>
          </section>

          <section className="mrq-panel">
            <h2>{isPhotographer ? <Camera size={18} /> : <PenTool size={18} />} Assets and delivery</h2>
            <div className="mrq-field">
              <label>Assets or deliverables needed</label>
              <textarea value={form.asset_needs} onChange={(e) => updateField('asset_needs', e.target.value)} rows={4} placeholder="What files, formats, scenes, deliverables, or outputs do you need?" />
            </div>
            <div className="mrq-two">
              <div className="mrq-field">
                <label>Revision scope expectations</label>
                <input value={form.revision_scope} onChange={(e) => updateField('revision_scope', e.target.value)} placeholder="Rounds of revisions, selects, proofing needs" />
              </div>
              <div className="mrq-field">
                <label>Budget notes</label>
                <input value={form.budget_notes} onChange={(e) => updateField('budget_notes', e.target.value)} placeholder="Optional budget or pricing guardrails" />
              </div>
            </div>
            <div className="mrq-field">
              <label>Reference links</label>
              <textarea value={form.reference_links} onChange={(e) => updateField('reference_links', e.target.value)} rows={4} placeholder="One link per line: Pinterest board, moodboard, prior brand assets, example work" />
            </div>
            <div className="mrq-field">
              <label>Upload references</label>
              <input type="file" accept="image/*" multiple onChange={(e) => updateField('photos', Array.from(e.target.files || []).slice(0, 5))} />
            </div>
          </section>

          <section className="mrq-panel">
            <h2><Layers3 size={18} /> Contact and process</h2>
            <div className="mrq-field">
              <label>Contact name</label>
              <input value={form.contact_name} onChange={(e) => updateField('contact_name', e.target.value)} placeholder="Your name or team contact" />
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
            <div className="mt-4 rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-4 text-sm text-gray-300">
              <p><strong>Revision policy:</strong> {workspace?.settings?.revision_policy || 'Configured inside Business Hub.'}</p>
              <p className="mt-3"><strong>Approval process:</strong> {workspace?.settings?.approval_policy || 'Configured inside Business Hub.'}</p>
            </div>
            <button className="mrq-btn primary" type="submit" disabled={submitting}>
              {submitting ? 'Sending...' : 'Send creative discovery'}
            </button>
          </section>
        </form>
      </main>
    </PageShell>
  );
}
