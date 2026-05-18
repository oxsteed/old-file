import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CheckCircle2, Droplets, Scissors, ShieldCheck, Sparkles } from 'lucide-react';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import { createPublicBeautyIntake, getPublicBeautyOperations } from '../api/beautyOperations';
import '../styles/MaintenanceRequestPage.css';

const INITIAL_FORM = {
  desired_service: '',
  desired_look: '',
  preferred_staff: '',
  preferred_time_notes: '',
  package_interest: '',
  budget_notes: '',
  contact_name: '',
  contact_email: '',
  contact_phone: '',
  inspiration_notes: '',
  hair_length: '',
  hair_history: '',
  beard_preferences: '',
  skin_sensitivities: '',
  contraindications: '',
  patch_test: false,
  photo_release: false,
  fragrance_sensitivity: false,
  prep_acknowledged: false,
  no_show_acknowledged: false,
  photos: [],
};

export default function BeautyIntakeRequestPage() {
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
        const data = await getPublicBeautyOperations(businessId);
        if (cancelled) return;
        setWorkspace(data);
      } catch {
        toast.error('Could not load this beauty profile.');
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
    if (form.desired_service.trim().length < 3) return toast.error('Tell the business what service you want.');
    if (!form.prep_acknowledged || !form.no_show_acknowledged) return toast.error('Acknowledge the prep and cancellation expectations first.');
    const payload = new FormData();
    Object.entries(form).forEach(([key, value]) => {
      if (key === 'photos') return;
      payload.append(key, value);
    });
    payload.append('template_slug', workspace?.business?.active_template || 'beauty_style');
    Array.from(form.photos || []).slice(0, 5).forEach((file) => payload.append('photos', file));

    setSubmitting(true);
    try {
      const request = await createPublicBeautyIntake(businessId, payload);
      setSubmitted(request);
      toast.success('Beauty intake sent.');
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Could not send beauty intake.');
    } finally {
      setSubmitting(false);
    }
  }

  const activeTemplate = workspace?.business?.active_template || 'beauty_style';
  const isBarber = activeTemplate === 'barbershop';
  const isHair = activeTemplate === 'hair_stylist' || activeTemplate === 'beauty_style';
  const isSpa = activeTemplate === 'spa_skincare';
  const businessName = workspace?.business?.business_name || 'this beauty business';

  if (loading) {
    return (
      <PageShell>
        <div className="mrq-page"><p className="mrq-muted">Loading beauty intake...</p></div>
      </PageShell>
    );
  }

  if (submitted) {
    return (
      <PageShell>
        <PageMeta title="Beauty intake sent - OxSteed" noIndex />
        <main className="mrq-page">
          <section className="mrq-success">
            <CheckCircle2 size={42} />
            <p className="mrq-eyebrow">Intake sent</p>
            <h1>{submitted.desired_service}</h1>
            <p>
              {businessName} can now review your goals, prep needs, timing, and package fit before moving you into booking, confirmation, or rebook follow-up.
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
      <PageMeta title={`Beauty intake - ${businessName}`} noIndex />
      <main className="mrq-page">
        <section className="mrq-hero">
          <div>
            <p className="mrq-eyebrow"><Sparkles size={16} /> Beauty intake</p>
            <h1>Start your beauty intake with {businessName}</h1>
            <p>
              {workspace?.settings?.prep_instructions || 'Share the look you want, your timing, and any prep or sensitivity notes so the business can route you into the right service path.'}
            </p>
          </div>
          <div className="mrq-hero-card">
            {isSpa ? <Droplets size={24} /> : <Scissors size={24} />}
            <strong>{workspace?.settings?.consultation_offer_label || 'Beauty intake and appointment planning'}</strong>
            <span>Built for look goals, prep expectations, package fit, and repeat-booking follow-through instead of generic booking notes.</span>
          </div>
        </section>

        <form className="mrq-grid" onSubmit={handleSubmit}>
          <section className="mrq-panel">
            <h2><Sparkles size={18} /> Service goals</h2>
            <div className="mrq-field">
              <label>Desired service</label>
              <input value={form.desired_service} onChange={(e) => updateField('desired_service', e.target.value)} placeholder={isBarber ? 'Fade, beard trim, hot towel shave' : isSpa ? 'Facial, peel, skin ritual' : 'Cut, color refresh, silk press'} maxLength={180} />
            </div>
            <div className="mrq-field">
              <label>Desired look or outcome</label>
              <input value={form.desired_look} onChange={(e) => updateField('desired_look', e.target.value)} placeholder={isBarber ? 'Clean skin fade with beard shape-up' : isSpa ? 'Calming hydration and brightening' : 'Soft layers with brighter face frame'} maxLength={255} />
            </div>
            <div className="mrq-field">
              <label>Inspiration or detail notes</label>
              <textarea value={form.inspiration_notes} onChange={(e) => updateField('inspiration_notes', e.target.value)} rows={5} placeholder="Tell the team what you want, what you are avoiding, and anything from prior visits that matters." />
            </div>
            <div className="mrq-two">
              <div className="mrq-field">
                <label>Preferred staff member</label>
                <input value={form.preferred_staff} onChange={(e) => updateField('preferred_staff', e.target.value)} placeholder="Optional" />
              </div>
              <div className="mrq-field">
                <label>Timing notes</label>
                <input value={form.preferred_time_notes} onChange={(e) => updateField('preferred_time_notes', e.target.value)} placeholder="Best days, event deadline, same-day if possible" />
              </div>
            </div>
            <div className="mrq-two">
              <div className="mrq-field">
                <label>Package or plan interest</label>
                <input value={form.package_interest} onChange={(e) => updateField('package_interest', e.target.value)} placeholder="Membership, bridal prep, color maintenance plan" />
              </div>
              <div className="mrq-field">
                <label>Budget notes</label>
                <input value={form.budget_notes} onChange={(e) => updateField('budget_notes', e.target.value)} placeholder="Optional budget or package note" />
              </div>
            </div>
          </section>

          <section className="mrq-panel">
            <h2>{isSpa ? <Droplets size={18} /> : <Scissors size={18} />} Prep and sensitivities</h2>
            {isHair ? (
              <div className="mrq-two">
                <div className="mrq-field">
                  <label>Hair length / density</label>
                  <input value={form.hair_length} onChange={(e) => updateField('hair_length', e.target.value)} placeholder="Short, shoulder length, thick, extensions" />
                </div>
                <div className="mrq-field">
                  <label>Hair history</label>
                  <input value={form.hair_history} onChange={(e) => updateField('hair_history', e.target.value)} placeholder="Color, relaxer, bleach, damage, last service" />
                </div>
              </div>
            ) : null}
            {isBarber ? (
              <div className="mrq-field">
                <label>Beard / grooming preferences</label>
                <input value={form.beard_preferences} onChange={(e) => updateField('beard_preferences', e.target.value)} placeholder="Line-up, length, shape, razor sensitive areas" />
              </div>
            ) : null}
            {isSpa ? (
              <div className="mrq-two">
                <div className="mrq-field">
                  <label>Skin sensitivities</label>
                  <input value={form.skin_sensitivities} onChange={(e) => updateField('skin_sensitivities', e.target.value)} placeholder="Acne, rosacea, dryness, fragrance sensitivity" />
                </div>
                <div className="mrq-field">
                  <label>Contraindications or medications</label>
                  <input value={form.contraindications} onChange={(e) => updateField('contraindications', e.target.value)} placeholder="Retinol, recent peel, allergies, pregnancy note" />
                </div>
              </div>
            ) : null}
            <div className="mrq-field">
              <label>Reference photos</label>
              <input type="file" accept="image/*" multiple onChange={(e) => updateField('photos', Array.from(e.target.files || []).slice(0, 5))} />
            </div>
            <div className="mrq-field">
              <label>Contact name</label>
              <input value={form.contact_name} onChange={(e) => updateField('contact_name', e.target.value)} placeholder="Your name" />
            </div>
            <div className="mrq-two">
              <div className="mrq-field">
                <label>Email</label>
                <input value={form.contact_email} onChange={(e) => updateField('contact_email', e.target.value)} placeholder="you@example.com" />
              </div>
              <div className="mrq-field">
                <label>Phone</label>
                <input value={form.contact_phone} onChange={(e) => updateField('contact_phone', e.target.value)} placeholder="Best text number" />
              </div>
            </div>
          </section>

          <section className="mrq-panel">
            <h2><ShieldCheck size={18} /> Prep, policy, and consent</h2>
            <div className="mrq-checklist">
              <label><input type="checkbox" checked={form.patch_test} onChange={(e) => updateField('patch_test', e.target.checked)} /> I may need patch-test or sensitivity review guidance before the visit.</label>
              <label><input type="checkbox" checked={form.photo_release} onChange={(e) => updateField('photo_release', e.target.checked)} /> I am open to before/after photo discussion if the provider asks.</label>
              <label><input type="checkbox" checked={form.fragrance_sensitivity} onChange={(e) => updateField('fragrance_sensitivity', e.target.checked)} /> I have fragrance or product sensitivities the provider should know about.</label>
            </div>
            <div className="mt-4 rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-4 text-sm text-gray-300">
              <p><strong>Deposit / cancellation:</strong> {workspace?.settings?.deposit_policy || 'Configured inside Business Hub.'}</p>
              <p className="mt-3"><strong>Prep guidance:</strong> {workspace?.settings?.prep_instructions || 'Configured inside Business Hub.'}</p>
            </div>
            <div className="mrq-checklist mt-4">
              <label><input type="checkbox" checked={form.prep_acknowledged} onChange={(e) => updateField('prep_acknowledged', e.target.checked)} /> I read the prep guidance and will follow any day-of instructions.</label>
              <label><input type="checkbox" checked={form.no_show_acknowledged} onChange={(e) => updateField('no_show_acknowledged', e.target.checked)} /> I understand there may be cancellation or no-show expectations before the business confirms timing.</label>
            </div>
            <button className="mrq-btn primary" type="submit" disabled={submitting}>
              {submitting ? 'Sending...' : 'Send beauty intake'}
            </button>
          </section>
        </form>
      </main>
    </PageShell>
  );
}
