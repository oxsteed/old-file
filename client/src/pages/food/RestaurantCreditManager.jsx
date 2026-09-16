import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  approveMerchantFoodWalletCreditRequest,
  declineMerchantFoodWalletCreditRequest,
  formatFoodMoney,
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

  return (
    <section className="fd-section fd-credit-manager">
      <div className="fd-credit-manager-head">
        <div>
          <p className="fd-credit-manager-kicker">Customer balances</p>
          <h2>Restaurant credit</h2>
          <p className="fd-card-meta">Approve credit only after matching the customer’s receipt or confirmation number.</p>
        </div>
        <span className="fd-credit-manager-count">{requests.length} pending</span>
      </div>

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
