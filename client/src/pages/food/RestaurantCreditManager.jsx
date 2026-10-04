import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  approveMerchantFoodWalletCreditRequest,
  declineMerchantFoodWalletCreditRequest,
  formatFoodMoney,
  grantMerchantFoodWalletCredit,
  listMerchantFoodWalletCreditRequests,
} from '../../api/food';
import { apiErrorMessage } from './foodShared';
import { formatCreditDateTime } from '../../lib/creditDateTime';

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
        </div>
      </div>

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
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
