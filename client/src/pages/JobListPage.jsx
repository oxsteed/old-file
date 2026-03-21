import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useJobs from '../hooks/useJobs';
import useAuth from '../hooks/useAuth';
import '../styles/JobListPage.css';

export default function JobListPage() {
  const { jobs, loading, error, pagination, fetchJobs } = useJobs();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ category: '', city: '', sort: 'newest', page: 1 });

  useEffect(() => { fetchJobs(filters); }, [filters, fetchJobs]);

  const handleFilter = (key, value) => setFilters(prev => ({ ...prev, [key]: value, page: 1 }));

  const categories = ['Handyman', 'Plumbing', 'Electrical', 'Cleaning', 'Moving', 'Painting', 'Landscaping', 'Assembly', 'Other'];

  return (
    <div className="job-list-page">
      <div className="job-list-header">
        <h1>Browse Jobs</h1>
        {user && <button onClick={() => navigate('/post-job')} className="btn-primary">Post a Job</button>}
      </div>
      <div className="job-filters">
        <select value={filters.category} onChange={e => handleFilter('category', e.target.value)}>
          <option value="">All Categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input type="text" placeholder="City..." value={filters.city} onChange={e => handleFilter('city', e.target.value)} />
        <select value={filters.sort} onChange={e => handleFilter('sort', e.target.value)}>
          <option value="newest">Newest</option>
          <option value="budget_high">Budget: High to Low</option>
          <option value="budget_low">Budget: Low to High</option>
        </select>
      </div>
      {error && <div className="error-message">{error}</div>}
      {loading ? <div className="loading">Loading jobs...</div> : (
        <div className="job-grid">
          {jobs.length === 0 ? <p className="no-results">No jobs found</p> : jobs.map(job => (
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
      )}
      {pagination.total > pagination.limit && (
        <div className="pagination">
          {Array.from({ length: Math.ceil(pagination.total / pagination.limit) }, (_, i) => (
            <button key={i} className={filters.page === i + 1 ? 'active' : ''} onClick={() => setFilters(prev => ({ ...prev, page: i + 1 }))}>{i + 1}</button>
          ))}
        </div>
      )}
    </div>
  );
}
