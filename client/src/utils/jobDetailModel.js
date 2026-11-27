export function samePartyId(left, right) {
  return ['string', 'number'].includes(typeof left) && ['string', 'number'].includes(typeof right)
    && String(left).trim() !== '' && String(right).trim() !== ''
    && String(left).trim() === String(right).trim();
}

export function jobList(raw) {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(value) ? value.filter(item => item != null) : [];
  } catch { return []; }
}

export function matchingHelpersPath(skills) {
  const ids = [...new Set(jobList(skills).map(skill => skill?.id).filter(id => ['string', 'number'].includes(typeof id) && /^[a-zA-Z0-9-]+$/.test(String(id))))];
  return ids.length ? `/helpers?requiredSkillIds=${encodeURIComponent(ids.join(','))}` : '/helpers';
}

export function jobMediaType(url) {
  if (/\.(mp3|wav|ogg|m4a)(\?|$)/i.test(url)) return 'audio';
  if (/\.(mp4|mov|webm)(\?|$)/i.test(url)) return 'video';
  return 'image';
}

export const JOB_STATUS_KEYS = {
  draft: 'draftStatus', published: 'acceptingBids', matched: 'matchedStatus', negotiating: 'negotiatingStatus',
  accepted: 'helperChosen', in_progress: 'inProgress', completed: 'completed', closed: 'closed', cancelled: 'cancelled',
};

// Open statuses still accept bids (shared with server/services/jobStatusPolicy.js).
export const BIDDABLE_JOB_STATUSES = Object.freeze(['published', 'matched', 'negotiating']);

export function jobDetailView({ job, user, bids = [], bidsStatus = 'idle', canApplyToJobs = false, needsOnboarding = false, reviewEligible = false, hasHelperAccess = false }) {
  const isOwner = Boolean(user && samePartyId(user.id, job.client_id));
  const isAssignedHelper = Boolean(user && !isOwner && samePartyId(user.id, job.assigned_helper_id));
  const isHelper = Boolean(user && (['helper', 'helper_pro', 'broker'].includes(user.role) || hasHelperAccess));
  const validBids = jobList(bids).filter(bid => typeof bid === 'object');
  const visibleBids = isOwner ? validBids : validBids.filter(bid => user && samePartyId(bid.helper_id, user.id));
  const hasAlreadyBid = visibleBids.some(bid => user && samePartyId(bid.helper_id, user.id));
  const totalBids = job.bid_count != null && Number.isFinite(Number(job.bid_count)) && Number(job.bid_count) >= 0 ? Number(job.bid_count) : null;
  const isDone = ['completed', 'closed'].includes(job.status);
  let action = null;
  if (isDone && (isOwner || isAssignedHelper) && reviewEligible) action = 'review';
  else if (isOwner) {
    if (job.status === 'accepted') action = 'payment';
    else if (job.status === 'in_progress') action = 'complete';
    else if (['published', 'matched', 'negotiating'].includes(job.status)) {
      if (bidsStatus === 'error') action = 'retry';
      else if (bidsStatus === 'success' && (visibleBids.length > 0 || totalBids > 0)) action = 'reviewBids';
      else if (bidsStatus === 'success' && job.status === 'published') action = 'findHelpers';
    }
  } else if (isAssignedHelper && isHelper && job.status === 'accepted') action = 'start';
  else if (isAssignedHelper && isHelper && job.status === 'in_progress') action = 'messages';
  else if (isHelper && hasAlreadyBid && bidsStatus === 'success') action = 'manageBid';
  else if (isHelper && BIDDABLE_JOB_STATUSES.includes(job.status)) {
    if (bidsStatus === 'error') action = 'retry';
    else if (bidsStatus === 'success' && needsOnboarding) action = 'onboarding';
    else if (bidsStatus === 'success' && canApplyToJobs) action = 'bid';
  } else if (!user && job.status === 'published') action = 'signIn';
  const completionPending = job.status === 'in_progress' && Boolean(job.completion_requested_at);
  return { isOwner, isAssignedHelper, isHelper, visibleBids, hasAlreadyBid, totalBids, action,
    completionPending,
    // Review P2-478: the assigned helper can mark the job done.
    canHelperComplete: isAssignedHelper && isHelper && job.status === 'in_progress' && !completionPending,
    // Review P1-133: either party can close a completed job.
    canClose: (isOwner || isAssignedHelper) && job.status === 'completed',
    expiryDaysLeft: acceptedExpiryDaysLeft(job),
    canSubmitBid: !isOwner && isHelper && BIDDABLE_JOB_STATUSES.includes(job.status) && bidsStatus === 'success' && !hasAlreadyBid && canApplyToJobs,
    canCancelBeforeAcceptance: isOwner && ['published', 'matched', 'negotiating'].includes(job.status),
    canCancelAfterAcceptance: (isOwner || (isAssignedHelper && isHelper)) && ['accepted', 'in_progress'].includes(job.status),
  };
}

