import { Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import '../styles/HomePage.css';
import ThemeToggle from '../components/ThemeToggle';
import PageMeta from '../components/PageMeta';
import api from '../api/axios';

const SKILL_TILES = [
  { slug: 'electrical',   icon: '⚡', name: 'Electrical',      desc: 'Outlets, panels, EV chargers' },
  { slug: 'plumbing',     icon: '🚿', name: 'Plumbing',        desc: 'Leaks, drains, water heaters' },
  { slug: 'hvac',         icon: '❄️', name: 'HVAC',            desc: 'AC, heating, duct work' },
  { slug: 'carpentry',    icon: '🪚', name: 'Carpentry',       desc: 'Decks, trim, custom builds' },
  { slug: 'painting',     icon: '🖌️', name: 'Painting',        desc: 'Interior & exterior' },
  { slug: 'roofing',      icon: '🏠', name: 'Roofing',         desc: 'Repair, replacement, gutters' },
  { slug: 'flooring',     icon: '🪵', name: 'Flooring',        desc: 'Hardwood, tile, carpet' },
  { slug: 'landscaping',  icon: '🌿', name: 'Landscaping',     desc: 'Lawn, garden, tree care' },
  { slug: 'moving',       icon: '🚚', name: 'Moving',          desc: 'Packing, loading, hauling' },
  { slug: 'cleaning',     icon: '✨', name: 'Cleaning',        desc: 'Deep clean, move-out, regular' },
  { slug: 'pest-control', icon: '🐛', name: 'Pest Control',    desc: 'Rodents, termites, insects' },
  { slug: 'auto',         icon: '🚗', name: 'Auto Repair',     desc: 'Mobile mechanic, detailing' },
  { slug: 'appliance',    icon: '🔌', name: 'Appliance Repair',desc: 'Washer, dryer, refrigerator' },
  { slug: 'concrete',     icon: '🏗️', name: 'Concrete',        desc: 'Driveways, patios, slabs' },
  { slug: 'welding',      icon: '⚙️', name: 'Welding',         desc: 'Metal fab, gates, structural' },
  { slug: 'home-repair',  icon: '🔨', name: 'Home Repair',     desc: 'Drywall, fixtures, handyman' },
  { slug: 'security',     icon: '🔒', name: 'Security',        desc: 'Cameras, alarms, smart home' },
  { slug: 'pet-care',     icon: '🐾', name: 'Pet Care',        desc: 'Sitting, walking, grooming' },
  { slug: 'tutoring',     icon: '📚', name: 'Tutoring',        desc: 'Math, reading, test prep' },
];

/** The real OxSteed brand icon (4-arrow clockwise ring with inner circle) */
function OxSteedIcon({ size = 26 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect width="512" height="512" rx="88" fill="#16213e"/>
      <path d="M 40 285 A 218 218 0 0 1 173 55 L 211 26 A 178 178 0 0 0 80 279 Z" fill="#F97316"/>
      <path d="M 228 40 A 218 218 0 0 1 457 173 L 486 211 A 178 178 0 0 0 233 80 Z" fill="#F97316"/>
      <path d="M 472 228 A 218 218 0 0 1 339 457 L 301 486 A 178 178 0 0 0 433 233 Z" fill="#F97316"/>
      <path d="M 284 472 A 218 218 0 0 1 55 339 L 26 301 A 178 178 0 0 0 279 433 Z" fill="#F97316"/>
      <circle cx="256" cy="256" r="145" fill="#F97316"/>
      <text
        x="256" y="236"
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily="Arial Black, Arial, Helvetica, system-ui, sans-serif"
        fontWeight="900"
        fontSize="90"
        fill="#FFFFFF"
      >OxS</text>
      <polyline
        points="131,305 172,305 184,295 194,268 204,326 214,297 224,305 381,305"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Fetches the 3 most recent open jobs + their latest bid amounts for the hero card */
function useLiveBidsPreview() {
  const [data, setData] = useState(null);   // { jobTitle, location, bids: [{name, badge, amt, stars}] }
  const [newCount, setNewCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // Fetch the most recent open jobs (public endpoint, no auth required)
        const { data: jobsRes } = await api.get('/jobs?status=open&limit=10&sort=newest');
        const jobs = jobsRes.jobs || jobsRes || [];
        if (!jobs.length) return;

        // Find the first job that has at least one bid
        let chosenJob = null;
        let liveBids = [];

        for (const j of jobs) {
          try {
            const { data: bidsRes } = await api.get(`/bids/job/${j.id}`);
            const bids = bidsRes.bids || bidsRes || [];
            if (bids.length > 0) {
              chosenJob = j;
              liveBids = bids;
              break;
            }
          } catch {
            // job may have no bids endpoint access — skip
          }
        }

        // Fall back to showing the newest job even if it has 0 bids
        if (!chosenJob) {
          chosenJob = jobs[0];
        }

        if (cancelled) return;

        // Format bids for display (cap at 3)
        const formattedBids = liveBids.slice(0, 3).map((b) => {
          const helperName =
            b.helper_name || b.helper?.name || b.bidder_name || 'Helper';
          const initial = helperName.charAt(0).toUpperCase();
          const firstLast =
            helperName.split(' ').length >= 2
              ? `${helperName.split(' ')[0].charAt(0)}. ${helperName.split(' ').slice(-1)[0]}`
              : helperName;

          const badge = b.is_licensed
            ? '✓ Licensed'
            : b.is_insured
            ? '✓ Insured'
            : '✓ Verified';

          const amt =
            b.amount != null
              ? `$${Number(b.amount).toLocaleString()}`
              : b.bid_amount != null
              ? `$${Number(b.bid_amount).toLocaleString()}`
              : '—';

          const stars = Math.min(5, Math.max(1, Math.round(b.helper_rating || b.rating || 4)));

          return { name: firstLast, initial, badge, amt, stars };
        });

        const location =
          chosenJob.city && chosenJob.state
            ? `${chosenJob.city}, ${chosenJob.state}`
            : chosenJob.location || chosenJob.zip_code || 'Local area';

        setData({
          jobTitle: chosenJob.title || chosenJob.category || 'Local job',
          location,
          bids: formattedBids,
        });
        setNewCount(Math.min(liveBids.length, 9));
      } catch {
        // Silently fail — hero card just won't update
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return { preview: data, newCount };
}

export default function HomePage() {
  const { preview, newCount } = useLiveBidsPreview();

  // Resolved display values — fall back to skeleton/placeholder while loading
  const jobTitle  = preview?.jobTitle  ?? '…';
  const location  = preview?.location  ?? '—';
  const bids      = preview?.bids      ?? [];
  const badgeLabel = newCount > 0 ? `${newCount} new` : 'Live';

  return (
    <div className="hp-root">
      <PageMeta
        title="OxSteed — Hire Local Help Today"
        description="Post a job, compare bids from verified local helpers, and pay securely with optional escrow. Free to start."
        url="https://oxsteed.com"
      />

      {/* -- Nav -- */}
      <nav className="hp-nav" aria-label="Main navigation">
        <Link to="/" className="hp-logo">
          <OxSteedIcon size={26} />
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

        {/* Hero live bids card */}
        <div className="hp-hero-card" aria-hidden="true">
          <div className="hp-mock-card">
            <div className="hp-mock-header">
              <span className="hp-mock-dot" style={{ background: '#01696f' }}/>
              <span style={{ fontSize: '.75rem', fontWeight: 600, color: '#6e6c66' }}>Live bids</span>
              <span className="hp-mock-badge">{badgeLabel}</span>
            </div>
            <div className="hp-mock-job">
              <div className="hp-mock-job-title">
                {preview ? jobTitle : <span style={{ opacity: .4 }}>Loading…</span>}
              </div>
              <div className="hp-mock-job-loc">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                {location}
              </div>
            </div>

            {bids.length > 0
              ? bids.map((b, i) => (
                  <div key={i} className="hp-mock-bid">
                    <div className="hp-mock-avatar">{b.initial}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '.8rem', fontWeight: 600, color: '#26231c' }}>{b.name}</div>
                      <div style={{ fontSize: '.7rem', color: '#01696f' }}>{b.badge}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '.875rem', fontWeight: 700, color: '#26231c' }}>{b.amt}</div>
                      <div style={{ fontSize: '.65rem', color: '#b0aea9', textAlign: 'right' }}>{'★'.repeat(b.stars)}</div>
                    </div>
                  </div>
                ))
              : /* skeleton rows while loading */
                [0, 1, 2].map(i => (
                  <div key={i} className="hp-mock-bid" style={{ opacity: .35 }}>
                    <div className="hp-mock-avatar" style={{ background: '#e0deda' }}>?</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '.8rem', fontWeight: 600, color: '#26231c' }}>—</div>
                      <div style={{ fontSize: '.7rem', color: '#01696f' }}>✓ Verified</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '.875rem', fontWeight: 700, color: '#26231c' }}>—</div>
                    </div>
                  </div>
                ))
            }
          </div>
        </div>
      </section>

      {/* -- Browse by Skills -- */}
      <section className="hp-section">
        <div className="hp-container">
          <div className="hp-section-head">
            <h2 className="hp-section-title">Browse by Skill</h2>
            <p className="hp-section-sub">Find a local expert for the exact job you need done.</p>
          </div>
          <div className="hp-cat-grid">
            {SKILL_TILES.map(tile => (
              <Link key={tile.slug} to={`/helpers?skill=${tile.slug}`} className="hp-cat-card">
                <span className="hp-cat-icon">{tile.icon}</span>
                <div className="hp-cat-name">{tile.name}</div>
                <div className="hp-cat-desc">{tile.desc}</div>
              </Link>
            ))}
          </div>
          <p className="hp-cat-note">
            Don't see your skill?{' '}
            <Link to="/register/customer" className="hp-text-link">Post a job</Link>
            {' '}and let qualified helpers come to you.
          </p>
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
              <OxSteedIcon size={22} />
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
