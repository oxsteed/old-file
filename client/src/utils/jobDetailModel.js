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

export function jobDetailView({ job, user, bids = [], bidsStatus = 'idle', canApplyToJobs = false, needsOnboarding = false, reviewEligible = false }) {
  const isOwner = Boolean(user && samePartyId(user.id, job.client_id));
  const isAssignedHelper = Boolean(user && !isOwner && samePartyId(user.id, job.assigned_helper_id));
  const isHelper = Boolean(user && ['helper', 'helper_pro', 'broker'].includes(user.role));
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
  else if (isHelper && job.status === 'published') {
    if (bidsStatus === 'error') action = 'retry';
    else if (bidsStatus === 'success' && needsOnboarding) action = 'onboarding';
    else if (bidsStatus === 'success' && canApplyToJobs) action = 'bid';
  } else if (!user && job.status === 'published') action = 'signIn';
  return { isOwner, isAssignedHelper, isHelper, visibleBids, hasAlreadyBid, totalBids, action,
    canSubmitBid: !isOwner && isHelper && job.status === 'published' && bidsStatus === 'success' && !hasAlreadyBid && canApplyToJobs,
    canCancelBeforeAcceptance: isOwner && ['published', 'matched', 'negotiating'].includes(job.status),
    canCancelAfterAcceptance: (isOwner || (isAssignedHelper && isHelper)) && ['accepted', 'in_progress'].includes(job.status),
  };
}
