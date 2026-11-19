// Admin → Invest review queue (OxSteed Invest, Track 4).
//
// Capability-scoped review over /api/invest/review-queue: participation
// applications, opportunity publish reviews, closing approvals, and
// proceeds release. The server scopes every queue to the caller's own
// review permissions and refuses self-approval and stale versions; this
// page only renders what it is given, sends the version it rendered, and
// surfaces the server's 403/409 clearly. Close, proceeds release, and
// distributions render inert with a gate notice while the live
// commitment gate (INVEST_COMMITMENTS_ENABLED) is off. Flags come from
// GET /api/me/access through investAccessFromProjection only; no role
// or mode is read here.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import {
  getReviewQueue, getOpportunity, reviewApplication, reviewOpportunity,
  publishOpportunity, approveClosingConditions, recordClosingApproval,
  closeOpportunity, releaseProceeds, recordDistribution, reviewAmendment,
  failCloseOpportunity,
} from '../../api/invest';
import { investAccessFromProjection, formatInvestCents, fundingProgress, opportunityStatusLabel, applicationStatusLabel, amendmentStatusLabel, parseAmountToCents, reviewQueueTabLabel, opportunityDetailFieldLabel } from '../../utils/invest';

function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const errorCode = (err) => err?.response?.data?.code || null;
const errorMessage = (err) => err?.response?.data?.error || err?.message || null;

const SELF_CODES = new Set([
  'invest_application_self_review',
  'invest_opportunity_self_review',
  'invest_opportunity_self_publish',
  'invest_close_self_approval',
  'invest_proceeds_self_release',
  'invest_close_same_approver',
  'invest_close_executor_mismatch',
  'invest_fail_close_self_approval',
  'invest_amendment_self_review',
]);
const VERSION_CODES = new Set([
  'invest_application_version_conflict',
  'invest_opportunity_version_conflict',
]);

function errorKey(code) {
  if (SELF_CODES.has(code)) return 'invest.review.errors.selfApproval';
  if (VERSION_CODES.has(code)) return 'invest.review.errors.versionConflict';
  if (code === 'invest_proceeds_blocked') return 'invest.review.errors.proceedsBlocked';
  if (code === 'invest_review_not_permitted') return 'invest.review.errors.notPermitted';
  if (code === 'invest_opportunity_no_agreement') return 'invest.review.errors.noAgreement';
  if (code === 'invest_opportunity_transition_invalid') return 'invest.review.errors.transitionInvalid';
  if (code === 'invest_fail_close_status_invalid') return 'invest.review.errors.transitionInvalid';
  if (code === 'invest_amendment_review_invalid') return 'invest.review.errors.transitionInvalid';
  if (code === 'invest_amendment_reconfirmation_pending') return 'invest.review.errors.reconfirmationPending';
  return null;
}

const selectCls = 'mt-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';
const inputCls = 'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';
const primaryBtn = 'rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50';
const dangerBtn = 'rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50';
const secondaryBtn = 'rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-900 dark:border-gray-600 dark:text-gray-100 disabled:opacity-50';

