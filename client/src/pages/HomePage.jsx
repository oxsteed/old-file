import { Link, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import '../styles/HomePage.css';
import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

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
  const [data, setData] = useState(null);
  const [newCount, setNewCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const { data: jobsRes } = await api.get('/jobs?status=open&limit=10&sort=newest');
        const jobs = jobsRes.jobs || jobsRes || [];
        if (!jobs.length) {
          if (cancelled) return;
          setData({
            jobTitle: 'Kitchen sink replacement',
            location: 'Local area',
            bids: [
              { name: 'Mike R.', initial: 'M', badge: '\u2713 Licensed', amt: '$185', stars: 5 },
              { name: 'Sarah T.', initial: 'S', badge: '\u2713 Insured', amt: '$210', stars: 4 },
              { name: 'James L.', initial: 'J', badge: '\u2713 Verified', amt: '$165', stars: 5 },
            ],
          });
          setNewCount(3);
          return;
        }

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
            // skip
          }
        }

        if (!chosenJob) chosenJob = jobs[0];
        if (cancelled) return;

        const formattedBids = liveBids.slice(0, 3).map((b) => {
          const helperName = b.helper_name || b.helper?.name || b.bidder_name || 'Helper';
          const initial = helperName.charAt(0).toUpperCase();
          const firstLast =
            helperName.split(' ').length >= 2
              ? `${helperName.split(' ')[0].charAt(0)}. ${helperName.split(' ').slice(-1)[0]}`
              : helperName;
          const badge = b.is_licensed ? '✓ Licensed' : b.is_insured ? '✓ Insured' : '✓ Verified';
          const amt = b.amount != null ? `$${Number(b.amount).toLocaleString()}` : b.bid_amount != null ? `$${Number(b.bid_amount).toLocaleString()}` : '—';
          const stars = Math.min(5, Math.max(1, Math.round(b.helper_rating || b.rating || 4)));
          return { name: firstLast, initial, badge, amt, stars };
        });

        const location =
          chosenJob.city && chosenJob.state
            ? `${chosenJob.city}, ${chosenJob.state}`
            : chosenJob.location || chosenJob.zip_code || 'Local area';

        setData({ jobTitle: chosenJob.title || chosenJob.category || 'Local job', location, bids: formattedBids });
        setNewCount(Math.min(liveBids.length, 9));
      } catch {
        // silently fail
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return { preview: data, newCount };
}

