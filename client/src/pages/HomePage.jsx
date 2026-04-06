import { Link } from 'react-router-dom';
import '../styles/HomePage.css';
import ThemeToggle from '../components/ThemeToggle';

const CATEGORIES = [
  { slug: 'electrical',  icon: '⚡', name: 'Electrical',       desc: 'Wiring, panels, EV chargers' },
  { slug: 'plumbing',    icon: '🚿', name: 'Plumbing',         desc: 'Pipes, drains, water heaters' },
  { slug: 'hvac',        icon: '❄️', name: 'HVAC',             desc: 'Install, repair, duct work' },
  { slug: 'carpentry',   icon: '🪚', name: 'Carpentry',          desc: 'Trim, cabinets, custom builds' },
  { slug: 'painting',    icon: '🖌️', name: 'Painting',          desc: 'Interior & exterior' },
  { slug: 'roofing',     icon: '🏠', name: 'Roofing',           desc: 'Repair, replacement, gutters' },
  { slug: 'flooring',    icon: '🪵', name: 'Flooring',          desc: 'Hardwood, tile, carpet' },
  { slug: 'landscaping', icon: '🌿', name: 'Landscaping',       desc: 'Garden, lawn, tree care' },
  { slug: 'moving',      icon: '🚚', name: 'Moving & Hauling',  desc: 'Local & long distance' },
  { slug: 'cleaning',    icon: '✨', name: 'Home Cleaning',     desc: 'Deep clean, move-out, regular' },
  { slug: 'handyman',    icon: '🔧', name: 'Handyman',          desc: 'Assembly, repairs, installs' },
  { slug: 'general-labor',icon: '💪', name: 'General Labor',    desc: 'Any task you need done' },
];

