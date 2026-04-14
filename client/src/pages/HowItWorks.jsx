import { Link } from 'react-router-dom';
import Footer from '../components/Footer';

const CUSTOMER_STEPS = [
  {
    step: '1',
    title: 'Create a Free Account',
    desc: 'Sign up in about 5 minutes. No credit card required.',
  },
  {
    step: '2',
    title: 'Post a Job',
    desc: 'Describe what you need — handyman work, cleaning, yard work, moving help, and more. Set your budget and timeline.',
  },
  {
    step: '3',
    title: 'Receive Bids',
    desc: 'Qualified local helpers see your job and send competitive bids. Compare profiles, ratings, and pricing side by side.',
  },
  {
    step: '4',
    title: 'Hire with Confidence',
    desc: 'Choose the best fit, communicate through our messaging system, and get the job done. Leave a review when complete.',
  },
];

const HELPER_STEPS = [
  {
    step: '1',
    title: 'Apply to Become a Helper',
    desc: 'Complete our quick registration process.',
  },
  {
    step: '2',
    title: 'Browse & Bid on Jobs',
    desc: 'See real jobs posted by customers in your area. Submit competitive bids and showcase your experience.',
  },
  {
    step: '3',
    title: 'Get Hired & Get Paid',
    desc: 'Win jobs, complete the work, and build your reputation with reviews. Grow your local business on your schedule.',
  },
];

const FAQS = [
  {
    q: 'Is OxSteed free to use?',
    a: 'Yes. Posting jobs as a customer is completely free. All users can sign up at no cost and bid on a limited number of jobs per month, or upgrade to a paid plan for expanded access.',
  },
  {
    q: 'How does OxSteed verify its users?',
    a: "Every user completes identity verification during registration. We may also run background checks and collect tax information (such as a W-9) when a user chooses to receive payment via OxSteed. Customer reviews further build each helper's reputation over time.",
  },
  {
    q: 'What types of jobs can I post?',
    a: "Handyman, plumbing, electrical, cleaning, moving, painting, landscaping, yard work, tool rental, general labor, and more. If it's a local service task, you can post it on OxSteed.",
  },
  {
    q: 'How do I communicate with a helper or customer?',
    a: "Once a bid is accepted, both parties can message each other securely through OxSteed's built-in messaging system without the need to share personal phone numbers.",
  },
  {
    q: 'What if something goes wrong?',
    a: "OxSteed is a marketplace that connects customers with independent business owners and does not control how individual jobs are performed or paid for. If there's an issue with a job, either party can open a case in our dispute resolution center, and our team will try to help mediate a fair outcome when possible.",
  },
];

