import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  BadgePercent,
  CheckCircle2,
  ChevronDown,
  Printer,
  QrCode,
  ScanLine,
  Smartphone,
  Store,
  Wallet,
  Wrench,
} from 'lucide-react';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import './QrGeneratorLandingPage.css';

function Step({ index, title, description }) {
  return (
    <article className="qr-landing-step">
      <div className="qr-landing-step__marker" aria-hidden="true">
        <span>{String(index + 1).padStart(2, '0')}</span>
      </div>
      <div className="qr-landing-step__copy">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </article>
  );
}

function FaqItem({ question, answer, open, onToggle }) {
  return (
    <div className="qr-landing-faq__item">
      <button
        type="button"
        className="qr-landing-faq__question"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span>{question}</span>
        <ChevronDown
          size={18}
          aria-hidden="true"
          className={`qr-landing-faq__chevron${open ? ' is-open' : ''}`}
        />
      </button>
      {open && <p className="qr-landing-faq__answer">{answer}</p>}
    </div>
  );
}

export default function QrGeneratorLandingPage() {
  const { t } = useTranslation();
  const [openFaq, setOpenFaq] = useState(null);

  const steps = [
    { title: t('qrLanding.step1Title'), description: t('qrLanding.step1Desc') },
    { title: t('qrLanding.step2Title'), description: t('qrLanding.step2Desc') },
    { title: t('qrLanding.step3Title'), description: t('qrLanding.step3Desc') },
  ];

  const faqs = [
    { q: t('qrLanding.faq1Q'), a: t('qrLanding.faq1A') },
    { q: t('qrLanding.faq2Q'), a: t('qrLanding.faq2A') },
    { q: t('qrLanding.faq3Q'), a: t('qrLanding.faq3A') },
  ];

  const audiences = [
    { icon: Wrench, title: t('qrLanding.audience1Title'), desc: t('qrLanding.audience1Desc') },
    { icon: Store, title: t('qrLanding.audience2Title'), desc: t('qrLanding.audience2Desc') },
    { icon: Smartphone, title: t('qrLanding.audience3Title'), desc: t('qrLanding.audience3Desc') },
  ];

  return (
    <PageShell>
      <PageMeta
        title={t('qrLanding.metaTitle')}
        description={t('qrLanding.metaDescription')}
        url="/qr-generator"
      />
      <main className="qr-landing">
        {/* Hero */}
        <section className="qr-landing-hero">
          <p className="qr-landing-eyebrow">
            <QrCode size={16} aria-hidden="true" />
            {t('qrLanding.heroEyebrow')}
          </p>
          <h1>{t('qrLanding.heroTitle')}</h1>
          <p className="qr-landing-hero__subtitle">{t('qrLanding.heroSubtitle')}</p>
          <div className="qr-landing-hero__ctas">
            <Link to="/login?next=/qr-generator" className="qr-landing-cta qr-landing-cta--primary">
              {t('qrLanding.ctaCreate')}
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </div>
          {/* Visual: sample QR flow */}
          <div className="qr-landing-demo" aria-hidden="true">
            <div className="qr-landing-demo__card">
              <QrCode size={64} />
              <span>{t('qrLanding.demoScan')}</span>
            </div>
            <ArrowRight size={24} className="qr-landing-demo__arrow" />
            <div className="qr-landing-demo__card">
              <ScanLine size={64} />
              <span>{t('qrLanding.demoPay')}</span>
            </div>
            <ArrowRight size={24} className="qr-landing-demo__arrow" />
            <div className="qr-landing-demo__card">
              <Wallet size={64} />
              <span>{t('qrLanding.demoPaid')}</span>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="qr-landing-section" aria-labelledby="qr-how">
          <h2 id="qr-how">{t('qrLanding.howItWorksTitle')}</h2>
          <div className="qr-landing-steps">
            {steps.map((step, i) => (
              <Step key={i} index={i} title={step.title} description={step.description} />
            ))}
          </div>
        </section>

        {/* Who it's for */}
        <section className="qr-landing-section" aria-labelledby="qr-audiences">
          <h2 id="qr-audiences">{t('qrLanding.audiencesTitle')}</h2>
          <div className="qr-landing-audiences">
            {audiences.map((a, i) => (
              <article key={i} className="qr-landing-audience">
                <a.icon size={28} aria-hidden="true" />
                <h3>{a.title}</h3>
                <p>{a.desc}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Fees */}
        <section className="qr-landing-fees" aria-labelledby="qr-fees">
          <BadgePercent size={28} aria-hidden="true" />
          <div>
            <h2 id="qr-fees">{t('qrLanding.feesTitle')}</h2>
            <p>{t('qrLanding.feesDesc')}</p>
          </div>
        </section>

        {/* Print note */}
        <section className="qr-landing-print" aria-label={t('qrLanding.printTitle')}>
          <Printer size={22} aria-hidden="true" />
          <p>{t('qrLanding.printDesc')}</p>
        </section>

        {/* FAQ */}
        <section className="qr-landing-section" aria-labelledby="qr-faq">
          <h2 id="qr-faq">{t('qrLanding.faqTitle')}</h2>
          <div className="qr-landing-faq">
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
        <section className="qr-landing-final">
          <CheckCircle2 size={32} aria-hidden="true" />
          <h2>{t('qrLanding.finalCtaTitle')}</h2>
          <p>{t('qrLanding.finalCtaSubtitle')}</p>
          <Link to="/login?next=/qr-generator" className="qr-landing-cta qr-landing-cta--primary">
            {t('qrLanding.ctaCreate')}
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </section>
      </main>
    </PageShell>
  );
}
