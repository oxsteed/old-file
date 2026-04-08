import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import useJobs from '../hooks/useJobs';
import usePayments from '../hooks/usePayments';
import useAuth from '../hooks/useAuth';
import '../styles/JobDetailPage.css';
import PageMeta from '../components/PageMeta';

// ─── Constants ────────────────────────────────────────────────────────────────
const JOB_TYPE_MAP = {
  one_time:       'One-Time',
  recurring:      'Recurring',
  tier1_intro:    'One-Time',
  tier2_standard: 'Standard',
  tier3_escrow:   'Escrow Protected',
};

const URGENCY_MAP = {
  asap:       { label: 'ASAP',       color: '#ef4444', bg: 'rgba(239,68,68,.15)' },
  this_week:  { label: 'This Week',  color: '#f97316', bg: 'rgba(249,115,22,.15)' },
  this_month: { label: 'This Month', color: '#eab308', bg: 'rgba(234,179,8,.15)' },
  flexible:   { label: 'Flexible',   color: '#4ade80', bg: 'rgba(74,222,128,.12)' },
};

const REQ_META = {
  license:         { label: 'Licensed',         icon: '🪪' },
  insurance:       { label: 'Insured',           icon: '🛡️' },
  skillLevel:      { label: 'Skilled',           icon: '⭐' },
  backgroundCheck: { label: 'Background Check',  icon: '✅' },
  ownTools:        { label: 'Own Tools',          icon: '🔧' },
  crewSize:        { label: 'Crew Required',      icon: '👥' },
};

const STATUS_MAP = {
  published:   { label: 'Accepting Bids', color: '#4ade80', bg: 'rgba(74,222,128,.12)' },
  accepted:    { label: 'Helper Chosen',  color: '#60a5fa', bg: 'rgba(96,165,250,.12)' },
  in_progress: { label: 'In Progress',   color: '#f97316', bg: 'rgba(249,115,22,.15)' },
  completed:   { label: 'Completed',     color: '#a3a3a3', bg: 'rgba(163,163,163,.1)' },
  cancelled:   { label: 'Cancelled',     color: '#f87171', bg: 'rgba(248,113,113,.12)' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatBudget(job) {
  if (!job) return '—';
  if (job.budget_type === 'open' || (!job.budget_min && !job.budget_max)) return 'Open to bids';
  if (job.budget_type === 'hourly') return `$${Number(job.budget_min).toLocaleString()}/hr`;
  const lo = Number(job.budget_min).toLocaleString();
  const hi = Number(job.budget_max).toLocaleString();
  if (lo === hi) return `$${lo}`;
  return `$${lo} – $${hi}`;
}

function parseRequirements(raw) {
  if (!raw) return [];
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(' ');
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86400000));
}

