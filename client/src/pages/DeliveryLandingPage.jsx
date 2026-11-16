import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  Bike,
  CheckCircle2,
  ChevronDown,
  Clock3,
  LifeBuoy,
  MapPin,
  Package,
  Route,
  ShieldCheck,
  Upload,
  Users,
  Wallet,
} from 'lucide-react';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import { EstimateCard, storeEstimatePrefill } from '../components/delivery/DeliveryEstimate';
import { estimateDeliveryPublic, getDeliveryPublicCaptchaConfig } from '../api/delivery';
import './DeliveryLandingPage.css';

function Step({ index, title, description }) {
  return (
    <article className="delivery-landing-step">
      <div className="delivery-landing-step__marker" aria-hidden="true">
        <span>{String(index + 1).padStart(2, '0')}</span>
      </div>
      <div className="delivery-landing-step__copy">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </article>
  );
}

function FaqItem({ question, answer, open, onToggle }) {
  return (
    <div className="delivery-landing-faq__item">
      <button
        type="button"
        className="delivery-landing-faq__question"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span>{question}</span>
        <ChevronDown
          size={18}
          aria-hidden="true"
          className={`delivery-landing-faq__chevron${open ? ' is-open' : ''}`}
        />
      </button>
      {open && <p className="delivery-landing-faq__answer">{answer}</p>}
    </div>
  );
}

