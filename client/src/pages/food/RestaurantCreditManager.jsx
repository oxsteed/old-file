import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import {
  approveMerchantFoodWalletCreditRequest,
  createMerchantFoodWalletRefund,
  declineMerchantFoodWalletCreditRequest,
  formatFoodMoney,
  getMerchantCreditApproval,
  grantMerchantFoodWalletCredit,
  listMerchantFoodWalletCreditRequests,
} from '../../api/food';
import { apiErrorMessage } from './foodShared';
import { formatCreditDateTime } from '../../lib/creditDateTime';
import RestaurantCreditReservePanel from './RestaurantCreditReservePanel';
import RestaurantCreditExposurePanel from './RestaurantCreditExposurePanel';
import RestaurantCreditFundingPanel from './RestaurantCreditFundingPanel';

function requestProof(request) {
  const metadata = request?.metadata && typeof request.metadata === 'object' ? request.metadata : {};
  return {
    reference: metadata.paymentReference || metadata.payment_reference || request.referenceId || '',
    attachmentUrl: metadata.proofAttachmentUrl || metadata.proof_attachment_url || '',
  };
}

function displayDate(value, fallback) {
  return formatCreditDateTime(value, fallback);
}

export default function RestaurantCreditManager({ restaurant }) {
  const { t } = useTranslation();
  const { t: financeT } = useTranslation('common');
  const [loadError, setLoadError] = useState(false);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState(null);
  const [confirmingId, setConfirmingId] = useState(null);
  const [decliningId, setDecliningId] = useState(null);
  const [declineReason, setDeclineReason] = useState('');
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantEmail, setGrantEmail] = useState('');
  const [grantAmount, setGrantAmount] = useState('');
  const [grantNote, setGrantNote] = useState('');
  const [grantReference, setGrantReference] = useState('');
  const [grantProofUrl, setGrantProofUrl] = useState('');
  const [grantConfirming, setGrantConfirming] = useState(false);
  const [grantWorking, setGrantWorking] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundCustomerId, setRefundCustomerId] = useState('');
  const [refundEmail, setRefundEmail] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundConfirming, setRefundConfirming] = useState(false);
  const [refundWorking, setRefundWorking] = useState(false);
  const [approval, setApproval] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const rows = await listMerchantFoodWalletCreditRequests(restaurant.id, { status: 'pending', limit: 100 });
      setRequests(Array.isArray(rows) ? rows : []);
    } catch (error) {
      setLoadError(true);
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [restaurant.id]);

  useEffect(() => { load(); }, [load]);

  // Phase 6: surface the platform credit-approval state so the restaurant
  // knows where it stands (suspended/revoked blocks new credit).
  useEffect(() => {
    let active = true;
    getMerchantCreditApproval()
      .then((rows) => {
        if (!active) return;
        const match = (Array.isArray(rows) ? rows : []).find((row) => String(row.restaurantId) === String(restaurant.id));
        setApproval(match || null);
      })
      .catch(() => { if (active) setApproval(null); });
    return () => { active = false; };
  }, [restaurant.id]);

  const approve = async (request) => {
    setWorkingId(request.id);
    try {
      await approveMerchantFoodWalletCreditRequest(restaurant.id, request.id, {
        approvalNote: t('food.creditCenter.manager.defaultApprovalNote'),
      });
      toast.success(t('food.creditCenter.manager.approvedToast', { name: request.customerName || request.customerEmail || t('food.creditCenter.customerFallback') }));
      setConfirmingId(null);
      await load();
    } catch (error) {
      toast.error(apiErrorMessage(error, t('food.creditCenter.manager.approveError')));
    } finally {
      setWorkingId(null);
    }
  };

  const decline = async (request) => {
    if (!declineReason.trim()) {
      toast.error(t('food.creditCenter.manager.declineReasonRequired'));
      return;
    }
    setWorkingId(request.id);
    try {
      await declineMerchantFoodWalletCreditRequest(restaurant.id, request.id, declineReason.trim());
      toast.success(t('food.creditCenter.manager.declinedToast'));
      setDecliningId(null);
      setDeclineReason('');
      await load();
    } catch (error) {
      toast.error(apiErrorMessage(error, t('food.creditCenter.manager.declineError')));
    } finally {
      setWorkingId(null);
    }
  };

  const resetGrantForm = () => {
    setGrantEmail('');
    setGrantAmount('');
    setGrantNote('');
    setGrantReference('');
    setGrantProofUrl('');
    setGrantConfirming(false);
  };

  const resetRefundForm = () => {
    setRefundCustomerId('');
    setRefundEmail('');
    setRefundAmount('');
    setRefundReason('');
    setRefundConfirming(false);
  };

  const openRefundForRequest = (request) => {
    resetRefundForm();
    setRefundCustomerId(request.customerId || '');
    setRefundEmail(request.customerEmail || '');
    setRefundOpen(true);
    setGrantOpen(false);
  };

  const submitRefund = async () => {
    const email = refundEmail.trim();
    if ((!refundCustomerId && !email) || !refundAmount.trim()) {
      toast.error(t('food.creditCenter.manager.refundFieldsRequired'));
      return;
    }
    setRefundWorking(true);
    try {
      const idempotencyKey = globalThis.crypto?.randomUUID?.() || `merchant-refund-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const payload = {
        amount: refundAmount.trim(),
        currencyCode: restaurant.currency_code,
        reason: refundReason.trim() || undefined,
        idempotencyKey,
      };
      if (refundCustomerId) payload.customerId = refundCustomerId;
      else payload.customerEmail = email;
      const result = await createMerchantFoodWalletRefund(restaurant.id, payload);
      if (result?.refund?.status === 'processed') {
        toast.success(t('food.creditCenter.manager.refundProcessedToast', { amount: refundAmount.trim(), currency: restaurant.currency_code || 'USD', email: email || t('food.creditCenter.customerFallback') }));
      } else {
        toast.success(t('food.creditCenter.manager.refundRecordedToast'));
      }
      resetRefundForm();
      setRefundOpen(false);
      await load();
    } catch (error) {
      toast.error(apiErrorMessage(error, t('food.creditCenter.manager.refundError')));
    } finally {
      setRefundWorking(false);
    }
  };

  const submitGrant = async () => {
    const email = grantEmail.trim();
    const note = grantNote.trim();
    if (!email || !grantAmount.trim() || !note) {
      toast.error(t('food.creditCenter.manager.grantFieldsRequired'));
      return;
    }
    setGrantWorking(true);
    try {
      const idempotencyKey = globalThis.crypto?.randomUUID?.() || `merchant-grant-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await grantMerchantFoodWalletCredit(restaurant.id, {
        customerEmail: email,
        amount: grantAmount.trim(),
        currencyCode: restaurant.currency_code,
        note,
        paymentReference: grantReference.trim() || undefined,
        proofAttachmentUrl: grantProofUrl.trim() || undefined,
        idempotencyKey,
      });
      if (result?.pendingApproval) {
        toast.success(t('food.creditCenter.manager.grantPendingToast'));
      } else {
        toast.success(t('food.creditCenter.manager.grantSuccessToast', { email }));
      }
      resetGrantForm();
      setGrantOpen(false);
      await load();
    } catch (error) {
      toast.error(apiErrorMessage(error, t('food.creditCenter.manager.grantError')));
    } finally {
      setGrantWorking(false);
    }
  };

  return (
    <>
    <section className="fd-section fd-credit-manager">
      <div className="fd-credit-manager-head">
        <div>
          <p className="fd-credit-manager-kicker">{t('food.creditCenter.manager.kicker')}</p>
          <h2>{t('food.creditCenter.manager.title')}</h2>
          <p className="fd-card-meta">{t('food.creditCenter.manager.intro')}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={load} disabled={loading} data-track-private>{financeT('merchantFinance.refresh')}</button>
          <span className="fd-credit-manager-count">{loading || loadError ? '—' : financeT('merchantFinance.pendingRequests', { count: requests.length })}</span>
          <button type="button" className="fd-btn fd-btn-sm" onClick={() => { setGrantOpen((v) => !v); setGrantConfirming(false); }} data-track-private>
            {grantOpen ? t('food.common.close') : t('food.creditCenter.manager.grantCredit')}
          </button>
          <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => { setRefundOpen((v) => !v); setRefundConfirming(false); }} data-track-private>
            {refundOpen ? t('food.common.close') : t('food.creditCenter.manager.refundCredit')}
          </button>
        </div>
      </div>

      {approval && (approval.status === 'suspended' || approval.status === 'revoked') && (
        <div className="fd-credit-approval-banner" role="alert" data-status={approval.status}>
          <strong>
            {approval.status === 'suspended'
              ? t('food.creditCenter.manager.suspendedBanner')
              : t('food.creditCenter.manager.revokedBanner')}
          </strong>
          {approval.revocationReason && <p>{t('food.creditCenter.manager.reason', { reason: approval.revocationReason })}</p>}
          {approval.status === 'revoked' && approval.gracePeriodEndsAt && (
            <p>{t('food.creditCenter.manager.graceEnds', { date: displayDate(approval.gracePeriodEndsAt, t('food.creditCenter.recentFallback')) })}</p>
          )}
        </div>
      )}

      {/* Funding step: approval isn't complete until the reserve is funded. */}
      {approval && approval.status === 'approved' && approval.fundingStatus !== 'funded' && (
        <RestaurantCreditFundingPanel restaurant={restaurant} approval={approval} onFunded={load} />
      )}

      {grantOpen && (
        <div className="fd-credit-grant-form">
          <strong>{t('food.creditCenter.manager.grantTitle')}</strong>
          <p className="fd-card-meta">{t('food.creditCenter.manager.grantIntro')}</p>
          <label>{t('food.creditCenter.manager.customerEmail')}
            <input type="email" required value={grantEmail} onChange={(event) => setGrantEmail(event.target.value)} placeholder="customer@example.com" maxLength={255} />
          </label>
          <label>{t('food.creditCenter.manager.amount', { currency: restaurant.currency_code || 'USD' })}
            <input inputMode="decimal" required value={grantAmount} onChange={(event) => setGrantAmount(event.target.value)} placeholder="25.00" />
          </label>
          <label>{t('food.creditCenter.manager.explanation')}
            <input value={grantNote} onChange={(event) => setGrantNote(event.target.value)} maxLength={255} placeholder={t('food.creditCenter.manager.explanationPlaceholder')} />
          </label>
          <label>{t('food.creditCenter.manager.paymentReference')}
            <input value={grantReference} onChange={(event) => setGrantReference(event.target.value)} maxLength={160} placeholder={t('food.creditCenter.manager.paymentReferencePlaceholder')} />
          </label>
          <label>{t('food.creditCenter.manager.proofUrl')}
            <input type="url" value={grantProofUrl} onChange={(event) => setGrantProofUrl(event.target.value)} maxLength={2000} placeholder="https://…" />
          </label>
          {grantConfirming ? (
            <div className="fd-credit-confirm-row">
              <strong>{t('food.creditCenter.manager.grantConfirm', { amount: grantAmount.trim(), currency: restaurant.currency_code || 'USD', email: grantEmail.trim() })}</strong>
              <button type="button" className="fd-btn fd-btn-sm" disabled={grantWorking} onClick={submitGrant} data-track-private>{grantWorking ? t('food.creditCenter.manager.granting') : t('food.creditCenter.manager.grantYes')}</button>
              <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => setGrantConfirming(false)} data-track-private>{t('food.common.cancel')}</button>
            </div>
          ) : (
            <div>
              <button
                type="button"
                className="fd-btn fd-btn-sm"
                disabled={!grantEmail.trim() || !grantAmount.trim() || !grantNote.trim()}
                onClick={() => setGrantConfirming(true)} data-track-private
              >
                {t('food.creditCenter.manager.grantReview')}
              </button>
            </div>
          )}
        </div>
      )}

      {refundOpen && (
        <div className="fd-credit-grant-form">
          <strong>{t('food.creditCenter.manager.refundTitle')}</strong>
          <p className="fd-card-meta">{t('food.creditCenter.manager.refundIntro')}</p>
          <label>{t('food.creditCenter.manager.customerEmail')}
            <input type="email" required value={refundEmail} onChange={(event) => { setRefundEmail(event.target.value); setRefundCustomerId(''); }} placeholder="customer@example.com" maxLength={255} />
          </label>
          <label>{t('food.creditCenter.manager.amount', { currency: restaurant.currency_code || 'USD' })}
            <input inputMode="decimal" required value={refundAmount} onChange={(event) => setRefundAmount(event.target.value)} placeholder="25.00" />
          </label>
          <label>{t('food.creditCenter.manager.refundReason')}
            <input value={refundReason} onChange={(event) => setRefundReason(event.target.value)} maxLength={500} placeholder={t('food.creditCenter.manager.refundReasonPlaceholder')} />
          </label>
          {refundConfirming ? (
            <div className="fd-credit-confirm-row">
              <strong>{t('food.creditCenter.manager.refundConfirm', { amount: refundAmount.trim(), currency: restaurant.currency_code || 'USD', email: refundEmail.trim() || t('food.creditCenter.customerFallback') })}</strong>
              <button type="button" className="fd-btn fd-btn-sm" disabled={refundWorking} onClick={submitRefund} data-track-private>{refundWorking ? t('food.creditCenter.manager.refunding') : t('food.creditCenter.manager.refundYes')}</button>
              <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => setRefundConfirming(false)} data-track-private>{t('food.common.cancel')}</button>
            </div>
          ) : (
            <div>
              <button
                type="button"
                className="fd-btn fd-btn-sm"
                disabled={!refundEmail.trim() || !refundAmount.trim()}
                onClick={() => setRefundConfirming(true)} data-track-private
              >
                {t('food.creditCenter.manager.refundReview')}
              </button>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="fd-empty">{t('food.creditCenter.manager.loadingRequests')}</div>
      ) : loadError ? (
        <div className="fd-finance-notice fd-finance-error" role="alert"><p>{financeT('merchantFinance.requestsUnavailable')}</p><button type="button" className="fd-btn fd-btn-secondary" onClick={load} data-track-private>{financeT('merchantFinance.retry')}</button></div>
      ) : requests.length === 0 ? (
        <div className="fd-credit-manager-empty">
          <strong>{t('food.creditCenter.manager.noRequests')}</strong>
          <span>{financeT('merchantFinance.requestsEmpty')}</span>
        </div>
      ) : (
        <div className="fd-credit-request-list">
          {requests.map((request) => {
            const proof = requestProof(request);
            const isWorking = String(workingId) === String(request.id);
            return (
              <article key={request.id} className="fd-credit-request-card">
                <div className="fd-credit-request-main">
                  <div>
                    <strong>{request.customerName || t('food.creditCenter.oxsteedCustomer')}</strong>
                    <span>{request.customerEmail || t('food.creditCenter.customerAccount')} · {displayDate(request.createdAt, t('food.creditCenter.recentFallback'))}</span>
                  </div>
                  <strong className="fd-credit-request-amount">{formatFoodMoney(request.amountCents, request.currencyCode || restaurant.currency_code || 'USD')}</strong>
                </div>
                <div className="fd-credit-proof-row">
                  {proof.reference && <span><small>{t('food.creditCenter.manager.confirmation')}</small><strong>{proof.reference}</strong></span>}
                  {proof.attachmentUrl && <a href={proof.attachmentUrl} target="_blank" rel="noreferrer" data-track-private>{t('food.creditCenter.manager.viewReceipt')}</a>}
                  {!proof.reference && !proof.attachmentUrl && <span className="fd-card-meta">{t('food.creditCenter.manager.noProof')}</span>}
                </div>
                {request.note && <p className="fd-credit-request-note">{request.note}</p>}

                {decliningId === request.id ? (
                  <div className="fd-credit-decline-form">
                    <input autoFocus value={declineReason} onChange={(event) => setDeclineReason(event.target.value)} maxLength={500} placeholder={t('food.creditCenter.manager.declinePlaceholder')} />
                    <button type="button" className="fd-btn fd-btn-danger fd-btn-sm" disabled={isWorking} onClick={() => decline(request)} data-track-private>{isWorking ? t('food.creditCenter.manager.declining') : t('food.creditCenter.manager.declineRequest')}</button>
                    <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => { setDecliningId(null); setDeclineReason(''); }} data-track-private>{t('food.common.cancel')}</button>
                  </div>
                ) : confirmingId === request.id ? (
                  <div className="fd-credit-confirm-row">
                    <strong>{t('food.creditCenter.manager.paymentMatched')}</strong>
                    <button type="button" className="fd-btn fd-btn-sm" disabled={isWorking} onClick={() => approve(request)} data-track-private>{isWorking ? t('food.creditCenter.manager.addingCredit') : t('food.creditCenter.manager.addCreditYes')}</button>
                    <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => setConfirmingId(null)} data-track-private>{t('food.common.cancel')}</button>
                  </div>
                ) : (
                  <div className="fd-credit-request-actions">
                    <button type="button" className="fd-btn fd-btn-sm" onClick={() => { setConfirmingId(request.id); setDecliningId(null); }} data-track-private>{t('food.creditCenter.manager.approveCredit')}</button>
                    <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => { setDecliningId(request.id); setConfirmingId(null); }} data-track-private>{t('food.creditCenter.manager.decline')}</button>
                    <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => openRefundForRequest(request)} data-track-private>{t('food.creditCenter.manager.refund')}</button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
    {/* Phase 4: pre-purchase credit reserve. Opt-in per restaurant; issuance
        is capped at the reserve balance once the restaurant is enrolled. */}
    <details className="fd-finance-disclosure"><summary>{financeT('merchantFinance.reserveControls')}</summary><p>{financeT('merchantFinance.reserveHint')}</p><RestaurantCreditReservePanel restaurant={restaurant} />
    {/* Phase 5: trial-tier credit cap + FIFO derisking. Applies to
        restaurants without a reserve row; enrolled restaurants see the
        reserve-enrolled state instead of the cap meter. */}
    <RestaurantCreditExposurePanel restaurant={restaurant} /></details>
    </>
  );
}
