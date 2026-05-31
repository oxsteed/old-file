import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Briefcase, Compass, Flag, Rocket, ShieldCheck, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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

function capitalizeWords(value) {
  return String(value || '')
    .split(' ')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

const LEAD_SOURCE_FALLBACK = [
  'OxSteed platform',
  'Referral',
  'Social media',
  'Search',
  'Press or podcast',
  'Other',
];

const TIMELINE_FALLBACK = [
  'Immediately',
  'Within 30 days',
  'Within 90 days',
  'Within 6 months',
  'Just exploring',
];

const getLocalizedArray = (value, fallback) => {
  return Array.isArray(value) && value.length > 0 ? value : fallback;
};

export default function FranchiseIntakePage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
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

  const territoryLabel = t('franchiseIntakePage.labels.territoryAndState');

  const leadSources = useMemo(() => {
    const translated = t('franchiseIntakePage.leadSources', { returnObjects: true });
    return getLocalizedArray(translated, LEAD_SOURCE_FALLBACK);
  }, [t]);

  const timelineOptions = useMemo(() => {
    const translated = t('franchiseIntakePage.timelineOptions', { returnObjects: true });
    return getLocalizedArray(translated, TIMELINE_FALLBACK);
  }, [t]);

  const heroCards = [
    {
      title: t('franchiseIntakePage.heroCards.territory.title'),
      body: t('franchiseIntakePage.heroCards.territory.body'),
    },
    {
      title: t('franchiseIntakePage.heroCards.capital.title'),
      body: t('franchiseIntakePage.heroCards.capital.body'),
    },
    {
      title: t('franchiseIntakePage.heroCards.launchChecklist.title'),
      body: t('franchiseIntakePage.heroCards.launchChecklist.body'),
    },
  ];

  const reviewCards = [
    {
      icon: Compass,
      title: t('franchiseIntakePage.review.cards.market.title'),
      body: t('franchiseIntakePage.review.cards.market.body'),
    },
    {
      icon: Briefcase,
      title: t('franchiseIntakePage.review.cards.background.title'),
      body: t('franchiseIntakePage.review.cards.background.body'),
    },
    {
      icon: Users,
      title: t('franchiseIntakePage.review.cards.capital.title'),
      body: t('franchiseIntakePage.review.cards.capital.body'),
    },
    {
      icon: Rocket,
      title: t('franchiseIntakePage.review.cards.launch.title'),
      body: t('franchiseIntakePage.review.cards.launch.body'),
    },
  ];

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
      toast.error(t('franchiseIntakePage.validation.missingRequired'));
      return false;
    }
    if (!form.territory_summary || !form.business_background || !form.timeline_window) {
      toast.error(t('franchiseIntakePage.validation.missingContext'));
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
      toast.success(t('franchiseIntakePage.messages.success'));

      if (user) {
        navigate('/franchise/status', { replace: true });
      }
    } catch (error) {
      toast.error(error.response?.data?.error || t('franchiseIntakePage.messages.submitFailed'));
    } finally {
      setLoading(false);
    }
  };

  if (submittedId && !user) {
    return (
        <PageShell>
        <PageMeta
          title={t('franchiseIntakePage.submitted.title')}
          description={t('franchiseIntakePage.submitted.body')}
          url={`${window.location.origin}/franchise/apply`}
        />
        <div style={{ minHeight: '100vh', background: 'radial-gradient(circle at top, rgba(249,115,22,0.16), transparent 38%), #020617', color: 'var(--app-text)' }}>
          <main style={{ maxWidth: '760px', margin: '0 auto', padding: '5rem 1.25rem 6rem' }}>
            <section style={{ border: '1px solid rgba(148,163,184,0.16)', borderRadius: '32px', padding: '2rem', background: 'rgba(15,23,42,0.86)' }}>
              <div style={{ width: '64px', height: '64px', borderRadius: '20px', display: 'grid', placeItems: 'center', background: 'rgba(16,185,129,0.16)', color: '#34d399', marginBottom: '1rem' }}>
                <ShieldCheck size={30} />
              </div>
              <h1 style={{ fontSize: '2.2rem', lineHeight: 1.05, margin: 0 }}>{t('franchiseIntakePage.submitted.heading')}</h1>
              <p style={{ color: 'var(--muted-text)', fontSize: '1rem', marginTop: '0.9rem' }}>
                {t('franchiseIntakePage.submitted.body', { applicationId: submittedId })}
              </p>
              <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', marginTop: '1.4rem' }}>
                <Link to="/login" style={{ padding: '0.9rem 1.2rem', borderRadius: '999px', background: '#f97316', color: '#fff', textDecoration: 'none', fontWeight: 700 }}>
                  {t('franchiseIntakePage.submitted.cta.signIn')}
                </Link>
                <Link to="/consulting" style={{ padding: '0.9rem 1.2rem', borderRadius: '999px', border: '1px solid rgba(148,163,184,0.16)', color: 'var(--app-text)', textDecoration: 'none', fontWeight: 700 }}>
                  {t('franchiseIntakePage.submitted.cta.strategyCall')}
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
        title={t('franchiseIntakePage.meta.title')}
        description={t('franchiseIntakePage.meta.description')}
        url={`${window.location.origin}/franchise/apply`}
      />
      <div style={{ minHeight: '100vh', background: 'radial-gradient(circle at top left, rgba(249,115,22,0.18), transparent 34%), radial-gradient(circle at top right, rgba(59,130,246,0.18), transparent 28%), #020617', color: 'var(--app-text)' }}>
        <main style={{ maxWidth: '1240px', margin: '0 auto', padding: '2rem 1.25rem 5rem' }}>
          <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(320px, 0.9fr)', gap: '1.5rem', alignItems: 'start' }}>
            <div style={{ border: '1px solid rgba(148,163,184,0.16)', borderRadius: '32px', padding: '2rem', background: 'rgba(15,23,42,0.86)' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.55rem', padding: '0.45rem 0.8rem', borderRadius: '999px', background: 'rgba(249,115,22,0.16)', color: '#fdba74', fontSize: '0.82rem', fontWeight: 700 }}>
                <Flag size={14} />
                {t('franchiseIntakePage.hero.badge')}
              </div>
              <h1 style={{ fontSize: 'clamp(2.5rem, 5vw, 4.6rem)', lineHeight: 0.98, margin: '1rem 0 0.9rem', letterSpacing: '-0.04em' }}>
                {t('franchiseIntakePage.hero.heading')}
              </h1>
              <p style={{ color: 'var(--muted-text)', fontSize: '1.02rem', lineHeight: 1.7, maxWidth: '58ch', margin: 0 }}>
                {t('franchiseIntakePage.hero.description')}
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.9rem', marginTop: '1.5rem' }}>
                {heroCards.map((card) => (
                  <div key={card.title} style={{ border: '1px solid rgba(148,163,184,0.12)', borderRadius: '20px', padding: '1rem', background: 'rgba(255,255,255,0.03)' }}>
                    <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>{card.title}</div>
                    <div style={{ color: 'var(--muted-text)', fontSize: '0.9rem', lineHeight: 1.55 }}>{card.body}</div>
                  </div>
                ))}
              </div>
            </div>

            <aside style={{ border: '1px solid rgba(148,163,184,0.16)', borderRadius: '32px', padding: '1.5rem', background: 'rgba(15,23,42,0.82)', position: 'sticky', top: '96px' }}>
              <div style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.16em', color: '#fbbf24', marginBottom: '0.9rem' }}>{t('franchiseIntakePage.review.title')}</div>
              <div style={{ display: 'grid', gap: '0.9rem' }}>
                {reviewCards.map((card) => (
                  <div key={card.title} style={{ display: 'flex', gap: '0.8rem', alignItems: 'flex-start' }}>
                    <div style={{ width: '42px', height: '42px', borderRadius: '14px', display: 'grid', placeItems: 'center', background: 'rgba(59,130,246,0.12)', color: '#93c5fd', flexShrink: 0 }}>
                      <card.icon size={18} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 700 }}>{card.title}</div>
                      <div style={{ color: 'var(--muted-text)', fontSize: '0.9rem', lineHeight: 1.55 }}>{card.body}</div>
                    </div>
                  </div>
                ))}
              </div>
            </aside>
          </section>

          <form onSubmit={handleSubmit} style={{ marginTop: '1.5rem', border: '1px solid rgba(148,163,184,0.16)', borderRadius: '32px', background: 'rgba(15,23,42,0.88)', padding: '1.5rem' }}>
            <div style={{ display: 'grid', gap: '1.5rem' }}>
              <section>
                <h2 style={sectionTitleStyle}>{t('franchiseIntakePage.sections.applicantInformation')}</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginTop: '0.95rem' }}>
                  <input name="first_name" value={form.first_name} onChange={handleChange} placeholder={t('franchiseIntakePage.placeholders.firstName')} style={fieldStyle} />
                  <input name="last_name" value={form.last_name} onChange={handleChange} placeholder={t('franchiseIntakePage.placeholders.lastName')} style={fieldStyle} />
                  <input name="email" type="email" value={form.email} onChange={handleChange} placeholder={t('franchiseIntakePage.placeholders.email')} style={fieldStyle} />
                  <input name="phone" value={form.phone} onChange={handleChange} placeholder={t('franchiseIntakePage.placeholders.phone')} style={fieldStyle} />
                </div>
              </section>

              <section>
                <h2 style={sectionTitleStyle}>{t('franchiseIntakePage.sections.territoryTarget')}</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginTop: '0.95rem' }}>
                  <CountrySelect
                    value={form.desired_country}
                    onChange={handleCountryChange}
                    className=""
                    style={fieldStyle}
                    placeholder={t('franchiseIntakePage.placeholders.country')}
                    required
                    name="desired_country"
                  />
                  <RegionInput
                    country={form.desired_country}
                    value={form.desired_region}
                    onChange={(value) => setForm((current) => ({ ...current, desired_region: value }))}
                    placeholder={t('franchiseIntakePage.placeholders.region', { locationLabel: territoryLabel.toLowerCase() })}
                    style={fieldStyle}
                    required={false}
                    name="desired_region"
                  />
                  <input name="desired_city" value={form.desired_city} onChange={handleChange} placeholder={t('franchiseIntakePage.placeholders.city')} style={fieldStyle} />
                  <input name="desired_brand_name" value={form.desired_brand_name} onChange={handleChange} placeholder={t('franchiseIntakePage.placeholders.brandName')} style={fieldStyle} />
                </div>
                <textarea
                  name="territory_summary"
                  value={form.territory_summary}
                  onChange={handleChange}
                  placeholder={t('franchiseIntakePage.placeholders.territory')}
                  style={{ ...fieldStyle, minHeight: '124px', marginTop: '1rem', resize: 'vertical' }}
                />
              </section>

              <section>
                <h2 style={sectionTitleStyle}>{t('franchiseIntakePage.sections.experience')}</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginTop: '0.95rem' }}>
                  <input name="current_company_name" value={form.current_company_name} onChange={handleChange} placeholder={t('franchiseIntakePage.placeholders.currentCompany')} style={fieldStyle} />
                  <select name="lead_source" value={form.lead_source} onChange={handleChange} style={fieldStyle}>
                    <option value="">{t('franchiseIntakePage.selects.leadSource')}</option>
                    {leadSources.map((source) => <option key={source} value={source}>{source}</option>)}
                  </select>
                  <select name="timeline_window" value={form.timeline_window} onChange={handleChange} style={fieldStyle}>
                    <option value="">{t('franchiseIntakePage.selects.timeline')}</option>
                    {timelineOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <input name="preferred_store_count" type="number" min="1" step="1" value={form.preferred_store_count} onChange={handleChange} placeholder={t('franchiseIntakePage.placeholders.storeCount')} style={fieldStyle} />
                  <input name="available_capital" type="number" min="0" step="1000" value={form.available_capital} onChange={handleChange} placeholder={t('franchiseIntakePage.placeholders.availableCapital')} style={fieldStyle} />
                  <input name="liquid_capital" type="number" min="0" step="1000" value={form.liquid_capital} onChange={handleChange} placeholder={t('franchiseIntakePage.placeholders.liquidCapital')} style={fieldStyle} />
                </div>
                <div style={{ display: 'grid', gap: '1rem', marginTop: '1rem' }}>
                  <textarea name="business_background" value={form.business_background} onChange={handleChange} placeholder={t('franchiseIntakePage.placeholders.businessBackground')} style={{ ...fieldStyle, minHeight: '120px', resize: 'vertical' }} />
                  <textarea name="operations_background" value={form.operations_background} onChange={handleChange} placeholder={t('franchiseIntakePage.placeholders.operationsBackground')} style={{ ...fieldStyle, minHeight: '120px', resize: 'vertical' }} />
                  <textarea name="local_market_overview" value={form.local_market_overview} onChange={handleChange} placeholder={t('franchiseIntakePage.placeholders.marketOverview')} style={{ ...fieldStyle, minHeight: '120px', resize: 'vertical' }} />
                </div>
              </section>

              <section style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', borderTop: '1px solid rgba(148,163,184,0.12)', paddingTop: '1.25rem' }}>
                <div style={{ color: 'var(--muted-text)', maxWidth: '56ch', lineHeight: 1.6 }}>
                  {t('franchiseIntakePage.formFooter')}
                </div>
                <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap' }}>
                  <Link to="/franchise/status" style={{ padding: '0.95rem 1.15rem', borderRadius: '999px', border: '1px solid rgba(148,163,184,0.16)', color: 'var(--app-text)', textDecoration: 'none', fontWeight: 700 }}>
                    {t('franchiseIntakePage.footer.viewStatus')}
                  </Link>
                  <button type="submit" disabled={loading} style={{ padding: '0.95rem 1.25rem', borderRadius: '999px', border: 'none', background: loading ? '#fb923c' : '#f97316', color: '#fff', fontWeight: 800, cursor: loading ? 'wait' : 'pointer' }}>
                    {loading ? t('franchiseIntakePage.buttons.submitting') : t('franchiseIntakePage.buttons.submit')}
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