export default function HomePage() {
  return (
    <div className="hp-root">
      {/* -- Nav -- */}
      <nav className="hp-nav" aria-label="Main navigation">
        <Link to="/" className="hp-logo">
          <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <rect x="4" y="14" width="10" height="14" rx="2" fill="currentColor" opacity=".2"/>
            <rect x="18" y="8" width="10" height="20" rx="2" fill="currentColor" opacity=".35"/>
            <path d="M4 14 C4 8 14 4 16 4 C18 4 28 8 28 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
            <circle cx="16" cy="4" r="2.5" fill="currentColor"/>
          </svg>
          OxSteed
        </Link>
        <div className="hp-nav-links">
          <Link to="/login" className="hp-nav-link">Sign in</Link>
          <Link to="/jobs" className="hp-nav-link">Browse Jobs</Link>
          <Link to="/how-it-works" className="hp-nav-link">How It Works</Link>
          <Link to="/register/helper" className="hp-btn hp-btn-ghost">List Your Skills</Link>
          <Link to="/register/customer" className="hp-btn hp-btn-primary">Post a Job</Link>
          <ThemeToggle />
        </div>
        {/* Mobile nav */}
        <div className="hp-nav-mobile">
          <Link to="/register/customer" className="hp-btn hp-btn-primary" style={{ fontSize: '.8rem', padding: '.5rem 1rem' }}>Post a Job</Link>
        </div>
      </nav>

      {/* -- Hero -- */}
      <section className="hp-hero">
        <div className="hp-hero-inner">
          <div className="hp-hero-eyebrow">Local trades marketplace</div>
          <h1 className="hp-hero-title">
            Post a job.<br />
            Find a helper.<br />
            <em>Get it done.</em>
          </h1>
          <p className="hp-hero-sub">
            Describe what needs doing, set your own requirements, and let qualified local helpers bid. Compare proposals and pay securely — with optional escrow protection. Free to start.
          </p>
          <div className="hp-hero-ctas">
            <Link to="/register/customer" className="hp-btn hp-btn-primary hp-btn-lg">
              Post a Job
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
            </Link>
            <Link to="/jobs" className="hp-btn hp-btn-outline hp-btn-lg">
              Browse Listings
            </Link>
          </div>
          <div className="hp-hero-trust">
            <span className="hp-trust-pill">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
              Free to post
            </span>
            <span className="hp-trust-pill">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
              Address stays private
            </span>
            <span className="hp-trust-pill">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
              No obligation
            </span>
          </div>
        </div>

        {/* Hero decorative card */}
        <div className="hp-hero-card" aria-hidden="true">
          <div className="hp-mock-card">
            <div className="hp-mock-header">
              <span className="hp-mock-dot" style={{ background:'#01696f' }}/>
              <span style={{ fontSize:'.75rem', fontWeight:600, color:'#6e6c66' }}>Live bids</span>
              <span className="hp-mock-badge">3 new</span>
            </div>
            <div className="hp-mock-job">
              <div className="hp-mock-job-title">Full kitchen rewire</div>
              <div className="hp-mock-job-loc">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                Springfield, OH
              </div>
            </div>
            {[
              { name: 'R. Okonkwo', stars: 5, amt: '$820', badge: '✓ Licensed' },
              { name: 'D. Carver',  stars: 5, amt: '$750', badge: '✓ Insured' },
              { name: 'T. Novak',   stars: 4, amt: '$890', badge: '✓ Verified' },
            ].map((b, i) => (
              <div key={i} className="hp-mock-bid">
                <div className="hp-mock-avatar">{b.name[0]}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize:'.8rem', fontWeight:600, color:'#26231c' }}>{b.name}</div>
                  <div style={{ fontSize:'.7rem', color:'#01696f' }}>{b.badge}</div>
                </div>
                <div>
                  <div style={{ fontSize:'.875rem', fontWeight:700, color:'#26231c' }}>{b.amt}</div>
                  <div style={{ fontSize:'.65rem', color:'#b0aea9', textAlign:'right' }}>{'★'.repeat(b.stars)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* -- Categories -- */}
      <section className="hp-section">
        <div className="hp-container">
          <div className="hp-section-head">
            <h2 className="hp-section-title">Browse by Category</h2>
            <p className="hp-section-sub">Skilled local helpers across every trade and service.</p>
          </div>
          <div className="hp-cat-grid">
            {CATEGORIES.map(cat => (
              <Link key={cat.slug} to={`/jobs?category=${encodeURIComponent(cat.name)}`} className="hp-cat-card">
                <span className="hp-cat-icon">{cat.icon}</span>
                <div className="hp-cat-name">{cat.name}</div>
                <div className="hp-cat-desc">{cat.desc}</div>
              </Link>
            ))}
          </div>
          <p className="hp-cat-note">
            Don't see what you need?{' '}
            <Link to="/register/customer" className="hp-text-link">Post a job</Link>
            {' '}and let helpers come to you.
          </p>
        </div>
      </section>

      {/* -- Stats strip -- */}
      <section className="hp-stats">
        <div className="hp-container">
          <div className="hp-stats-grid">
            <div className="hp-stat"><span className="hp-stat-num">Free</span><span className="hp-stat-label">to list your skills</span></div>
            <div className="hp-stat-div" aria-hidden="true"/>
            <div className="hp-stat"><span className="hp-stat-num">12+</span><span className="hp-stat-label">service categories</span></div>
            <div className="hp-stat-div" aria-hidden="true"/>
            <div className="hp-stat"><span className="hp-stat-num">Nationwide</span><span className="hp-stat-label">available across the US</span></div>
          </div>
        </div>
      </section>

      {/* -- Helper CTA -- */}
      <section className="hp-section hp-cta-section">
        <div className="hp-container">
          <div className="hp-cta-inner">
            <div className="hp-cta-text">
              <h2 className="hp-cta-title">Post your skills.<br /><em>Run your own business.</em></h2>
              <p className="hp-cta-desc">
                List your services for free on your local board, or subscribe to Pro for priority placement and a verified badge. You set your own rates, hours, and service area.
              </p>
            </div>
            <div className="hp-cta-actions">
              <Link to="/register/helper" className="hp-btn hp-btn-primary hp-btn-lg">
                List Your Skills
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
              </Link>
              <Link to="/register/customer" className="hp-btn hp-btn-outline hp-btn-lg">
                Post a Job Instead
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* -- Footer -- */}
      <footer className="hp-footer">
        <div className="hp-container">
          <div className="hp-footer-top">
            <Link to="/" className="hp-footer-logo">
              <svg width="22" height="22" viewBox="0 0 32 32" fill="none" aria-hidden="true">
                <rect x="4" y="14" width="10" height="14" rx="2" fill="currentColor" opacity=".3"/>
                <rect x="18" y="8" width="10" height="20" rx="2" fill="currentColor" opacity=".5"/>
                <path d="M4 14 C4 8 14 4 16 4 C18 4 28 8 28 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
                <circle cx="16" cy="4" r="2.5" fill="currentColor"/>
              </svg>
              OxSteed
            </Link>
            <div className="hp-footer-links">
              <Link to="/login">Sign In</Link>
              <Link to="/register/customer">Find Help</Link>
              <Link to="/register/helper">List Your Skills</Link>
              <Link to="/how-it-works">How It Works</Link>
              <Link to="/about">About</Link>
            </div>
          </div>
          <div className="hp-footer-legal-links">
            <Link to="/terms">Terms of Service</Link>
            <Link to="/privacy">Privacy Policy</Link>
            <Link to="/security">Security</Link>
            <Link to="/cookie-policy">Cookie Policy</Link>
            <Link to="/cookie-settings">Cookie Settings</Link>
            <Link to="/do-not-sell">Do Not Sell My Info</Link>
            <Link to="/accessibility">Accessibility</Link>
          </div>
          <p className="hp-footer-disclaimer">
            PLEASE READ THE FULL <Link to="/terms">TERMS OF SERVICE</Link>. OxSteed LLC operates an online introduction platform and optional payment services. OxSteed is not a party to any service agreement between users unless both parties have affirmatively opted into Tier 3 Payment Protection for a specific job. All helpers are independent individuals or businesses — not employees, agents, or contractors of OxSteed. OxSteed does not control how helpers perform work, does not set prices, and does not dispatch helpers. Users are solely responsible for evaluating and selecting other users. OxSteed does not provide insurance of any kind.
          </p>
          <p className="hp-footer-copy">© 2026 OxSteed LLC · support@oxsteed.com</p>
        </div>
      </footer>
    </div>
  );
}