// ─── Component ────────────────────────────────────────────────────────────────
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
  const [mediaIndex, setMediaIndex] = useState(null); // lightbox index
  const [cancelReason, setCancelReason] = useState('');
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    fetchJob(id);
    loadBids();
  }, [id]);

  async function loadBids() {
    try { setBids((await getJobBids(id)) || []); } catch {}
  }

  async function handleBidSubmit(e) {
    e.preventDefault();
    setBidLoading(true);
    setBidError(null);
    try {
      await createBid({ job_id: id, ...bidForm, amount: parseFloat(bidForm.amount), eta_hours: parseInt(bidForm.eta_hours) });
      setBidForm({ amount: '', message: '', eta_hours: '' });
      loadBids();
      fetchJob(id);
    } catch (err) {
      setBidError(err.response?.data?.error || 'Failed to submit bid');
    } finally {
      setBidLoading(false);
    }
  }

  async function handleAssign(bidId) {
    setActionLoading(true);
    try { await assignHelper(bidId); fetchJob(id); loadBids(); }
    catch (err) { alert(err.response?.data?.error || 'Failed to assign helper'); }
    finally { setActionLoading(false); }
  }

  async function handleStart() {
    setActionLoading(true);
    try { await startJob(id); fetchJob(id); }
    catch (err) { alert(err.response?.data?.error || 'Failed to start job'); }
    finally { setActionLoading(false); }
  }

  async function handleComplete() {
    setActionLoading(true);
    try { await completeJob(id); fetchJob(id); }
    catch (err) { alert(err.response?.data?.error || 'Failed to complete job'); }
    finally { setActionLoading(false); }
  }

  async function handleCancel() {
    if (!cancelReason.trim()) return;
    setActionLoading(true);
    try { await cancelJob(id, cancelReason); fetchJob(id); setShowCancelModal(false); }
    catch (err) { alert(err.response?.data?.error || 'Failed to cancel job'); }
    finally { setActionLoading(false); }
  }

  async function handlePayment() {
    const acceptedBid = bids.find(b => b.status === 'accepted');
    if (!acceptedBid) return alert('No accepted bid found');
    setActionLoading(true);
    try {
      const result = await createPaymentIntent(id, acceptedBid.amount);
      if (result?.client_secret) {
        alert('Payment initiated. Funds held in escrow until job completion.');
        fetchJob(id);
      }
    } catch (err) { alert(err.response?.data?.error || 'Payment failed'); }
    finally { setActionLoading(false); }
  }

  if (loading) return (
    <div className="jdp-page">
      <div className="jdp-skeleton">
        <div className="jdp-skeleton-bar wide" />
        <div className="jdp-skeleton-bar" />
        <div className="jdp-skeleton-bar narrow" />
      </div>
    </div>
  );
  if (error || !job) return (
    <div className="jdp-page">
      <div className="jdp-not-found">
        <div className="jdp-not-found-icon">📋</div>
        <h2>Job not found</h2>
        <p>This job may have expired or been removed.</p>
        <button onClick={() => navigate('/jobs')} className="jdp-btn-primary">Browse Jobs</button>
      </div>
    </div>
  );

  const isOwner    = user?.id === job.client_id;
  const isHelper   = user?.role === 'helper';
  const hasAlreadyBid = bids.some(b => b.helper_id === user?.id);
  const acceptedBid   = bids.find(b => b.status === 'accepted');

  const requirements = parseRequirements(job.requirements);
  const mediaUrls    = Array.isArray(job.media_urls)
    ? job.media_urls
    : (typeof job.media_urls === 'string' ? JSON.parse(job.media_urls || '[]') : []);

  const urgencyMeta = URGENCY_MAP[job.urgency] || URGENCY_MAP.flexible;
  const statusMeta  = STATUS_MAP[job.status]   || STATUS_MAP.published;
  const jobTypeLabel = JOB_TYPE_MAP[job.job_type_label] || JOB_TYPE_MAP[job.job_type] || job.job_type_label || 'One-Time';
  const location = [job.location_city, job.location_state].filter(Boolean).join(', ');
  const daysLeft = daysUntil(job.expires_at);
  const budget   = formatBudget(job);

  return (
    <div className="jdp-page">
      <PageMeta
        title={job.title || 'Job Details'}
        description={job.description?.slice(0, 155) || 'View job details and submit a bid on OxSteed.'}
        url={`https://oxsteed.com/jobs/${id}`}
        noIndex
      />

      {/* Back nav */}
      <div className="jdp-topbar">
        <button className="jdp-back" onClick={() => navigate('/jobs')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
          Back to Jobs
        </button>
        <span className="jdp-id">JOB-{String(id).slice(0,8).toUpperCase()}</span>
      </div>

      <div className="jdp-layout">
        {/* ── Main column ───────────────────────────────────────────── */}
        <div className="jdp-main">

          {/* Hero card */}
          <div className="jdp-card jdp-hero-card">
            <div className="jdp-hero-top">
              <div className="jdp-hero-chips">
                {job.category_name && (
                  <span className="jdp-chip jdp-chip-cat">{job.category_name}</span>
                )}
                <span className="jdp-chip" style={{ color: statusMeta.color, background: statusMeta.bg }}>
                  {statusMeta.label}
                </span>
                {job.is_urgent && (
                  <span className="jdp-chip" style={{ color:'#ef4444', background:'rgba(239,68,68,.15)' }}>
                    🔥 Urgent
                  </span>
                )}
              </div>
              <div className="jdp-hero-bid-count">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                {job.bid_count} {job.bid_count === 1 ? 'bid' : 'bids'}
              </div>
            </div>

            <h1 className="jdp-title">{job.title}</h1>

            <div className="jdp-meta-strip">
              {location && (
                <span className="jdp-meta-pill">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                  {location}
                </span>
              )}
              <span className="jdp-meta-pill">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                {timeAgo(job.created_at)}
              </span>
              <span className="jdp-meta-pill" style={{ color: urgencyMeta.color, background: urgencyMeta.bg }}>
                {urgencyMeta.label}
              </span>
              <span className="jdp-meta-pill">
                {jobTypeLabel}
              </span>
            </div>

            <div className="jdp-description">
              {job.description}
            </div>
          </div>

          {/* Requirements */}
          {requirements.length > 0 && (
            <div className="jdp-card">
              <h2 className="jdp-section-title">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                Requirements
              </h2>
              <p className="jdp-req-note">The client requires helpers to confirm these qualifications before bidding.</p>
              <div className="jdp-req-grid">
                {requirements.map((r, i) => {
                  const meta = REQ_META[r.type] || { label: r.type, icon: '📌' };
                  return (
                    <div key={i} className="jdp-req-chip">
                      <span className="jdp-req-icon">{meta.icon}</span>
                      <div>
                        <div className="jdp-req-label">{meta.label}</div>
                        {r.detail?.licenseType && <div className="jdp-req-detail">{r.detail.licenseType}</div>}
                        {r.detail?.minCoverage  && <div className="jdp-req-detail">{r.detail.minCoverage} coverage</div>}
                        {r.detail?.minLevel     && <div className="jdp-req-detail">{r.detail.minLevel} level</div>}
                        {r.detail?.minCrew      && <div className="jdp-req-detail">Min {r.detail.minCrew} people</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Media gallery */}
          {mediaUrls.length > 0 && (
            <div className="jdp-card">
              <h2 className="jdp-section-title">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                Photos & Media ({mediaUrls.length})
              </h2>
              <div className="jdp-media-grid">
                {mediaUrls.map((url, i) => {
                  const isVideo = /\.(mp4|mov|webm|ogg)(\?|$)/i.test(url);
                  const isAudio = /\.(mp3|wav|ogg|m4a)(\?|$)/i.test(url);
                  if (isAudio) return (
                    <div key={i} className="jdp-media-audio">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                      <audio src={url} controls style={{ width:'100%', marginTop:'0.5rem' }} />
                    </div>
                  );
                  if (isVideo) return (
                    <div key={i} className="jdp-media-video">
                      <video src={url} controls playsInline style={{ width:'100%', borderRadius:'8px', maxHeight:'280px' }} />
                    </div>
                  );
                  return (
                    <div key={i} className="jdp-media-thumb" onClick={() => setMediaIndex(i)} role="button" tabIndex={0} aria-label={`View image ${i+1}`}>
                      <img src={url} alt={`Job media ${i+1}`} loading="lazy" />
                      <div className="jdp-media-overlay">🔍</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Bid Section ──────────────────────────────────────────── */}

          {/* Helper: upgrade prompt */}
          {isHelper && job.status === 'published' && !hasAlreadyBid && !canApplyToJobs && (
            <div className="jdp-card jdp-upgrade-card">
              <div className="jdp-upgrade-icon">🚀</div>
              <h3>{needsOnboarding ? 'Complete your profile to bid' : 'Upgrade to bid on jobs'}</h3>
              <p>{needsOnboarding
                ? 'Finish setting up your helper profile to start submitting bids.'
                : 'Upgrade to a Pro membership to unlock bidding and get access to all jobs.'}</p>
              <Link to="/dashboard" className="jdp-btn-primary">
                {needsOnboarding ? 'Complete Profile' : 'View Plans'}
              </Link>
            </div>
          )}

          {/* Helper: already bid */}
          {hasAlreadyBid && job.status === 'published' && (
            <div className="jdp-card jdp-bid-submitted">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              <span>Your bid has been submitted. The client will reach out if they choose you.</span>
            </div>
          )}

          {/* Helper: start job */}
          {isHelper && job.status === 'accepted' && job.assigned_helper_id === user?.id && (
            <div className="jdp-card jdp-action-card">
              <h3>You've been chosen for this job!</h3>
              <p>The client has selected your bid. Mark it as started when you're on-site and ready to begin.</p>
              <button className="jdp-btn-primary" onClick={handleStart} disabled={actionLoading}>
                {actionLoading ? 'Starting…' : '▶ Start Job'}
              </button>
            </div>
          )}

          {/* Helper: bid form */}
          {isHelper && job.status === 'published' && !hasAlreadyBid && canApplyToJobs && (
            <div className="jdp-card jdp-bid-form-card">
              <h2 className="jdp-section-title">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Submit Your Bid
              </h2>
              {bidError && <div className="jdp-bid-error">{bidError}</div>}
              <form onSubmit={handleBidSubmit} className="jdp-bid-form">
                <div className="jdp-bid-form-row">
                  <div className="jdp-field">
                    <label>Your Price ($)</label>
                    <div className="jdp-input-prefix">
                      <span>$</span>
                      <input type="number" step="0.01" min="1" required
                        value={bidForm.amount}
                        onChange={e => setBidForm(p => ({ ...p, amount: e.target.value }))}
                        placeholder="0.00" />
                    </div>
                  </div>
                  <div className="jdp-field">
                    <label>Estimated Hours</label>
                    <div className="jdp-input-prefix">
                      <span>⏱</span>
                      <input type="number" min="1" required
                        value={bidForm.eta_hours}
                        onChange={e => setBidForm(p => ({ ...p, eta_hours: e.target.value }))}
                        placeholder="e.g. 4" />
                    </div>
                  </div>
                </div>
                <div className="jdp-field">
                  <label>Why you're the right person for this job</label>
                  <textarea rows={4} required
                    value={bidForm.message}
                    onChange={e => setBidForm(p => ({ ...p, message: e.target.value }))}
                    placeholder="Describe your relevant experience, availability, and approach…" />
                  <span className="jdp-char-count">{bidForm.message.length} / 500</span>
                </div>
                <button type="submit" className="jdp-btn-primary jdp-bid-submit" disabled={bidLoading}>
                  {bidLoading ? 'Submitting…' : '💼 Submit Bid'}
                </button>
              </form>
            </div>
          )}

          {/* Owner: bids list */}
          {(isOwner || isHelper) && (
            <div className="jdp-card">
              <h2 className="jdp-section-title">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                Bids ({bids.length})
              </h2>
              {bids.length === 0 ? (
                <div className="jdp-empty-bids">
                  <div className="jdp-empty-bids-icon">📭</div>
                  <p>No bids yet. Qualified helpers will start bidding soon.</p>
                </div>
              ) : (
                <div className="jdp-bids-list">
                  {bids.map(bid => (
                    <div key={bid.id} className={`jdp-bid-card ${bid.status}`}>
                      <div className="jdp-bid-helper">
                        {bid.helper_avatar
                          ? <img src={bid.helper_avatar} alt={bid.helper_name} className="jdp-bid-avatar" />
                          : <div className="jdp-bid-avatar jdp-bid-avatar-initials">{initials(bid.helper_name)}</div>
                        }
                        <div className="jdp-bid-helper-info">
                          <span className="jdp-bid-helper-name">{bid.helper_name}</span>
                          <div className="jdp-bid-helper-stats">
                            {bid.helper_rating && (
                              <span>⭐ {Number(bid.helper_rating).toFixed(1)}</span>
                            )}
                            {bid.jobs_completed > 0 && (
                              <span>✓ {bid.jobs_completed} jobs done</span>
                            )}
                          </div>
                        </div>
                        <div className="jdp-bid-right">
                          <div className="jdp-bid-amount">${Number(bid.amount).toLocaleString()}</div>
                          <div className="jdp-bid-eta">⏱ {bid.eta_hours}h est.</div>
                          <span className={`jdp-bid-status ${bid.status}`}>{bid.status}</span>
                        </div>
                      </div>
                      {bid.message && <p className="jdp-bid-message">"{bid.message}"</p>}
                      <div className="jdp-bid-footer">
                        <span className="jdp-bid-date">{timeAgo(bid.created_at)}</span>
                        {isOwner && job.status === 'published' && bid.status === 'pending' && (
                          <button className="jdp-btn-accept" onClick={() => handleAssign(bid.id)} disabled={actionLoading}>
                            Accept Bid
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Sidebar ───────────────────────────────────────────────── */}
        <aside className="jdp-sidebar">

          {/* Budget */}
          <div className="jdp-card jdp-sidebar-card">
            <div className="jdp-sidebar-budget">{budget}</div>
            {job.budget_type === 'open' && (
              <p className="jdp-sidebar-budget-note">Client is open to all bids. Submit a competitive offer.</p>
            )}
            {job.budget_type === 'hourly' && (
              <p className="jdp-sidebar-budget-note">Rate per hour of work on-site.</p>
            )}
          </div>

          {/* Details */}
          <div className="jdp-card jdp-sidebar-card">
            <h3 className="jdp-sidebar-title">Job Details</h3>
            <div className="jdp-detail-rows">
              {location && (
                <div className="jdp-detail-row">
                  <span className="jdp-detail-icon">📍</span>
                  <div>
                    <div className="jdp-detail-label">Location</div>
                    <div className="jdp-detail-val">{location}</div>
                    {job.location_address && <div className="jdp-detail-sub">{job.location_address}</div>}
                  </div>
                </div>
              )}
              <div className="jdp-detail-row">
                <span className="jdp-detail-icon">📅</span>
                <div>
                  <div className="jdp-detail-label">Posted</div>
                  <div className="jdp-detail-val">{new Date(job.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
                </div>
              </div>
              <div className="jdp-detail-row">
                <span className="jdp-detail-icon">⚡</span>
                <div>
                  <div className="jdp-detail-label">Urgency</div>
                  <div className="jdp-detail-val" style={{ color: urgencyMeta.color }}>{urgencyMeta.label}</div>
                </div>
              </div>
              <div className="jdp-detail-row">
                <span className="jdp-detail-icon">🔄</span>
                <div>
                  <div className="jdp-detail-label">Job Type</div>
                  <div className="jdp-detail-val">{jobTypeLabel}</div>
                </div>
              </div>
              {daysLeft !== null && (
                <div className="jdp-detail-row">
                  <span className="jdp-detail-icon">⏳</span>
                  <div>
                    <div className="jdp-detail-label">Expires</div>
                    <div className="jdp-detail-val" style={{ color: daysLeft < 5 ? '#ef4444' : undefined }}>
                      {daysLeft === 0 ? 'Today' : `${daysLeft} days left`}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Client info */}
          {job.client_name && (
            <div className="jdp-card jdp-sidebar-card">
              <h3 className="jdp-sidebar-title">Posted by</h3>
              <div className="jdp-client-row">
                <div className="jdp-client-avatar">{initials(job.client_name)}</div>
                <div>
                  <div className="jdp-client-name">{job.client_name}</div>
                  <div className="jdp-client-label">OxSteed Client</div>
                </div>
              </div>
            </div>
          )}

          {/* Assigned helper */}
          {job.helper_name && job.assigned_helper_id && (
            <div className="jdp-card jdp-sidebar-card">
              <h3 className="jdp-sidebar-title">Assigned Helper</h3>
              <div className="jdp-client-row">
                <div className="jdp-client-avatar" style={{ background: 'rgba(74,222,128,.2)', color: '#4ade80' }}>{initials(job.helper_name)}</div>
                <div>
                  <div className="jdp-client-name">{job.helper_name}</div>
                  <div className="jdp-client-label">Accepted Helper</div>
                </div>
              </div>
            </div>
          )}

          {/* Owner actions */}
          {isOwner && (
            <div className="jdp-card jdp-sidebar-card jdp-owner-actions">
              <h3 className="jdp-sidebar-title">Actions</h3>
              {job.status === 'published' && (
                <button className="jdp-btn-danger" onClick={() => setShowCancelModal(true)}>
                  Cancel Job
                </button>
              )}
              {job.status === 'accepted' && (
                <button className="jdp-btn-primary" onClick={handlePayment} disabled={actionLoading}>
                  {actionLoading ? 'Processing…' : '🔒 Pay & Hold in Escrow'}
                </button>
              )}
              {job.status === 'in_progress' && (
                <button className="jdp-btn-primary" onClick={handleComplete} disabled={actionLoading}>
                  {actionLoading ? 'Processing…' : '✅ Mark as Complete'}
                </button>
              )}
              {job.status === 'completed' && (
                <div className="jdp-status-done">Job completed ✓</div>
              )}
            </div>
          )}
        </aside>
      </div>

      {/* ── Lightbox ─────────────────────────────────────────────────── */}
      {mediaIndex !== null && (
        <div className="jdp-lightbox" onClick={() => setMediaIndex(null)}>
          <button className="jdp-lightbox-close" onClick={() => setMediaIndex(null)}>✕</button>
          {mediaIndex > 0 && (
            <button className="jdp-lightbox-prev" onClick={e => { e.stopPropagation(); setMediaIndex(mediaIndex - 1); }}>‹</button>
          )}
          <img src={mediaUrls[mediaIndex]} alt={`Job media ${mediaIndex + 1}`} onClick={e => e.stopPropagation()} />
          {mediaIndex < mediaUrls.length - 1 && (
            <button className="jdp-lightbox-next" onClick={e => { e.stopPropagation(); setMediaIndex(mediaIndex + 1); }}>›</button>
          )}
          <div className="jdp-lightbox-counter">{mediaIndex + 1} / {mediaUrls.length}</div>
        </div>
      )}

      {/* ── Cancel modal ─────────────────────────────────────────────── */}
      {showCancelModal && (
        <div className="jdp-modal-overlay" onClick={() => setShowCancelModal(false)}>
          <div className="jdp-modal" onClick={e => e.stopPropagation()}>
            <h3>Cancel this job?</h3>
            <p>This will remove your job listing. Helpers who have bid will be notified.</p>
            <textarea
              className="jdp-modal-textarea"
              rows={3}
              placeholder="Reason for cancellation (optional)"
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
            />
            <div className="jdp-modal-actions">
              <button className="jdp-btn-ghost" onClick={() => setShowCancelModal(false)}>Keep Job</button>
              <button className="jdp-btn-danger" onClick={handleCancel} disabled={actionLoading}>
                {actionLoading ? 'Cancelling…' : 'Cancel Job'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
