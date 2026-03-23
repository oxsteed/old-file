import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import useJobs from '../hooks/useJobs';
import useAuth from '../hooks/useAuth';
import '../styles/JobListPage.css';

const CATEGORIES = [
  { name: 'Handyman', icon: '🛠️' },
  { name: 'Plumbing', icon: '🚰' },
  { name: 'Electrical', icon: '⚡' },
  { name: 'Cleaning', icon: '✨' },
  { name: 'Moving', icon: '🚚' },
  { name: 'Painting', icon: '🎨' },
  { name: 'Landscaping', icon: '🌿' },
  { name: 'Assembly', icon: '🔧' },
  { name: 'Other', icon: '📋' },
];

export default function JobListPage() {
  const { jobs, loading, error, pagination, fetchJobs } = useJobs();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ category: '', city: '', sort: 'newest', page: 1 });

  useEffect(() => { fetchJobs(filters); }, [filters, fetchJobs]);

  const handleFilter = (key, value) => setFilters(prev => ({ ...prev, [key]: value, page: 1 }));

  const hasJobs = jobs && jobs.length > 0;

  return (
    <div className="job-list-page">
      {/* Navbar */}
      <nav className="jlp-navbar">
        <Link to="/" className="jlp-logo">OxSteed</Link>
        <div className="jlp-nav-links">
          <Link to="/jobs" className="jlp-nav-active">Browse Jobs</Link>
          {user ? (
            <Link to="/dashboard" className="jlp-nav-link">Dashboard</Link>
          ) : (
            <Link to="/login" className="jlp-nav-link">Sign In</Link>
          )}
          {user && <button onClick={() => navigate('/post-job')} className="btn-primary">Post a Job</button>}
          {!user && <Link to="/register/customer" className="btn-primary">Get Started</Link>}
        </div>
      </nav>

      {/* Hero Section */}
      <div className="jlp-hero">
        <h1>Find Local Services Near You</h1>
        <p className="jlp-hero-sub">Browse available jobs or post your own. Connect with trusted local helpers in your area.</p>
        <div className="jlp-search-bar">
          <select value={filters.category} onChange={e => handleFilter('category', e.target.value)}>
            <option value="">All Categories</option>
            {CATEGORIES.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
          <input type="text" placeholder="Enter your city..." value={filters.city} onChange={e => handleFilter('city', e.target.value)} />
          <select value={filters.sort} onChange={e => handleFilter('sort', e.target.value)}>
            <option value="newest">Newest First</option>
            <option value="budget_high">Budget: High to Low</option>
            <option value="budget_low">Budget: Low to High</option>
          </select>
        </div>
      </div>

      {/* Category Pills */}
      <div className="jlp-categories">
        <button className={`jlp-cat-pill ${filters.category === '' ? 'active' : ''}`} onClick={() => handleFilter('category', '')}>All</button>
        {CATEGORIES.map(c => (
          <button key={c.name} className={`jlp-cat-pill ${filters.category === c.name ? 'active' : ''}`} onClick={() => handleFilter('category', c.name)}>
            <span className="jlp-cat-icon">{c.icon}</span> {c.name}
          </button>
        ))}
      </div>

      {/* Main Content */}
      <div className="jlp-content">
        {loading ? (
          <div className="jlp-loading">
            <div className="jlp-spinner"></div>
            <p>Loading jobs...</p>
          </div>
        ) : hasJobs ? (
          <>
            <div className="job-grid">
              {jobs.map(job => (
                <div key={job.id} className="job-card" onClick={() => navigate(`/jobs/${job.id}`)}>
                  <div className="job-card-header">
                    <span className={`priority-badge ${job.priority}`}>{job.priority}</span>
                    <span className="bid-count">{job.bid_count} bids</span>
                  </div>
                  <h3>{job.title}</h3>
                  <p className="job-category">{job.category}</p>
                  <p className="job-description">{job.description?.substring(0, 120)}...</p>
                  <div className="job-card-footer">
                    <span className="budget">${job.budget_min} - ${job.budget_max}</span>
                    <span className="location">{job.location_city}, {job.location_state}</span>
                  </div>
                </div>
              ))}
            </div>
            {pagination.total > pagination.limit && (
              <div className="pagination">
                {Array.from({ length: Math.ceil(pagination.total / pagination.limit) }, (_, i) => (
                  <button key={i} className={filters.page === i + 1 ? 'active' : ''} onClick={() => setFilters(prev => ({ ...prev, page: i + 1 }))}>{i + 1}</button>
                ))}
              </div>
            )}
          </>
        ) : (
          /* Empty State */
          <div className="jlp-empty">
            <div className="jlp-empty-icon">
              <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
                <rect x="10" y="20" width="60" height="45" rx="6" stroke="#f97316" strokeWidth="2" fill="none" />
                <line x1="10" y1="35" x2="70" y2="35" stroke="#f97316" strokeWidth="2" opacity="0.4" />
                <rect x="18" y="42" width="20" height="4" rx="2" fill="#f97316" opacity="0.3" />
                <rect x="18" y="50" width="35" height="4" rx="2" fill="#f97316" opacity="0.2" />
                <circle cx="58" cy="50" r="3" fill="#f97316" opacity="0.5" />
              </svg>
            </div>
            <h2>No jobs posted yet</h2>
            <p>Be the first to post a job and connect with local helpers.</p>
            <div className="jlp-empty-actions">
              {user ? (
                <button onClick={() => navigate('/post-job')} className="btn-primary btn-lg">Post the First Job</button>
              ) : (
                <>
                  <Link to="/register/customer" className="btn-primary btn-lg">Sign Up to Post a Job</Link>
                  <Link to="/register/helper" className="btn-outline btn-lg">Join as a Helper</Link>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* How It Works */}
      <div className="jlp-how-it-works">
        <h2>How OxSteed Works</h2>
        <div className="jlp-steps">
          <div className="jlp-step">
            <div className="jlp-step-num">1</div>
            <h3>Post a Job</h3>
            <p>Describe what you need done and set your budget.</p>
          </div>
          <div className="jlp-step">
            <div className="jlp-step-num">2</div>
            <h3>Get Bids</h3>
            <p>Local helpers review your job and submit competitive bids.</p>
          </div>
          <div className="jlp-step">
            <div className="jlp-step-num">3</div>
            <h3>Hire &amp; Pay</h3>
            <p>Choose the best helper and pay securely through OxSteed.</p>
          </div>
        </div>
      </div>

      {/* Browse by Category */}
      <div className="jlp-browse-cats">
        <h2>Browse by Category</h2>
        <div className="jlp-cat-grid">
          {CATEGORIES.map(c => (
            <div key={c.name} className="jlp-cat-card" onClick={() => handleFilter('category', c.name)}>
              <span className="jlp-cat-card-icon">{c.icon}</span>
              <span className="jlp-cat-card-name">{c.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <footer className="jlp-footer">
        <div className="jlp-footer-links">
          <Link to="/">Home</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/cookie-policy">Cookies</Link>
          <Link to="/security">Security</Link>
        </div>
        <p>&copy; 2026 OxSteed. All rights reserved.</p>
      </footer>
    </div>
  );
}
