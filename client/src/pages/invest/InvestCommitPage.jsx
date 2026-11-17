// OxSteed Invest commit flow with the §4 review screen.
//
// Before confirmation the screen shows: the exact amount of eligible
// Credit, the valuation rule and the monetary reference value rule, the
// itemized fees (no investor fees are defined, so the list is empty with
// an honest note saying so, never an invented fee), a plain-language
// rights summary linked to the controlling agreement, the
// pending-not-completed status, the cancellation conditions and deadline,
// the risk acknowledgement of possible loss, and the exact agreement
// version being accepted. The primary button copy is exactly
// "Confirm investment commitment".
//
// The commitment itself is created only when the live commitment gate is
// on (projection.invest.investCommitmentsEnabled); while the gate is off
// the flow is complete but inert and the confirm action is unavailable.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import useAccessProjection from '../../hooks/useAccessProjection';
import PageShell from '../../components/PageShell';
import {
  getOpportunity, listApplications, getMyInvestments, listAgreementVersions,
  createCommitment, newIdempotencyKey,
} from '../../api/invest';
import {
  investAccessFromProjection, formatInvestCents, parseAmountToCents,
  commitReviewMissingRows, commitmentReferenceCents,
} from '../../utils/invest';
import { InvestError, InvestLoading, InvestNotice, InvestSection, InvestField, investButtonClassName, investInputClassName, investSecondaryButtonClassName } from './InvestShared';