/** Homepage search bar with live skill autocomplete */
function HomeSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Filter SKILL_TILES based on query
  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const matches = SKILL_TILES.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.desc.toLowerCase().includes(q) ||
        t.slug.includes(q)
    );
    setSuggestions(matches);
    setOpen(matches.length > 0);
    setActiveIdx(-1);
  }, [query]);

  function handleSubmit(e) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    // If an active suggestion is selected use that slug, otherwise free-text search
    if (activeIdx >= 0 && suggestions[activeIdx]) {
      navigate(`/helpers?skill=${suggestions[activeIdx].slug}`);
    } else {
      navigate(`/helpers?q=${encodeURIComponent(q)}`);
    }
    setOpen(false);
  }

  function handleKeyDown(e) {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActiveIdx(-1);
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      navigate(`/helpers?skill=${suggestions[activeIdx].slug}`);
      setQuery(suggestions[activeIdx].name);
      setOpen(false);
    }
  }

  function handleSelect(tile) {
    navigate(`/helpers?skill=${tile.slug}`);
    setQuery('');
    setOpen(false);
  }

  // Close dropdown on outside click
  useEffect(() => {
    function onOutside(e) {
      if (inputRef.current && !inputRef.current.closest('.hp-search-wrap').contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  return (
    <div className="hp-search-wrap" role="search">
      <form className="hp-search-form" onSubmit={handleSubmit} autoComplete="off">
        <label htmlFor="hp-search-input" className="sr-only">Search for a service or skill</label>
        <span className="hp-search-icon" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </span>
        <input
          ref={inputRef}
          id="hp-search-input"
          className="hp-search-input"
          type="text"
          placeholder="What do you need done? e.g. plumbing, lawn care…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onKeyDown={handleKeyDown}
          aria-autocomplete="list"
          aria-controls="hp-search-suggestions"
          aria-activedescendant={activeIdx >= 0 ? `hp-sugg-${activeIdx}` : undefined}
          aria-expanded={open}
        />
        {query && (
          <button
            type="button"
            className="hp-search-clear"
            aria-label="Clear search"
            onClick={() => { setQuery(''); setOpen(false); inputRef.current?.focus(); }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        )}
        <button type="submit" className="hp-btn hp-btn-primary hp-search-btn">
          Search
        </button>
      </form>

      {open && (
        <ul
          id="hp-search-suggestions"
          className="hp-search-suggestions"
          ref={listRef}
          role="listbox"
          aria-label="Skill suggestions"
        >
          {suggestions.map((tile, i) => (
            <li
              key={tile.slug}
              id={`hp-sugg-${i}`}
              role="option"
              aria-selected={i === activeIdx}
              className={`hp-search-suggestion${i === activeIdx ? ' hp-search-suggestion--active' : ''}`}
              onMouseDown={() => handleSelect(tile)}
            >
              <span className="hp-sugg-icon">{tile.icon}</span>
              <span className="hp-sugg-text">
                <span className="hp-sugg-name">{tile.name}</span>
                <span className="hp-sugg-desc">{tile.desc}</span>
              </span>
              <span className="hp-sugg-arrow" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function HomePage() {
  const { preview, newCount } = useLiveBidsPreview();
  const { user, logout } = useAuth();
  const [skillsExpanded, setSkillsExpanded] = useState(false);
  const skillsOverflowRef = useRef(null);

  const jobTitle  = preview?.jobTitle  ?? '…';
  const location  = preview?.location  ?? '—';
  const bids      = preview?.bids      ?? [];
  const badgeLabel = newCount > 0 ? `${newCount} new` : 'Live';

  return (
    <PageShell>
    <div className="hp-root">
      <PageMeta
        title="OxSteed — Hire Local Help Today"
        description="Post a job, compare bids from verified local helpers, and pay securely via OxSteed. Free to start."
        url="https://oxsteed.com"
      />



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
            Describe what needs doing, set your own requirements, and let qualified local helpers bid. Compare proposals and pay securely with OxSteed. Free to start.
          </p>

          {/* ── Search bar ── */}
          <HomeSearch />

          <div className="hp-hero-ctas">
            {user ? (
              <>
                <Link
                  to={user.role === 'helper' ? '/jobs' : '/post-job'}
                  className="hp-btn hp-btn-primary hp-btn-lg"
                >
                  {user.role === 'helper' ? 'Browse Jobs' : 'Post a Job'}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
                </Link>
                <Link to="/dashboard" className="hp-btn hp-btn-outline hp-btn-lg">
                  Go to Dashboard
                </Link>
              </>
            ) : (
              <>
                <Link to="/register/customer" className="hp-btn hp-btn-primary hp-btn-lg">
                  Post a Job
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
                </Link>
                <Link to="/jobs" className="hp-btn hp-btn-outline hp-btn-lg">
                  Browse Listings
                </Link>
              </>
            )}
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
              : [0, 1, 2].map(i => (
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
            <p className="hp-section-sub">Find a local helpers for the exact job you need done.</p>
          </div>

          {/* Preview: first 5 cards always visible */}
          <div className="hp-cat-grid">
            {SKILL_TILES.slice(0, 5).map(tile => (
              <Link key={tile.slug} to={`/helpers?skill=${tile.slug}`} className="hp-cat-card">
                <span className="hp-cat-icon">{tile.icon}</span>
                <div className="hp-cat-name">{tile.name}</div>
                <div className="hp-cat-desc">{tile.desc}</div>
              </Link>
            ))}
          </div>

          {/* Overflow: remaining 15 cards + fallback note, animated */}
          <div
            id="hp-skills-overflow"
            ref={skillsOverflowRef}
            className="hp-skills-overflow"
            style={{
              maxHeight: skillsExpanded
                ? (skillsOverflowRef.current?.scrollHeight ?? 9999) + 'px'
                : '0px',
              opacity: skillsExpanded ? 1 : 0,
            }}
            aria-hidden={!skillsExpanded}
          >
            <div className="hp-cat-grid" style={{ paddingTop: '1rem' }}>
              {SKILL_TILES.slice(5).map(tile => (
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

          {/* Toggle button */}
          <div className="hp-skills-toggle-wrap">
            <button
              className="hp-skills-toggle"
              onClick={() => setSkillsExpanded(e => !e)}
              aria-expanded={skillsExpanded}
              aria-controls="hp-skills-overflow"
            >
              {skillsExpanded ? 'Show fewer' : `Show ${SKILL_TILES.length - 4} more skills`}
              <svg
                className={`hp-skills-chevron${skillsExpanded ? ' hp-skills-chevron--up' : ''}`}
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
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
                List your services for free on your local board, or subscribe to Pro for priority placement. You set your own rates, hours, and service area.
              </p>
            </div>
            <div className="hp-cta-actions">
              {user?.role === 'helper' ? (
                <Link to="/dashboard" className="hp-btn hp-btn-primary hp-btn-lg">
                  Go to Dashboard
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
                </Link>
              ) : (
                <>
                  <Link to={user ? '/dashboard' : '/register/helper'} className="hp-btn hp-btn-primary hp-btn-lg">
                    {user ? 'View Dashboard' : 'List Your Skills'}
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
                  </Link>
                  <Link to={user?.role === 'customer' ? '/post-job' : '/register/customer'} className="hp-btn hp-btn-outline hp-btn-lg">
                    {user?.role === 'customer' ? 'Post a Job' : 'Post a Job Instead'}
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

    </div>
    </PageShell>
  );
}
