import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  Briefcase,
  Building2,
  CalendarDays,
  CheckCircle2,
  HeartHandshake,
  Mail,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
} from 'lucide-react';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import './about.css';

const PILLARS = [
  { key: 'people', icon: HeartHandshake },
  { key: 'clarity', icon: Sparkles },
  { key: 'ownership', icon: ShieldCheck },
];

const JOURNEY = [
  { key: 'start', icon: MessageSquare },
  { key: 'coordinate', icon: CalendarDays },
  { key: 'followThrough', icon: CheckCircle2 },
];

const ROLES = [
  { key: 'customer', icon: UserRoundCheck, to: '/post-job' },
  { key: 'helper', icon: Briefcase, to: '/jobs' },
  { key: 'business', icon: Building2, to: '/business-hub' },
];

export default function AboutPage() {
  const { t } = useTranslation();

  return (
    <PageShell>
      <PageMeta
        title={t('aboutPage.title')}
        description={t('aboutPage.experience.metaDescription')}
      />
      <div className="about-page">
        <section className="about-hero" aria-labelledby="about-title">
          <div className="about-hero__content">
            <p className="about-eyebrow"><Sparkles size={16} aria-hidden="true" /> {t('aboutPage.experience.eyebrow')}</p>
            <h1 id="about-title">{t('aboutPage.experience.title')}</h1>
            <p className="about-hero__intro">{t('aboutPage.experience.intro')}</p>
            <div className="about-actions">
              <Link className="about-button about-button--primary" to="/how-it-works">
                {t('aboutPage.experience.primaryCta')} <ArrowRight size={17} aria-hidden="true" />
              </Link>
              <Link className="about-button about-button--secondary" to="/join">
                {t('aboutPage.experience.secondaryCta')}
              </Link>
            </div>
          </div>
          <div className="about-hero__visual" aria-label={t('aboutPage.experience.visualAria')}>
            <div className="about-orbit about-orbit--outer" aria-hidden="true" />
            <div className="about-orbit about-orbit--inner" aria-hidden="true" />
            <div className="about-visual-card about-visual-card--main">
              <div className="about-visual-card__top"><span className="about-visual-card__logo">O</span><span>OxSteed</span><span className="about-live-dot" /></div>
              <strong>{t('aboutPage.experience.visualTitle')}</strong>
              <span>{t('aboutPage.experience.visualDetail')}</span>
              <div className="about-visual-flow"><i /><i /><i /></div>
            </div>
            <div className="about-visual-card about-visual-card--small about-visual-card--one"><CalendarDays size={16} aria-hidden="true" /> {t('aboutPage.experience.visualBadgeOne')}</div>
            <div className="about-visual-card about-visual-card--small about-visual-card--two"><MessageSquare size={16} aria-hidden="true" /> {t('aboutPage.experience.visualBadgeTwo')}</div>
          </div>
        </section>

        <section className="about-pillars" aria-labelledby="about-pillars-title">
          <div className="about-section-heading">
            <p className="about-eyebrow">{t('aboutPage.experience.pillarsKicker')}</p>
            <h2 id="about-pillars-title">{t('aboutPage.experience.pillarsTitle')}</h2>
          </div>
          <div className="about-pillar-grid">
            {PILLARS.map(({ key, icon: Icon }) => (
              <article className="about-pillar" key={key}>
                <span className="about-pillar__icon"><Icon size={21} aria-hidden="true" /></span>
                <h3>{t(`aboutPage.experience.pillars.${key}.title`)}</h3>
                <p>{t(`aboutPage.experience.pillars.${key}.body`)}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="about-journey" aria-labelledby="about-journey-title">
          <div className="about-section-heading about-section-heading--journey">
            <div>
              <p className="about-eyebrow">{t('aboutPage.experience.journeyKicker')}</p>
              <h2 id="about-journey-title">{t('aboutPage.experience.journeyTitle')}</h2>
            </div>
            <p>{t('aboutPage.experience.journeyDescription')}</p>
          </div>
          <div className="about-journey-grid">
            {JOURNEY.map(({ key, icon: Icon }, index) => (
              <article className="about-journey-card" key={key}>
                <div className="about-journey-card__number">0{index + 1}</div>
                <span className="about-journey-card__icon"><Icon size={20} aria-hidden="true" /></span>
                <p className="about-eyebrow">{t(`aboutPage.experience.journey.${key}.label`)}</p>
                <h3>{t(`aboutPage.experience.journey.${key}.title`)}</h3>
                <p>{t(`aboutPage.experience.journey.${key}.body`)}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="about-roles" aria-labelledby="about-roles-title">
          <div className="about-section-heading">
            <div>
              <p className="about-eyebrow">{t('aboutPage.experience.offerKicker')}</p>
              <h2 id="about-roles-title">{t('aboutPage.experience.offerTitle')}</h2>
            </div>
            <p>{t('aboutPage.experience.offerDescription')}</p>
          </div>
          <div className="about-role-grid">
            {ROLES.map(({ key, icon: Icon, to }) => (
              <Link className="about-role-card" to={to} key={key}>
                <span className="about-role-card__icon"><Icon size={21} aria-hidden="true" /></span>
                <h3>{t(`aboutPage.experience.roles.${key}.title`)}</h3>
                <p>{t(`aboutPage.experience.roles.${key}.body`)}</p>
                <span className="about-role-card__link">{t(`aboutPage.experience.roles.${key}.cta`)} <ArrowRight size={16} aria-hidden="true" /></span>
              </Link>
            ))}
          </div>
        </section>

        <section className="about-trust" aria-labelledby="about-trust-title">
          <div className="about-trust__icon"><ShieldCheck size={25} aria-hidden="true" /></div>
          <div>
            <p className="about-eyebrow">{t('aboutPage.experience.trustKicker')}</p>
            <h2 id="about-trust-title">{t('aboutPage.experience.trustTitle')}</h2>
            <p>{t('aboutPage.experience.trustBody')}</p>
            <p className="about-trust__note">{t('aboutPage.experience.trustNote')}</p>
          </div>
        </section>

        <section className="about-contact" aria-labelledby="about-contact-title">
          <div>
            <p className="about-eyebrow"><Mail size={16} aria-hidden="true" /> {t('aboutPage.experience.contactKicker')}</p>
            <h2 id="about-contact-title">{t('aboutPage.experience.contactTitle')}</h2>
            <p>{t('aboutPage.experience.contactBody')}</p>
          </div>
          <div className="about-contact__links">
            <a href="mailto:support@oxsteed.com"><Mail size={17} aria-hidden="true" /> support@oxsteed.com</a>
            <a href="https://oxsteed.com"><ArrowRight size={17} aria-hidden="true" /> oxsteed.com</a>
            <span>{t('aboutPage.experience.legalNote')}</span>
          </div>
        </section>
      </div>
    </PageShell>
  );
}