// Review P1-132: days until the accepted-job auto-cancel (7 days after
// acceptance unless work starts). null when not applicable.
// G1-A4 (item 16): chronological job status timeline. Every event comes
// from a timestamp the server already serializes — the job row's own
// created_at / accepted_at / started_at / completed_at / cancelled_at
// (getJob selects all five; serializeJob passes them through, they are in
// none of the stripped lists) plus the earliest visible bid's created_at
// (GET /bids/job/:jobId selects b.created_at; helpers are server-filtered
// to their own bid, so their timeline shows their own bid, never another
// helper's). Events that have not happened yet are omitted, never
// fabricated; an invalid or missing timestamp drops its event. No
// owner-only field is read here, so the timeline is safe for every viewer
// the page already admits.
export const JOB_TIMELINE_KEYS = Object.freeze({
  posted: 'timelinePosted',
  bidsReceived: 'timelineBidsReceived',
  accepted: 'timelineAccepted',
  started: 'timelineStarted',
  completed: 'timelineCompleted',
  cancelled: 'timelineCancelled',
});
export function buildJobTimeline(job, bids = []) {
  if (!job || typeof job !== 'object') return [];
  const atMs = (value) => {
    if (value == null || value === '') return null;
    const ms = value instanceof Date ? value.getTime() : Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  };
  const events = [];
  const push = (key, value, extra = {}) => {
    const ms = atMs(value);
    if (ms == null) return;
    events.push({ key, at: value instanceof Date ? value.toISOString() : value, ms, ...extra });
  };
  push('posted', job.created_at);
  // First bid received: the earliest created_at among the bids this viewer
  // may see. The list endpoint pages (50 by default, newest first), so on
  // a job with more bids than the loaded page this is the earliest loaded
  // bid, not necessarily the job's first bid ever — the count below is the
  // job's own bid_count, which stays exact.
  const bidTimes = jobList(bids).map((bid) => atMs(bid?.created_at)).filter((ms) => ms != null);
  if (bidTimes.length > 0) {
    const earliest = Math.min(...bidTimes);
    events.push({ key: 'bidsReceived', at: new Date(earliest).toISOString(), ms: earliest, count: bidTimes.length });
  }
  push('accepted', job.accepted_at);
  push('started', job.started_at);
  push('completed', job.completed_at);
  push('cancelled', job.cancelled_at);
  // Chronological; ties keep lifecycle order (posted, bids, accepted,
  // started, completed/cancelled) because Array.sort is stable.
  events.sort((a, b) => a.ms - b.ms);
  return events.map(({ key, at, count }) => (count == null ? { key, at } : { key, at, count }));
}

export const ACCEPTED_JOB_EXPIRY_DAYS = 7;
export function acceptedExpiryDaysLeft(job, now = Date.now()) {
  if (!job || job.status !== 'accepted' || !job.accepted_at || job.started_at) return null;
  const acceptedMs = Date.parse(job.accepted_at);
  if (!Number.isFinite(acceptedMs)) return null;
  const elapsedDays = (now - acceptedMs) / 86_400_000;
  return Math.max(0, Math.ceil(ACCEPTED_JOB_EXPIRY_DAYS - elapsedDays));
}
