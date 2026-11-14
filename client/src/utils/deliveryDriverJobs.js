// Open-jobs feed for the Driving tab: which posted marketplace jobs a driver
// can see. Availability gates the FEED only. An offline driver (available
// !== true, including null/undefined on profiles created before the flag
// existed) sees no open jobs. Claiming itself is not gated here: the claim
// predicate in DeliveryCard and the server claim path never read `available`.
export function selectOpenJobs(jobs, { helperMode, available, userId } = {}) {
  if (helperMode !== true || available !== true) return [];
  return (jobs || []).filter((job) => job.status === 'posted'
    && job.marketplace_available === true
    && String(job.customer_user_id) !== String(userId));
}
