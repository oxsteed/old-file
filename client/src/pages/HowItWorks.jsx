import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Footer from '../components/Footer';

export default function HowItWorks() {
  const { t } = useTranslation();
  const [openFaq, setOpenFaq] = useState(null);

  const CUSTOMER_STEPS = [
    { step: '1', title: t('howItWorks.customerStep1Title'), desc: t('howItWorks.customerStep1Desc') },
    { step: '2', title: t('howItWorks.customerStep2Title'), desc: t('howItWorks.customerStep2Desc') },
    { step: '3', title: t('howItWorks.customerStep3Title'), desc: t('howItWorks.customerStep3Desc') },
    { step: '4', title: t('howItWorks.customerStep4Title'), desc: t('howItWorks.customerStep4Desc') },
  ];

  const HELPER_STEPS = [
    { step: '1', title: t('howItWorks.helperStep1Title'), desc: t('howItWorks.helperStep1Desc') },
    { step: '2', title: t('howItWorks.helperStep2Title'), desc: t('howItWorks.helperStep2Desc') },
    { step: '3', title: t('howItWorks.helperStep3Title'), desc: t('howItWorks.helperStep3Desc') },
  ];

  const FAQS = [
    { q: t('howItWorks.faq1Q'), a: t('howItWorks.faq1A') },
    { q: t('howItWorks.faq2Q'), a: t('howItWorks.faq2A') },
    { q: t('howItWorks.faq3Q'), a: t('howItWorks.faq3A') },
    { q: t('howItWorks.faq4Q'), a: t('howItWorks.faq4A') },
    { q: t('howItWorks.faq5Q'), a: t('howItWorks.faq5A') },
  ];

  return (
    <div
      className="how-it-works-page min-h-screen flex flex-col"
      style={{ background: 'var(--color-bg)', color: 'var(--color-text)' }}
    >
      {/* ── Navbar ── */}
      <nav
        role="navigation"
        aria-label={t('mainNavigation')}
        style={{
          borderBottom: '1px solid var(--color-border-faint)',
          backdropFilter: 'blur(12px)',
          background: 'var(--color-nav-bg)',
          position: 'sticky',
          top: 0,
          zIndex: 50,
        }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link to="/" style={{ fontSize: '1.35rem', fontWeight: 800, color: '#f97316', letterSpacing: '-0.02em', textDecoration: 'none' }}>
            OxSteed
          </Link>
          <div className="flex items-center gap-3 sm:gap-6">
            <Link to="/join" className="hidden sm:inline"
              style={{ fontSize: '0.875rem', color: 'var(--color-text-subtle)', textDecoration: 'none', transition: 'color 150ms' }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--color-nav-link-hover)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-subtle)'}
            >{t('howItWorks.postJob')}</Link>
            <Link to="/register/helper" className="hidden sm:inline"
              style={{ fontSize: '0.875rem', color: 'var(--color-text-subtle)', textDecoration: 'none', transition: 'color 150ms' }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--color-nav-link-hover)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-subtle)'}
            >{t('howItWorks.becomeHelper')}</Link>
            <Link
              to="/login"
              style={{
                fontSize: '0.875rem',
                fontWeight: 600,
                color: 'var(--color-primary-text)',
                background: 'var(--color-primary)',
                padding: '0.45rem 1.1rem',
                borderRadius: '999px',
                textDecoration: 'none',
                transition: 'background 150ms',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--color-primary-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--color-primary)'}
            >{t('howItWorks.signIn')}</Link>
          </div>
        </div>
      </nav>

      <div className="flex-1">

        {/* ── Hero ── */}
        <section
          style={{
            padding: '4.5rem 1.5rem 3.5rem',
            textAlign: 'center',
            position: 'relative',
            overflow: 'hidden',
            borderBottom: '1px solid var(--color-border-faint)',
          }}
        >
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: 'radial-gradient(ellipse 70% 55% at 50% -10%, rgba(249,115,22,0.13) 0%, transparent 70%)',
          }} />
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.03,
            backgroundImage: 'linear-gradient(var(--color-border-subtle) 1px, transparent 1px), linear-gradient(90deg, var(--color-border-subtle) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }} />

          <div style={{ position: 'relative', maxWidth: '720px', margin: '0 auto' }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
              background: 'var(--color-primary-bg)',
              border: '1px solid color-mix(in srgb, var(--color-primary) 25%, transparent)',
              borderRadius: '999px',
              padding: '0.3rem 0.9rem',
              fontSize: '0.75rem',
              fontWeight: 700,
              color: 'var(--color-primary)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              marginBottom: '1.25rem',
            }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#f97316', display: 'inline-block' }} />
              {t('howItWorks.badge')}
            </div>
            <h1 style={{
              fontSize: 'clamp(2.5rem, 5vw, 3.75rem)',
              fontWeight: 800,
              lineHeight: 1.1,
              letterSpacing: '-0.03em',
              color: 'var(--color-text)',
              marginBottom: '1.25rem',
            }}>
              {t('howItWorks.title')}
            </h1>
            <p style={{
              fontSize: '1.0625rem',
              color: 'var(--color-text-subtle)',
              lineHeight: 1.65,
              maxWidth: '540px',
              margin: '0 auto 1.75rem',
            }}>
              {t('howItWorks.subtitle')}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '0.75rem' }}>
              <Link
                to="/join"
                style={{
                  background: '#f97316',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: '0.9375rem',
                  padding: '0.75rem 1.75rem',
                  borderRadius: '999px',
                  textDecoration: 'none',
                  transition: 'background 150ms, box-shadow 150ms',
                  boxShadow: '0 0 24px rgba(249,115,22,0.3)',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#ea580c'; e.currentTarget.style.boxShadow = '0 0 32px rgba(249,115,22,0.45)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#f97316'; e.currentTarget.style.boxShadow = '0 0 24px rgba(249,115,22,0.3)'; }}
              >
                {t('howItWorks.postJobFree')}
              </Link>
              <Link
                to="/register/helper"
                style={{
                  background: 'var(--color-surface-translucent)',
                  border: '1px solid var(--color-border-subtle)',
                  color: 'var(--color-text-soft)',
                  fontWeight: 600,
                  fontSize: '0.9375rem',
                  padding: '0.75rem 1.75rem',
                  borderRadius: '999px',
                  textDecoration: 'none',
                  transition: 'border-color 150ms, color 150ms, background 150ms',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(249,115,22,0.5)'; e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(249,115,22,0.06)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border-subtle)'; e.currentTarget.style.color = 'var(--color-text-soft)'; e.currentTarget.style.background = 'var(--color-surface-translucent)'; }}
              >
                {t('howItWorks.becomeHelper')}
              </Link>
            </div>
          </div>
        </section>

        {/* ── How It Works (side-by-side) ── */}
        <section style={{ padding: '3rem 1.5rem 3.5rem', maxWidth: '1120px', margin: '0 auto' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: '1.5rem',
            alignItems: 'stretch',
          }}>
            {[
              { eyebrow: t('howItWorks.forCustomers'), title: t('howItWorks.customerTitle'), steps: CUSTOMER_STEPS, cta: { to: '/join', label: t('howItWorks.customerCta'), style: 'solid' } },
              { eyebrow: t('howItWorks.forHelpers'),   title: t('howItWorks.helperTitle'),   steps: HELPER_STEPS,   cta: { to: '/register/helper',   label: t('howItWorks.helperCta'),   style: 'outline' } },
            ].map((col) => (
              <div
                key={col.eyebrow}
                style={{
                  background: 'var(--color-card-bg)',
                  border: '1px solid var(--color-border-subtle)',
                  borderRadius: '20px',
                  padding: '1.75rem 1.6rem 1.5rem',
                  display: 'flex',
                  flexDirection: 'column',
                  transition: 'border-color 200ms, box-shadow 200ms',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(249,115,22,0.28)'; e.currentTarget.style.boxShadow = '0 12px 40px rgba(0,0,0,0.3)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border-subtle)'; e.currentTarget.style.boxShadow = 'none'; }}
              >
                <span style={{
                  display: 'inline-block',
                  alignSelf: 'flex-start',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: '#f97316',
                  background: 'rgba(249,115,22,0.1)',
                  border: '1px solid rgba(249,115,22,0.2)',
                  borderRadius: '999px',
                  padding: '0.25rem 0.75rem',
                  marginBottom: '0.75rem',
                }}>{col.eyebrow}</span>
                <h2 style={{
                  fontSize: 'clamp(1.375rem, 2.25vw, 1.625rem)',
                  fontWeight: 800,
                  color: 'var(--color-text)',
                  letterSpacing: '-0.025em',
                  lineHeight: 1.2,
                  margin: '0 0 1.25rem',
                }}>{col.title}</h2>

                <ol style={{
                  listStyle: 'none', padding: 0, margin: '0 0 1.5rem',
                  display: 'flex', flexDirection: 'column', gap: '1rem',
                  flex: 1,
                }}>
                  {col.steps.map((item) => (
                    <li key={item.step} style={{ display: 'flex', gap: '0.9rem', alignItems: 'flex-start' }}>
                      <div style={{
                        flex: '0 0 auto',
                        width: '1.85rem', height: '1.85rem',
                        borderRadius: '8px',
                        background: 'linear-gradient(135deg, #f97316, #ea580c)',
                        boxShadow: '0 3px 10px rgba(249,115,22,0.35)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 800, fontSize: '0.8125rem', color: 'var(--color-primary-text)',
                        letterSpacing: '-0.01em',
                        marginTop: '0.1rem',
                      }}>{item.step}</div>
                      <div style={{ minWidth: 0 }}>
                        <h3 style={{ color: 'var(--color-text)', fontWeight: 700, fontSize: '0.9375rem', margin: '0 0 0.2rem', lineHeight: 1.35 }}>{item.title}</h3>
                        <p style={{ color: 'var(--color-text-subtle)', fontSize: '0.8125rem', lineHeight: 1.55, margin: 0 }}>{item.desc}</p>
                      </div>
                    </li>
                  ))}
                </ol>

                <Link
                  to={col.cta.to}
                  style={col.cta.style === 'solid' ? {
                    display: 'inline-block', textAlign: 'center',
                    background: '#f97316', color: '#fff',
                    fontWeight: 700, fontSize: '0.9rem',
                    padding: '0.7rem 1.5rem',
                    borderRadius: '999px',
                    textDecoration: 'none',
                    transition: 'background 150ms, box-shadow 150ms',
                    boxShadow: '0 0 20px rgba(249,115,22,0.25)',
                  } : {
                    display: 'inline-block', textAlign: 'center',
                    background: 'transparent',
                    border: '1.5px solid #f97316',
                    color: 'var(--color-primary)',
                    fontWeight: 700, fontSize: '0.9rem',
                    padding: '0.55rem 1.5rem',
                    borderRadius: '999px',
                    textDecoration: 'none',
                    transition: 'background 150ms, color 150ms, box-shadow 150ms',
                  }}
                  onMouseEnter={e => {
                    if (col.cta.style === 'solid') { e.currentTarget.style.background = '#ea580c'; e.currentTarget.style.boxShadow = '0 0 28px rgba(249,115,22,0.4)'; }
                    else { e.currentTarget.style.background = '#f97316'; e.currentTarget.style.color = '#fff'; e.currentTarget.style.boxShadow = '0 0 20px rgba(249,115,22,0.3)'; }
                  }}
                  onMouseLeave={e => {
                    if (col.cta.style === 'solid') { e.currentTarget.style.background = '#f97316'; e.currentTarget.style.boxShadow = '0 0 20px rgba(249,115,22,0.25)'; }
                    else { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#fb923c'; e.currentTarget.style.boxShadow = 'none'; }
                  }}
                >
                  {col.cta.label}
                </Link>
              </div>
            ))}
          </div>
        </section>

        {/* ── FAQ accordion ── */}
        <section style={{
          padding: '3rem 1.5rem 3.5rem',
          background: 'linear-gradient(180deg, rgba(249,115,22,0.03) 0%, transparent 100%)',
          borderTop: '1px solid var(--color-border-faint)',
          borderBottom: '1px solid var(--color-border-faint)',
        }}>
          <div style={{ maxWidth: '1120px', margin: '0 auto' }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: '2.5rem',
              alignItems: 'start',
            }}>

              {/* Left column - title */}
              <div style={{ position: 'sticky', top: '5rem' }}>
                <h2 style={{
                  fontSize: 'clamp(1.5rem, 2.75vw, 2rem)',
                  fontWeight: 800,
                  color: 'var(--color-text)',
                  letterSpacing: '-0.025em',
                  margin: '0 0 0.6rem',
                  lineHeight: 1.15,
                }}>
                  {t('howItWorks.faqTitle').split('\n').map((line, i, a) => (
                    <span key={i}>{line}{i < a.length - 1 ? <br /> : null}</span>
                  ))}
                </h2>
                <p style={{ color: 'var(--color-text-subtle)', fontSize: '0.9rem', lineHeight: 1.6, margin: 0, maxWidth: '280px' }}>
                  {t('howItWorks.faqSubtitle')}
                </p>
              </div>

              {/* Right column - accordion */}
              <div style={{
                border: '1px solid var(--color-border-subtle)',
                borderRadius: '16px',
                overflow: 'hidden',
                background: 'var(--color-surface-translucent)',
              }}>
                {FAQS.map((faq, i) => {
                  const isOpen = openFaq === i;
                  return (
                    <div
                      key={i}
                      style={{
                        borderBottom: i < FAQS.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
                        background: isOpen ? 'rgba(249,115,22,0.04)' : 'transparent',
                        transition: 'background 200ms',
                      }}
                    >
                      <button
                        onClick={() => setOpenFaq(isOpen ? null : i)}
                        aria-expanded={isOpen}
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '1rem',
                          padding: '1.1rem 1.35rem',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        <span style={{
                          color: isOpen ? 'var(--color-text)' : 'var(--color-text-soft)',
                          fontWeight: 700,
                          fontSize: '0.9375rem',
                          lineHeight: 1.35,
                          transition: 'color 200ms',
                        }}>
                          {faq.q}
                        </span>
                        <svg
                          width="18" height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke={isOpen ? 'var(--color-primary)' : 'var(--color-text-subtle)'}
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          style={{
                            flexShrink: 0,
                            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                            transition: 'transform 280ms cubic-bezier(0.4, 0, 0.2, 1), stroke 200ms',
                          }}
                          aria-hidden="true"
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>

                      <div style={{
                        display: 'grid',
                        gridTemplateRows: isOpen ? '1fr' : '0fr',
                        transition: 'grid-template-rows 280ms cubic-bezier(0.4, 0, 0.2, 1)',
                      }}>
                        <div style={{ overflow: 'hidden' }}>
                          <p style={{
                            color: 'var(--color-text-subtle)',
                            fontSize: '0.875rem',
                            lineHeight: 1.7,
                            margin: 0,
                            padding: '0 1.35rem 1.25rem',
                          }}>
                            {faq.a}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

            </div>
          </div>
        </section>

        {/* ── Bottom CTA ── */}
        <section style={{ padding: '4rem 1.5rem', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: 'radial-gradient(ellipse 60% 50% at 50% 100%, rgba(249,115,22,0.1) 0%, transparent 70%)',
          }} />
          <div style={{ position: 'relative', maxWidth: '560px', margin: '0 auto' }}>
            <h2 style={{
              fontSize: 'clamp(1.75rem, 3vw, 2.125rem)',
              fontWeight: 800,
              color: 'var(--color-text)',
              letterSpacing: '-0.03em',
              marginBottom: '0.75rem',
              lineHeight: 1.15,
            }}>{t('howItWorks.readyTitle')}</h2>
            <p style={{ color: 'var(--color-text-subtle)', fontSize: '1rem', lineHeight: 1.65, maxWidth: '400px', margin: '0 auto 1.75rem' }}>
              {t('howItWorks.readySubtitle')}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '0.75rem' }}>
              <Link
                to="/join"
                style={{
                  background: '#f97316',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: '0.9375rem',
                  padding: '0.8rem 2rem',
                  borderRadius: '999px',
                  textDecoration: 'none',
                  transition: 'background 150ms, box-shadow 150ms',
                  boxShadow: '0 0 28px rgba(249,115,22,0.35)',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#ea580c'; e.currentTarget.style.boxShadow = '0 0 40px rgba(249,115,22,0.5)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#f97316'; e.currentTarget.style.boxShadow = '0 0 28px rgba(249,115,22,0.35)'; }}
              >
                {t('howItWorks.postJobFreeBtn')}
              </Link>
              <Link
                to="/register/helper"
                style={{
                  background: 'var(--color-surface-translucent)',
                  border: '1px solid var(--color-border-subtle)',
                  color: 'var(--color-text-soft)',
                  fontWeight: 600,
                  fontSize: '0.9375rem',
                  padding: '0.8rem 2rem',
                  borderRadius: '999px',
                  textDecoration: 'none',
                  transition: 'border-color 150ms, color 150ms, background 150ms',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(249,115,22,0.5)'; e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(249,115,22,0.06)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border-subtle)'; e.currentTarget.style.color = 'var(--color-text-soft)'; e.currentTarget.style.background = 'var(--color-surface-translucent)'; }}
              >
                {t('howItWorks.becomeHelper')}
              </Link>
            </div>
          </div>
        </section>

      </div>

      <Footer />
    </div>
  );
}
