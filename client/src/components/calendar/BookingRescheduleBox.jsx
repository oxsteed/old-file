import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import toast from 'react-hot-toast';

/**
 * Group 1, item 14 — booking-level reschedule proposal box.
 *
 * Shared by the customer surface (MyBookingsPage) and the provider
 * surface (BookingRequestsPanel, accepted bookings). A proposal is a
 * request: the booking's window changes only when the other party
 * accepts. A pending proposal shows the proposed time and Accept /
 * Decline to the other party; the proposer sees it as waiting.
 * Accepts and declines go through POST /bookings/:id/reschedule[/:proposalId/respond].
 */
export default function BookingRescheduleBox({ bookingId, proposal, currentUserId, onDone }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const isMine = proposal && currentUserId && String(proposal.proposedBy) === String(currentUserId);

  const submitProposal = async () => {
    if (!date || !start || !end) {
      toast.error(t('booking.reschedule.missingFields'));
      return;
    }
    if (end <= start) {
      toast.error(t('booking.reschedule.endAfterStart'));
      return;
    }
    setBusy(true);
    try {
      await api.post(`/bookings/${bookingId}/reschedule`, {
        proposed_date: date,
        proposed_start_time: start,
        proposed_end_time: end,
        message: message.trim() || undefined,
      });
      toast.success(t('booking.reschedule.proposed'));
      setOpen(false);
      setDate('');
      setStart('');
      setEnd('');
      setMessage('');
      onDone?.();
    } catch (err) {
      toast.error(err?.response?.data?.error || t('booking.reschedule.proposeFailed'));
    } finally {
      setBusy(false);
    }
  };

  const respond = async (action) => {
    if (!proposal?.id || busy) return;
    setBusy(true);
    try {
      await api.post(`/bookings/${bookingId}/reschedule/${proposal.id}/respond`, { action });
      toast.success(
        action === 'accept' ? t('booking.reschedule.accepted') : t('booking.reschedule.declined'),
      );
      onDone?.();
    } catch (err) {
      toast.error(err?.response?.data?.error || t('booking.reschedule.respondFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (proposal) {
    return (
      <div className="hb-reschedule-box" role="status">
        <p className="hb-reschedule-text">
          {t('booking.reschedule.proposedBanner', {
            date: proposal.proposedDate,
            start: String(proposal.proposedStartTime || '').slice(0, 5),
            end: String(proposal.proposedEndTime || '').slice(0, 5),
          })}
          {proposal.message ? ` ${proposal.message}` : ''}
        </p>
        {isMine ? (
          <p className="hb-reschedule-waiting">{t('booking.reschedule.waitingOtherParty')}</p>
        ) : (
          <div className="hb-reschedule-actions">
            <button
              type="button"
              className="booking-action-btn booking-action-approve"
              onClick={() => respond('accept')}
              disabled={busy} data-track="ui.294d17f7b5.1"
            >
              {t('booking.reschedule.accept')}
            </button>
            <button
              type="button"
              className="booking-action-btn booking-action-cancel"
              onClick={() => respond('decline')}
              disabled={busy} data-track="ui.294d17f7b5.2"
            >
              {t('booking.reschedule.decline')}
            </button>
          </div>
        )}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        className="booking-action-btn booking-action-approve"
        onClick={() => setOpen(true)} data-track="ui.294d17f7b5.3"
      >
        {t('booking.reschedule.propose')}
      </button>
    );
  }

  return (
    <div className="hb-reschedule-box">
      <p className="hb-reschedule-text">{t('booking.reschedule.proposeHint')}</p>
      <div className="hb-reschedule-form">
        <label>
          <span>{t('booking.reschedule.date')}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          <span>{t('booking.reschedule.start')}</span>
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label>
          <span>{t('booking.reschedule.end')}</span>
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <label>
          <span>{t('booking.reschedule.message')}</span>
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t('booking.reschedule.messagePlaceholder')}
          />
        </label>
      </div>
      <div className="hb-reschedule-actions">
        <button
          type="button"
          className="booking-action-btn booking-action-approve"
          onClick={submitProposal}
          disabled={busy} data-track="ui.294d17f7b5.4"
        >
          {t('booking.reschedule.sendProposal')}
        </button>
        <button
          type="button"
          className="booking-action-btn booking-action-cancel"
          onClick={() => setOpen(false)}
          disabled={busy} data-track="ui.294d17f7b5.5"
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}
