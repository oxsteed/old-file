// Public consultant / specialty profile (Group 10 item 506). Anyone can view
// an approved consultant's headline, bio, specialties, coverage, languages,
// portfolio, pricing summary, and next availability. Unapproved, declined,
// and inactive profiles 404 from the server and render as not found here.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import api from '../api/axios';
import { schedulingApi } from '../api/scheduling';
import { formatCents } from '../lib/format';
import './ConsultantPublicProfilePage.css';

export default function ConsultantPublicProfilePage() {
  const { userId } = useParams();
  const { t, i18n } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState('');
  const [profile, setProfile] = useState(null);
  const [nextAvailable, setNextAvailable] = useState([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        setNotFound(false);
        setError('');
        const { data } = await api.get(`/consulting/contractor/public/${encodeURIComponent(userId)}`);
        if (cancelled) return;
        setProfile(data.profile);
        try {
          const slots = await schedulingApi.getNextAvailableDates(userId, 30, 60);
          if (!cancelled) setNextAvailable(slots.data || []);
        } catch {
          if (!cancelled) setNextAvailable([]);
        }
      } catch (err) {
        if (cancelled) return;
        if (err.response?.status === 404) setNotFound(true);
        else setError(t('consultantPublicProfile.errors.load'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [userId, t]);

  const name = profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : '';
  const pricing = profile?.pricingSummary;
  const portfolio = profile?.portfolio || [];
  const dateLocale = i18n.language || 'en';

  return (
    <PageShell>
      <PageMeta
        title={profile ? t('consultantPublicProfile.page.title', { name }) : t('consultantPublicProfile.page.fallbackTitle')}
        description={profile?.headline || t('consultantPublicProfile.page.fallbackDescription')}
        url={`${window.location.origin}/consultants/${encodeURIComponent(userId)}`}
      />
      <Navbar />
      <main className="cpp-main">
        {loading && <p className="cpp-muted">{t('consultantPublicProfile.loading')}</p>}
        {notFound && (
          <div>
            <h1 className="cpp-title">{t('consultantPublicProfile.notFound.title')}</h1>
            <p className="cpp-body-muted">{t('consultantPublicProfile.notFound.body')}</p>
            <p className="cpp-link-row">
              <Link to="/consulting-intake" className="cpp-link">{t('consultantPublicProfile.notFound.intakeLink')}</Link>
            </p>
          </div>
        )}
        {error && <p role="alert" className="cpp-error">{error}</p>}
        {profile && (
          <article>
            <p className="cpp-eyebrow">{t('consultantPublicProfile.eyebrow')}</p>
            <h1 className="cpp-name">{name}</h1>
            {profile.headline && <p className="cpp-headline">{profile.headline}</p>}
            {!profile.accepts_new_referrals && (
              <p role="status" className="cpp-notice">{t('consultantPublicProfile.notAccepting')}</p>
            )}
            {profile.bio && (
              <section className="cpp-section">
                <h2 className="cpp-section-title">{t('consultantPublicProfile.sections.about')}</h2>
                <p className="cpp-bio">{profile.bio}</p>
              </section>
            )}

            <section className="cpp-section">
              <h2 className="cpp-section-title">{t('consultantPublicProfile.sections.specialties')}</h2>
              {(profile.specialties || []).length ? (
                <ul className="cpp-chips">
                  {profile.specialties.map((specialty) => (
                    <li key={specialty} className="cpp-chip">{specialty}</li>
                  ))}
                </ul>
              ) : (
                <p className="cpp-muted">{t('consultantPublicProfile.empty.specialties')}</p>
              )}
              <dl className="cpp-facts">
                <div><dt>{t('consultantPublicProfile.fields.coverage')}</dt><dd>{[...(profile.coverage_countries || []), ...(profile.coverage_regions || [])].join(', ') || t('consultantPublicProfile.empty.coverage')}</dd></div>
                <div><dt>{t('consultantPublicProfile.fields.languages')}</dt><dd>{(profile.languages || []).join(', ') || t('consultantPublicProfile.empty.languages')}</dd></div>
                {profile.years_experience != null && (
                  <div><dt>{t('consultantPublicProfile.fields.experience')}</dt><dd>{t('consultantPublicProfile.experienceYears', { count: profile.years_experience })}</dd></div>
                )}
                {profile.home_city || profile.home_region || profile.home_country ? (
                  <div><dt>{t('consultantPublicProfile.fields.basedIn')}</dt><dd>{[profile.home_city, profile.home_region, profile.home_country].filter(Boolean).join(', ')}</dd></div>
                ) : null}
                {profile.accepts_virtual_consulting && (
                  <div><dt>{t('consultantPublicProfile.fields.virtual')}</dt><dd>{t('consultantPublicProfile.virtualYes')}</dd></div>
                )}
              </dl>
            </section>

            <section className="cpp-section">
              <h2 className="cpp-section-title">{t('consultantPublicProfile.sections.pricing')}</h2>
              <p className="cpp-price">
                {t('consultantPublicProfile.pricing.minimum', { amount: formatCents(pricing?.minimum_package_price_cents || 0, { maximumFractionDigits: 0 }) })}
              </p>
              <p className="cpp-note">{t('consultantPublicProfile.pricing.note')}</p>
            </section>

            <section className="cpp-section">
              <h2 className="cpp-section-title">{t('consultantPublicProfile.sections.portfolio')}</h2>
              {portfolio.length ? (
                <ul className="cpp-portfolio">
                  {portfolio.map((item) => (
                    <li key={item.id} className="cpp-portfolio-item">
                      <h3 className="cpp-portfolio-title">{item.title}</h3>
                      {item.description && <p className="cpp-portfolio-desc">{item.description}</p>}
                      {item.link_url && (
                        <p className="cpp-link-row">
                          <a href={item.link_url} target="_blank" rel="noopener noreferrer" className="cpp-link">{t('consultantPublicProfile.portfolio.viewWork')}</a>
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="cpp-muted">{t('consultantPublicProfile.empty.portfolio')}</p>
              )}
            </section>

            <section className="cpp-section">
              <h2 className="cpp-section-title">{t('consultantPublicProfile.sections.availability')}</h2>
              {nextAvailable.length ? (
                <ul className="cpp-chips">
                  {nextAvailable.slice(0, 7).map((dateObj) => (
                    <li key={dateObj.date} className="cpp-date">
                      {new Date(dateObj.date).toLocaleDateString(dateLocale, { weekday: 'short', month: 'short', day: 'numeric' })}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="cpp-muted">{t('consultantPublicProfile.empty.availability')}</p>
              )}
              <p className="cpp-link-row">
                <Link to={`/consulting-intake?consultant=${encodeURIComponent(profile.user_id)}`} className="cpp-link">{t('consultantPublicProfile.bookLink')}</Link>
              </p>
            </section>
          </article>
        )}
      </main>
      <Footer />
    </PageShell>
  );
}