function ApplicationDetail({ t, item, onDecided }) {
  const [identityVerified, setIdentityVerified] = useState(!!item.identityVerified);
  const [authorityVerified, setAuthorityVerified] = useState(!!item.authorityVerified);
  const [note, setNote] = useState(item.reviewNote || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const decide = async (decision) => {
    if (decision === 'needs_information' && !note.trim()) {
      setError(t('invest.review.application.noteRequired'));
      return;
    }
    if (decision === 'approved' && (!identityVerified || !authorityVerified)) {
      setError(t('invest.review.application.verifyRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await reviewApplication(item.id, {
        decision,
        identityVerified,
        authorityVerified,
        reviewNote: note.trim() || null,
        expectedVersion: item.expectedVersion,
      });
      onDecided();
    } catch (err) {
      const key = errorKey(errorCode(err));
      setError(key ? t(key) : (errorMessage(err) || t('invest.review.errors.generic')));
      if (VERSION_CODES.has(errorCode(err))) onDecided();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{item.opportunityTitle}</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {applicationStatusLabel(item.status, t)}
          {item.createdAt ? ` · ${formatDate(item.createdAt)}` : ''}
        </p>
      </header>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        <dt className="text-gray-500">{t('invest.review.application.applicant')}</dt>
        <dd className="break-all text-gray-900 dark:text-gray-100">{item.userId}</dd>
        <dt className="text-gray-500">{t('invest.review.application.identity')}</dt>
        <dd className="text-gray-900 dark:text-gray-100">{t(item.identityVerified ? 'invest.common.yes' : 'invest.review.application.no')}</dd>
        <dt className="text-gray-500">{t('invest.review.application.authority')}</dt>
        <dd className="text-gray-900 dark:text-gray-100">{t(item.authorityVerified ? 'invest.common.yes' : 'invest.review.application.no')}</dd>
        <dt className="text-gray-500">{t('invest.review.application.agreementAccepted')}</dt>
        <dd className="text-gray-900 dark:text-gray-100">{item.agreementAcceptedAt ? formatDate(item.agreementAcceptedAt) : t('invest.review.application.no')}</dd>
        <dt className="text-gray-500">{t('invest.review.application.version')}</dt>
        <dd className="text-gray-900 dark:text-gray-100">{item.expectedVersion}</dd>
      </dl>
      {item.eligibility && Object.keys(item.eligibility).length > 0 ? (
        <section>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t('invest.review.application.eligibility')}</h3>
          <dl className="mt-1 space-y-1 text-sm">
            {Object.entries(item.eligibility).map(([key, value]) => (
              <div key={key} className="grid grid-cols-1 gap-x-4 sm:grid-cols-3">
                <dt className="text-gray-500">{key}</dt>
                <dd className="break-words text-gray-900 dark:text-gray-100 sm:col-span-2">{String(value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      {item.reviewNote ? (
        <p className="text-sm text-amber-700 dark:text-amber-200">{item.reviewNote}</p>
      ) : null}
      <section className="space-y-3">
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input type="checkbox" checked={identityVerified} onChange={(e) => setIdentityVerified(e.target.checked)} />
          {t('invest.review.application.confirmIdentity')}
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input type="checkbox" checked={authorityVerified} onChange={(e) => setAuthorityVerified(e.target.checked)} />
          {t('invest.review.application.confirmAuthority')}
        </label>
        <label className="block text-sm text-gray-700 dark:text-gray-200">
          {t('invest.review.application.note')}
          <textarea className={inputCls} rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {error ? <p className="text-sm text-red-600 dark:text-red-300" role="alert">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => decide('approved')} className={primaryBtn}>{t('invest.review.actions.approve')}</button>
          <button type="button" disabled={busy} onClick={() => decide('declined')} className={dangerBtn}>{t('invest.review.actions.decline')}</button>
          <button type="button" disabled={busy} onClick={() => decide('needs_information')} className={secondaryBtn}>{t('invest.review.actions.needsInformation')}</button>
        </div>
      </section>
    </div>
  );
}

function AmendmentDetail({ t, item, onDecided }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const reconfirmation = item.reconfirmation || null;
  const changes = item.changes && typeof item.changes === 'object' ? item.changes : {};

  const decide = async (decision) => {
    setBusy(true);
    setError(null);
    try {
      await reviewAmendment(item.id, decision, {
        note: note.trim() || null,
        expectedVersion: item.expectedVersion,
      });
      onDecided();
    } catch (err) {
      const key = errorKey(errorCode(err));
      setError(key ? t(key) : (errorMessage(err) || t('invest.review.errors.generic')));
      if (VERSION_CODES.has(errorCode(err))) onDecided();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{item.opportunityTitle}</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {amendmentStatusLabel(item.status, t)}
          {item.noticeSentAt ? ` · ${formatDate(item.noticeSentAt)}` : ''}
        </p>
      </header>
      {Object.keys(changes).length > 0 ? (
        <section>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t('invest.review.amendments.changes')}</h3>
          <dl className="mt-1 space-y-1 text-sm">
            {Object.entries(changes).map(([key, value]) => (
              <div key={key} className="grid grid-cols-1 gap-x-4 sm:grid-cols-3">
                <dt className="text-gray-500">{key}</dt>
                <dd className="break-words text-gray-900 dark:text-gray-100 sm:col-span-2">{String(value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      <section>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t('invest.review.amendments.reconfirmationTitle')}</h3>
        {reconfirmation ? (
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            {t('invest.review.amendments.reconfirmation', {
              reconfirmed: reconfirmation.reconfirmed,
              total: reconfirmation.total,
              pending: reconfirmation.pending,
            })}
          </p>
        ) : (
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{t('invest.review.amendments.reconfirmationNone')}</p>
        )}
        {reconfirmation?.pendingUserIds?.length > 0 ? (
          <div className="mt-2">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{t('invest.review.amendments.reconfirmationPendingUsers')}</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-gray-600 dark:text-gray-300">
              {reconfirmation.pendingUserIds.map((userId) => (
                <li key={userId} className="break-all">{userId}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {item.reconfirmationDeadlineAt ? (
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            {t('invest.review.amendments.deadline', { date: formatDate(item.reconfirmationDeadlineAt) || '' })}
          </p>
        ) : null}
      </section>
      <section className="space-y-3">
        <label className="block text-sm text-gray-700 dark:text-gray-200">
          {t('invest.review.amendments.note')}
          <textarea className={inputCls} rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {error ? <p className="text-sm text-red-600 dark:text-red-300" role="alert">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => decide('effective')} className={primaryBtn}>{t('invest.review.amendments.makeEffective')}</button>
          <button type="button" disabled={busy} onClick={() => decide('rejected')} className={dangerBtn}>{t('invest.review.amendments.reject')}</button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">{t('invest.review.amendments.effectiveNote')}</p>
      </section>
    </div>
  );
}

function OpportunityDetail({ t, item, detail, gateOn, onDecided }) {
  const [note, setNote] = useState('');
  const [verifiedItems, setVerifiedItems] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [closingNote, setClosingNote] = useState('');
  const [failCloseReason, setFailCloseReason] = useState('');
  const [distribution, setDistribution] = useState({ positionId: '', amount: '' });
  const [distributionNotice, setDistributionNotice] = useState(null);

  const opportunity = detail?.opportunity || item;
  const funding = detail?.funding || {};
  const progress = fundingProgress(funding.targetCents ?? opportunity.targetCents, funding.reservedCents, funding.completedCents);
  const approvals = detail?.closingApprovals || [];
  const reviewApproval = approvals.find((a) => a.stage === 'review' && a.decision === 'approved');
  const executionApproval = approvals.find((a) => a.stage === 'execution' && a.decision === 'approved');
  const positions = detail?.positions || [];
  const details = opportunity.details || {};

  const act = async (fn, { reload = true } = {}) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (reload) onDecided();
    } catch (err) {
      const key = errorKey(errorCode(err));
      setError(key ? t(key) : (errorMessage(err) || t('invest.review.errors.generic')));
      if (VERSION_CODES.has(errorCode(err)) && reload) onDecided();
    } finally {
      setBusy(false);
    }
  };

  const review = (action) => act(() => reviewOpportunity(opportunity.id, {
    action,
    note: note.trim() || null,
    verificationSummary: action === 'approve' && verifiedItems.trim()
      ? { verifiedItems: verifiedItems.split('\n').map((s) => s.trim()).filter(Boolean) }
      : null,
    expectedVersion: opportunity.expectedVersion,
  }));

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{opportunity.title}</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {opportunityStatusLabel(opportunity.status, t)}
          {opportunity.deadlineAt ? ` · ${formatDate(opportunity.deadlineAt)}` : ''}
        </p>
      </header>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        <dt className="text-gray-500">{t('invest.review.opportunity.target')}</dt>
        <dd className="text-gray-900 dark:text-gray-100">{formatInvestCents(opportunity.targetCents, 'USD')}</dd>
        <dt className="text-gray-500">{t('invest.review.opportunity.minimum')}</dt>
        <dd className="text-gray-900 dark:text-gray-100">{formatInvestCents(opportunity.minimumCents, 'USD')}</dd>
        <dt className="text-gray-500">{t('invest.review.opportunity.committed')}</dt>
        <dd className="text-gray-900 dark:text-gray-100">
          {formatInvestCents(progress.reservedCents, 'USD')}
          {` · ${t('invest.review.opportunity.progress', { percent: progress.percent })}`}
        </dd>
        <dt className="text-gray-500">{t('invest.review.opportunity.purpose')}</dt>
        <dd className="text-gray-900 dark:text-gray-100">{opportunity.purpose}</dd>
        <dt className="text-gray-500">{t('invest.review.opportunity.valuation')}</dt>
        <dd className="text-gray-900 dark:text-gray-100">{opportunity.valuationRule || t('invest.common.notSet')}</dd>
        <dt className="text-gray-500">{t('invest.review.opportunity.useOfProceeds')}</dt>
        <dd className="text-gray-900 dark:text-gray-100">{opportunity.useOfProceeds || t('invest.common.notSet')}</dd>
        <dt className="text-gray-500">{t('invest.review.opportunity.version')}</dt>
        <dd className="text-gray-900 dark:text-gray-100">{opportunity.expectedVersion}</dd>
      </dl>
      {details.legalDetails || details.financials || details.ownership || details.risks || details.relatedParties ? (
        <section>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t('invest.review.opportunity.details')}</h3>
          <dl className="mt-1 space-y-2 text-sm">
            {['legalDetails', 'financials', 'ownership', 'risks', 'relatedParties'].map((key) => (details[key] ? (
              <div key={key}>
                <dt className="text-gray-500">{opportunityDetailFieldLabel(key, t)}</dt>
                <dd className="break-words text-gray-900 dark:text-gray-100">{details[key]}</dd>
              </div>
            ) : null))}
          </dl>
        </section>
      ) : null}
      {opportunity.verificationSummary?.reviewNote ? (
        <p className="text-sm text-amber-700 dark:text-amber-200">{opportunity.verificationSummary.reviewNote}</p>
      ) : null}

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t('invest.review.opportunity.decideTitle')}</h3>
        <label className="block text-sm text-gray-700 dark:text-gray-200">
          {t('invest.review.opportunity.note')}
          <textarea className={inputCls} rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {opportunity.status === 'under_review' ? (
          <label className="block text-sm text-gray-700 dark:text-gray-200">
            {t('invest.review.opportunity.verifiedItems')}
            <textarea className={inputCls} rows={3} value={verifiedItems} onChange={(e) => setVerifiedItems(e.target.value)} />
          </label>
        ) : null}
        {error ? <p className="text-sm text-red-600 dark:text-red-300" role="alert">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          {opportunity.status === 'submitted' ? (
            <button type="button" disabled={busy} onClick={() => review('claim')} className={secondaryBtn}>{t('invest.review.actions.claim')}</button>
          ) : null}
          {opportunity.status === 'under_review' ? (
            <>
              <button type="button" disabled={busy} onClick={() => review('approve')} className={primaryBtn}>{t('invest.review.actions.approve')}</button>
              <button type="button" disabled={busy} onClick={() => review('decline')} className={dangerBtn}>{t('invest.review.actions.decline')}</button>
            </>
          ) : null}
          {opportunity.status === 'approved' ? (
            <button type="button" disabled={busy} onClick={() => act(() => publishOpportunity(opportunity.id, opportunity.expectedVersion))} className={primaryBtn}>
              {t('invest.review.actions.publish')}
            </button>
          ) : null}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">{t('invest.review.opportunity.publishNote')}</p>
      </section>

      {['published', 'closing', 'closed'].includes(opportunity.status) ? (
        <section className="space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t('invest.review.closing.title')}</h3>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {opportunity.closingConditionsApprovedAt
              ? t('invest.review.closing.conditionsApproved', { date: formatDate(opportunity.closingConditionsApprovedAt) || '' })
              : t('invest.review.closing.conditionsPending')}
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {reviewApproval
              ? t('invest.review.closing.reviewApproved', { approver: reviewApproval.approverUserId })
              : t('invest.review.closing.reviewPending')}
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {executionApproval
              ? t('invest.review.closing.executionApproved', { approver: executionApproval.approverUserId })
              : t('invest.review.closing.executionPending')}
          </p>
          {!gateOn ? (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-200" role="note">
              {t('invest.review.closing.gateOff')}
            </p>
          ) : null}
          <label className="block text-sm text-gray-700 dark:text-gray-200">
            {t('invest.review.closing.note')}
            <textarea className={inputCls} rows={2} maxLength={2000} value={closingNote} onChange={(e) => setClosingNote(e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            {!opportunity.closingConditionsApprovedAt ? (
              <button type="button" disabled={busy} onClick={() => act(() => approveClosingConditions(opportunity.id))} className={secondaryBtn}>
                {t('invest.review.closing.approveConditions')}
              </button>
            ) : null}
            {!reviewApproval ? (
              <button type="button" disabled={busy} onClick={() => act(() => recordClosingApproval(opportunity.id, { stage: 'review', decision: 'approved', note: closingNote.trim() || null }))} className={secondaryBtn}>
                {t('invest.review.closing.approveReview')}
              </button>
            ) : null}
            {reviewApproval && !executionApproval ? (
              <button type="button" disabled={busy} onClick={() => act(() => recordClosingApproval(opportunity.id, { stage: 'execution', decision: 'approved', note: closingNote.trim() || null }))} className={secondaryBtn}>
                {t('invest.review.closing.approveExecution')}
              </button>
            ) : null}
            {opportunity.status !== 'closed' ? (
              <button type="button" disabled={busy || !gateOn} onClick={() => act(() => closeOpportunity(opportunity.id))} className={primaryBtn} title={gateOn ? undefined : t('invest.review.closing.gateOff')}>
                {t('invest.review.closing.close')}
              </button>
            ) : null}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">{t('invest.review.closing.separateApprovers')}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{t('invest.review.closing.currentVersionOnly')}</p>
        </section>
      ) : null}

      {['published', 'paused', 'closing'].includes(opportunity.status) ? (
        <section className="space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t('invest.review.failClose.title')}</h3>
          <p className="text-sm text-gray-600 dark:text-gray-300">{t('invest.review.failClose.copy')}</p>
          <label className="block text-sm text-gray-700 dark:text-gray-200">
            {t('invest.review.failClose.reason')}
            <textarea className={inputCls} rows={2} maxLength={2000} value={failCloseReason} onChange={(e) => setFailCloseReason(e.target.value)} />
          </label>
          {error ? <p className="text-sm text-red-600 dark:text-red-300" role="alert">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => act(() => failCloseOpportunity(opportunity.id, failCloseReason.trim() || null))} className={dangerBtn}>
              {t('invest.review.failClose.button')}
            </button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">{t('invest.review.failClose.note')}</p>
        </section>
      ) : null}

      {opportunity.status === 'closed' ? (
        <section className="space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t('invest.review.proceeds.title')}</h3>
          {!gateOn ? (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-200" role="note">
              {t('invest.review.closing.gateOff')}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || !gateOn} onClick={() => act(() => releaseProceeds(opportunity.id))} className={primaryBtn} title={gateOn ? undefined : t('invest.review.closing.gateOff')}>
              {t('invest.review.proceeds.release')}
            </button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">{t('invest.review.proceeds.blockedNote')}</p>
          {positions.length > 0 ? (
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                const cents = parseAmountToCents(distribution.amount);
                if (!distribution.positionId || !cents) {
                  setError(t('invest.review.distributions.required'));
                  return;
                }
                const position = positions.find((p) => p.id === distribution.positionId);
                if (!position) {
                  setError(t('invest.review.distributions.required'));
                  return;
                }
                act(async () => {
                  const result = await recordDistribution(opportunity.id, { positionId: position.id, userId: position.userId, amountCents: cents });
                  if (result?.queued) {
                    setDistributionNotice(t('invest.review.distributions.queued'));
                    setDistribution((p) => ({ ...p, amount: '' }));
                  }
                }, { reload: false });
              }}
            >
              <label className="block text-sm text-gray-700 dark:text-gray-200">
                {t('invest.review.distributions.position')}
                <select className={selectCls} value={distribution.positionId} onChange={(e) => setDistribution((p) => ({ ...p, positionId: e.target.value }))}>
                  <option value="">{t('invest.review.distributions.choosePosition')}</option>
                  {positions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {`${formatInvestCents(p.amountCents, p.currencyCode || 'USD')} · ${p.userId}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm text-gray-700 dark:text-gray-200">
                {t('invest.review.distributions.amount')}
                <input type="text" inputMode="decimal" className={inputCls} value={distribution.amount} onChange={(e) => setDistribution((p) => ({ ...p, amount: e.target.value }))} />
              </label>
              <div>
                <button type="submit" disabled={busy || !gateOn} className={secondaryBtn}>
                  {t('invest.review.distributions.submit')}
                </button>
              </div>
              {distributionNotice ? <p className="text-sm text-emerald-700 dark:text-emerald-300" role="status">{distributionNotice}</p> : null}
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('invest.review.distributions.dualApprovalNote')}</p>
            </form>
          ) : (
            <p className="text-sm text-gray-600 dark:text-gray-300">{t('invest.review.distributions.empty')}</p>
          )}
        </section>
      ) : null}
    </div>
  );
}

export default function InvestReviewQueue() {
  const { t } = useTranslation();
  const [queue, setQueue] = useState(null);
  const [type, setType] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [notPermitted, setNotPermitted] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [access, setAccess] = useState({ investEnabled: false, investCommitmentsEnabled: false, investPilot: false, canParticipate: false });

  const loadAccess = useCallback(async () => {
    try {
      const { data } = await api.get('/me/access');
      setAccess(investAccessFromProjection(data));
    } catch {
      setAccess({ investEnabled: false, investCommitmentsEnabled: false, investPilot: false, canParticipate: false });
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    setNotPermitted(false);
    try {
      const data = await getReviewQueue();
      setQueue(data);
      const types = data?.queues || [];
      if (!type || !types.includes(type)) setType(types[0] || null);
    } catch (err) {
      if (errorCode(err) === 'invest_review_not_permitted') setNotPermitted(true);
      else setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => { loadAccess(); load(); }, [loadAccess, load]);

  const items = queue && type ? (queue[type] || []) : [];
  const selected = items.find((row) => String(row.id) === String(selectedId)) || null;

  const openDetail = useCallback(async (row) => {
    setSelectedId(row.id);
    setDetail(null);
    if (type === 'applications' || type === 'amendments') return;
    setDetailLoading(true);
    try {
      // Proceeds rows carry the proceeds id; the opportunity id is the
      // detail key. Every other queue row is the opportunity itself.
      setDetail(await getOpportunity(type === 'proceeds' ? row.opportunityId : row.id));
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, [type]);

  const reloadAndReselect = useCallback(async () => {
    const keep = selectedId;
    setSelectedId(null);
    setDetail(null);
    await load();
    if (!keep) return;
    setSelectedId(keep);
    // The decision changed the record: refetch the detail too, so the
    // closing approvals and positions shown are the fresh ones.
    // Application and amendment rows carry their own detail; they need
    // no opportunity fetch.
    if (type !== 'applications' && type !== 'amendments') {
      const row = (queue?.[type] || []).find((item) => String(item.id) === String(keep));
      if (row) {
        try {
          setDetail(await getOpportunity(type === 'proceeds' ? row.opportunityId : row.id));
        } catch {
          setDetail(null);
        }
      }
    }
  }, [load, selectedId, queue, type]);

  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('invest.review.title')}</h1>
      <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">{t('invest.review.intro')}</p>

      {!access.investCommitmentsEnabled ? (
        <p className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-200" role="note">
          {t('invest.review.closing.gateOff')}
        </p>
      ) : null}

      {failed ? (
        <div role="alert" className="space-y-2 text-sm">
          <p>{t('invest.review.errors.loadFailed')}</p>
          <button type="button" onClick={load} className="rounded-lg border border-gray-300 px-3 py-1.5">{t('invest.common.retry')}</button>
        </div>
      ) : notPermitted ? (
        <p className="text-sm text-gray-600 dark:text-gray-300">{t('invest.review.errors.notPermitted')}</p>
      ) : (
        <div>
          <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label={t('invest.review.title')}>
            {(queue?.queues || []).map((queueType) => (
              <button
                key={queueType}
                type="button"
                role="tab"
                aria-selected={type === queueType}
                onClick={() => { setType(queueType); setSelectedId(null); setDetail(null); }}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${type === queueType ? 'bg-orange-500 text-white' : 'border border-gray-300 text-gray-900 dark:border-gray-600 dark:text-gray-100'}`}
              >
                {reviewQueueTabLabel(queueType, t)}
              </button>
            ))}
          </div>

          {(queue?.queues || []).length === 0 && !loading ? (
            <p className="text-sm text-gray-600 dark:text-gray-300">{t('invest.review.empty')}</p>
          ) : null}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            <div className="lg:col-span-2">
              {items.length === 0 && !loading ? (
                <p className="text-sm text-gray-600 dark:text-gray-300">{t('invest.review.emptyType')}</p>
              ) : (
                <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700" aria-busy={loading}>
                  {items.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => openDetail(row)}
                        aria-current={selectedId === row.id ? 'true' : undefined}
                        className={`w-full px-3 py-2 text-start text-sm hover:bg-gray-50 dark:hover:bg-gray-800 ${selectedId === row.id ? 'bg-gray-100 dark:bg-gray-800' : ''}`}
                      >
                        <span className="block font-medium text-gray-900 dark:text-white">
                          {row.opportunityTitle || row.title || row.id}
                        </span>
                        {type === 'proceeds' ? (
                          <span className="block text-xs text-gray-600 dark:text-gray-300">
                            {row.createdAt ? formatDate(row.createdAt) : ''}
                          </span>
                        ) : (
                          <span className="block text-xs text-gray-600 dark:text-gray-300">
                            {type === 'applications' ? applicationStatusLabel(row.status, t)
                              : type === 'amendments' ? amendmentStatusLabel(row.status, t)
                                : opportunityStatusLabel(row.status, t)}
                            {row.createdAt ? ` · ${formatDate(row.createdAt)}` : ''}
                          </span>
                        )}
                        {type === 'proceeds' ? (
                          <span className="block text-xs text-gray-600 dark:text-gray-300">
                            {formatInvestCents(row.amountCents, row.currencyCode || 'USD')}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="lg:col-span-3">
              {!selected ? (
                <p className="text-sm text-gray-600 dark:text-gray-300">{t('invest.review.select')}</p>
              ) : type === 'applications' ? (
                <ApplicationDetail key={`${selected.id}:${selected.expectedVersion}`} t={t} item={selected} onDecided={reloadAndReselect} />
              ) : type === 'amendments' ? (
                <AmendmentDetail key={`${selected.id}:${selected.expectedVersion}`} t={t} item={selected} onDecided={reloadAndReselect} />
              ) : detailLoading ? (
                <p className="text-sm text-gray-600" role="status">{t('invest.common.loading')}</p>
              ) : (
                <OpportunityDetail
                  key={`${selected.id}:${selected.expectedVersion}`}
                  t={t}
                  item={selected}
                  detail={detail}
                  gateOn={access.investCommitmentsEnabled}
                  onDecided={reloadAndReselect}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
