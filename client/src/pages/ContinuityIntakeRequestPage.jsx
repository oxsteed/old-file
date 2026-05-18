import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
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
        toast.error('Could not load this guided-intake profile.');
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
    if (form.primary_goal.trim().length < 3) return toast.error('Tell the business the main goal or concern first.');
    if (!form.policy_acknowledged) return toast.error('Acknowledge the intake and communication expectations first.');

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
      toast.success('Guided intake sent.');
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Could not send guided intake.');
    } finally {
      setSubmitting(false);
    }
  }

  const activeTemplate = workspace?.business?.active_template || 'wellness_therapy';
  const businessName = workspace?.business?.business_name || 'this business';
  const isEducation = EDUCATION_TEMPLATES.includes(activeTemplate);
  const isCare = CARE_TEMPLATES.includes(activeTemplate);
  const isPet = ['pet_services', 'dog_walker'].includes(activeTemplate);
  const Icon = isEducation ? BookOpen : isPet ? PawPrint : HeartHandshake;

  if (loading) {
    return (
      <PageShell>
        <div className="mrq-page"><p className="mrq-muted">Loading guided intake...</p></div>
      </PageShell>
    );
  }

  if (submitted) {
    return (
      <PageShell>
        <PageMeta title="Guided intake sent - OxSteed" noIndex />
        <main className="mrq-page">
          <section className="mrq-success">
            <CheckCircle2 size={42} />
            <p className="mrq-eyebrow">Intake sent</p>
            <h1>{submitted.primary_goal}</h1>
            <p>
              {businessName} can now review the goal, context, recurring cadence, and trust requirements before moving you into scheduling, progress review, or a longer continuity plan.
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
      <PageMeta title={`Guided intake - ${businessName}`} noIndex />
      <main className="mrq-page">
        <section className="mrq-hero">
          <div>
            <p className="mrq-eyebrow"><Icon size={16} /> Guided intake</p>
            <h1>Start guided intake with {businessName}</h1>
            <p>
              {workspace?.settings?.continuity_pitch || 'Share the goal, support context, schedule rhythm, and trust considerations so the business can route you into the right recurring support path.'}
            </p>
          </div>
          <div className="mrq-hero-card">
            <Icon size={24} />
            <strong>{workspace?.settings?.intake_label || 'Guided intake and continuity planning'}</strong>
            <span>Built for recurring sessions, progress review, and trust-sensitive follow-up instead of a one-off booking request.</span>
          </div>
        </section>

        <form className="mrq-grid" onSubmit={handleSubmit}>
          <section className="mrq-panel">
            <h2><Icon size={18} /> Goal and support context</h2>
            <div className="mrq-field">
              <label>Primary goal or concern</label>
              <input
                value={form.primary_goal}
                onChange={(e) => updateField('primary_goal', e.target.value)}
                placeholder={isEducation ? 'Reading support, test prep, confidence with algebra' : isCare ? 'Recurring support, pet routine, family help, dependable care' : 'Strength plan, recovery support, stress relief, nutrition reset'}
                maxLength={180}
              />
            </div>
            <div className="mrq-field">
              <label>Support context</label>
              <textarea value={form.support_context} onChange={(e) => updateField('support_context', e.target.value)} rows={5} placeholder="Explain the situation, current challenges, and what good progress would look like." />
            </div>
            <div className="mrq-two">
              <div className="mrq-field">
                <label>Schedule notes</label>
                <input value={form.schedule_notes} onChange={(e) => updateField('schedule_notes', e.target.value)} placeholder="Best days, frequency, urgency, time windows" />
              </div>
              <div className="mrq-field">
                <label>Progress target</label>
                <input value={form.progress_target} onChange={(e) => updateField('progress_target', e.target.value)} placeholder="Weekly walks, exam score goal, fewer flare-ups, mobility milestone" />
              </div>
            </div>
            <div className="mrq-two">
              <div className="mrq-field">
                <label>Package or plan interest</label>
                <input value={form.package_interest} onChange={(e) => updateField('package_interest', e.target.value)} placeholder="Membership, weekly sessions, support package" />
              </div>
              <div className="mrq-field">
                <label>Age, level, or life stage</label>
                <input value={form.age_or_level} onChange={(e) => updateField('age_or_level', e.target.value)} placeholder={isEducation ? 'Grade 6, SAT prep, early childhood' : isPet ? 'Puppy, senior dog, reactive walker' : 'Beginner, postpartum, older adult'} />
              </div>
            </div>
          </section>

          <section className="mrq-panel">
            <h2><ShieldCheck size={18} /> Routine, trust, and considerations</h2>
            <div className="mrq-field">
              <label>Current routine or baseline</label>
              <textarea value={form.current_routine} onChange={(e) => updateField('current_routine', e.target.value)} rows={4} placeholder="What does the current routine, schedule, or baseline look like right now?" />
            </div>
            <div className="mrq-field">
              <label>Special considerations</label>
              <textarea value={form.special_considerations} onChange={(e) => updateField('special_considerations', e.target.value)} rows={4} placeholder="Allergies, sensitivities, accessibility needs, behavior notes, accommodations, or communication preferences." />
            </div>
            <div className="mrq-two">
              <div className="mrq-field">
                <label>Guardian / family contact</label>
                <input value={form.guardian_name} onChange={(e) => updateField('guardian_name', e.target.value)} placeholder="Optional parent, guardian, or family lead" />
              </div>
              <div className="mrq-field">
                <label>Guardian phone</label>
                <input value={form.guardian_phone} onChange={(e) => updateField('guardian_phone', e.target.value)} placeholder="Optional contact number" />
              </div>
            </div>
            <div className="mt-4 rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-4 text-sm text-gray-300">
              <p><strong>Trust signals:</strong> {(workspace?.settings?.trust_artifacts || []).join(', ') || 'Configured inside Business Hub.'}</p>
              <p className="mt-3"><strong>Prep and expectations:</strong> {workspace?.settings?.prep_expectations || 'Configured inside Business Hub.'}</p>
            </div>
          </section>

          <section className="mrq-panel">
            <h2><HeartHandshake size={18} /> Contact and acknowledgement</h2>
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
                <input value={form.contact_phone} onChange={(e) => updateField('contact_phone', e.target.value)} placeholder="Best number" />
              </div>
            </div>
            <div className="mrq-two">
              <div className="mrq-field">
                <label>Preferred contact channel</label>
                <select value={form.preferred_contact_channel} onChange={(e) => updateField('preferred_contact_channel', e.target.value)}>
                  <option value="message">Message</option>
                  <option value="email">Email</option>
                  <option value="call">Call</option>
                  <option value="text">Text</option>
                  <option value="meeting">Meeting</option>
                </select>
              </div>
              <div className="mrq-field">
                <label>Relationship type</label>
                <select value={form.relationship_type} onChange={(e) => updateField('relationship_type', e.target.value)}>
                  <option value="client">Client</option>
                  <option value="student">Student</option>
                  <option value="family">Family</option>
                  <option value="pet">Pet</option>
                  <option value="patient">Patient</option>
                  <option value="athlete">Athlete</option>
                </select>
              </div>
            </div>
            <div className="mrq-field">
              <label>Budget notes</label>
              <input value={form.budget_notes} onChange={(e) => updateField('budget_notes', e.target.value)} placeholder="Optional budget or commitment note" />
            </div>
            <div className="mrq-checklist mt-4">
              <label><input type="checkbox" checked={form.guardian_acknowledged} onChange={(e) => updateField('guardian_acknowledged', e.target.checked)} /> I understand a guardian or family point of contact may be needed for recurring support when relevant.</label>
              <label><input type="checkbox" checked={form.safety_acknowledged} onChange={(e) => updateField('safety_acknowledged', e.target.checked)} /> I shared any key safety, behavior, accessibility, or accommodation notes that matter.</label>
              <label><input type="checkbox" checked={form.policy_acknowledged} onChange={(e) => updateField('policy_acknowledged', e.target.checked)} /> I understand this intake helps the business decide the right plan, timing, and next step before confirming service.</label>
            </div>
            <button className="mrq-btn primary" type="submit" disabled={submitting}>
              {submitting ? 'Sending...' : 'Send guided intake'}
            </button>
          </section>
        </form>
      </main>
    </PageShell>
  );
}
