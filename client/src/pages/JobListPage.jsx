import { useEffect, useRef, useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import useJobs from '../hooks/useJobs';
import useAuth from '../hooks/useAuth';
import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';
import CountrySelect from '../components/CountrySelect';
import RegionInput from '../components/RegionInput';
import '../styles/JobListPage.css';
import { useTranslation } from 'react-i18next';
import { detectCountryFromLocale } from '../lib/countries';

const CATEGORIES = [
  { name: 'Handyman' },
  { name: 'Plumbing' },
  { name: 'Electrical' },
  { name: 'Cleaning' },
  { name: 'Moving' },
  { name: 'Painting' },
  { name: 'Landscaping' },
  { name: 'Yard Work' },
  { name: 'Tool Rental' },
  { name: 'General Labor' },
  { name: 'Other' },
];



/** Defensive budget formatting — handles missing, partial, and malformed data */
function formatBudget(min, max) {
  const hasMin = min != null && min !== '' && !isNaN(Number(min)) && Number(min) > 0;
  const hasMax = max != null && max !== '' && !isNaN(Number(max)) && Number(max) > 0;

  if (!hasMin && !hasMax) return 'Budget TBD';
  if (hasMin && !hasMax) return `From $${Number(min).toLocaleString()}`;
  if (!hasMin && hasMax) return `Up to $${Number(max).toLocaleString()}`;
  if (Number(min) === Number(max)) return `$${Number(min).toLocaleString()}`;
  return `$${Number(min).toLocaleString()} – $${Number(max).toLocaleString()}`;
}

/** Defensive location formatting */
function formatLocation(city, state) {
  if (city && state) return `${city}, ${state}`;
  if (city) return city;
  if (state) return state;
  return 'Location TBD';
}

/** Map priority to badge variant */
function priorityBadge(priority) {
  const p = (priority || 'normal').toLowerCase();
  if (p === 'urgent' || p === 'asap') return { cls: 'ox-badge ox-badge-error', label: p };
  if (p === 'high') return { cls: 'ox-badge ox-badge-warning', label: p };
  return { cls: 'ox-badge ox-badge-default', label: p };
}

export default function JobListPage() {
  const { t } = useTranslation();
  const { jobs, loading, error, pagination, fetchJobs } = useJobs();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Default state filter to logged-in helper's state (persisted in localStorage)
  const defaultState = user?.role === 'helper' && user?.state
    ? user.state
    : (localStorage.getItem('jlp_state_filter') || '');
  // Country filter — prefer the user's record, then localStorage, then locale.
  const defaultCountry = user?.country
    || localStorage.getItem('jlp_country_filter')
    || detectCountryFromLocale('US');

  const [filters, setFilters] = useState(() => ({
    q: searchParams.get('q') || '',
    category: '',
    city: '',
    country: defaultCountry,
    state: defaultState,
    sort: 'newest',
    page: 1,
  }));
  // Separate display state for the q input so we can debounce API calls
  const [qInput, setQInput] = useState(searchParams.get('q') || '');
  const qDebounceRef = useRef(null);
  const [tourView, setTourView] = useState('customer');

  useEffect(() => {
    fetchJobs(filters);
  }, [filters, fetchJobs]);

  const handleFilter = (key, value) => {
    if (key === 'state')   localStorage.setItem('jlp_state_filter', value);
    if (key === 'country') localStorage.setItem('jlp_country_filter', value);
    setFilters(prev => {
      // Changing the country invalidates the current state filter — they're
      // country-specific.
      if (key === 'country') {
        return { ...prev, country: value, state: '', page: 1 };
      }
      return { ...prev, [key]: value, page: 1 };
    });
  };

  const hasJobs = jobs && jobs.length > 0;

  return (
    <PageShell>
      <PageMeta
        title={t('jobList.metaTitle')}
        description="Find jobs in your area posted by homeowners and businesses. Bid on work that matches your skills and schedule."
        url="https://oxsteed.com/jobs"
      />

      <div className="ox-container">
        {/* ── Hero Section ── */}
        <section className="jlp-hero">
          <h1>{t('jobList.title')}</h1>
          <p className="jlp-hero-sub">
            Browse available jobs or post your own. Connect with local helpers in your area.
          </p>

          {/* Filter Bar */}
          <div className="jlp-filter-bar">
            <input
              type="search"
              className="ox-input"
              placeholder={t('jobList.searchPlaceholder')}
              value={qInput}
              onChange={e => {
                const val = e.target.value;
                setQInput(val);
                if (qDebounceRef.current) clearTimeout(qDebounceRef.current);
                qDebounceRef.current = setTimeout(() => handleFilter('q', val), 350);
              }}
              aria-label="Search jobs"
            />

            <select
              className="ox-select"
              value={filters.category}
              onChange={e => handleFilter('category', e.target.value)}
              aria-label="Filter by category"
            >
              <option value="">{t('jobList.allCategories')}</option>
              {CATEGORIES.map(c => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>

            <input
              type="text"
              className="ox-input"
              placeholder="Enter your city..."
              value={filters.city}
              onChange={e => handleFilter('city', e.target.value)}
              aria-label="Filter by city"
            />

            <CountrySelect
              className="ox-select"
              value={filters.country}
              onChange={(code) => handleFilter('country', code)}
              includeBlank={false}
              aria-label="Filter by country"
            />

            <RegionInput
              className="ox-select"
              country={filters.country}
              value={filters.state}
              onChange={(v) => handleFilter('state', v)}
              aria-label="Filter by state or region"
              placeholder={t('jobList.allStates')}
            />

            <select
              className="ox-select"
              value={filters.sort}
              onChange={e => handleFilter('sort', e.target.value)}
              aria-label="Sort jobs"
            >
              <option value="newest">{t('jobList.sortNewest')}</option>
              <option value="budget_high">{t('jobList.sortBudgetHigh')}</option>
              <option value="budget_low">{t('jobList.sortBudgetLow')}</option>
            </select>
          </div>

          {/* State filter indicator */}
          {filters.state && (
            <div className="jlp-state-indicator">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
              Showing jobs in {filters.state}
              <button className="jlp-state-clear" onClick={() => handleFilter('state', '')}>
                Show all states
              </button>
            </div>
          )}
        </section>

        {/* ── Category Chips ── */}
        <div className="jlp-chips" role="group" aria-label="Filter by category">
          <button
            className={`ox-chip ${filters.category === '' ? 'active' : ''}`}
            onClick={() => handleFilter('category', '')}
          >
            All
          </button>
          {CATEGORIES.map(c => (
            <button
              key={c.name}
              className={`ox-chip ${filters.category === c.name ? 'active' : ''}`}
              onClick={() => handleFilter('category', c.name)}
            >
              {c.name}
            </button>
          ))}
        </div>

        {/* ── Main Content ── */}
        <section className="jlp-content" aria-label="Job listings">
          {loading ? (
            <div className="jlp-loading">
              <div className="ox-spinner" />
              <p>{t('common.loading')}</p>
            </div>
          ) : error ? (
            <div className="jlp-error">
              <div className="jlp-error-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
              </div>
              <h2>{t('errors.generic')}</h2>
              <p>{t('errors.tryAgain')}</p>
              <button className="ox-btn ox-btn-primary" onClick={() => fetchJobs(filters)}>
                Try Again
              </button>
            </div>
          ) : hasJobs ? (
            <>
              <div className="jlp-grid">
                {jobs.map(job => {
                  const badge = priorityBadge(job.priority);
                  return (
                    <article
                      key={job.id}
                      className="jlp-job-card"
                      onClick={() => navigate(`/jobs/${job.id}`)}
                      role="link"
                      tabIndex={0}
                      aria-label={`${job.title} — ${formatBudget(job.budget_min, job.budget_max)}`}
                      onKeyDown={e => { if (e.key === 'Enter') navigate(`/jobs/${job.id}`); }}
                    >
                      <div className="jlp-card-header">
                        <span className={badge.cls}>{badge.label}</span>
                        <span className="jlp-bid-count">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
                            <circle cx="9" cy="7" r="4"/>
                            <path d="M23 21v-2a4 4 0 00-3-3.87"/>
                            <path d="M16 3.13a4 4 0 010 7.75"/>
                          </svg>
                          {job.bid_count ?? 0} bid{(job.bid_count ?? 0) !== 1 ? 's' : ''}
                        </span>
                      </div>

                      <h3 className="jlp-card-title">{job.title || 'Untitled Job'}</h3>
                      <p className="jlp-card-category">{job.category || 'General'}</p>
                      <p className="jlp-card-desc">
                        {job.description
                          ? (job.description.length > 140
                              ? job.description.substring(0, 140) + '…'
                              : job.description)
                          : 'No description provided.'}
                      </p>

                      <div className="jlp-card-footer">
                        <span className="jlp-card-budget">
                          {formatBudget(job.budget_min, job.budget_max)}
                        </span>
                        <span className="jlp-card-location">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                            <circle cx="12" cy="10" r="3"/>
                          </svg>
                          {formatLocation(job.location_city, job.location_state)}
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>

              {/* Pagination */}
              {pagination.total > pagination.limit && (
                <div className="jlp-pagination" role="navigation" aria-label="Job listings pagination">
                  {Array.from(
                    { length: Math.ceil(pagination.total / pagination.limit) },
                    (_, i) => (
                      <button
                        key={i}
                        className={`jlp-page-btn ${filters.page === i + 1 ? 'active' : ''}`}
                        onClick={() => setFilters(prev => ({ ...prev, page: i + 1 }))}
                        aria-label={`Page ${i + 1}`}
                        aria-current={filters.page === i + 1 ? 'page' : undefined}
                      >
                        {i + 1}
                      </button>
                    )
                  )}
                </div>
              )}
            </>
          ) : (
            /* Empty State */
            <div className="jlp-empty">
              <div className="jlp-empty-icon">
                <svg width="72" height="72" viewBox="0 0 80 80" fill="none" aria-hidden="true">
                  <rect x="10" y="20" width="60" height="45" rx="6" stroke="var(--color-primary)" strokeWidth="2" fill="none" />
                  <line x1="10" y1="35" x2="70" y2="35" stroke="var(--color-primary)" strokeWidth="2" opacity="0.4" />
                  <rect x="18" y="42" width="20" height="4" rx="2" fill="var(--color-primary)" opacity="0.3" />
                  <rect x="18" y="50" width="35" height="4" rx="2" fill="var(--color-primary)" opacity="0.2" />
                  <circle cx="58" cy="50" r="3" fill="var(--color-primary)" opacity="0.5" />
                </svg>
              </div>
              <h2>{t('jobList.noJobs')}</h2>
              <p>{t('jobList.noJobsSub')}</p>
              <div className="jlp-empty-actions">
                {user ? (
                  <button onClick={() => navigate('/post-job')} className="ox-btn ox-btn-primary ox-btn-lg">
                    Post a Job — It's Free
                  </button>
                ) : (
                  <>
                    <Link to="/register/customer" className="ox-btn ox-btn-primary ox-btn-lg">
                      Post Your First Job Free
                    </Link>
                    <Link to="/register/helper" className="ox-btn ox-btn-outline ox-btn-lg">
                      Join as a Helper
                    </Link>
                  </>
                )}
              </div>
            </div>
          )}
        </section>

        {/* ── How It Works ── */}
        <section className="jlp-how-section" aria-label="How OxSteed Works">
          <h2>How OxSteed Works</h2>

          <div className="jlp-tour-toggle">
            <button
              className={`jlp-tour-btn ${tourView === 'customer' ? 'active' : ''}`}
              onClick={() => setTourView('customer')}
            >
              I Need Help
            </button>
            <button
              className={`jlp-tour-btn ${tourView === 'helper' ? 'active' : ''}`}
              onClick={() => setTourView('helper')}
            >
              I'm a Helper
            </button>
          </div>

          {tourView === 'customer' ? (
            <div>
              <div className="jlp-steps">
                <div>
                  <div className="jlp-step-num">1</div>
                  <h3>Post What You Need</h3>
                  <p>Describe the job, set your budget, and your request goes live to local helpers instantly.</p>
                </div>
                <div>
                  <div className="jlp-step-num">2</div>
                  <h3>Compare & Choose</h3>
                  <p>Review bids, check helper profiles, compare offers, message helpers with questions.</p>
                </div>
                <div>
                  <div className="jlp-step-num">3</div>
                  <h3>Choose Your Helper</h3>
                  <p>Pick the one that fits your budget and schedule. You stay in control the whole way.</p>
                </div>
                <div>
                  <div className="jlp-step-num">4</div>
                  <h3>Get It Done</h3>
                  <p>Pay directly or pay via OxSteed for added protection. Rate your helper when complete.</p>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <div className="jlp-steps">
                <div>
                  <div className="jlp-step-num">1</div>
                  <h3>Create Your Profile</h3>
                  <p>Sign up for free, list your skills, and set your service area.</p>
                </div>
                <div>
                  <div className="jlp-step-num">2</div>
                  <h3>Get Verified</h3>
                  <p>Level up with background checks to win more jobs.</p>
                </div>
                <div>
                  <div className="jlp-step-num">3</div>
                  <h3>Browse & Bid</h3>
                  <p>Find jobs in your area, submit competitive bids, and stand out with your profile.</p>
                </div>
                <div>
                  <div className="jlp-step-num">4</div>
                  <h3>Get Paid</h3>
                  <p>Complete the job, collect payment directly or through OxSteed, and build your reputation.</p>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </PageShell>
  );
}
