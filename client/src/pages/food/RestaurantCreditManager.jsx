import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
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

function requestProof(request) {
  const metadata = request?.metadata && typeof request.metadata === 'object' ? request.metadata : {};
  return {
    reference: metadata.paymentReference || metadata.payment_reference || request.referenceId || '',
    attachmentUrl: metadata.proofAttachmentUrl || metadata.proof_attachment_url || '',
  };
}

function displayDate(value) {
  return formatCreditDateTime(value, 'Recently');
}

export default function RestaurantCreditManager({ restaurant }) {
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
    try {
      const rows = await listMerchantFoodWalletCreditRequests(restaurant.id, { status: 'pending', limit: 100 });
      setRequests(Array.isArray(rows) ? rows : []);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Unable to load restaurant credit requests.'));
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
        approvalNote: 'Payment verified in the restaurant credit inbox.',
      });
      toast.success(`Credit added for ${request.customerName || request.customerEmail || 'customer'}.`);
      setConfirmingId(null);
      await load();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Unable to approve this credit request.'));
    } finally {
      setWorkingId(null);
    }
  };

  const decline = async (request) => {
    if (!declineReason.trim()) {
      toast.error('Add a short reason so the customer knows what to correct.');
      return;
    }
    setWorkingId(request.id);
    try {
      await declineMerchantFoodWalletCreditRequest(restaurant.id, request.id, declineReason.trim());
      toast.success('Credit request declined.');
      setDecliningId(null);
      setDeclineReason('');
      await load();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Unable to decline this credit request.'));
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
      toast.error('Customer and amount are required for a refund.');
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
        toast.success(`Refunded ${refundAmount.trim()} ${restaurant.currency_code || 'USD'} to ${email || 'customer'}.`);
      } else {
        toast.success('Refund request recorded.');
      }
      resetRefundForm();
      setRefundOpen(false);
      await load();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Unable to process this refund.'));
    } finally {
      setRefundWorking(false);
    }
  };

  const submitGrant = async () => {
    const email = grantEmail.trim();
    const note = grantNote.trim();
    if (!email || !grantAmount.trim() || !note) {
      toast.error('Customer email, amount, and an explanation are required.');
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
        toast.success('Large grant submitted for approval.');
      } else {
        toast.success(`Credit granted to ${email}.`);
      }
      resetGrantForm();
      setGrantOpen(false);
      await load();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Unable to grant credit.'));
    } finally {
      setGrantWorking(false);
    }
  };

  return (
    <>
    <section className="fd-section fd-credit-manager">
      <div className="fd-credit-manager-head">
        <div>
          <p className="fd-credit-manager-kicker">Customer balances</p>
          <h2>Restaurant credit</h2>
          <p className="fd-card-meta">Approve credit only after matching the customer’s receipt or confirmation number.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="fd-credit-manager-count">{requests.length} pending</span>
          <button type="button" className="fd-btn fd-btn-sm" onClick={() => { setGrantOpen((v) => !v); setGrantConfirming(false); }}>
            {grantOpen ? 'Close' : 'Grant credit'}
          </button>
          <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => { setRefundOpen((v) => !v); setRefundConfirming(false); }}>
            {refundOpen ? 'Close' : 'Refund credit'}
          </button>
        </div>
      </div>

      {approval && (approval.status === 'suspended' || approval.status === 'revoked') && (
        <div className="fd-credit-approval-banner" role="alert" data-status={approval.status}>
          <strong>
            {approval.status === 'suspended'
              ? 'New credit is paused for this restaurant while its platform approval is suspended.'
              : 'This restaurant\u2019s credit approval was revoked. Remaining customer balances move to OxSteed Credit when the grace period ends.'}
          </strong>
          {approval.revocationReason && <p>Reason: {approval.revocationReason}</p>}
          {approval.status === 'revoked' && approval.gracePeriodEndsAt && (
            <p>Grace period ends: {displayDate(approval.gracePeriodEndsAt)}</p>
          )}
        </div>
      )}

      {grantOpen && (
        <div className="fd-credit-grant-form">
          <strong>Grant credit directly</strong>
          <p className="fd-card-meta">Adds credit to a customer’s wallet immediately. An explanation is required for every grant and is recorded on the audit trail.</p>
          <label>Customer email
            <input type="email" required value={grantEmail} onChange={(event) => setGrantEmail(event.target.value)} placeholder="customer@example.com" maxLength={255} />
          </label>
          <label>Amount ({restaurant.currency_code || 'USD'})
            <input inputMode="decimal" required value={grantAmount} onChange={(event) => setGrantAmount(event.target.value)} placeholder="25.00" />
          </label>
          <label>Explanation (required)
            <input value={grantNote} onChange={(event) => setGrantNote(event.target.value)} maxLength={255} placeholder="Why is this credit being added? e.g. comp for wrong order" />
          </label>
          <label>Payment / proof reference (optional)
            <input value={grantReference} onChange={(event) => setGrantReference(event.target.value)} maxLength={160} placeholder="Confirmation or receipt number" />
          </label>
          <label>Proof attachment URL (optional)
            <input type="url" value={grantProofUrl} onChange={(event) => setGrantProofUrl(event.target.value)} maxLength={2000} placeholder="https://…" />
          </label>
          {grantConfirming ? (
            <div className="fd-credit-confirm-row">
              <strong>Grant {grantAmount.trim()} {restaurant.currency_code || 'USD'} to {grantEmail.trim()}?</strong>
              <button type="button" className="fd-btn fd-btn-sm" disabled={grantWorking} onClick={submitGrant}>{grantWorking ? 'Granting…' : 'Yes, grant credit'}</button>
              <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => setGrantConfirming(false)}>Cancel</button>
            </div>
          ) : (
            <div>
              <button
                type="button"
                className="fd-btn fd-btn-sm"
                disabled={!grantEmail.trim() || !grantAmount.trim() || !grantNote.trim()}
                onClick={() => setGrantConfirming(true)}
              >
                Review grant
              </button>
            </div>
          )}
        </div>
      )}

      {refundOpen && (
        <div className="fd-credit-grant-form">
          <strong>Refund credit to a customer</strong>
          <p className="fd-card-meta">Deducts credit from the customer’s wallet and sends the money back to their card. Only credit issued in the last 30 days can be refunded. If the card refund fails, the wallet balance is left untouched.</p>
          <label>Customer email
            <input type="email" required value={refundEmail} onChange={(event) => { setRefundEmail(event.target.value); setRefundCustomerId(''); }} placeholder="customer@example.com" maxLength={255} />
          </label>
          <label>Amount ({restaurant.currency_code || 'USD'})
            <input inputMode="decimal" required value={refundAmount} onChange={(event) => setRefundAmount(event.target.value)} placeholder="25.00" />
          </label>
          <label>Reason (optional)
            <input value={refundReason} onChange={(event) => setRefundReason(event.target.value)} maxLength={500} placeholder="Why is this credit being refunded?" />
          </label>
          {refundConfirming ? (
            <div className="fd-credit-confirm-row">
              <strong>Refund {refundAmount.trim()} {restaurant.currency_code || 'USD'} to {refundEmail.trim() || 'customer'}?</strong>
              <button type="button" className="fd-btn fd-btn-sm" disabled={refundWorking} onClick={submitRefund}>{refundWorking ? 'Refunding…' : 'Yes, refund'}</button>
              <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => setRefundConfirming(false)}>Cancel</button>
            </div>
          ) : (
            <div>
              <button
                type="button"
                className="fd-btn fd-btn-sm"
                disabled={!refundEmail.trim() || !refundAmount.trim()}
                onClick={() => setRefundConfirming(true)}
              >
                Review refund
              </button>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="fd-empty">Loading credit requests…</div>
      ) : requests.length === 0 ? (
        <div className="fd-credit-manager-empty">
          <strong>No credit requests to review</strong>
          <span>New customer requests will appear here automatically.</span>
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
                    <strong>{request.customerName || 'OxSteed customer'}</strong>
                    <span>{request.customerEmail || 'Customer account'} · {displayDate(request.createdAt)}</span>
                  </div>
                  <strong className="fd-credit-request-amount">{formatFoodMoney(request.amountCents, request.currencyCode || restaurant.currency_code || 'USD')}</strong>
                </div>
                <div className="fd-credit-proof-row">
                  {proof.reference && <span><small>Confirmation</small><strong>{proof.reference}</strong></span>}
                  {proof.attachmentUrl && <a href={proof.attachmentUrl} target="_blank" rel="noreferrer">View receipt</a>}
                  {!proof.reference && !proof.attachmentUrl && <span className="fd-card-meta">No receipt or confirmation attached.</span>}
                </div>
                {request.note && <p className="fd-credit-request-note">{request.note}</p>}

                {decliningId === request.id ? (
                  <div className="fd-credit-decline-form">
                    <input autoFocus value={declineReason} onChange={(event) => setDeclineReason(event.target.value)} maxLength={500} placeholder="Reason, for example: receipt amount does not match" />
                    <button type="button" className="fd-btn fd-btn-danger fd-btn-sm" disabled={isWorking} onClick={() => decline(request)}>{isWorking ? 'Declining…' : 'Decline request'}</button>
                    <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => { setDecliningId(null); setDeclineReason(''); }}>Cancel</button>
                  </div>
                ) : confirmingId === request.id ? (
                  <div className="fd-credit-confirm-row">
                    <strong>Payment matched?</strong>
                    <button type="button" className="fd-btn fd-btn-sm" disabled={isWorking} onClick={() => approve(request)}>{isWorking ? 'Adding credit…' : 'Yes, add credit'}</button>
                    <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => setConfirmingId(null)}>Cancel</button>
                  </div>
                ) : (
                  <div className="fd-credit-request-actions">
                    <button type="button" className="fd-btn fd-btn-sm" onClick={() => { setConfirmingId(request.id); setDecliningId(null); }}>Approve credit</button>
                    <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => { setDecliningId(request.id); setConfirmingId(null); }}>Decline</button>
                    <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => openRefundForRequest(request)}>Refund</button>
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
    <RestaurantCreditReservePanel restaurant={restaurant} />
    </>
  );
}
