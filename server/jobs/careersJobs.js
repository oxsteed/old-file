// server/jobs/careersJobs.js
// Careers background work (spec §13). Each sweep runs under its own fenced
// job lock so only one instance does the work, and each is safe to re-run.
//
//   careerOfferExpiry    every 15 min  expire overdue offers, 24 h warnings,
//                                      lapse old invitations
//   careerOnboardingResume every 5 min resume onboarding runs a crash stopped
//   careerBoostExpiry    hourly        end boosts and hiring events
//   careerRetention      nightly       anonymize applications past their
//                                      jurisdiction's retention (Q18)
//   careerFacts          nightly       recompute profile facts from records
//   careerFairness       monthly       impact-ratio check (auto-off < 0.8),
//                                      quarterly adverse-impact reports

const pool = require('../db');
const logger = require('../utils/logger');
const { withFencedJobLock } = require('./jobLockingService');
const { withTransaction } = require('../utils/transaction');
const offers = require('../services/careers/offers');
const onboarding = require('../services/careers/onboardingRun');
const billing = require('../services/careers/billing');
const retention = require('../services/careers/retention');
const { computeFacts } = require('../services/careers/profileFacts');
const fairness = require('../services/careers/fairness');

const SCHEDULES = {
  offerExpiry: '0 */15 * * * *',
  onboardingResume: '30 */5 * * * *',
  boostExpiry: '0 5 * * * *',
  retention: '0 15 3 * * *',
  facts: '0 40 3 * * *',
  fairness: '0 0 4 1 * *',
};

async function locked(name, ttl, fn) {
  let result = { locked: false };
  await withFencedJobLock(name, async (fence) => {
    fence.assertActive();
    result = { locked: true, ...(await fn()) };
  }, ttl, { throwOnError: true });
  return result;
}

const runOfferExpiry = () => locked('career-offer-expiry', 600, () => withTransaction(pool, (c) => offers.sweepOffers(c), 'career_offer_expiry'));

const runOnboardingResume = () => locked('career-onboarding-resume', 600, async () => {
  const resumed = await onboarding.resumeStalled({});
  return { resumed: Array.isArray(resumed) ? resumed.length : resumed };
});

const runBoostExpiry = () => locked('career-boost-expiry', 600, () => withTransaction(pool, (c) => billing.sweepExpired(c), 'career_boost_expiry'));

const runRetention = () => locked('career-retention', 3600, () => retention.sweepExpired({}));

/**
 * Facts come only from OxSteed records (§9.1). Recompute for profiles,
 * stalest first.
 */
async function runFacts({ limit = 5000 } = {}) {
  return locked('career-facts', 3600, async () => {
    const { rows } = await pool.query(
      `SELECT p.user_id FROM career_profiles p
         JOIN users u ON u.id = p.user_id AND u.deleted_at IS NULL
        ORDER BY (SELECT MAX(f.computed_at) FROM career_profile_facts f WHERE f.user_id = p.user_id) ASC NULLS FIRST
        LIMIT $1`,
      [limit]
    );
    let computed = 0;
    let failed = 0;
    for (const { user_id: userId } of rows) {
      try {
        await withTransaction(pool, (c) => computeFacts(c, userId), 'career_facts');
        computed += 1;
      } catch (err) {
        failed += 1;
        logger.warn('careers: fact recompute failed', { userId, error: err.message });
      }
    }
    return { computed, failed };
  });
}

function previousMonth(now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 1));
  return { periodStart: start.toISOString().slice(0, 10), periodEnd: end.toISOString().slice(0, 10) };
}

function previousQuarter(now = new Date()) {
  const q = Math.floor(now.getUTCMonth() / 3);
  const end = new Date(Date.UTC(now.getUTCFullYear(), q * 3, 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 3, 1));
  return { periodStart: start.toISOString().slice(0, 10), periodEnd: end.toISOString().slice(0, 10) };
}

async function runFairness(now = new Date()) {
  return locked('career-fairness', 3600, async () => {
    const ranking = await fairness.runRankingCheck(previousMonth(now));
    let quarterly = null;
    if (now.getUTCMonth() % 3 === 0) quarterly = await fairness.runQuarterlyReports(previousQuarter(now));
    return { ranking, quarterly };
  });
}

const JOBS = [
  ['offerExpiry', runOfferExpiry],
  ['onboardingResume', runOnboardingResume],
  ['boostExpiry', runBoostExpiry],
  ['retention', runRetention],
  ['facts', runFacts],
  ['fairness', runFairness],
];

function startCareersJobs() {
  const cron = require('node-cron');
  for (const [name, run] of JOBS) {
    cron.schedule(SCHEDULES[name], async () => {
      try {
        const result = await run();
        logger.info(`careers job ${name} finished`, result);
      } catch (err) {
        logger.error(`careers job ${name} failed`, { error: err.message });
      }
    });
  }
  logger.info('Careers jobs scheduled', SCHEDULES);
}

module.exports = {
  SCHEDULES,
  startCareersJobs,
  runOfferExpiry,
  runOnboardingResume,
  runBoostExpiry,
  runRetention,
  runFacts,
  runFairness,
  previousMonth,
  previousQuarter,
};