export default function HowItWorks() {
  return (
    <div
      className="min-h-screen text-white flex flex-col"
      data-theme="dark"
      style={{ background: '#080c14' }}
    >
      {/* ── Navbar ── */}
      <nav
        role="navigation"
        aria-label="Main navigation"
        style={{
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          backdropFilter: 'blur(12px)',
          background: 'rgba(8,12,20,0.85)',
          position: 'sticky',
          top: 0,
          zIndex: 50,
        }}
      >
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" style={{ fontSize: '1.35rem', fontWeight: 800, color: '#f97316', letterSpacing: '-0.02em', textDecoration: 'none' }}>
            OxSteed
          </Link>
          <div className="flex items-center gap-6">
            <Link to="/register/customer" style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.55)', textDecoration: 'none', transition: 'color 150ms' }}
              onMouseEnter={e => e.currentTarget.style.color = '#fff'}
              onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.55)'}
            >Post a Job</Link>
            <Link to="/register/helper" style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.55)', textDecoration: 'none', transition: 'color 150ms' }}
              onMouseEnter={e => e.currentTarget.style.color = '#fff'}
              onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.55)'}
            >Become a Helper</Link>
            <Link
              to="/login"
              style={{
                fontSize: '0.875rem',
                fontWeight: 600,
                color: '#fff',
                background: '#f97316',
                padding: '0.45rem 1.1rem',
                borderRadius: '999px',
                textDecoration: 'none',
                transition: 'background 150ms',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#ea580c'}
              onMouseLeave={e => e.currentTarget.style.background = '#f97316'}
            >Sign In</Link>
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
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          {/* ambient glow */}
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: 'radial-gradient(ellipse 70% 55% at 50% -10%, rgba(249,115,22,0.13) 0%, transparent 70%)',
          }} />
          {/* subtle grid */}
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.03,
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }} />

          <div style={{ position: 'relative', maxWidth: '720px', margin: '0 auto' }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
              background: 'rgba(249,115,22,0.1)',
              border: '1px solid rgba(249,115,22,0.25)',
              borderRadius: '999px',
              padding: '0.3rem 0.9rem',
              fontSize: '0.75rem',
              fontWeight: 700,
              color: '#fb923c',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              marginBottom: '1.25rem',
            }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#f97316', display: 'inline-block' }} />
              Platform Overview
            </div>
            <h1 style={{
              fontSize: 'clamp(2.5rem, 5vw, 3.75rem)',
              fontWeight: 800,
              lineHeight: 1.1,
              letterSpacing: '-0.03em',
              color: '#fff',
              marginBottom: '1.25rem',
            }}>
              How OxSteed Works
            </h1>
            <p style={{
              fontSize: '1.0625rem',
              color: 'rgba(255,255,255,0.5)',
              lineHeight: 1.65,
              maxWidth: '540px',
              margin: '0 auto 1.75rem',
            }}>
              OxSteed connects customers with local helpers. Whether you need work done or want to earn money in your community, we make it simple and easy to use.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '0.75rem' }}>
              <Link
                to="/register/customer"
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
                Post a Job — It's Free
              </Link>
              <Link
                to="/register/helper"
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: 'rgba(255,255,255,0.75)',
                  fontWeight: 600,
                  fontSize: '0.9375rem',
                  padding: '0.75rem 1.75rem',
                  borderRadius: '999px',
                  textDecoration: 'none',
                  transition: 'border-color 150ms, color 150ms, background 150ms',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(249,115,22,0.5)'; e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(249,115,22,0.06)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; e.currentTarget.style.color = 'rgba(255,255,255,0.75)'; e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
              >
                Become a Helper
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
              { eyebrow: 'For Customers', title: 'Get Help in 4 Easy Steps', steps: CUSTOMER_STEPS, cta: { to: '/register/customer', label: 'Create Your Free Account', style: 'solid' } },
              { eyebrow: 'For Helpers',   title: 'Start Earning in Your Neighborhood', steps: HELPER_STEPS, cta: { to: '/register/helper', label: 'Apply to Become a Helper', style: 'outline' } },
            ].map((col) => (
              <div
                key={col.eyebrow}
                style={{
                  background: 'linear-gradient(145deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.015) 100%)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: '20px',
                  padding: '1.75rem 1.6rem 1.5rem',
                  display: 'flex',
                  flexDirection: 'column',
                  transition: 'border-color 200ms, box-shadow 200ms',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(249,115,22,0.28)'; e.currentTarget.style.boxShadow = '0 12px 40px rgba(0,0,0,0.3)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'; e.currentTarget.style.boxShadow = 'none'; }}
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
                  color: '#fff',
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
                        fontWeight: 800, fontSize: '0.8125rem', color: '#fff',
                        letterSpacing: '-0.01em',
                        marginTop: '0.1rem',
                      }}>{item.step}</div>
                      <div style={{ minWidth: 0 }}>
                        <h3 style={{ color: '#fff', fontWeight: 700, fontSize: '0.9375rem', margin: '0 0 0.2rem', lineHeight: 1.35 }}>{item.title}</h3>
                        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.8125rem', lineHeight: 1.55, margin: 0 }}>{item.desc}</p>
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
                    color: '#fb923c',
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

        {/* ── FAQ (2-column editorial) ── */}
        <section style={{
          padding: '3rem 1.5rem 3.5rem',
          background: 'linear-gradient(180deg, rgba(249,115,22,0.03) 0%, transparent 100%)',
          borderTop: '1px solid rgba(255,255,255,0.05)',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
        }}>
          <div style={{ maxWidth: '1120px', margin: '0 auto' }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: '2rem',
              alignItems: 'start',
            }}>
              {/* Left column — title */}
              <div>
                <h2 style={{
                  fontSize: 'clamp(1.5rem, 2.75vw, 2rem)',
                  fontWeight: 800,
                  color: '#fff',
                  letterSpacing: '-0.025em',
                  margin: '0 0 0.6rem',
                  lineHeight: 1.15,
                }}>
                  Frequently Asked Questions
                </h2>
                <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.9rem', lineHeight: 1.6, margin: 0, maxWidth: '320px' }}>
                  Quick answers to what most people ask about OxSteed.
                </p>
              </div>

              {/* Right column — FAQ items in a tight 2-column grid */}
              <div style={{
                gridColumn: 'span 1',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                gap: '0.625rem',
              }}>
                {FAQS.map((faq, i) => (
                  <div
                    key={i}
                    style={{
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.07)',
                      borderRadius: '12px',
                      padding: '1rem 1.15rem',
                      transition: 'border-color 200ms',
                    }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(249,115,22,0.2)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'}
                  >
                    <h3 style={{ color: '#fff', fontWeight: 700, fontSize: '0.875rem', margin: '0 0 0.35rem', lineHeight: 1.35 }}>{faq.q}</h3>
                    <p style={{ color: 'rgba(255,255,255,0.48)', fontSize: '0.8125rem', lineHeight: 1.55, margin: 0 }}>{faq.a}</p>
                  </div>
                ))}
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
              color: '#fff',
              letterSpacing: '-0.03em',
              marginBottom: '0.75rem',
              lineHeight: 1.15,
            }}>Ready to Get Started?</h2>
            <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '1rem', lineHeight: 1.65, maxWidth: '400px', margin: '0 auto 1.75rem' }}>
              Join your local OxSteed community today. It only takes a couple of minutes.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '0.75rem' }}>
              <Link
                to="/register/customer"
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
                Post a Job Free
              </Link>
              <Link
                to="/register/helper"
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: 'rgba(255,255,255,0.75)',
                  fontWeight: 600,
                  fontSize: '0.9375rem',
                  padding: '0.8rem 2rem',
                  borderRadius: '999px',
                  textDecoration: 'none',
                  transition: 'border-color 150ms, color 150ms, background 150ms',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(249,115,22,0.5)'; e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(249,115,22,0.06)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; e.currentTarget.style.color = 'rgba(255,255,255,0.75)'; e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
              >
                Become a Helper
              </Link>
            </div>
          </div>
        </section>

      </div>

      <Footer />
    </div>
  );
}
