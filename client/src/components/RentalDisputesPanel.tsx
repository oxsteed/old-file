// Group 11 Slice 2e: disputes on a tool-rental booking (586, 589, 590).
// Damage claims (record-only money, D-257), the rental-specific escalation
// thread, and the deposit-resolution acknowledgment. All actions are
// party-checked on the server; the panel only shows the actions the
// current side may take.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { toolRentalsApi } from '../api/toolRentals';

export default function RentalDisputesPanel({ booking, isOwner, currentUserId, onChanged }) {
  const { t } = useTranslation();
  const [claims, setClaims] = useState([]);
  const [escalations, setEscalations] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [claimDraft, setClaimDraft] = useState({ amount: '', description: '' });
  const [resolveDraft, setResolveDraft] = useState({});
  const [escDraft, setEscDraft] = useState({ category: 'damage', message: '' });
  const [escReply, setEscReply] = useState({});

  const load = async () => {
    try {
      const [c, e] = await Promise.all([
        toolRentalsApi.getDamageClaims(booking.id).catch(() => ({ claims: [] })),
        toolRentalsApi.getEscalations(booking.id).catch(() => ({ escalations: [] })),
      ]);
      setClaims(c.claims || []);
      setEscalations(e.escalations || []);
    } catch { /* disputes unavailable; the panel stays empty */ }
    setLoaded(true);
  };

  useEffect(() => { load(); }, [booking.id]);

  const refresh = () => { load(); onChanged?.(); };
  const claimable = ['payment_confirmed', 'returned', 'completed'].includes(booking.status);
  const openClaim = claims.find((c) => c.status === 'open');
  const depositResolved = ['returned', 'partially_withheld', 'withheld'].includes(booking.deposit_status)
    && booking.deposit_resolved_at;
  const depositAckPending = depositResolved && booking.deposit_ack_status === 'pending';

  const handleFileClaim = async () => {
    const amount = Number(claimDraft.amount);
    if (!Number.isFinite(amount) || amount <= 0 || !claimDraft.description.trim()) {
      toast.error(t('toolRentals.damageClaimInvalid') || 'Enter an amount over 0 and describe the damage.');
      return;
    }
    try {
      await toolRentalsApi.fileDamageClaim(booking.id, { amount, description: claimDraft.description.trim() });
      setClaimDraft({ amount: '', description: '' });
      toast.success(t('toolRentals.damageClaimFiled') || 'Damage claim filed');
      refresh();
    } catch (err) {
      toast.error(err?.response?.data?.error || t('toolRentals.damageClaimFailed') || 'Could not file the damage claim');
    }
  };

  const handleResolveClaim = async (claim) => {
    const draft = resolveDraft[claim.id] || { decision: 'agreed', amount: '', reason: '' };
    try {
      await toolRentalsApi.resolveDamageClaim(booking.id, claim.id, {
        decision: draft.decision,
        agreed_amount: draft.decision === 'agreed' ? Number(draft.amount) : undefined,
        reason: draft.reason || undefined,
      });
      toast.success(t('toolRentals.damageClaimResolved') || 'Damage claim resolved');
      refresh();
    } catch (err) {
      toast.error(err?.response?.data?.error || t('toolRentals.damageClaimFailed') || 'Could not resolve the damage claim');
    }
  };

  const handleAckClaim = async (claim, decision) => {
    try {
      await toolRentalsApi.acknowledgeDamageClaim(booking.id, claim.id, decision);
      toast.success(decision === 'acknowledged'
        ? (t('toolRentals.resolutionAcknowledged') || 'Resolution acknowledged')
        : (t('toolRentals.resolutionDisputed') || 'Resolution disputed; the claim is open again'));
      refresh();
    } catch (err) {
      toast.error(err?.response?.data?.error || t('toolRentals.damageClaimFailed') || 'Could not record the acknowledgment');
    }
  };

  const handleAckDeposit = async (decision) => {
    try {
      await toolRentalsApi.acknowledgeDepositResolution(booking.id, decision);
      toast.success(decision === 'acknowledged'
        ? (t('toolRentals.resolutionAcknowledged') || 'Resolution acknowledged')
        : (t('toolRentals.resolutionDisputed') || 'Resolution disputed'));
      refresh();
    } catch (err) {
      toast.error(err?.response?.data?.error || t('toolRentals.depositResolveFailed') || 'Could not record the acknowledgment');
    }
  };

  const handleOpenEscalation = async () => {
    if (!escDraft.message.trim()) {
      toast.error(t('toolRentals.escalationMessageRequired') || 'Write what support should look into.');
      return;
    }
    try {
      await toolRentalsApi.openEscalation(booking.id, { category: escDraft.category, message: escDraft.message.trim() });
      setEscDraft({ category: 'damage', message: '' });
      toast.success(t('toolRentals.escalationOpened') || 'Escalation opened');
      refresh();
    } catch (err) {
      toast.error(err?.response?.data?.error || t('toolRentals.escalationFailed') || 'Could not open the escalation');
    }
  };

  const handleEscReply = async (esc) => {
    const message = (escReply[esc.id] || '').trim();
    if (!message) return;
    try {
      await toolRentalsApi.postEscalationMessage(esc.id, message);
      setEscReply((prev) => ({ ...prev, [esc.id]: '' }));
      refresh();
    } catch (err) {
      toast.error(err?.response?.data?.error || t('toolRentals.escalationFailed') || 'Could not send the message');
    }
  };

  // Wave 3 (589, D-569): either party accepts or disputes an admin-closed
  // escalation; a dispute reopens the thread.
  const handleAckEscalation = async (esc, decision) => {
    try {
      await toolRentalsApi.acknowledgeEscalation(esc.id, decision);
      toast.success(decision === 'acknowledged'
        ? (t('toolRentals.resolutionAcknowledged') || 'Resolution acknowledged')
        : (t('toolRentals.resolutionDisputed') || 'Resolution disputed; the escalation is open again'));
      refresh();
    } catch (err) {
      toast.error(err?.response?.data?.error || t('toolRentals.escalationFailed') || 'Could not record the acknowledgment');
    }
  };

  // Wave 3 (589, D-572): the escalation section is always visible, even
  // on a pending booking with no history. The server never gated opening
  // an escalation by booking status, but the panel hid the form until a
  // claim, an escalation, or a claimable status existed (G11-B9).
  const escalationSection = (
    <>
      <h4>{t('toolRentals.escalationTitle') || 'Support escalation'}</h4>
      {escalations.map((esc) => (
        <div key={esc.id}>
          <p>
            {t(`toolRentals.escalationCategory_${esc.category}`) || esc.category}
            {' · '}{t(`toolRentals.escalationStatus_${esc.status}`) || esc.status}
            {esc.status === 'resolved' && esc.ack_status ? ` · ${t(`toolRentals.escalationAck_${esc.ack_status}`) || esc.ack_status}` : ''}
          </p>
          <ul>
            {(esc.messages || []).map((m) => (
              <li key={m.id}>
                <strong>{t(`toolRentals.escalationRole_${m.author_role}`) || m.author_role}:</strong> {m.body}
              </li>
            ))}
          </ul>
          {esc.status !== 'resolved' && (
            <div className="booking-card-actions">
              <label>
                {t('toolRentals.escalationReply') || 'Reply'}
                <input
                  type="text" maxLength={2000} value={escReply[esc.id] || ''}
                  onChange={(e) => setEscReply((prev) => ({ ...prev, [esc.id]: e.target.value }))}
                />
              </label>
              <button type="button" onClick={() => handleEscReply(esc)} className="booking-action-btn booking-action-approve" data-track-private>
                {t('toolRentals.escalationSend') || 'Send'}
              </button>
            </div>
          )}
          {esc.status === 'resolved' && esc.ack_status === 'pending' && (
            <div>
              <p>{t('toolRentals.escalationAckPrompt') || 'An admin closed this escalation. Accept the resolution, or dispute it to reopen the thread.'}</p>
              <div className="booking-card-actions">
                <button type="button" onClick={() => handleAckEscalation(esc, 'acknowledged')} className="booking-action-btn booking-action-approve" data-track-private>
                  {t('toolRentals.resolutionAcknowledge') || 'Accept resolution'}
                </button>
                <button type="button" onClick={() => handleAckEscalation(esc, 'disputed')} className="booking-action-btn booking-action-decline" data-track-private>
                  {t('toolRentals.resolutionDispute') || 'Dispute resolution'}
                </button>
              </div>
            </div>
          )}
          {esc.status === 'resolved' && esc.ack_status === 'acknowledged' && (
            <p>{t('toolRentals.resolutionAcknowledgedNote') || 'Resolution acknowledged by the other party.'}</p>
          )}
          {esc.ack_status === 'disputed' && (
            <p>{t('toolRentals.escalationAckDisputedNote') || 'The resolution was disputed. The escalation is open again for admin review.'}</p>
          )}
        </div>
      ))}
      <div className="booking-card-actions">
        <label>
          {t('toolRentals.escalationCategory') || 'Category'}
          <select value={escDraft.category} onChange={(e) => setEscDraft((prev) => ({ ...prev, category: e.target.value }))}>
            <option value="damage">{t('toolRentals.escalationCategory_damage') || 'Damage'}</option>
            <option value="deposit">{t('toolRentals.escalationCategory_deposit') || 'Deposit'}</option>
            <option value="condition">{t('toolRentals.escalationCategory_condition') || 'Condition'}</option>
            <option value="other">{t('toolRentals.escalationCategory_other') || 'Other'}</option>
          </select>
        </label>
        <label>
          {t('toolRentals.escalationMessage') || 'What happened?'}
          <input
            type="text" maxLength={2000} value={escDraft.message}
            onChange={(e) => setEscDraft((prev) => ({ ...prev, message: e.target.value }))}
          />
        </label>
        <button type="button" onClick={handleOpenEscalation} className="booking-action-btn booking-action-approve" data-track-private>
          {t('toolRentals.escalationOpen') || 'Open escalation'}
        </button>
      </div>
      <p><Link to="/support">{t('toolRentals.escalationSupportLink') || 'Contact support'}</Link></p>
    </>
  );

  if (!loaded) return null;
  const showPanel = claims.length > 0 || escalations.length > 0 || claimable || depositAckPending;
  if (!showPanel) {
    return (
      <div className="booking-card-note" data-testid={`booking-disputes-${booking.id}`}>
        {escalationSection}
      </div>
    );
  }

  return (
    <div className="booking-card-note" data-testid={`booking-disputes-${booking.id}`}>
      <h4>{t('toolRentals.damageClaimTitle') || 'Damage claims & support'}</h4>
      {claims.map((claim) => {
        const isFiler = String(claim.filed_by) === String(currentUserId);
        const draft = resolveDraft[claim.id] || { decision: 'agreed', amount: '', reason: '' };
        return (
          <div key={claim.id}>
            <p>
              {t('toolRentals.damageClaimAmount') || 'Claim'}: ${Number(claim.amount).toFixed(2)}
              {' · '}{t(`toolRentals.damageClaimStatus_${claim.status}`) || claim.status}
              {claim.status !== 'open' && claim.agreed_amount != null && (
                <> · {t('toolRentals.damageClaimAgreed') || 'Agreed'}: ${Number(claim.agreed_amount).toFixed(2)}</>
              )}
              {claim.resolution_reason && <> · {claim.resolution_reason}</>}
            </p>
            <p>{claim.description}</p>
            {claim.ack_status === 'acknowledged' && (
              <p>{t('toolRentals.resolutionAcknowledgedNote') || 'Resolution acknowledged by the other party.'}</p>
            )}
            {claim.status === 'open' && !isFiler && (
              <div className="booking-card-actions">
                <label>
                  {t('toolRentals.damageClaimDecision') || 'Decision'}
                  <select
                    value={draft.decision}
                    onChange={(e) => setResolveDraft((prev) => ({ ...prev, [claim.id]: { ...draft, decision: e.target.value } }))}
                  >
                    <option value="agreed">{t('toolRentals.damageClaimAgree') || 'Agree an amount'}</option>
                    <option value="declined">{t('toolRentals.damageClaimDecline') || 'Decline'}</option>
                  </select>
                </label>
                {draft.decision === 'agreed' && (
                  <label>
                    {t('toolRentals.damageClaimAgreedAmount') || 'Agreed amount'}
                    <input
                      type="number" step="0.01" min="0" max={Number(claim.amount)}
                      value={draft.amount}
                      onChange={(e) => setResolveDraft((prev) => ({ ...prev, [claim.id]: { ...draft, amount: e.target.value } }))}
                    />
                  </label>
                )}
                <label>
                  {t('toolRentals.damageClaimReason') || 'Reason'}
                  <input
                    type="text" maxLength={2000} value={draft.reason}
                    onChange={(e) => setResolveDraft((prev) => ({ ...prev, [claim.id]: { ...draft, reason: e.target.value } }))}
                  />
                </label>
                <button type="button" onClick={() => handleResolveClaim(claim)} className="booking-action-btn booking-action-approve" data-track-private>
                  {t('toolRentals.damageClaimResolve') || 'Resolve claim'}
                </button>
              </div>
            )}
            {claim.status !== 'open' && claim.ack_status === 'pending' && isFiler && (
              <div className="booking-card-actions">
                <button type="button" onClick={() => handleAckClaim(claim, 'acknowledged')} className="booking-action-btn booking-action-approve" data-track-private>
                  {t('toolRentals.resolutionAcknowledge') || 'Accept resolution'}
                </button>
                <button type="button" onClick={() => handleAckClaim(claim, 'disputed')} className="booking-action-btn booking-action-decline" data-track-private>
                  {t('toolRentals.resolutionDispute') || 'Dispute resolution'}
                </button>
              </div>
            )}
            {claim.status !== 'open' && claim.ack_status === 'pending' && !isFiler && (
              <p>{t('toolRentals.resolutionWaitingOther') || 'Waiting for the other party to accept the resolution.'}</p>
            )}
          </div>
        );
      })}
      {claimable && !openClaim && (
        <div className="booking-card-actions">
          <label>
            {t('toolRentals.damageClaimAmount') || 'Claim'}
            <input
              type="number" step="0.01" min="0"
              value={claimDraft.amount}
              onChange={(e) => setClaimDraft((prev) => ({ ...prev, amount: e.target.value }))}
            />
          </label>
          <label>
            {t('toolRentals.damageClaimDescription') || 'What was damaged?'}
            <input
              type="text" maxLength={2000} value={claimDraft.description}
              onChange={(e) => setClaimDraft((prev) => ({ ...prev, description: e.target.value }))}
            />
          </label>
          <button type="button" onClick={handleFileClaim} className="booking-action-btn booking-action-approve" data-track-private>
            {t('toolRentals.damageClaimFile') || 'File damage claim'}
          </button>
          <p>{t('toolRentals.damageClaimOffPlatformNote') || 'The platform only records the claim. Any money moves directly between you, off-platform.'}</p>
        </div>
      )}
      {depositAckPending && !isOwner && (
        <div>
          <p>{t('toolRentals.depositAckPrompt') || 'The owner resolved the deposit. Accept the decision, or dispute it.'}</p>
          <div className="booking-card-actions">
            <button type="button" onClick={() => handleAckDeposit('acknowledged')} className="booking-action-btn booking-action-approve" data-track-private>
              {t('toolRentals.resolutionAcknowledge') || 'Accept resolution'}
            </button>
            <button type="button" onClick={() => handleAckDeposit('disputed')} className="booking-action-btn booking-action-decline" data-track-private>
              {t('toolRentals.resolutionDispute') || 'Dispute resolution'}
            </button>
          </div>
        </div>
      )}
      {depositResolved && booking.deposit_ack_status === 'disputed' && (
        <p>{t('toolRentals.depositAckDisputedNote') || 'The deposit decision was disputed. Support can review it in an escalation below.'}</p>
      )}
      {escalationSection}
    </div>
  );
}
