import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useJobs from '../hooks/useJobs';
import usePayments from '../hooks/usePayments';
import useAuth from '../hooks/useAuth';
import '../styles/JobDetailPage.css';

export default function JobDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, canApplyToJobs, needsOnboarding } = useAuth();
  const { fetchJob, job, loading, error, createBid, getJobBids, assignHelper, startJob, completeJob, cancelJob } = useJobs();
  const { createPaymentIntent } = usePayments();
  const [bids, setBids] = useState([]);
  const [bidForm, setBidForm] = useState({ amount: '', message: '', eta_hours: '' });
  const [bidError, setBidError] = useState(null);
  const [bidLoading, setBidLoading] = useState(false);

  useEffect(() => {
    fetchJob(id);
    loadBids();
  }, [id]);

  const loadBids = async () => {
    try {
      const data = await getJobBids(id);
      setBids(data || []);
    } catch (err) {
      console.error('Failed to load bids');
    }
  };

  const handleBidSubmit = async (e) => {
    e.preventDefault();
    setBidLoading(true);
    setBidError(null);
    try {
      await createBid({ job_id: id, ...bidForm, amount: parseFloat(bidForm.amount), eta_hours: parseInt(bidForm.eta_hours) });
      setBidForm({ amount: '', message: '', eta_hours: '' });
      loadBids();
    } catch (err) {
      setBidError(err.response?.data?.error || 'Failed to submit bid');
    } finally {
      setBidLoading(false);
    }
  };

  const handleAssign = async (bidId) => {
    try {
      await assignHelper(bidId);
      fetchJob(id);
      loadBids();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to assign helper');
    }
  };

  const handleStart = async () => {
    try {
      await startJob(id);
      fetchJob(id);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to start job');
    }
  };

  const handleComplete = async () => {
    try {
      await completeJob(id);
      fetchJob(id);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to complete job');
    }
  };

  const handleCancel = async () => {
    const reason = prompt('Reason for cancellation:');
    if (!reason) return;
    try {
      await cancelJob(id, reason);
      fetchJob(id);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to cancel job');
    }
  };

  const handlePayment = async () => {
    try {
      const acceptedBid = bids.find(b => b.status === 'accepted');
      if (!acceptedBid) return alert('No accepted bid found');
      const result = await createPaymentIntent(id, acceptedBid.amount);
      if (result?.client_secret) {
        alert('Payment initiated. Funds held in escrow until job completion.');
        fetchJob(id);
      }
    } catch (err) {
      alert(err.response?.data?.error || 'Payment failed');
    }
  };

  if (loading) return <div className="loading">Loading job details...</div>;
  if (error) return <div className="error-message">{error}</div>;
  if (!job) return <div className="loading">Job not found</div>;

  const isOwner = user?.id === job.client_id;
  const isHelper = user?.role === 'helper';
  const hasAlreadyBid = bids.some(b => b.helper_id === user?.id);

  return (
    <div className="job-detail-page">
      <button className="back-btn" onClick={() => navigate('/jobs')}>← Back to Jobs</button>

      <div className="job-detail-card">
        <div className="job-detail-header">
          <div>
            <span className={`priority-badge ${job.priority}`}>{job.priority}</span>
            <span className="status-badge">{job.status}</span>
          </div>
          <span className="bid-count">{job.bid_count} bids</span>
        </div>

        <h1>{job.title}</h1>
        <p className="job-category">{job.category}</p>
        <p className="job-description-full">{job.description}</p>

        <div className="job-meta">
          <div className="meta-item">
            <span className="meta-label">Budget</span>
            <span className="meta-value">${job.budget_min} - ${job.budget_max}</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Location</span>
            <span className="meta-value">{job.location_city}, {job.location_state}</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Posted</span>
            <span className="meta-value">{new Date(job.created_at).toLocaleDateString()}</span>
          </div>
          {job.job_type && (
            <div className="meta-item">
              <span className="meta-label">Type</span>
              <span className="meta-value">{job.job_type}</span>
            </div>
          )}
        </div>

        {/* Owner actions */}
        {isOwner && job.status === 'published' && (
          <button className="btn-danger" onClick={handleCancel}>Cancel Job</button>
        )}
        {isOwner && job.status === 'accepted' && (
          <button className="btn-primary" onClick={handlePayment}>Pay & Hold in Escrow</button>
        )}
        {isOwner && job.status === 'in_progress' && (
          <button className="btn-primary" onClick={handleComplete}>Mark as Complete</button>
        )}

        {/* Helper actions */}
        {isHelper && job.status === 'accepted' && job.assigned_helper_id === user?.id && (
          <button className="btn-primary" onClick={handleStart}>Start Job</button>
        )}
      </div>

      {/* Bid Form - only for helpers on published jobs */}
      {isHelper && job.status === 'published' && !hasAlreadyBid && canApplyToJobs && (
        <div className="bid-form-card">
          <h2>Place Your Bid</h2>
          {bidError && <div className="error-message">{bidError}</div>}
          <form onSubmit={handleBidSubmit}>
            <div className="form-group">
              <label>Your Price ($)</label>
              <input type="number" step="0.01" min="1" value={bidForm.amount} onChange={e => setBidForm(prev => ({ ...prev, amount: e.target.value }))} required />
            </div>
            <div className="form-group">
              <label>Estimated Hours</label>
              <input type="number" min="1" value={bidForm.eta_hours} onChange={e => setBidForm(prev => ({ ...prev, eta_hours: e.target.value }))} required />
            </div>
            <div className="form-group">
              <label>Message to Client</label>
              <textarea value={bidForm.message} onChange={e => setBidForm(prev => ({ ...prev, message: e.target.value }))} rows="3" placeholder="Why you're the right person for this job..." />
            </div>
            <button type="submit" className="btn-primary" disabled={bidLoading}>{bidLoading ? 'Submitting...' : 'Submit Bid'}</button>
          </form>
        </div>
      )}

      {isHelper && job.status === 'published' && !hasAlreadyBid && !canApplyToJobs && (
        <div className="bid-form-card">
          <div className="upgrade-prompt" style={{ color: '#f59e0b', fontWeight: 600, padding: '1rem' }}>
            {needsOnboarding
              ? 'Complete your onboarding to start bidding on jobs.'
              : 'Upgrade your plan to bid on jobs.'}
          </div>
        </div>
      )}

      {hasAlreadyBid && job.status === 'published' && (
        <div className="bid-form-card">
          <p className="already-bid">You have already submitted a bid for this job.</p>
        </div>
      )}

      {/* Bids List */}
      {(isOwner || bids.length > 0) && (
        <div className="bids-section">
          <h2>Bids ({bids.length})</h2>
          {bids.length === 0 ? (
            <p className="no-bids">No bids yet. Check back soon.</p>
          ) : (
            <div className="bids-list">
              {bids.map(bid => (
                <div key={bid.id} className={`bid-card ${bid.status}`}>
                  <div className="bid-header">
                    <span className="bid-amount">${bid.amount}</span>
                    <span className={`bid-status ${bid.status}`}>{bid.status}</span>
                  </div>
                  <p className="bid-message">{bid.message}</p>
                  <div className="bid-meta">
                    <span>ETA: {bid.eta_hours}h</span>
                    <span>{new Date(bid.created_at).toLocaleDateString()}</span>
                  </div>
                  {isOwner && job.status === 'published' && bid.status === 'pending' && (
                    <button className="btn-primary btn-sm" onClick={() => handleAssign(bid.id)}>Accept Bid</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