export default function InvestCommitPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { t } = useTranslation();
  const projection = useAccessProjection(user);
  const access = investAccessFromProjection(projection);
  const [opportunity, setOpportunity] = useState(null);
  const [application, setApplication] = useState(null);
  const [eligibleCreditCents, setEligibleCreditCents] = useState(null);
  const [agreementVersion, setAgreementVersion] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [amountText, setAmountText] = useState('');
  const [amountError, setAmountError] = useState(null);
  const [riskChecked, setRiskChecked] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const idempotencyKeyRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getOpportunity(id);
      setOpportunity(data?.opportunity || null);
      const apps = await listApplications();
      const approved = (Array.isArray(apps?.applications) ? apps.applications : [])
        .find((a) => String(a.opportunityId) === String(id) && a.status === 'approved');
      setApplication(approved || null);
      const me = await getMyInvestments();
      setEligibleCreditCents(typeof me?.eligibleCreditCents === 'number' ? me.eligibleCreditCents : null);
      if (approved?.agreementVersionId) {
        try {
          const versions = await listAgreementVersions(id);
          const list = Array.isArray(versions?.versions) ? versions.versions : (Array.isArray(versions) ? versions : []);
          setAgreementVersion(list.find((v) => String(v.id) === String(approved.agreementVersionId)) || null);
        } catch { setAgreementVersion(null); }
      }
    } catch (e) {
      setError(e?.response?.data?.error || e.message || t('invest.commit.error.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => { load(); }, [load]);

  const amountCents = parseAmountToCents(amountText);

  const startReview = (event) => {
    event.preventDefault();
    setAmountError(null);
    if (amountCents === null) {
      setAmountError(t('invest.commit.amount.invalid'));
      return;
    }
    if (opportunity && amountCents < Number(opportunity.minimumCents || 0)) {
      setAmountError(t('invest.commit.amount.belowMinimum', { minimum: formatInvestCents(opportunity.minimumCents, 'USD') }));
      return;
    }
    if (eligibleCreditCents !== null && amountCents > eligibleCreditCents) {
      setAmountError(t('invest.commit.amount.aboveEligible', { eligible: formatInvestCents(eligibleCreditCents, 'USD') }));
      return;
    }
    if (!riskChecked) {
      setAmountError(t('invest.commit.amount.riskRequired'));
      return;
    }
    idempotencyKeyRef.current = newIdempotencyKey();
    setReviewing(true);
  };

  const confirm = async () => {
    setConfirming(true);
    setError(null);
    try {
      const result = await createCommitment(id, {
        applicationId: application.id,
        amountCents,
        agreementVersionId: application.agreementVersionId,
        idempotencyKey: idempotencyKeyRef.current,
      });
      setReceipt(result);
      setReviewing(false);
    } catch (e) {
      setError(e?.response?.data?.error || e.message || t('invest.commit.error.confirmFailed'));
    } finally {
      setConfirming(false);
    }
  };

  const reviewRows = reviewing && amountCents !== null ? {
    amountCents,
    currencyCode: 'USD',
    valuationRule: opportunity?.valuationRule || null,
    fees: [],
    feesTotalCents: 0,
    feesNote: t('invest.commit.review.feesNote'),
    rightsSummary: agreementVersion
      ? t('invest.commit.review.rightsSummary', { version: agreementVersion.versionNumber, hash: agreementVersion.contentHash })
      : t('invest.commit.review.rightsSummaryFallback'),
    agreementVersion: agreementVersion ? {
      id: String(agreementVersion.id),
      versionNumber: Number(agreementVersion.versionNumber),
      contentHash: agreementVersion.contentHash,
    } : null,
    status: 'pending',
    statusNote: t('invest.commit.review.statusNote'),
    cancellationTerms: t('invest.commit.review.cancellationTerms'),
    riskAcknowledged: riskChecked,
    riskNote: t('invest.commit.review.riskNote'),
  } : null;
  const missingReviewRows = reviewRows ? commitReviewMissingRows(reviewRows) : ['review'];

  const referenceCents = receipt?.commitment
    ? commitmentReferenceCents(receipt.commitment.amountCents, receipt.commitment.creditReferenceRate)
    : null;

  return (
    <PageShell>
      <div className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-bold text-white">{t('invest.commit.title')}</h1>
        <p className="mt-2 text-sm text-gray-400 leading-relaxed">{t('invest.commit.intro')}</p>

        {loading ? <InvestLoading label={t('invest.common.loading')} /> : null}
        {error ? <div className="mt-6"><InvestError message={error} retryLabel={t('invest.common.retry')} onRetry={load} /></div> : null}

        {!loading && !error && opportunity ? (
          <div className="mt-6 flex flex-col gap-6">
            <div>
              <Link to={`/invest/opportunities/${opportunity.id}`} className="text-sm text-orange-400 hover:text-orange-300">
                {opportunity.title}
              </Link>
              <p className="mt-2 text-sm text-gray-300">
                {t('invest.commit.eligibleBalance', { amount: eligibleCreditCents === null ? t('invest.common.notSet') : formatInvestCents(eligibleCreditCents, 'USD') })}
              </p>
            </div>

            {!access.investCommitmentsEnabled ? (
              <InvestNotice tone="warn">{t('invest.commit.gateOff')}</InvestNotice>
            ) : null}

            {receipt ? (
              <InvestSection title={t('invest.commit.receipt.title')} hint={t('invest.commit.receipt.hint')}>
                <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-gray-400">{t('invest.commit.review.amount')}</dt>
                    <dd className="mt-1 font-semibold text-white">{formatInvestCents(receipt.commitment.amountCents, receipt.commitment.currencyCode || 'USD')}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-400">{t('invest.commit.review.status')}</dt>
                    <dd className="mt-1 font-semibold text-white">{t('invest.commit.review.statusPending')}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-400">{t('invest.commit.review.referenceValue')}</dt>
                    <dd className="mt-1 font-semibold text-white">
                      {referenceCents === null ? t('invest.common.notSet') : formatInvestCents(referenceCents, receipt.commitment.currencyCode || 'USD')}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-400">{t('invest.commit.review.agreementVersion')}</dt>
                    <dd className="mt-1 font-semibold text-white">
                      {t('invest.commit.review.agreementVersionValue', {
                        version: receipt.commitment.agreementVersionNumber,
                        hash: (receipt.review?.agreementVersion?.contentHash || '').slice(0, 16),
                      })}
                    </dd>
                  </div>
                </dl>
                <p className="text-sm text-gray-300 leading-relaxed">{receipt.review?.statusNote}</p>
                <p className="text-sm text-gray-300 leading-relaxed">{receipt.review?.cancellationTerms}</p>
                {receipt.replayed ? <p className="text-sm text-gray-400">{t('invest.commit.receipt.replayed')}</p> : null}
                <div>
                  <Link to="/invest/my-investments" className={investButtonClassName}>{t('invest.directory.myInvestments')}</Link>
                </div>
              </InvestSection>
            ) : null}

            {!receipt && !application ? (
              <InvestNotice tone="warn">
                {t('invest.commit.noApprovedApplication')}
                {' '}
                <Link to={`/invest/apply?opportunityId=${opportunity.id}`} className="font-semibold underline">
                  {t('invest.detail.actions.apply')}
                </Link>
              </InvestNotice>
            ) : null}

            {!receipt && application && !reviewing ? (
              <form onSubmit={startReview} className="flex flex-col gap-6">
                <InvestSection title={t('invest.commit.amount.title')} hint={t('invest.commit.amount.hint')}>
                  <InvestField label={t('invest.commit.amount.label', { minimum: formatInvestCents(opportunity.minimumCents, 'USD') })}>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={amountText}
                      onChange={(e) => setAmountText(e.target.value)}
                      placeholder="250.00"
                      className={investInputClassName}
                    />
                  </InvestField>
                  {amountError ? <p className="text-sm text-red-300" role="alert">{amountError}</p> : null}
                  <label htmlFor="invest-commit-risk" className="flex items-start gap-2 text-sm text-gray-200">
                    <input
                      id="invest-commit-risk"
                      type="checkbox"
                      checked={riskChecked}
                      onChange={(e) => setRiskChecked(e.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-orange-500"
                    />
                    <span>{t('invest.commit.amount.riskAck')}</span>
                  </label>
                </InvestSection>
                <div>
                  <button type="submit" disabled={!access.investCommitmentsEnabled} className={investButtonClassName}>
                    {t('invest.commit.reviewButton')}
                  </button>
                </div>
              </form>
            ) : null}

            {!receipt && application && reviewing && reviewRows ? (
              <InvestSection title={t('invest.commit.review.title')} hint={t('invest.commit.review.hint')}>
                <dl className="flex flex-col gap-4 text-sm">
                  <div>
                    <dt className="text-gray-400">{t('invest.commit.review.amount')}</dt>
                    <dd className="mt-1 font-semibold text-white">{formatInvestCents(reviewRows.amountCents, 'USD')}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-400">{t('invest.commit.review.valuationRule')}</dt>
                    <dd className="mt-1 text-gray-200 leading-relaxed">{reviewRows.valuationRule || t('invest.commit.review.valuationRuleFallback')}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-400">{t('invest.commit.review.referenceValue')}</dt>
                    <dd className="mt-1 text-gray-200 leading-relaxed">{t('invest.commit.review.referenceValueNote')}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-400">{t('invest.commit.review.fees')}</dt>
                    <dd className="mt-1 text-gray-200 leading-relaxed">
                      {reviewRows.fees.length === 0 ? t('invest.commit.review.noFees') : reviewRows.fees.map((fee) => `${fee.label}: ${formatInvestCents(fee.amountCents, 'USD')}`).join(', ')}
                    </dd>
                    <dd className="mt-1 text-gray-400 leading-relaxed">{reviewRows.feesNote}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-400">{t('invest.commit.review.rights')}</dt>
                    <dd className="mt-1 text-gray-200 leading-relaxed">{reviewRows.rightsSummary}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-400">{t('invest.commit.review.status')}</dt>
                    <dd className="mt-1 font-semibold text-white">{t('invest.commit.review.statusPending')}</dd>
                    <dd className="mt-1 text-gray-400 leading-relaxed">{reviewRows.statusNote}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-400">{t('invest.commit.review.cancellation')}</dt>
                    <dd className="mt-1 text-gray-200 leading-relaxed">{reviewRows.cancellationTerms}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-400">{t('invest.commit.review.risk')}</dt>
                    <dd className="mt-1 text-gray-200 leading-relaxed">{reviewRows.riskNote}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-400">{t('invest.commit.review.agreementVersion')}</dt>
                    <dd className="mt-1 font-semibold text-white">
                      {reviewRows.agreementVersion
                        ? t('invest.commit.review.agreementVersionValue', { version: reviewRows.agreementVersion.versionNumber, hash: reviewRows.agreementVersion.contentHash.slice(0, 16) })
                        : t('invest.common.notSet')}
                    </dd>
                  </div>
                </dl>
                {missingReviewRows.length > 0 ? (
                  <InvestNotice tone="warn">{t('invest.commit.review.incomplete')}</InvestNotice>
                ) : null}
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={confirm}
                    disabled={confirming || !access.investCommitmentsEnabled || missingReviewRows.length > 0}
                    className={investButtonClassName}
                  >
                    {t('invest.commit.confirmButton')}
                  </button>
                  <button type="button" onClick={() => setReviewing(false)} disabled={confirming} className={investSecondaryButtonClassName}>
                    {t('invest.commit.backButton')}
                  </button>
                </div>
              </InvestSection>
            ) : null}
          </div>
        ) : null}
      </div>
    </PageShell>
  );
}
