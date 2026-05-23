import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Briefcase, Compass, Flag, Rocket, ShieldCheck, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import CountrySelect from '../components/CountrySelect';
import RegionInput from '../components/RegionInput';

const fieldStyle = {
  width: '100%',
  padding: '0.95rem 1rem',
  borderRadius: '16px',
  border: '1px solid rgba(148, 163, 184, 0.16)',
  background: 'rgba(15, 23, 42, 0.72)',
  color: 'var(--app-text)',
  fontSize: '0.96rem',
};

const sectionTitleStyle = {
  fontSize: '1.05rem',
  fontWeight: 700,
  margin: 0,
  color: 'var(--app-text)',
};

const leadSources = [
  'OxSteed platform',
  'Referral',
  'Social media',
  'Search',
  'Press or podcast',
  'Other',
];

const timelineOptions = [
  'Immediately',
  'Within 30 days',
  'Within 90 days',
  'Within 6 months',
  'Just exploring',
];

function capitalizeWords(value) {
  return String(value || '')
    .split(' ')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

export default function FranchiseIntakePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [submittedId, setSubmittedId] = useState(null);
  const [form, setForm] = useState({
    first_name: user?.first_name || '',
    last_name: user?.last_name || '',
    email: user?.email || '',
    phone: user?.phone || '',
    desired_country: user?.country || '',
    desired_region: '',
    desired_city: '',
    territory_summary: '',
    current_company_name: '',
    desired_brand_name: '',
    lead_source: '',
    business_background: '',
    operations_background: '',
    local_market_overview: '',
    timeline_window: '',
    preferred_store_count: '1',
    available_capital: '',
    liquid_capital: '',
  });

  const territoryLabel = useMemo(() => {
    if (!form.desired_country) return 'Region / state';
    return 'Region / state';
  }, [form.desired_country]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const handleCountryChange = (value) => {
    setForm((current) => ({
      ...current,
      desired_country: value,
      desired_region: '',
    }));
  };

  const validate = () => {
    if (!form.first_name || !form.last_name || !form.email || !form.desired_country) {
      toast.error('First name, last name, email, and country are required.');
      return false;
    }
    if (!form.territory_summary || !form.business_background || !form.timeline_window) {
      toast.error('Please tell us about your territory, background, and launch timeline.');
      return false;
    }
    return true;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!validate()) return;

    setLoading(true);
    try {
      const { data } = await api.post('/franchise/applications', {
        ...form,
        first_name: capitalizeWords(form.first_name),
        last_name: capitalizeWords(form.last_name),
        preferred_store_count: parseInt(form.preferred_store_count, 10) || 1,
      });

      setSubmittedId(data?.application?.id || data?.id || null);
      toast.success('Franchise application received.');

      if (user) {
        navigate('/franchise/status', { replace: true });
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Unable to submit franchise application.');
    } finally {
      setLoading(false);
    }
  };

  if (submittedId && !user) {
    return (
      <PageShell>
        <PageMeta
          title="Franchise application received"
          description="Your OxSteed franchise application has been submitted."
          url={`${window.location.origin}/franchise/apply`}
        />
        <div style={{ minHeight: '100vh', background: 'radial-gradient(circle at top, rgba(249,115,22,0.16), transparent 38%), #020617', color: 'var(--app-text)' }}>
          <main style={{ maxWidth: '760px', margin: '0 auto', padding: '5rem 1.25rem 6rem' }}>
            <section style={{ border: '1px solid rgba(148,163,184,0.16)', borderRadius: '32px', padding: '2rem', background: 'rgba(15,23,42,0.86)' }}>
              <div style={{ width: '64px', height: '64px', borderRadius: '20px', display: 'grid', placeItems: 'center', background: 'rgba(16,185,129,0.16)', color: '#34d399', marginBottom: '1rem' }}>
                <ShieldCheck size={30} />
              </div>
              <h1 style={{ fontSize: '2.2rem', lineHeight: 1.05, margin: 0 }}>Application received</h1>
              <p style={{ color: 'var(--muted-text)', fontSize: '1rem', marginTop: '0.9rem' }}>
                We have your franchise intake and our team will review it shortly. Keep this email handy because updates for application <strong>#{submittedId}</strong> will be sent there.
              </p>
              <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', marginTop: '1.4rem' }}>
                <Link to="/login" style={{ padding: '0.9rem 1.2rem', borderRadius: '999px', background: '#f97316', color: '#fff', textDecoration: 'none', fontWeight: 700 }}>
                  Sign in to track progress
                </Link>
                <Link to="/consulting" style={{ padding: '0.9rem 1.2rem', borderRadius: '999px', border: '1px solid rgba(148,163,184,0.16)', color: 'var(--app-text)', textDecoration: 'none', fontWeight: 700 }}>
                  Book a strategy call
                </Link>
              </div>
            </section>
          </main>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageMeta
        title="OxSteed Franchise Intake"
        description="Apply to launch an OxSteed franchise in your market."
        url={`${window.location.origin}/franchise/apply`}
      />
      <div style={{ minHeight: '100vh', background: 'radial-gradient(circle at top left, rgba(249,115,22,0.18), transparent 34%), radial-gradient(circle at top right, rgba(59,130,246,0.18), transparent 28%), #020617', color: 'var(--app-text)' }}>
        <main style={{ maxWidth: '1240px', margin: '0 auto', padding: '2rem 1.25rem 5rem' }}>
          <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(320px, 0.9fr)', gap: '1.5rem', alignItems: 'start' }}>
            <div style={{ border: '1px solid rgba(148,163,184,0.16)', borderRadius: '32px', padding: '2rem', background: 'rgba(15,23,42,0.86)' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.55rem', padding: '0.45rem 0.8rem', borderRadius: '999px', background: 'rgba(249,115,22,0.16)', color: '#fdba74', fontSize: '0.82rem', fontWeight: 700 }}>
                <Flag size={14} />
                OxSteed franchise intake
              </div>
              <h1 style={{ fontSize: 'clamp(2.5rem, 5vw, 4.6rem)', lineHeight: 0.98, margin: '1rem 0 0.9rem', letterSpacing: '-0.04em' }}>
                Launch a real operating business, not just an application.
              </h1>
              <p style={{ color: 'var(--muted-text)', fontSize: '1.02rem', lineHeight: 1.7, maxWidth: '58ch', margin: 0 }}>
                This intake is only for franchise expansion. Tell us your market, operating experience, capital readiness, and launch goals. We will review franchise fit separately from the business-launch consulting program.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.9rem', marginTop: '1.5rem' }}>
                {[
                  ['Territory-first review', 'Country, region, and market demand are screened before approval.'],
                  ['Capital readiness', 'We confirm the investment profile before moving into diligence.'],
                  ['Launch checklist', 'Approved applicants move into training, agreement, and readiness milestones.'],
                ].map(([title, body]) => (
                  <div key={title} style={{ border: '1px solid rgba(148,163,184,0.12)', borderRadius: '20px', padding: '1rem', background: 'rgba(255,255,255,0.03)' }}>
                    <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>{title}</div>
                    <div style={{ color: 'var(--muted-text)', fontSize: '0.9rem', lineHeight: 1.55 }}>{body}</div>
                  </div>
                ))}
              </div>
            </div>

            <aside style={{ border: '1px solid rgba(148,163,184,0.16)', borderRadius: '32px', padding: '1.5rem', background: 'rgba(15,23,42,0.82)', position: 'sticky', top: '96px' }}>
              <div style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.16em', color: '#fbbf24', marginBottom: '0.9rem' }}>What we review</div>
              <div style={{ display: 'grid', gap: '0.9rem' }}>
                {[
                  [Compass, 'Market fit', 'Territory demand, local context, and expansion logic.'],
                  [Briefcase, 'Operating background', 'Leadership, service, and business execution experience.'],
                  [Users, 'Capital and commitment', 'Available capital, timeline, and store count goals.'],
                  [Rocket, 'Launch readiness', 'How quickly you can move once approved.'],
                ].map(([Icon, title, body]) => (
                  <div key={title} style={{ display: 'flex', gap: '0.8rem', alignItems: 'flex-start' }}>
                    <div style={{ width: '42px', height: '42px', borderRadius: '14px', display: 'grid', placeItems: 'center', background: 'rgba(59,130,246,0.12)', color: '#93c5fd', flexShrink: 0 }}>
                      <Icon size={18} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 700 }}>{title}</div>
                      <div style={{ color: 'var(--muted-text)', fontSize: '0.9rem', lineHeight: 1.55 }}>{body}</div>
                    </div>
                  </div>
                ))}
              </div>
            </aside>
          </section>

          <form onSubmit={handleSubmit} style={{ marginTop: '1.5rem', border: '1px solid rgba(148,163,184,0.16)', borderRadius: '32px', background: 'rgba(15,23,42,0.88)', padding: '1.5rem' }}>
            <div style={{ display: 'grid', gap: '1.5rem' }}>
              <section>
                <h2 style={sectionTitleStyle}>Applicant information</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginTop: '0.95rem' }}>
                  <input name="first_name" value={form.first_name} onChange={handleChange} placeholder="First name" style={fieldStyle} />
                  <input name="last_name" value={form.last_name} onChange={handleChange} placeholder="Last name" style={fieldStyle} />
                  <input name="email" type="email" value={form.email} onChange={handleChange} placeholder="Email" style={fieldStyle} />
                  <input name="phone" value={form.phone} onChange={handleChange} placeholder="Phone (optional)" style={fieldStyle} />
                </div>
              </section>

              <section>
                <h2 style={sectionTitleStyle}>Territory and launch target</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginTop: '0.95rem' }}>
                  <CountrySelect
                    value={form.desired_country}
                    onChange={handleCountryChange}
                    className=""
                    style={fieldStyle}
                    placeholder="Select target country"
                    required
                    name="desired_country"
                  />
                  <RegionInput
                    country={form.desired_country}
                    value={form.desired_region}
                    onChange={(value) => setForm((current) => ({ ...current, desired_region: value }))}
                    placeholder={`Select ${territoryLabel.toLowerCase()}`}
                    style={fieldStyle}
                    required={false}
                    name="desired_region"
                  />
                  <input name="desired_city" value={form.desired_city} onChange={handleChange} placeholder="Target city (optional)" style={fieldStyle} />
                  <input name="desired_brand_name" value={form.desired_brand_name} onChange={handleChange} placeholder="Desired brand or operating name" style={fieldStyle} />
                </div>
                <textarea name="territory_summary" value={form.territory_summary} onChange={handleChange} placeholder="Describe the territory you want to operate, why it matters, and what demand you see there." style={{ ...fieldStyle, minHeight: '124px', marginTop: '1rem', resize: 'vertical' }} />
              </section>

              <section>
                <h2 style={sectionTitleStyle}>Experience and capital</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginTop: '0.95rem' }}>
                  <input name="current_company_name" value={form.current_company_name} onChange={handleChange} placeholder="Current company name (optional)" style={fieldStyle} />
                  <select name="lead_source" value={form.lead_source} onChange={handleChange} style={fieldStyle}>
                    <option value="">How did you hear about OxSteed?</option>
                    {leadSources.map((source) => <option key={source} value={source}>{source}</option>)}
                  </select>
                  <select name="timeline_window" value={form.timeline_window} onChange={handleChange} style={fieldStyle}>
                    <option value="">Target timeline</option>
                    {timelineOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <input name="preferred_store_count" type="number" min="1" step="1" value={form.preferred_store_count} onChange={handleChange} placeholder="Preferred store count" style={fieldStyle} />
                  <input name="available_capital" type="number" min="0" step="1000" value={form.available_capital} onChange={handleChange} placeholder="Available capital (USD)" style={fieldStyle} />
                  <input name="liquid_capital" type="number" min="0" step="1000" value={form.liquid_capital} onChange={handleChange} placeholder="Liquid capital (USD)" style={fieldStyle} />
                </div>
                <div style={{ display: 'grid', gap: '1rem', marginTop: '1rem' }}>
                  <textarea name="business_background" value={form.business_background} onChange={handleChange} placeholder="What business experience do you have?" style={{ ...fieldStyle, minHeight: '120px', resize: 'vertical' }} />
                  <textarea name="operations_background" value={form.operations_background} onChange={handleChange} placeholder="What operations or field-service experience do you have?" style={{ ...fieldStyle, minHeight: '120px', resize: 'vertical' }} />
                  <textarea name="local_market_overview" value={form.local_market_overview} onChange={handleChange} placeholder="What do you know about your local market, customer demand, or competitive landscape?" style={{ ...fieldStyle, minHeight: '120px', resize: 'vertical' }} />
                </div>
              </section>

              <section style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', borderTop: '1px solid rgba(148,163,184,0.12)', paddingTop: '1.25rem' }}>
                <div style={{ color: 'var(--muted-text)', maxWidth: '56ch', lineHeight: 1.6 }}>
                  Submitting this form starts the franchise review flow only. It does not put you into the business-launch consulting queue.
                </div>
                <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap' }}>
                  <Link to="/franchise/status" style={{ padding: '0.95rem 1.15rem', borderRadius: '999px', border: '1px solid rgba(148,163,184,0.16)', color: 'var(--app-text)', textDecoration: 'none', fontWeight: 700 }}>
                    View my status
                  </Link>
                  <button type="submit" disabled={loading} style={{ padding: '0.95rem 1.25rem', borderRadius: '999px', border: 'none', background: loading ? '#fb923c' : '#f97316', color: '#fff', fontWeight: 800, cursor: loading ? 'wait' : 'pointer' }}>
                    {loading ? 'Submitting...' : 'Submit franchise intake'}
                  </button>
                </div>
              </section>
            </div>
          </form>
        </main>
      </div>
    </PageShell>
  );
}
