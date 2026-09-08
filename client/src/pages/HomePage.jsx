import { Link, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import '../styles/HomePage.css';
import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import Hero from '../components/Hero';
import LiveHelpersHeroCard from '../components/LiveHelpersHeroCard';
import { LAUNCH_VISIBILITY } from '../utils/launchScope';

const SHOW_DISCOVER_SEARCH_TAB = LAUNCH_VISIBILITY.discoverEverything;
const SHOW_BUSINESS_ASCENSION_CONSULTING = LAUNCH_VISIBILITY.businessAscension;

const SKILL_SLUGS = [
  { slug: 'electrical',   icon: '⚡' },
  { slug: 'plumbing',     icon: '🚿' },
  { slug: 'hvac',         icon: '❄️' },
  { slug: 'carpentry',    icon: '🪚' },
  { slug: 'painting',     icon: '🖌️' },
  { slug: 'roofing',      icon: '🏠' },
  { slug: 'flooring',     icon: '🪵' },
  { slug: 'landscaping',  icon: '🌿' },
  { slug: 'moving',       icon: '🚚' },
  { slug: 'cleaning',     icon: '✨' },
  { slug: 'pest-control', icon: '🐛' },
  { slug: 'auto',         icon: '🚗' },
  { slug: 'appliance',    icon: '🔌' },
  { slug: 'concrete',     icon: '🏗️' },
  { slug: 'welding',      icon: '⚙️' },
  { slug: 'home-repair',  icon: '🔨' },
  { slug: 'security',     icon: '🔒' },
  { slug: 'pet-care',     icon: '🐾' },
  { slug: 'tutoring',     icon: '📚' },
];

const OXSTEED_SERVICE_PROFILE = {
  companyName: 'OxSteed',
  headline: 'Food, tools, and local service work under one company.',
  startingPrice: '$100 minimum',
  availability: 'Monday through Thursday',
  baseCity: 'Springfield, OH',
  serviceTypes: [
    'Home help',
    'Tool-based jobs',
    'Delivery and hauling',
    'Cleanup and setup',
  ],
  toolList: [
    'Truck and hauling gear',
    'Power drill and bit set',
    'Ladders and step stools',
    'Pressure washer',
    'Hand tools and repair kit',
    'Measuring and layout tools',
    'Cleanup and janitorial supplies',
    'Phone and photo inspection kit',
  ],
  travelCities: [
    'Springfield',
    'Dayton',
    'Columbus',
    'Beavercreek',
    'Fairborn',
    'Urbana',
  ],
};

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

function HomeCompanySection() {
  const { t } = useTranslation();
  const profile = OXSTEED_SERVICE_PROFILE;
  return (
    <section className="hp-section hp-company-section">
      <div className="hp-container">
        <div className="hp-company-card">
          <div className="hp-company-hero">
            <div className="hp-company-copy">
              <p className="hp-company-kicker">
                {t('homePage.company.kicker', { defaultValue: 'OxSteed as a company' })}
              </p>
              <div className="hp-company-title-row">
                <span className="hp-company-logo" aria-hidden="true">
                  <OxSteedIcon size={54} />
                </span>
                <h2 className="hp-company-title">
                  {t('homePage.company.heading', { defaultValue: profile.companyName })}
                </h2>
              </div>
              <p className="hp-company-subcopy">
                {t('homePage.company.subcopy', { defaultValue: profile.headline })}
              </p>
              <div className="hp-company-meta">
                <span>{t('homePage.company.price', { defaultValue: profile.startingPrice })}</span>
                <span>•</span>
                <span>{t('homePage.company.availability', { defaultValue: profile.availability })}</span>
                <span>•</span>
                <span>{t('homePage.company.serviceArea', { defaultValue: `${profile.baseCity} - service within 60 miles` })}</span>
              </div>
            </div>
          </div>

          <div className="hp-company-grid">
            <div className="hp-company-panel">
              <h3>{t('homePage.company.services', { defaultValue: 'Services' })}</h3>
              <div className="hp-chip-grid">
                {profile.serviceTypes.map((item, index) => (
                  <span key={item} className="hp-chip hp-chip--warm">
                    {index === 0 ? t('homePage.company.serviceTypes.homeHelp', { defaultValue: item }) : index === 1 ? t('homePage.company.serviceTypes.toolBased', { defaultValue: item }) : index === 2 ? t('homePage.company.serviceTypes.delivery', { defaultValue: item }) : t('homePage.company.serviceTypes.cleanup', { defaultValue: item })}
                  </span>
                ))}
              </div>
            </div>

            <div className="hp-company-panel">
              <h3>{t('homePage.company.tools', { defaultValue: 'Tools' })}</h3>
              <div className="hp-chip-grid">
                {profile.toolList.map((item) => (
                  <span key={item} className="hp-chip hp-chip--cool">{item}</span>
                ))}
              </div>
            </div>

            <div className="hp-company-panel hp-company-panel--wide">
              <h3>{t('homePage.company.travelCities', { defaultValue: 'Travel cities' })}</h3>
              <div className="hp-chip-grid">
                {profile.travelCities.map((item) => (
                  <span key={item} className="hp-chip hp-chip--blue">{item}</span>
                ))}
              </div>
            </div>
          </div>

          <div className="hp-company-actions">
            <Link to="/direct/request-quote" className="hp-btn hp-btn-primary hp-btn-lg hp-company-btn">
              {t('homePage.company.requestQuote', { defaultValue: 'Request a quote' })}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </Link>
            <Link to="/direct/view-quote" className="hp-btn hp-btn-outline hp-btn-lg hp-company-btn-secondary">
              {t('homePage.company.viewQuote', { defaultValue: 'View quote' })}
            </Link>
            <Link to="/direct/service-area" className="hp-btn hp-btn-outline hp-btn-lg hp-company-btn-secondary">
              {t('homePage.company.checkServiceArea', { defaultValue: 'Check service area' })}
            </Link>
            <Link to="/direct/services" className="hp-btn hp-btn-outline hp-btn-lg hp-company-btn-secondary">
              {t('homePage.company.viewServices', { defaultValue: 'View services' })}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}


const SEARCH_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
);
const PIN_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
  </svg>
);
const CLEAR_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

