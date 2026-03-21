import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useJobs from '../hooks/useJobs';
import '../styles/PostJobPage.css';

const categories = ['Handyman', 'Plumbing', 'Electrical', 'Cleaning', 'Moving', 'Painting', 'Landscaping', 'Assembly', 'Car Help', 'Roadside Assistance', 'Delivery', 'Errands', 'Other'];
const priorities = ['normal', 'high', 'urgent'];

export default function PostJobPage() {
  const navigate = useNavigate();
  const { createJob } = useJobs();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: '',
    job_type: 'one_time',
    budget_min: '',
    budget_max: '',
    location_city: '',
    location_state: 'OH',
    priority: 'normal',
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const jobData = {
        ...form,
        budget_min: parseFloat(form.budget_min),
        budget_max: parseFloat(form.budget_max),
      };
      const result = await createJob(jobData);
      navigate(`/jobs/${result.job?.id || result.id}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create job');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="post-job-page">
      <h1>Post a Job</h1>
      <p className="subtitle">Describe what you need done and let helpers bid on your project.</p>

      {error && <div className="error-message">{error}</div>}

      <form onSubmit={handleSubmit} className="post-job-form">
        <div className="form-group">
          <label>Job Title *</label>
          <input name="title" value={form.title} onChange={handleChange} placeholder="e.g. Need help moving furniture" required />
        </div>

        <div className="form-group">
          <label>Description *</label>
          <textarea name="description" value={form.description} onChange={handleChange} rows="5" placeholder="Describe the job in detail: what needs to be done, tools needed, estimated time..." required />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Category *</label>
            <select name="category" value={form.category} onChange={handleChange} required>
              <option value="">Select category</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label>Priority</label>
            <select name="priority" value={form.priority} onChange={handleChange}>
              {priorities.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
            </select>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Budget Min ($) *</label>
            <input name="budget_min" type="number" step="0.01" min="5" value={form.budget_min} onChange={handleChange} placeholder="25" required />
          </div>
          <div className="form-group">
            <label>Budget Max ($) *</label>
            <input name="budget_max" type="number" step="0.01" min="5" value={form.budget_max} onChange={handleChange} placeholder="100" required />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>City *</label>
            <input name="location_city" value={form.location_city} onChange={handleChange} placeholder="Springfield" required />
          </div>
          <div className="form-group">
            <label>State</label>
            <input name="location_state" value={form.location_state} onChange={handleChange} placeholder="OH" />
          </div>
        </div>

        <div className="form-group">
          <label>Job Type</label>
          <select name="job_type" value={form.job_type} onChange={handleChange}>
            <option value="one_time">One-Time</option>
            <option value="recurring">Recurring</option>
            <option value="crew">Crew Job (Multiple Helpers)</option>
          </select>
        </div>

        <div className="form-actions">
          <button type="button" className="btn-secondary" onClick={() => navigate('/jobs')}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Posting...' : 'Post Job'}
          </button>
        </div>
      </form>
    </div>
  );
}
