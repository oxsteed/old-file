import React, { useEffect, useState, useId, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import useJobs from '../hooks/useJobs';
import useAuth from '../hooks/useAuth';
import api from '../api/axios';
import toast from 'react-hot-toast';
import '../styles/JobDetailPage.css';
import PageMeta from '../components/PageMeta';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import PreferredHelperBanner from '../components/PreferredHelperBanner';
import ReviewModal from '../components/reviews/ReviewModal';
import BidAcceptanceModal from '../components/BidAcceptanceModal';
import JobCancellationConfirmation from '../components/JobCancellationConfirmation';
import HelperCancellationConfirmation from '../components/HelperCancellationConfirmation';
import CancellationStats from '../components/CancellationStats';
import UserReputationCard from '../components/UserReputationCard';
import ReportModal from '../components/ReportModal';
import JobMaterialsPanel from '../components/JobMaterialsPanel';
import DirectPaymentRecordModal from '../components/DirectPaymentRecordModal';
import { useTranslation } from 'react-i18next';
import { analytics } from '../utils/analytics';
import { detectLocale, formatDate, formatMoney } from '../lib/format';
import { LAUNCH_VISIBILITY } from '../utils/launchScope';

import JobImageViewer from '../components/JobImageViewer';
import { useJobDetailBids } from '../hooks/useJobDetailBids';
import { JOB_STATUS_KEYS, jobDetailView, jobList, jobMediaType, matchingHelpersPath, samePartyId } from '../utils/jobDetailModel';
import { bidNeedingReconfirm, canEditJob } from '../utils/jobEditModel';
import PaymentReauthorizationBanner from '../components/PaymentReauthorizationBanner';
import JobPaymentLayersPanel from '../components/paymentLayers/JobPaymentLayersPanel';
import JobRevisionHistory from '../components/JobRevisionHistory';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatBudget(job, t) {
  if (!job) return '-';
  if (job.budget_type === 'open' || (!job.budget_min && !job.budget_max)) return t('jobDetail.openToBids');
  const moneyOptions = {
    currency: job.currency || 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  };
  if (job.budget_type === 'hourly') {
    return t('jobDetail.hourlyRate', { amount: formatMoney(job.budget_min ?? job.budget_max, moneyOptions) });
  }
  const lo = formatMoney(job.budget_min ?? job.budget_max, moneyOptions);
  const hi = formatMoney(job.budget_max ?? job.budget_min, moneyOptions);
  if (lo === hi) return lo;
  return `${lo} – ${hi}`;
}

function timeAgo(dateStr) {
  if (!dateStr || !Number.isFinite(new Date(dateStr).getTime())) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const relative = new Intl.RelativeTimeFormat(detectLocale(), { numeric: 'auto' });
  if (mins < 60) return relative.format(-Math.max(0, mins), 'minute');
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return relative.format(-hrs, 'hour');
  const days = Math.floor(hrs / 24);
  if (days < 7) return relative.format(-days, 'day');
  return formatDate(dateStr, { year: undefined });
}

function initials(name) {
  if (!name?.trim()) return '?';
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

// Format name for privacy: "FirstName L." (first name + last initial only)
function formatNameForPrivacy(fullName) {
  if (!fullName?.trim()) return '';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  // Return first name + last initial of last part
  const lastName = parts[parts.length - 1];
  const lastInitial = lastName[0]?.toUpperCase() || '';
  return `${parts[0]} ${lastInitial}.`;
}

function calendarDate(value) {
  const localDate = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value;
  return formatDate(localDate, { month: 'long' });
}

function daysUntil(dateStr) {
  if (!dateStr || !Number.isFinite(new Date(dateStr).getTime())) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86400000));
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function JobDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  // Reset job data, bid checks and dialogs immediately on job/account changes.
  return <JobDetailContent key={`${id}:${user?.id ?? 'guest'}`} />;
}