export default function DeliveryLandingPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  // The server says whether the public estimate needs a bot check; the
  // widget renders only then. Refetched if the server asks for a check this
  // page did not know about (config changed after load).
  const [captcha, setCaptcha] = useState(null);
  const loadCaptcha = useCallback(() => {
    getDeliveryPublicCaptchaConfig().then(setCaptcha).catch(() => setCaptcha(null));
  }, []);
  useEffect(() => { loadCaptcha(); }, [loadCaptcha]);
  const [openFaq, setOpenFaq] = useState(null);

  const steps = [
    { title: t('deliveryLanding.step1Title'), description: t('deliveryLanding.step1Desc') },
    { title: t('deliveryLanding.step2Title'), description: t('deliveryLanding.step2Desc') },
    { title: t('deliveryLanding.step3Title'), description: t('deliveryLanding.step3Desc') },
  ];

  const faqs = [
    { q: t('deliveryLanding.faq1Q'), a: t('deliveryLanding.faq1A') },
    { q: t('deliveryLanding.faq2Q'), a: t('deliveryLanding.faq2A') },
    { q: t('deliveryLanding.faq3Q'), a: t('deliveryLanding.faq3A') },
    { q: t('deliveryLanding.faq4Q'), a: t('deliveryLanding.faq4A') },
  ];

  return (
    <PageShell>
      <PageMeta
        title={t('deliveryLanding.metaTitle')}
        description={t('deliveryLanding.metaDescription')}
        url="/delivery"
      />
      <main className="delivery-landing">
        {/* Hero with the instant estimate (same card as the signed-in page,
            priced through the public estimate endpoint). */}
        <div className="delivery-page delivery-page--public" dir={i18n.dir()}>
          <header className="delivery-hero delivery-hero--redesign">
            <div className="delivery-hero__copy">
              <span className="delivery-eyebrow">{t('delivery.eyebrow')}</span>
              <h1>{t('delivery.title')}</h1>
              <p>{t('delivery.hero.subtitle')}</p>
              <ol className="delivery-steps" aria-label={t('delivery.hero.stepsLabel')}>
                <li>
                  <span className="delivery-steps__number">1</span>
                  <span>{t('delivery.hero.step1')}</span>
                  <Upload size={18} aria-hidden="true" />
                </li>
                <li>
                  <span className="delivery-steps__number">2</span>
                  <span>{t('delivery.hero.step2')}</span>
                  <LifeBuoy size={18} aria-hidden="true" />
                </li>
                <li>
                  <span className="delivery-steps__number">3</span>
                  <span>{t('delivery.hero.step3')}</span>
                  <Route size={18} aria-hidden="true" />
                </li>
              </ol>
              <p className="delivery-landing-hero__coverage">
                <MapPin size={14} aria-hidden="true" />
                {t('deliveryLanding.coverageNote')}
              </p>
              <div className="delivery-landing-hero__ctas">
                <Link to="/join" className="delivery-landing-cta delivery-landing-cta--secondary">
                  {t('deliveryLanding.ctaDrive')}
                </Link>
              </div>
            </div>
            <EstimateCard
              t={t}
              requestEstimate={estimateDeliveryPublic}
              captcha={captcha}
              onCaptchaRequired={loadCaptcha}
              continueLabel={t('delivery.estimate.signInToBook')}
              continueNote={t('delivery.estimate.signInNote')}
              onContinue={(prefill) => {
                storeEstimatePrefill(prefill);
                navigate(`/login?next=${encodeURIComponent('/delivery')}`);
              }}
            />
          </header>
        </div>

        {/* How it works */}
        <section className="delivery-landing-section" aria-labelledby="delivery-how">
          <h2 id="delivery-how">{t('deliveryLanding.howItWorksTitle')}</h2>
          <div className="delivery-landing-steps">
            {steps.map((step, i) => (
              <Step key={i} index={i} title={step.title} description={step.description} />
            ))}
          </div>
        </section>

        {/* Two audiences */}
        <section className="delivery-landing-section" aria-labelledby="delivery-audiences">
          <h2 id="delivery-audiences">{t('deliveryLanding.audiencesTitle')}</h2>
          <div className="delivery-landing-audiences">
            <article className="delivery-landing-audience">
              <Package size={28} aria-hidden="true" />
              <h3>{t('deliveryLanding.forCustomersTitle')}</h3>
              <p>{t('deliveryLanding.forCustomersDesc')}</p>
              <ul>
                <li><CheckCircle2 size={16} aria-hidden="true" />{t('deliveryLanding.customerPoint1')}</li>
                <li><CheckCircle2 size={16} aria-hidden="true" />{t('deliveryLanding.customerPoint2')}</li>
                <li><CheckCircle2 size={16} aria-hidden="true" />{t('deliveryLanding.customerPoint3')}</li>
              </ul>
            </article>
            <article className="delivery-landing-audience">
              <Bike size={28} aria-hidden="true" />
              <h3>{t('deliveryLanding.forDriversTitle')}</h3>
              <p>{t('deliveryLanding.forDriversDesc')}</p>
              <ul>
                <li><CheckCircle2 size={16} aria-hidden="true" />{t('deliveryLanding.driverPoint1')}</li>
                <li><CheckCircle2 size={16} aria-hidden="true" />{t('deliveryLanding.driverPoint2')}</li>
                <li><CheckCircle2 size={16} aria-hidden="true" />{t('deliveryLanding.driverPoint3')}</li>
              </ul>
            </article>
          </div>
        </section>

        {/* Trust strip */}
        <section className="delivery-landing-trust" aria-label={t('deliveryLanding.trustTitle')}>
          <div className="delivery-landing-trust__item">
            <Route size={22} aria-hidden="true" />
            <span>{t('deliveryLanding.trustTracking')}</span>
          </div>
          <div className="delivery-landing-trust__item">
            <ShieldCheck size={22} aria-hidden="true" />
            <span>{t('deliveryLanding.trustVetted')}</span>
          </div>
          <div className="delivery-landing-trust__item">
            <Clock3 size={22} aria-hidden="true" />
            <span>{t('deliveryLanding.trustTiming')}</span>
          </div>
          <div className="delivery-landing-trust__item">
            <Wallet size={22} aria-hidden="true" />
            <span>{t('deliveryLanding.trustPricing')}</span>
          </div>
        </section>

        {/* FAQ */}
        <section className="delivery-landing-section" aria-labelledby="delivery-faq">
          <h2 id="delivery-faq">{t('deliveryLanding.faqTitle')}</h2>
          <div className="delivery-landing-faq">
            {faqs.map((faq, i) => (
              <FaqItem
                key={i}
                question={faq.q}
                answer={faq.a}
                open={openFaq === i}
                onToggle={() => setOpenFaq(openFaq === i ? null : i)}
              />
            ))}
          </div>
        </section>

        {/* Final CTA */}
        <section className="delivery-landing-final">
          <Users size={32} aria-hidden="true" />
          <h2>{t('deliveryLanding.finalCtaTitle')}</h2>
          <p>{t('deliveryLanding.finalCtaSubtitle')}</p>
          <div className="delivery-landing-hero__ctas">
            <Link to="/login?next=/delivery" className="delivery-landing-cta delivery-landing-cta--primary">
              {t('deliveryLanding.ctaRequest')}
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <Link to="/join" className="delivery-landing-cta delivery-landing-cta--secondary">
              {t('deliveryLanding.ctaDrive')}
            </Link>
          </div>
        </section>
      </main>
    </PageShell>
  );
}