/**
 * Homepage search bar - v2
 *
 * Features:
 *  1. Mode toggle: "Find a Helper" navigates /helpers; "Browse Jobs" navigates /jobs
 *  2. Location field with autocomplete from /api/geo/suggest; auto-detects via
 *     browser geolocation (defaults to 60-mile radius)
 *  3. "Available today" quick-toggle pill
 *  4. Live DB skill autocomplete from /api/helpers/skills, falls back to
 *     the hardcoded SKILL_TILES list
 */
function HomeSearch() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const SKILL_TILES = SKILL_SLUGS.map(s => ({
    ...s,
    name: t(`homePage.skills.tiles.${s.slug}.name`),
    desc: t(`homePage.skills.tiles.${s.slug}.desc`),
  }));

  // ── Mode ──────────────────────────────────────────────────────────────────
  const [mode, setMode] = useState('helpers'); // 'helpers' | 'jobs' | 'discover'

  // ── Query / skill autocomplete ────────────────────────────────────────────
  const [query, setQuery]             = useState('');
  const [skillSugg, setSkillSugg]     = useState([]);
  const [skillsOpen, setSkillsOpen]   = useState(false);
  const [skillIdx, setSkillIdx]       = useState(-1);

  // ── Location ──────────────────────────────────────────────────────────────
  const [locInput, setLocInput]       = useState('');
  const [locCoords, setLocCoords]     = useState({ lat: null, lng: null });
  const [locSugg, setLocSugg]         = useState([]);
  const [locOpen, setLocOpen]         = useState(false);

  // ── Available today toggle ────────────────────────────────────────────────
  const [availToday, setAvailToday]   = useState(false);

  const wrapRef          = useRef(null);
  const queryRef         = useRef(null);
  const locInputRef      = useRef(null);
  const userHasTypedLoc  = useRef(false);   // guard: don't overwrite after user types

  // ── Geolocation on mount (helpers + discover use location radius) ────────
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      async ({ coords: { latitude: lat, longitude: lng } }) => {
        // Only apply the geocoded label if the user hasn't started typing
        if (userHasTypedLoc.current) return;
        setLocCoords({ lat, lng });
        try {
          const { data } = await api.get('/geo/reverse', { params: { lat, lng } });
          if (!userHasTypedLoc.current) setLocInput(data.display || t('homePage.search.nearYou'));
        } catch {
          if (!userHasTypedLoc.current) setLocInput(t('homePage.search.nearYou'));
        }
      },
      () => {},            // silently ignore denied / unavailable
      { timeout: 5000, maximumAge: 600000 },
    );
  }, []);

  // ── Skill autocomplete: instant local + deferred DB ───────────────────────
  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!q) { setSkillSugg([]); setSkillsOpen(false); return; }

    const local = SKILL_TILES.filter(
      (t) => t.name.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q) || t.slug.includes(q),
    );
    // Bug fixes: reset index on every suggestion change; clear stale list immediately
    // when no local matches so the old list doesn't linger during the DB fetch delay.
    if (local.length) {
      setSkillSugg(local.slice(0, 8));
      setSkillsOpen(true);
      setSkillIdx(-1);
    } else {
      setSkillSugg([]);
      setSkillsOpen(false);
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get('/helpers/skills', { params: { q, limit: 8 } });
        if (cancelled) return;
        const dbSkills = (data.skills || []).map((s) => ({
          slug: s.name.toLowerCase().replace(/[\s/]+/g, '-'),
          icon: '🔍',
          name: s.name,
          desc: s.category || '',
          fromDb: true,
        }));
        const dbNames = new Set(dbSkills.map((s) => s.name.toLowerCase()));
        const combined = [
          ...dbSkills,
          ...local.filter((s) => !dbNames.has(s.name.toLowerCase())),
        ].slice(0, 8);
        setSkillSugg(combined);
        setSkillsOpen(combined.length > 0);
        setSkillIdx(-1);
      } catch { /* keep local suggestions */ }
    }, 220);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  // ── Location autocomplete ─────────────────────────────────────────────────
  useEffect(() => {
    const q = locInput.trim();
    // Don't re-fetch if the value matches the already-resolved label
    if (!q || q.length < 2 || (locCoords.lat !== null)) {
      setLocSugg([]); setLocOpen(false); return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get('/geo/suggest', { params: { q } });
        if (cancelled) return;
        setLocSugg(data || []);
        setLocOpen((data || []).length > 0);
      } catch {}
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [locInput, locCoords.lat]);

  // ── Close all dropdowns on outside click ──────────────────────────────────
  useEffect(() => {
    function handler(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setSkillsOpen(false);
        setLocOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Helpers: build URLSearchParams from current state ─────────────────────
  // DB-sourced skills have dynamically generated slugs that won't match any
  // SKILL_TILES id on the directory page, so route them via ?q= (text search)
  // instead of ?skill= (tile lookup).
  function addSkillOrQuery(p, tile) {
    if (!tile) return;
    if (tile.fromDb) {
      p.set('q', tile.name);
    } else {
      p.set('skill', tile.slug);
    }
  }

  function buildHelperParams(overrideTile) {
    const p = new URLSearchParams();
    if (overrideTile) {
      addSkillOrQuery(p, overrideTile);
    } else if (skillIdx >= 0 && skillSugg[skillIdx]) {
      addSkillOrQuery(p, skillSugg[skillIdx]);
    } else if (query.trim()) {
      p.set('q', query.trim());
    }
    if (locCoords.lat !== null && locCoords.lng !== null) {
      p.set('lat', locCoords.lat.toFixed(6));
      p.set('lng', locCoords.lng.toFixed(6));
      p.set('radius', '60');
    }
    if (availToday) p.set('availableToday', 'true');
    return p;
  }

  function handleSubmit(e) {
    e.preventDefault();
    setSkillsOpen(false);
    setLocOpen(false);
    if (mode === 'jobs') {
      const q = query.trim();
      navigate(`/jobs${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      return;
    }
    if (mode === 'discover') {
      const p = new URLSearchParams();
      const qv = query.trim();
      if (qv) p.set('q', qv);
      p.set('radius', '60');
      if (locCoords.lat !== null && locCoords.lng !== null) {
        p.set('lat', locCoords.lat.toFixed(6));
        p.set('lng', locCoords.lng.toFixed(6));
      }
      navigate(`/discover?${p.toString()}`);
      return;
    }
    navigate(`/helpers?${buildHelperParams().toString()}`);
  }

  function handleSelectSkill(tile) {
    navigate(`/helpers?${buildHelperParams(tile).toString()}`);
    setQuery('');
    setSkillsOpen(false);
  }

  function handleSelectLocation(loc) {
    setLocInput(loc.display);
    setLocCoords({ lat: loc.lat, lng: loc.lng });
    setLocSugg([]);
    setLocOpen(false);
  }

  function handleQueryKeyDown(e) {
    if (!skillsOpen) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setSkillIdx((i) => Math.min(i + 1, skillSugg.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSkillIdx((i) => Math.max(i - 1, -1)); }
    else if (e.key === 'Escape') { setSkillsOpen(false); setSkillIdx(-1); }
    else if (e.key === 'Enter' && skillIdx >= 0) { e.preventDefault(); handleSelectSkill(skillSugg[skillIdx]); }
  }

  return (
    <div className="hp-search-wrap" ref={wrapRef} role="search">

      {/* ── Mode tabs ─────────────────────────────────────────────────────── */}
      <div className="hp-search-tabs" role="tablist" aria-label={t('homePage.search.searchMode')}>
        <button
          type="button" role="tab" aria-selected={mode === 'helpers'}
          className={`hp-search-tab${mode === 'helpers' ? ' hp-search-tab--active' : ''}`}
          onClick={() => setMode('helpers')}
        >
          {t('homePage.search.findHelper')}
        </button>
        <button
          type="button" role="tab" aria-selected={mode === 'jobs'}
          className={`hp-search-tab${mode === 'jobs' ? ' hp-search-tab--active' : ''}`}
          onClick={() => setMode('jobs')}
        >
          {t('homePage.search.browseJobs')}
        </button>
        {SHOW_DISCOVER_SEARCH_TAB && (
          <button
            type="button" role="tab" aria-selected={mode === 'discover'}
            className={`hp-search-tab${mode === 'discover' ? ' hp-search-tab--active' : ''}`}
            onClick={() => setMode('discover')}
          >
            {t('homePage.search.discoverAll')}
          </button>
        )}
      </div>

      {/* ── Search form ───────────────────────────────────────────────────── */}
      <form className="hp-search-form" onSubmit={handleSubmit} autoComplete="off">

        {/* Query field */}
        <div className="hp-search-field hp-search-field--query">
          <span className="hp-search-icon">{SEARCH_ICON}</span>
          <label htmlFor="hp-search-input" className="sr-only">
            {mode === 'helpers'
              ? t('homePage.search.helperLabel')
              : mode === 'discover'
                ? t('homePage.search.discoverLabel')
                : t('homePage.search.jobsLabel')}
          </label>
          <input
            ref={queryRef}
            id="hp-search-input"
            className="hp-search-input"
            type="text"
            placeholder={
              mode === 'helpers'
                ? t('homePage.search.helperPh')
                : mode === 'discover'
                  ? t('homePage.search.discoverPh')
                  : t('homePage.search.jobsPh')
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => mode === 'helpers' && skillSugg.length > 0 && setSkillsOpen(true)}
            onKeyDown={handleQueryKeyDown}
            aria-autocomplete="list"
            aria-controls="hp-skill-sugg"
            aria-activedescendant={skillIdx >= 0 ? `hp-sugg-${skillIdx}` : undefined}
            aria-expanded={skillsOpen}
          />
          {query && (
            <button type="button" className="hp-search-clear" aria-label={t('homePage.search.clearSearch')}
              onClick={() => { setQuery(''); setSkillsOpen(false); queryRef.current?.focus(); }}>
              {CLEAR_ICON}
            </button>
          )}
        </div>

        {/* Location field - helpers + discover (60 mi radius) */}
        {(mode === 'helpers' || mode === 'discover') && (
          <div className="hp-search-field hp-search-field--loc">
            <span className="hp-search-icon">{PIN_ICON}</span>
            <input
              ref={locInputRef}
              className="hp-search-input"
              type="text"
              placeholder={t('homePage.search.locationPh')}
              value={locInput}
              onChange={(e) => { userHasTypedLoc.current = true; setLocInput(e.target.value); setLocCoords({ lat: null, lng: null }); }}
              onFocus={() => locSugg.length > 0 && setLocOpen(true)}
              onKeyDown={(e) => { if (e.key === 'Escape') setLocOpen(false); }}
              aria-label={t('homePage.search.locationLabel')}
              aria-autocomplete="list"
              aria-expanded={locOpen}
            />
            {locInput && (
              <button type="button" className="hp-search-clear" aria-label={t('homePage.search.clearLocation')}
                onClick={() => { setLocInput(''); setLocCoords({ lat: null, lng: null }); setLocSugg([]); setLocOpen(false); locInputRef.current?.focus(); }}>
                {CLEAR_ICON}
              </button>
            )}
            {locOpen && locSugg.length > 0 && (
              <ul className="hp-search-suggestions hp-loc-suggestions" role="listbox" aria-label={t('homePage.search.locationSuggestions')}>
                {locSugg.map((loc, i) => (
                  <li key={i} role="option" className="hp-search-suggestion" onMouseDown={() => handleSelectLocation(loc)}>
                    <span className="hp-sugg-icon">📍</span>
                    <span className="hp-sugg-text">
                      <span className="hp-sugg-name">{loc.display}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Available today toggle - helpers mode only */}
        {mode === 'helpers' && (
          <button
            type="button"
            className={`hp-avail-toggle${availToday ? ' hp-avail-toggle--on' : ''}`}
            onClick={() => setAvailToday((t) => !t)}
            aria-pressed={availToday}
            title={t('homePage.search.availTodayTitle')}
          >
            <span className={`hp-avail-dot${availToday ? ' hp-avail-dot--on' : ''}`} aria-hidden="true" />
            {t('homePage.search.availToday')}
          </button>
        )}

        <button type="submit" className="hp-btn hp-btn-primary hp-search-btn">
          {mode === 'jobs'
            ? t('homePage.search.findJobs')
            : mode === 'discover'
              ? t('homePage.search.discoverSearch')
              : t('homePage.search.search')}
        </button>
      </form>

      {/* ── Skill suggestions dropdown ────────────────────────────────────── */}
      {mode === 'helpers' && skillsOpen && skillSugg.length > 0 && (
        <ul id="hp-skill-sugg" className="hp-search-suggestions" role="listbox" aria-label={t('homePage.search.skillSuggestions')}>
          {skillSugg.map((tile, i) => (
            <li
              key={`${tile.slug}-${i}`}
              id={`hp-sugg-${i}`}
              role="option"
              aria-selected={i === skillIdx}
              className={`hp-search-suggestion${i === skillIdx ? ' hp-search-suggestion--active' : ''}`}
              onMouseDown={() => handleSelectSkill(tile)}
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
  const { user, logout } = useAuth();
  const { t } = useTranslation();
  const [skillsExpanded, setSkillsExpanded] = useState(false);
  const skillsOverflowRef = useRef(null);

  const SKILL_TILES = SKILL_SLUGS.map(s => ({
    ...s,
    name: t(`homePage.skills.tiles.${s.slug}.name`),
    desc: t(`homePage.skills.tiles.${s.slug}.desc`),
  }));

  return (
    <PageShell>
    <div className="hp-root">
      <PageMeta url="https://oxsteed.com/" />



      {/* -- Hero -- */}
      <section className="hp-hero">
        <Hero search={<HomeSearch />} />

        {/* Hero live helpers near you card - now interactive infinite scroll */}
        <LiveHelpersHeroCard />
      </section>

      {/* -- Browse by Skills -- */}
      <HomeCompanySection />
      <section className="hp-section">
        <div className="hp-container">
          <div className="hp-section-head">
            <h2 className="hp-section-title">{t('homePage.skills.sectionTitle')}</h2>
            <p className="hp-section-sub">{t('homePage.skills.sectionSubtitle')}</p>
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
              {t('homePage.skills.dontSeeSkill')}{' '}
              <Link to="/register/customer" className="hp-text-link">{t('homePage.skills.postJobLink')}</Link>
              {' '}{t('homePage.skills.dontSeeEnd')}
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
              {skillsExpanded ? t('homePage.skills.showFewer') : t('homePage.skills.showMore', { count: SKILL_TILES.length - 4 })}
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

      {/* -- Business Ascension Consulting Section -- */}
      {SHOW_BUSINESS_ASCENSION_CONSULTING && (
      <section className="hp-section hp-consulting-section">
        <div className="hp-container">
          <div className="hp-consulting-intro">
            <h2 className="hp-consulting-title">{t('homePage.consulting.heading')}</h2>
            <p className="hp-consulting-subcopy">
              {t('homePage.consulting.subcopy')}
            </p>
          </div>
          <div className="hp-consulting-grid">
            <div className="hp-consulting-block" style={{'--icon': '👥'}}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--hp-primary)', opacity: 0.7, marginBottom: '0.5rem' }} aria-hidden="true">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              </svg>
              <h3 className="hp-consulting-subtitle">{t('homePage.consulting.subtitle1')}</h3>
              <p className="hp-consulting-text">{t('homePage.consulting.desc1')}</p>
            </div>
            <div className="hp-consulting-block" style={{'--icon': '🚀'}}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--hp-primary)', opacity: 0.7, marginBottom: '0.5rem' }} aria-hidden="true">
                <path d="M4.5 16.5c-1.5-1.26-2-5-2-8.5a9 9 0 0 1 18 0c0 3.5-.5 7.26-2 8.5M12 8v5M8 13h8"/>
              </svg>
              <h3 className="hp-consulting-subtitle">{t('homePage.consulting.subtitle2')}</h3>
              <p className="hp-consulting-text">{t('homePage.consulting.desc2')}</p>
            </div>
          </div>
          <div className="hp-consulting-cta">
            <div>
              <Link
                to="/direct/request-quote"
                className="hp-btn hp-btn-primary hp-btn-lg hp-consulting-btn"
                style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
              >
                {t('homePage.consulting.ctaButton')}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
              </Link>
              <p className="hp-consulting-price">{t('homePage.consulting.ctaPrice')}</p>
            </div>
            <p className="hp-consulting-subtext">{t('homePage.consulting.ctaSubtext')}</p>
          </div>
        </div>
      </section>
      )}

      {/* -- Helper CTA -- */}
      <section className="hp-section hp-cta-section">
        <div className="hp-container">
          <div className="hp-cta-inner">
            <div className="hp-cta-text">
              <h2 className="hp-cta-title">{t('homePage.cta.title')}<br /><em>{t('homePage.cta.titleEm')}</em></h2>
              <p className="hp-cta-desc">
                {t('homePage.cta.desc')}
              </p>
            </div>
            <div className="hp-cta-actions">
              {user?.role === 'helper' ? (
                <Link to="/dashboard" className="hp-btn hp-btn-primary hp-btn-lg">
                  {t('homePage.cta.goToDashboard')}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
                </Link>
              ) : (
                <>
                  <Link to={user ? '/dashboard' : '/register/helper'} className="hp-btn hp-btn-primary hp-btn-lg">
                    {user ? t('homePage.cta.viewDashboard') : t('homePage.cta.listSkills')}
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
                  </Link>
                  <Link to={user?.role === 'customer' ? '/post-job' : '/register/customer'} className="hp-btn hp-btn-outline hp-btn-lg">
                    {user?.role === 'customer' ? t('homePage.cta.postJob') : t('homePage.cta.postJobInstead')}
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