function JobDetailContent() {
  const { t } = useTranslation();

  const URGENCY_MAP = {
    asap:       { label: t('jobDetail.urgencyASAP'), color: 'var(--color-error)', bg: 'var(--color-error-bg)' },
    this_week:  { label: t('jobDetail.urgencyWeek'),  color: 'var(--color-warning)', bg: 'var(--color-warning-bg)' },
    this_month: { label: t('jobDetail.urgencyMonth'), color: 'var(--color-warning)', bg: 'var(--color-warning-bg)' },
    flexible:   { label: t('jobDetail.urgencyFlexible'),   color: 'var(--color-success)', bg: 'var(--color-success-bg)' },
  };
  const JOB_TYPE_MAP = {
    one_time: t('jobDetail.oneTime'),
    recurring: t('jobDetail.recurring'),
    tier1_intro: t('jobDetail.oneTime'),
    tier2_standard: t('jobDetail.standard'),
    tier3_escrow: LAUNCH_VISIBILITY.jobEscrowLabels ? t('jobDetail.escrowProtected') : t('jobDetail.standard'),
  };
  const REQ_META = {
    license: { label: t('jobDetail.licensed'), icon: '🪪' },
    insurance: { label: t('jobDetail.insured'), icon: '🛡️' },
    skillLevel: { label: t('jobDetail.skilled'), icon: '⭐' },
    backgroundCheck: { label: t('jobDetail.backgroundCheck'), icon: '✅' },
    ownTools: { label: t('jobDetail.ownTools'), icon: '🔧' },
    crewSize: { label: t('jobDetail.crewRequired'), icon: '👥' },
  };
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, canApplyToJobs, needsOnboarding } = useAuth();
  const { fetchJob, job, loading, error, createBid, getJobBids, assignHelper, startJob, completeJob, cancelJob, reconfirmBid, getJobRevisions } = useJobs();
  const [reconfirmLoading, setReconfirmLoading] = useState(false);

  const { bids, status: bidsStatus, loadBids } = useJobDetailBids(id, user?.id, getJobBids);
  const fieldId = useId();
  const cancelDialog = useRef(null);
  const [bidForm, setBidForm] = useState({ amount: '', message: '', eta_hours: '' });
  const [bidError, setBidError] = useState(null);
  const [bidLoading, setBidLoading] = useState(false);
  const [mediaIndex, setMediaIndex] = useState(null); // lightbox index
  const [cancelReason, setCancelReason] = useState('');
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showJobCancellationModal, setShowJobCancellationModal] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [reviewEligible, setReviewEligible] = useState(false);
  const [paymentRecordOpen, setPaymentRecordOpen] = useState(false);
  // Bid acceptance scheduling modal
  const [acceptingBid, setAcceptingBid] = useState(null); // bid object being accepted
  const [helperPolicies, setHelperPolicies] = useState(null); // cancellation policies for helper
  const [loadingPolicies, setLoadingPolicies] = useState(false);

  useEffect(() => { void fetchJob(id); }, [id, fetchJob]);

  useEffect(() => {
    let current = true;
    setReviewEligible(false);
    const involved = user && (samePartyId(user.id, job?.client_id) || samePartyId(user.id, job?.assigned_helper_id));
    if (involved && ['completed', 'closed'].includes(job?.status)) {
      api.get(`/reviews/jobs/${id}/eligibility`)
        .then(r => { if (current) setReviewEligible(r.data.eligible === true); })
        .catch(() => { if (current) setReviewEligible(false); });
    }
    return () => { current = false; };
  }, [job?.status, job?.client_id, job?.assigned_helper_id, user?.id, id]);

  useEffect(() => {
    if (!showCancelModal) return;
    const opener = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    cancelDialog.current?.querySelector('textarea')?.focus();
    const keydown = event => {
      if (event.key === 'Escape' && !actionLoading) setShowCancelModal(false);
      if (event.key === 'Tab') {
        const controls = [...cancelDialog.current.querySelectorAll('textarea, button:not(:disabled)')];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); document.body.style.overflow = overflow; if (opener?.isConnected) opener.focus(); };
  }, [showCancelModal, actionLoading]);

  async function handleBidSubmit(e) {
    e.preventDefault();
    if (!jobDetailView({ job, user, bids, bidsStatus, canApplyToJobs }).canSubmitBid) return;
    setBidLoading(true);
    setBidError(null);
    try {
      await createBid({
        job_id: id,
        amount: parseFloat(bidForm.amount),
        message: bidForm.message,
        estimated_hours: parseInt(bidForm.eta_hours, 10),
        // The job terms this bid is priced against; the server refuses a bid
        // on a stale revision so the helper reviews the latest details first.
        ...(job?.revision != null ? { job_revision: job.revision } : {}),
      });
      analytics.bidPlaced(id, parseFloat(bidForm.amount));
      setBidForm({ amount: '', message: '', eta_hours: '' });
      loadBids();
      fetchJob(id);
    } catch (err) {
      if (err.response?.data?.code === 'job_changed') {
        setBidError(t('jobEdit.bidJobChanged'));
        fetchJob(id);
      } else {
        setBidError(err.response?.data?.error || t('jobDetail.bidFailed'));
      }
    } finally {
      setBidLoading(false);
    }
  }

  // Opens the BidAcceptanceModal (payment method selection step) before calling assignHelper.
  async function handleAcceptClick(bid) {
    setLoadingPolicies(true);
    try {
      // Fetch helper's cancellation policies (path must NOT include /api/ prefix)
      const { data } = await api.get('/helper-settings/policies', {
        params: { helper_id: bid.helper_id }
      });
      setHelperPolicies(data.data);
    } catch (err) {
      // Policies are informational — don't block the modal from opening
      console.error('Failed to fetch helper policies (non-blocking):', err);
      setHelperPolicies(null);
    } finally {
      setLoadingPolicies(false);
      // Always open the modal — policies are optional
      setAcceptingBid(bid);
    }
  }

  // Called by BidAcceptanceModal once the customer selects a payment method.
  async function handleAssign(bidId, paymentMethod, scheduledStart = null, scheduledEnd = null) {
    setAcceptingBid(null);
    setHelperPolicies(null);
    setActionLoading(true);
    try {
      await assignHelper(bidId, paymentMethod, scheduledStart, scheduledEnd, job?.version ?? null);
      fetchJob(id);
      loadBids();
      toast.success(t('jobDetail.helperAssigned', { defaultValue: 'Helper assigned successfully' }));
    } catch (err) {
      const errorMsg = getErrorMessage(err);
      toast.error(errorMsg);
      if (err.code === 'AUTH_EXPIRED' || err.code === 'NO_TOKEN') {
        setTimeout(() => navigate('/login'), 2000);
      }
    } finally {
      setActionLoading(false);
    }
  }

  async function handleStart() {
    setActionLoading(true);
    try {
      await startJob(id);
      fetchJob(id);
      toast.success(t('jobDetail.jobStarted'));
    } catch (err) {
      const errorMsg = getErrorMessage(err);
      toast.error(errorMsg);
      // Handle auth errors - redirect to login
      if (err.code === 'AUTH_EXPIRED' || err.code === 'NO_TOKEN') {
        setTimeout(() => navigate('/login'), 2000);
      }
    } finally {
      setActionLoading(false);
    }
  }

  async function handleComplete() {
    setActionLoading(true);
    try {
      await completeJob(id);
      fetchJob(id);
      toast.success(t('jobDetail.jobCompleted'));
    } catch (err) {
      const errorMsg = getErrorMessage(err);
      toast.error(errorMsg);
      // Handle auth errors - redirect to login
      if (err.code === 'AUTH_EXPIRED' || err.code === 'NO_TOKEN') {
        setTimeout(() => navigate('/login'), 2000);
      }
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCancel() {
    setActionLoading(true);
    try {
      await cancelJob(id, cancelReason.trim() || null);
      fetchJob(id);
      setShowCancelModal(false);
      toast.success(t('jobDetail.jobCancelled'));
    } catch (err) {
      const errorMsg = getErrorMessage(err);
      toast.error(errorMsg);
      // Handle auth errors - redirect to login
      if (err.code === 'AUTH_EXPIRED' || err.code === 'NO_TOKEN') {
        setTimeout(() => navigate('/login'), 2000);
      }
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReconfirm(bid) {
    setReconfirmLoading(true);
    try {
      await reconfirmBid(bid.id, { job_revision: job?.revision });
      toast.success(t('jobEdit.reconfirmed'));
      loadBids();
      fetchJob(id);
    } catch (err) {
      toast.error(err.response?.data?.code === 'bid_expired' ? t('jobEdit.acceptBidExpired') : getErrorMessage(err));
    } finally {
      setReconfirmLoading(false);
    }
  }

  async function handleJobCancellation(feeData) {
    // Called after JobCancellationModal confirms cancellation
    setShowJobCancellationModal(false);
    fetchJob(id);
    loadBids();
  }

  // Helper function to extract error message
  function getErrorMessage(err) {
    if (err.code === 'NO_TOKEN') {
      return t('jobDetail.sessionExpired');
    }
    if (err.code === 'AUTH_EXPIRED') {
      return t('jobDetail.sessionRedirect');
    }
    if (err.code === 'DISPUTE_OPEN') {
      return t('jobDetail.disputeOpen');
    }
    const serverCode = err.response?.data?.code;
    if (serverCode === 'bid_needs_reconfirm') return t('jobEdit.acceptNeedsReconfirm');
    if (serverCode === 'bid_expired') return t('jobEdit.acceptBidExpired');
    if (serverCode === 'payment_reauthorization_required') return t('jobPaymentReauth.blockedComplete');
    if (serverCode === 'precondition_failed' || serverCode === 'version_conflict') {
      fetchJob(id);
      return t('jobEdit.acceptJobChanged');
    }
    return err.message || err.response?.data?.error || t('jobDetail.operationFailed');
  }

  if (!job || error) return (
    <><Navbar /><main className="jdp-page jdp-state" aria-busy={loading || (!job && !error)}>
      {error ? <><h1>{t('jobDetail.loadFailed')}</h1><p>{t('jobDetail.loadFailedHelp')}</p>
        <button className="jdp-btn-primary" onClick={() => fetchJob(id)} disabled={loading}>{t('jobDetail.retry')}</button>
        <Link className="jdp-btn-ghost" to="/jobs">{t('jobDetail.browseJobs')}</Link></>
        : <p role="status">{t('jobDetail.loadingJob')}</p>}
    </main><Footer /></>
  );

  const view = jobDetailView({ job, user, bids, bidsStatus, canApplyToJobs, needsOnboarding, reviewEligible });
  const { isOwner, isHelper, isAssignedHelper, visibleBids, totalBids, action } = view;
  const partialBids = isOwner && bidsStatus === 'success' && totalBids > visibleBids.length;
  const acceptedBid = visibleBids.find(bid => bid.status === 'accepted');
  const ownBidToReconfirm = !isOwner && isHelper ? bidNeedingReconfirm(visibleBids, user, job) : null;
  const showRevisions = Number(job.revision) > 1 || Number(job.version) > 1;
  const canSeeRevisions = showRevisions && (isOwner || isAssignedHelper || Boolean(visibleBids.length));
  const visibleRequirements = jobList(job.requirements).filter(requirement => typeof requirement === 'object' &&
    (requirement.type !== 'backgroundCheck' || LAUNCH_VISIBILITY.backgroundChecks));
  const requiredSkills = jobList(job.required_skills).filter(skill => typeof skill === 'object' && skill.name);
  const mediaUrls = jobList(job.media_urls).filter(url => typeof url === 'string' && url.trim());
  const imageUrls = mediaUrls.filter(url => jobMediaType(url) === 'image');
  const urgencyMeta = URGENCY_MAP[job.is_urgent ? 'asap' : job.urgency];
  const jobTypeLabel = JOB_TYPE_MAP[job.job_type_label] || JOB_TYPE_MAP[job.job_type] || job.job_type_label;
  const location = [job.location_city, job.location_state].filter(Boolean).join(', ');
  const daysLeft = daysUntil(job.expires_at);
  const statusLabel = t(`jobDetail.${JOB_STATUS_KEYS[job.status] || 'statusUnknown'}`);
  const focusSection = target => { const node = document.getElementById(`${fieldId}-${target}`); node?.focus(); node?.scrollIntoView({ behavior: 'auto', block: 'start' }); };
  const actionLabels = { reviewBids: 'reviewBids', findHelpers: 'findHelpers', bid: 'placeBid', onboarding: 'completeProfile', manageBid: 'manageBid', start: 'startJob', messages: 'openMessages', payment: 'recordDirectPayment', complete: 'markComplete', signIn: 'signInToBid', retry: 'retryBids' };
  const actionHelp = { reviewBids: 'reviewBidsHelp', findHelpers: 'findHelpersHelp', bid: 'placeBidHelp', onboarding: 'completeProfileHelp', manageBid: 'manageBidHelp', start: 'chosenHelp', messages: 'messagesHelp', payment: 'directPaymentHelp', complete: 'completeHelp', signIn: 'signInHelp', retry: 'bidsFailed' };
  function runNextStep() {
    if (action === 'reviewBids') focusSection('bids');
    else if (action === 'bid') focusSection('bid-form');
    else if (action === 'findHelpers') navigate(matchingHelpersPath(job.required_skills));
    else if (action === 'onboarding') navigate('/dashboard');
    else if (action === 'manageBid') navigate('/my-bids');
    else if (action === 'messages') navigate('/helper/messages');
    else if (action === 'signIn') navigate(`/login?next=${encodeURIComponent(`/jobs/${id}`)}`);
    else if (action === 'start') handleStart();
    else if (action === 'complete') handleComplete();
    else if (action === 'payment') setPaymentRecordOpen(true);
    else if (action === 'retry') loadBids();
  }
  const requirementsCard = (visibleRequirements.length > 0 || requiredSkills.length > 0) && (
    <section className="jdp-card" aria-labelledby={`${fieldId}-requirements`}>
      <h2 id={`${fieldId}-requirements`} className="jdp-section-title">{t('jobDetail.requirements')}</h2>
      {visibleRequirements.length > 0 && <><p className="jdp-req-note">{t('jobDetail.requirementsHelp')}</p>
              <div className="jdp-req-grid">
                {visibleRequirements.map((r, i) => {
                  const meta = REQ_META[r.type] || { label: r.type, icon: '📌' };
                  return (
                    <div key={i} className="jdp-req-chip">
                      <span className="jdp-req-icon">{meta.icon}</span>
                      <div>
                        <div className="jdp-req-label">{meta.label}</div>
                        {r.detail?.licenseType && <div className="jdp-req-detail">{r.detail.licenseType}</div>}
                        {r.detail?.minCoverage  && <div className="jdp-req-detail">{t('jobDetail.coverage', { amount: r.detail.minCoverage })}</div>}
                        {r.detail?.minLevel     && <div className="jdp-req-detail">{t('jobDetail.skillLevelValue', { level: r.detail.minLevel })}</div>}
                        {r.detail?.minCrew      && <div className="jdp-req-detail">{t('jobDetail.minimumCrew', { count: r.detail.minCrew })}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
      </>}
      {requiredSkills.length > 0 && <><h3 className="jdp-small-heading">{t('jobDetail.requiredSkills')}</h3>
        <div className="jdp-skills">{requiredSkills.map((skill, index) => <span className="jdp-meta-pill" key={skill.id ?? index}>{skill.name}</span>)}</div></>}
    </section>
  );
  const bidsCard = (isOwner || isHelper || visibleBids.length > 0) && (
    <section className="jdp-card" aria-labelledby={`${fieldId}-bids`} aria-busy={bidsStatus === 'loading'}>
      <h2 id={`${fieldId}-bids`} tabIndex={-1} className="jdp-section-title">{isOwner ? t('jobDetail.bidsHeading') : t('jobDetail.ownBidHeading')}</h2>
      {isOwner && totalBids !== null && <p className="jdp-count">{t('jobDetail.bidCount', { count: totalBids })}</p>}
      {partialBids && <p className="jdp-count">{t('jobDetail.partialBids', { visible: visibleBids.length, total: totalBids })}</p>}
      {bidsStatus === 'loading' && <p role="status">{t('jobDetail.loadingBids')}</p>}
      {bidsStatus === 'error' && <div role="alert"><p>{t('jobDetail.bidsFailed')}</p>
        <button type="button" className="jdp-btn-ghost" onClick={loadBids}>{t('jobDetail.retry')}</button></div>}
      {bidsStatus === 'success' && (visibleBids.length === 0 ? <p className="jdp-empty-bids">{t(`jobDetail.${!isOwner ? 'noOwnBid' : totalBids > 0 ? 'noVisibleBids' : job.status === 'published' ? 'noBidsOpen' : 'noBidsClosed'}`)}</p> : (
                <div className="jdp-bids-list">
                  {visibleBids.map(bid => (
                    <div key={bid.id} className={`jdp-bid-card ${bid.status}`}>
                      <div className="jdp-bid-helper">
                        {bid.helper_avatar
                          ? <img src={bid.helper_avatar} alt="" className="jdp-bid-avatar" />
                          : <div className="jdp-bid-avatar jdp-bid-avatar-initials">{initials(bid.helper_name)}</div>
                        }
                        <div className="jdp-bid-helper-info">
                          <span className="jdp-bid-helper-name">{formatNameForPrivacy(bid.helper_name)}</span>
                          <div className="jdp-bid-helper-stats">
                            {bid.helper_rating && (
                              <span>⭐ {Number(bid.helper_rating).toFixed(1)}</span>
                            )}
                            {bid.jobs_completed > 0 && (
                              <span>✓ {t('jobDetail.jobsDone', { count: bid.jobs_completed })}</span>
                            )}
                          </div>
                        </div>
                        <div className="jdp-bid-right">
                          <div className="jdp-bid-amount">{formatMoney(bid.amount, { currency: job.currency || 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
                          <div className="jdp-bid-eta">⏱ {t('jobDetail.hoursEstimated', { hours: bid.eta_hours ?? bid.estimated_hours })}</div>
                          <span className={`jdp-bid-status ${bid.status}`}>{t(`jobDetail.bidStatus.${bid.status}`, { defaultValue: bid.status })}</span>
                          {bid.status === 'pending' && bid.needs_reconfirm && <span className="jdp-bid-status pending">{t('jobEdit.awaitingReconfirm')}</span>}
                        </div>
                      </div>
                      {bid.message && <p className="jdp-bid-message">"{bid.message}"</p>}
                      {/* Helper's proposed available times (from BidAvailability) */}
                      {Array.isArray(bid.available_times) && bid.available_times.length > 0 && (
                        <div className="jdp-bid-availability">
                          <span className="jdp-bid-avail-label">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                            {t('jobDetail.helperAvailability', { defaultValue: 'Available:' })}
                          </span>
                          {bid.available_times.slice(0, 3).map((slot, i) => (
                            <span key={i} className="jdp-bid-avail-pill">
                              {formatDate(`${slot.date}T12:00:00`, { weekday: 'short', year: undefined })}
                              {slot.start ? ` · ${slot.start}` : ''}
                            </span>
                          ))}
                          {bid.availability_note && (
                            <span className="jdp-bid-avail-note">{bid.availability_note}</span>
                          )}
                        </div>
                      )}
                      <div className="jdp-bid-footer">
                        <span className="jdp-bid-date">{timeAgo(bid.created_at)}</span>
                        {isOwner && ['published', 'matched', 'negotiating'].includes(job.status) && bid.status === 'pending' && (
                          <button
                            className="jdp-btn-accept"
                            onClick={() => handleAcceptClick(bid)}
                            disabled={actionLoading || loading || loadingPolicies || Boolean(bid.needs_reconfirm)}
                            title={bid.needs_reconfirm ? t('jobEdit.acceptNeedsReconfirm') : undefined}
                          >
                            {t('jobDetail.acceptBid', { defaultValue: 'Accept & Schedule' })}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
      ))}
    </section>
  );

  return (
    <><Navbar /><main className="jdp-page" aria-busy={loading}>
      <PageMeta title={job.title || t('jobDetail.details')} description={job.description?.slice(0, 155) || t('jobDetail.metaDescription')} url={`https://oxsteed.com/jobs/${id}`} noIndex />
      <div className="jdp-topbar"><Link className="jdp-back" to="/jobs">‹ {t('jobDetail.backToJobs')}</Link>
        <span className="jdp-id">JOB-{String(id).slice(0, 8).toUpperCase()}</span></div>
      <section className="jdp-card jdp-summary" aria-labelledby={`${fieldId}-title`}>
        <div className="jdp-summary-content"><div className="jdp-hero-chips">
          {job.category_name && <span className="jdp-chip jdp-chip-cat">{job.category_name}</span>}
          <span className="jdp-chip jdp-status" data-status={job.status}>{statusLabel}</span></div>
          <h1 id={`${fieldId}-title`} className="jdp-title">{job.title || t('jobDetail.details')}</h1>
          <dl className="jdp-meta-strip">
            {location && <div><dt>{t('jobs.location')}</dt><dd>{location}</dd></div>}
            {urgencyMeta && <div><dt>{t('jobs.urgency')}</dt><dd style={{ color: urgencyMeta.color }}>{urgencyMeta.label}</dd></div>}
            {jobTypeLabel && <div><dt>{t('jobDetail.jobType')}</dt><dd>{jobTypeLabel}</dd></div>}
          </dl><p className="jdp-description">{job.description}</p>
          {Number(job.revision) > 1 && <p className="jdp-count">{t('jobEdit.updatedNotice', { revision: job.revision })}</p>}
        </div>
        <div className="jdp-budget"><h2>{t('jobDetail.budgetLabel')}</h2><p className="jdp-budget-value">{formatBudget(job, t)}</p>
          {job.budget_type === 'open' && <p>{t('jobDetail.openBudgetHelp')}</p>}
          {job.budget_type === 'hourly' && <p>{t('jobDetail.hourlyBudgetHelp')}</p>}
        </div>
      </section>
      <div className="jdp-layout">
        <section className="jdp-card jdp-next-step" aria-labelledby={`${fieldId}-next-step`}>
          <h2 id={`${fieldId}-next-step`} className="jdp-section-title">{t('jobDetail.nextStep')}</h2>
          {action ? <><p>{t(`jobDetail.${actionHelp[action] || 'reviewHelp'}`)}</p>
            {action === 'review' ? <ReviewModal jobId={id} revieweeName={isOwner ? (formatNameForPrivacy(job.helper_name) || t('jobDetail.yourHelper')) : (formatNameForPrivacy(job.client_name) || t('jobDetail.yourCustomer'))} onComplete={() => setReviewEligible(false)} />
              : <button type="button" className="jdp-btn-primary" onClick={runNextStep} disabled={actionLoading || loading}>{actionLoading ? t('jobDetail.processing') : t(`jobDetail.${actionLabels[action]}`)}</button>}
          </> : <p role="status">{t(`jobDetail.${['loading', 'idle'].includes(bidsStatus) && user && ['published', 'matched', 'negotiating'].includes(job.status) ? 'checkingBids' : 'noNextStep'}`)}</p>}
          {isOwner && job.status === 'accepted' && <Link className="jdp-btn-ghost" to="/messages">{t('jobDetail.openMessages')}</Link>}
          {isOwner && canEditJob(job, user) && <Link className="jdp-btn-ghost" to={`/jobs/${id}/edit`}>{t('jobEdit.editJob')}</Link>}
          {(view.canCancelBeforeAcceptance || view.canCancelAfterAcceptance) && <div className="jdp-secondary-action">
            <button type="button" className="jdp-btn-danger" onClick={() => view.canCancelBeforeAcceptance ? setShowCancelModal(true) : setShowJobCancellationModal(true)} disabled={actionLoading || loading || (view.canCancelAfterAcceptance && !acceptedBid)}>{t('jobDetail.cancelJob')}</button>
            {view.canCancelAfterAcceptance && !acceptedBid && bidsStatus === 'error' && <button type="button" className="jdp-btn-ghost" onClick={loadBids}>{t('jobDetail.retryBids')}</button>}
          </div>}
        </section>
        <div className="jdp-main">
          <PreferredHelperBanner job={job} />
          {(isOwner || (user && String(job.assigned_helper_id) === String(user.id))) && <PaymentReauthorizationBanner jobId={id} job={job} onResolved={() => fetchJob(id)} />}
          <JobPaymentLayersPanel job={job} isOwner={isOwner} isAssignedHelper={isAssignedHelper} onChanged={() => fetchJob(id)} />
          {ownBidToReconfirm && <section className="jdp-card jdp-reconfirm" role="status" aria-labelledby={`${fieldId}-reconfirm`}>
            <h2 id={`${fieldId}-reconfirm`} className="jdp-section-title">{t('jobEdit.reconfirmTitle')}</h2>
            <p>{t('jobEdit.reconfirmHelp')}</p>
            {ownBidToReconfirm.expires_at && <p className="jdp-count">{t('jobEdit.reconfirmBy', { date: formatDate(ownBidToReconfirm.expires_at, { month: 'long', hour: 'numeric', minute: '2-digit' }) })}</p>}
            <div className="jdp-modal-actions">
              <button type="button" className="jdp-btn-primary" onClick={() => handleReconfirm(ownBidToReconfirm)} disabled={reconfirmLoading}>
                {reconfirmLoading ? t('jobDetail.processing') : t('jobEdit.reconfirmButton')}</button>
              <Link className="jdp-btn-ghost" to="/my-bids">{t('jobEdit.reviseBid')}</Link>
            </div>
          </section>}
          {isOwner && bidsCard}
          {requirementsCard}
          {view.canSubmitBid && <section className="jdp-card jdp-bid-form-card" aria-labelledby={`${fieldId}-bid-form`}>
            <h2 id={`${fieldId}-bid-form`} className="jdp-section-title" tabIndex={-1}>{t('jobDetail.submitYourBid')}</h2>
            {bidError && <p className="jdp-bid-error" role="alert">{bidError}</p>}
              <form onSubmit={handleBidSubmit} className="jdp-bid-form">
                <div className="jdp-bid-form-row">
                  <div className="jdp-field">
                    <label htmlFor={`${fieldId}-amount`}>{t('jobDetail.bidPrice')}</label>
                    <div className="jdp-input-prefix">
                      <span>{job.currency || 'USD'}</span>
                      <input id={`${fieldId}-amount`} type="number" step="0.01" min="1" required
                        value={bidForm.amount}
                        onChange={e => setBidForm(p => ({ ...p, amount: e.target.value }))}
                        placeholder="0.00" />
                    </div>
                  </div>
                  <div className="jdp-field">
                    <label htmlFor={`${fieldId}-hours`}>{t('jobDetail.estimatedHours')}</label>
                    <div className="jdp-input-prefix">
                      <span>⏱</span>
                      <input id={`${fieldId}-hours`} type="number" min="1" required
                        value={bidForm.eta_hours}
                        onChange={e => setBidForm(p => ({ ...p, eta_hours: e.target.value }))}
                        placeholder={t('jobDetail.estimatedHoursPlaceholder')} />
                    </div>
                  </div>
                </div>
                <div className="jdp-field">
                  <label htmlFor={`${fieldId}-message`}>{t('jobDetail.bidMessageLabel')}</label>
                  <textarea id={`${fieldId}-message`} rows={4} required maxLength={500}
                    value={bidForm.message}
                    onChange={e => setBidForm(p => ({ ...p, message: e.target.value }))}
                    placeholder={t('jobDetail.bidMessagePlaceholder')} />
                  <span className="jdp-char-count">{bidForm.message.length} / 500</span>
                </div>
                <button type="submit" className="jdp-btn-primary jdp-bid-submit" disabled={bidLoading}>
                  {bidLoading ? t('jobDetail.submittingBid') : `💼 ${t('jobDetail.submitBid')}`}
                </button>
              </form>
          </section>}
          {!isOwner && bidsCard}
          {canSeeRevisions && <JobRevisionHistory jobId={id} revision={job.revision} version={job.version} load={getJobRevisions} />}
          {mediaUrls.length > 0 && <section className="jdp-card" aria-labelledby={`${fieldId}-media`}>
            <h2 id={`${fieldId}-media`} className="jdp-section-title">{t('jobDetail.photosMedia', { count: mediaUrls.length })}</h2>
            <div className="jdp-media-grid">{mediaUrls.map((url, i) => jobMediaType(url) === 'audio' ?
              <audio key={i} src={url} controls aria-label={t('jobDetail.jobMedia', { number: i + 1 })} /> : jobMediaType(url) === 'video' ?
              <video key={i} src={url} controls playsInline aria-label={t('jobDetail.jobMedia', { number: i + 1 })} /> :
              <button key={i} type="button" className="jdp-media-thumb" onClick={() => setMediaIndex(imageUrls.indexOf(url))} aria-label={t('jobDetail.viewImage', { number: i + 1 })}>
                <img src={url} alt={t('jobDetail.jobMedia', { number: i + 1 })} loading="lazy" /></button>)}</div>
          </section>}
        </div>
        <aside className="jdp-supporting">
          <section className="jdp-card" aria-labelledby={`${fieldId}-details`}>
            <h2 id={`${fieldId}-details`} className="jdp-section-title">{t('jobDetail.details')}</h2>
            <dl className="jdp-detail-rows">
              {job.created_at && <div><dt>{t('jobDetail.posted')}</dt><dd>{formatDate(job.created_at, { month: 'long' })}</dd></div>}
              {daysLeft !== null && <div><dt>{t('jobDetail.expires')}</dt><dd>{daysLeft === 0 ? t('jobDetail.postingExpired') : calendarDate(job.expires_at)}</dd></div>}
              {(job.scheduled_date || job.scheduled_time) && <div><dt>{t('jobDetail.scheduled')}</dt><dd>{job.scheduled_date && calendarDate(job.scheduled_date)}{job.scheduled_date && job.scheduled_time && ` ${t('jobDetail.at')} `}{job.scheduled_time && String(job.scheduled_time).substring(0, 5)}</dd></div>}
              {job.location_address && <div><dt>{t('jobDetail.addressLabel')}</dt><dd>{job.location_address}</dd></div>}
            </dl>
            {job.client_name && <div className="jdp-participant"><h3 className="jdp-small-heading">{t('jobDetail.postedBy')}</h3><div className="jdp-client-row"><span className="jdp-client-avatar" aria-hidden="true">{initials(job.client_name)}</span><p>{formatNameForPrivacy(job.client_name)}</p></div></div>}
            {job.helper_name && job.assigned_helper_id && <div className="jdp-participant"><h3 className="jdp-small-heading">{t('jobDetail.assignedHelper')}</h3><div className="jdp-client-row"><span className="jdp-client-avatar" aria-hidden="true">{initials(job.helper_name)}</span><p>{formatNameForPrivacy(job.helper_name)}</p></div></div>}
          </section>
          {job.client_id && !isOwner && <CancellationStats userId={job.client_id} type="customer" showDetails={false} />}
          {job.assigned_helper_id && <><UserReputationCard userId={job.assigned_helper_id} />
            {user && !isOwner && <button className="jdp-btn-danger" onClick={() => setReportModalOpen(true)}>{t('jobDetail.reportHelper')}</button>}</>}
          {LAUNCH_VISIBILITY.jobMaterialsLogistics && isHelper && job.category_name && <JobMaterialsPanel category={job.category_name} jobId={id} />}
        </aside>
      </div>
      {mediaIndex !== null && <JobImageViewer images={imageUrls} index={mediaIndex} onIndexChange={setMediaIndex} onClose={() => setMediaIndex(null)} />}
      {/* ── Cancel modal ─────────────────────────────────────────────── */}
      {showCancelModal && (
        <div className="jdp-modal-overlay" onClick={() => setShowCancelModal(false)}>
          <div ref={cancelDialog} className="jdp-modal" role="dialog" aria-modal="true" aria-labelledby={`${fieldId}-cancel-title`} onClick={e => e.stopPropagation()}>
            <h3 id={`${fieldId}-cancel-title`}>{t('jobDetail.cancelTitle')}</h3>
            <p>{t('jobDetail.cancelHelp')}</p>
            <label htmlFor={`${fieldId}-cancel-reason`}>{t('jobDetail.cancelReasonLabel')}</label>
            <textarea id={`${fieldId}-cancel-reason`}
              className="jdp-modal-textarea"
              rows={3}
              placeholder={t('jobDetail.cancelPlaceholder')}
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
            />
            <div className="jdp-modal-actions">
              <button className="jdp-btn-ghost" onClick={() => setShowCancelModal(false)}>{t('jobDetail.keepJob')}</button>
              <button className="jdp-btn-danger" onClick={handleCancel} disabled={actionLoading}>
                {actionLoading ? t('jobDetail.cancelling') : t('jobDetail.cancelJob')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bid Acceptance Modal (Payment Method Selection) ─────────── */}
      {acceptingBid && (
        <BidAcceptanceModal
          bid={acceptingBid}
          helperPolicies={helperPolicies}
          onCancel={() => {
            setAcceptingBid(null);
            setHelperPolicies(null);
          }}
          onConfirm={(bidData) => {
            // bidData should contain payment_method
            // Legacy: { payment_method }. Rail engine: the full selection.
            handleAssign(acceptingBid.id, bidData.payment_rail ? bidData : bidData.payment_method);
          }}
        />
      )}

      {/* ── Job Cancellation Modals (role-aware Phase 2) ────────────── */}
      {showJobCancellationModal && job && acceptedBid && isOwner && (
        /* Customer sees: helper name+avatar, blocked time, fee, acknowledge */
        <JobCancellationConfirmation
          job={job}
          bid={acceptedBid}
          helperName={job.helper_name ? formatNameForPrivacy(job.helper_name) : null}
          helperAvatar={job.helper_avatar || null}
          onCancel={() => setShowJobCancellationModal(false)}
          onConfirm={handleJobCancellation}
        />
      )}
      {showJobCancellationModal && job && acceptedBid && isAssignedHelper && (
        /* Helper sees: customer reliability, own pattern, no fee, acknowledge */
        <HelperCancellationConfirmation
          job={job}
          customerName={job.client_name ? formatNameForPrivacy(job.client_name) : null}
          customerAvatar={job.client_avatar || null}
          helperId={user?.id}
          onCancel={() => setShowJobCancellationModal(false)}
          onConfirm={handleJobCancellation}
        />
      )}

      {/* ── Report Helper Modal ──────────────────────────────── */}
      {reportModalOpen && job?.assigned_helper_id && (
        <ReportModal
          reportedUserId={job.assigned_helper_id}
          reportedName={job.helper_name ? formatNameForPrivacy(job.helper_name) : t('jobDetail.theHelper')}
          onClose={() => setReportModalOpen(false)}
        />
      )}

      {/* ── Direct Payment Record Modal ─────────────────────────── */}
      <DirectPaymentRecordModal
        isOpen={paymentRecordOpen}
        title={t('jobDetail.recordDirectPaymentTitle')}
        subtitle={t('jobDetail.recordDirectPaymentSubtitle')}
        sourceType="job"
        sourceId={job?.id}
        sourceLabel={job?.title ? t('jobDetail.jobPaymentFor', { title: job.title }) : t('jobDetail.jobPayment')}
        amountCents={Math.round((acceptedBid?.amount || job?.budget_max || job?.budget_min || 0) * 100)}
        currencyCode={job?.currency || 'USD'}
        payerId={job?.client_id}
        payeeId={job?.assigned_helper_id}
        onClose={() => setPaymentRecordOpen(false)}
        onSuccess={() => {
          fetchJob(id);
        }}
      />

    </main><Footer /></>
  );
}
