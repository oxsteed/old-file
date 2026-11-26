import React, { useState, useEffect, useCallback } from 'react';
import { currentAuthEpoch } from '../api/authSessionEpoch';
import { EquipmentBookingPanel } from '../components/EquipmentOperations';
import RentalDisputesPanel from '../components/RentalDisputesPanel';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import { useAuth } from '../hooks/useAuth';
import { toolRentalsApi } from '../api/toolRentals';
import api from '../api/axios';
import { cancelBookingRequest, fetchBookingPrefillForJob } from '../api/bookings';
import BookingRescheduleBox from '../components/calendar/BookingRescheduleBox';
import { prefillBookingDraft } from '../components/booking/BookingFlow';
import { Calendar, MapPin, User, DollarSign, AlertCircle, Loader, FileText, Flag, Clock, CheckCircle, XCircle, Briefcase, Wrench } from 'lucide-react';
import toast from 'react-hot-toast';
import InvoiceModal from '../components/InvoiceModal';
import TermsAcceptanceModal from '../components/TermsAcceptanceModal';
import UserReportModal from '../components/UserReportModal';
import './MyBookingsPage.css';
// Groups 5-6 item 225: customer service-issue reports on business visits.
import MyBusinessVisits from '../components/businessHub/g56/MyBusinessVisits';
import MyFormerWorkplaces from '../components/businessHub/g56/MyFormerWorkplaces';

function formatTime(hhmm: string | null | undefined, locale: string): string {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(2000, 0, 1, h, m || 0);
  return d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

interface HelperBooking {
  id: string;
  helperId: string;
  serviceName: string;
  requestedDate: string;
  requestedStartTime: string;
  requestedEndTime: string;
  serviceLocation: string;
  description?: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired' | 'cancelled' | 'accepted_cancelled';
  expiresAt: string;
  confirmationHours: number;
  acceptedAt?: string | null;
  declinedAt?: string | null;
  helperResponseReason?: string | null;
  createdAt: string;
  pendingRescheduleProposal?: {
    id: string;
    proposedBy: string;
    proposedByRole: string;
    proposedDate: string;
    proposedStartTime: string;
    proposedEndTime: string;
    message?: string | null;
    status: string;
  } | null;
}

interface Booking {
  id: number;
  tool_id: number;
  customer_id: number | string;
  owner_id: number | string;
  start_date: string;
  end_date: string;
  total_price: number;
  status: 'pending' | 'invoice_sent' | 'payment_confirmed' | 'returned' | 'cancelled' | 'completed';
  created_at: string;
  name?: string;
  daily_rate?: number;
  first_name?: string;
  last_name?: string;
  return_condition_note?: string | null;
  returned_at?: string | null;
  deposit_amount?: number | string;
  deposit_status?: 'none' | 'due' | 'held' | 'returned' | 'partially_withheld' | 'withheld';
  deposit_withheld_amount?: number | string | null;
  deposit_resolution_note?: string | null;
  owner_approval?: 'pending' | 'approved' | 'declined';
  owner_approval_at?: string | null;
  owner_decline_reason?: string | null;
  pickup_time?: string | null;
  // Group 11 item 576: return time + reschedule state.
  return_time?: string | null;
  return_reschedule_status?: 'none' | 'proposed' | 'approved' | 'declined';
  return_reschedule_proposed_end_date?: string | null;
  return_reschedule_proposed_time?: string | null;
  return_reschedule_reason?: string | null;
  agreement_snapshot?: { rental?: { fulfillment?: string; returnTime?: string | null }; tool?: { cleaningInstructions?: string | null } } | null;
  renter_identity?: { status: string; verified: boolean; verifiedAt?: string | null };
  owner_identity?: { status: string; verified: boolean; verifiedAt?: string | null };
  checkout_acknowledged_at?: string | null;
  checkout_report_id?: string | null;
}

const MyBookingsPageContent = () => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || 'en';
  const navigate = useNavigate();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'my-rentals' | 'my-tools' | 'helper-bookings'>('helper-bookings');
  const [myBookings, setMyBookings] = useState<Booking[]>([]);
  const [ownerBookings, setOwnerBookings] = useState<Booking[]>([]);
  const [helperBookings, setHelperBookings] = useState<HelperBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [invoiceBookingId, setInvoiceBookingId] = useState<number | null>(null);
  const [termsModalOpen, setTermsModalOpen] = useState(false);
  const [termsBookingId, setTermsBookingId] = useState<number | null>(null);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportBookingId, setReportBookingId] = useState<number | null>(null);
  const [reportOwnerId, setReportOwnerId] = useState<number | string | null>(null);
  // Group 11 item 570: in-app confirmation receipt, loaded lazily per booking.
  const [receiptOpen, setReceiptOpen] = useState<Record<number, boolean>>({});
  const [receipts, setReceipts] = useState<Record<number, any>>({});
  const [receiptLoading, setReceiptLoading] = useState<Record<number, boolean>>({});
  // Group 11 item 576: renter return-reschedule draft per booking.
  const [rescheduleDraft, setRescheduleDraft] = useState<Record<number, { date: string; time: string }>>({});
  // Group 11 item 583: cancellation recovery record per cancelled booking.
  const [recoveries, setRecoveries] = useState<Record<number, any>>({});
  const [recoveryDraft, setRecoveryDraft] = useState<Record<number, { amount: string; direction: string; note: string }>>({});
  // Group 11 item 584: replacement suggestions per cancelled booking.
  const [bookingAlternatives, setBookingAlternatives] = useState<Record<number, any[]>>({});

  useEffect(() => {
    loadBookings();
  }, []);

  const loadBookings = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [myRentals, toolBookings, hbResponse] = await Promise.all([
        toolRentalsApi.getMyBookings().catch(() => []),
        toolRentalsApi.getBookingsByOwner().catch(() => []),
        api.get('/bookings').catch(() => ({ data: { data: [] } })),
      ]);

      setMyBookings(myRentals);
      setOwnerBookings(toolBookings);
      setHelperBookings(Array.isArray(hbResponse.data?.data) ? hbResponse.data.data : []);
      // Group 11 items 583/584: for every cancelled rental, load the
      // recovery record (if any) and replacement suggestions for the
      // original dates, so the recovery panel is ready on the card.
      const cancelled = [...myRentals, ...toolBookings].filter((b: Booking) => b.status === 'cancelled');
      const seen = new Set<number>();
      await Promise.all(cancelled.filter((b: Booking) => !seen.has(b.id) && seen.add(b.id)).map(async (b: Booking) => {
        try {
          const { recovery } = await toolRentalsApi.getCancellationRecovery(b.id);
          if (recovery) setRecoveries((prev) => ({ ...prev, [b.id]: recovery }));
        } catch { /* no recovery recorded yet */ }
        try {
          const alts = await toolRentalsApi.getAlternatives(b.tool_id, { startDate: b.start_date, endDate: b.end_date });
          setBookingAlternatives((prev) => ({ ...prev, [b.id]: alts }));
        } catch { /* alternatives unavailable */ }
      }));
    } catch (err) {
      setError(t('toolRentals.loadingError') || 'Failed to load bookings');
    } finally {
      setLoading(false);
    }
  }, [t]);

  // P3-12-F09: the owner must accept the per-booking rental terms before
  // sending the first invoice. The acceptance is recorded server-side in
  // tool_rental_terms_acceptance (owner role); the invoice endpoint also
  // enforces it so the modal cannot be bypassed.
  // Group 11 item 568 (D-258): approval precedes invoicing. The invoice
  // endpoint enforces it server-side; the button stays disabled until
  // the owner approves, so the flow is visible before the server refuses.
  const handleSendInvoice = async (booking: Booking) => {
    if (booking.owner_approval !== 'approved') {
      toast.error(t('toolRentals.approvalRequiredBeforeInvoice') || 'Approve this request before sending the invoice.');
      return;
    }
    try {
      const { data } = await api.get(`/tool-rentals/bookings/${booking.id}/terms-status`);
      if (data?.ownerAccepted) {
        setInvoiceBookingId(booking.id);
        setInvoiceModalOpen(true);
        return;
      }
    } catch {
      // If the status check fails, still route through the terms modal:
      // the server enforces acceptance before the invoice is created.
    }
    setTermsBookingId(booking.id);
    setTermsModalOpen(true);
  };

  // Group 11 item 568: explicit owner approve/decline, distinct from
  // invoicing. Decline closes the request with a reason the renter sees.
  const handleApproveBooking = async (booking: Booking) => {
    try {
      await toolRentalsApi.approveBooking(booking.id);
      toast.success(t('toolRentals.approvalApproved') || 'Approved');
      loadBookings();
    } catch (err) {
      toast.error(t('toolRentals.approvalFailed') || 'Could not approve the request');
    }
  };

  const handleDeclineBooking = async (booking: Booking) => {
    const reason = window.prompt(
      t('toolRentals.declineReasonPrompt') || 'Why are you declining this request? The renter will see this reason.',
      ''
    );
    if (reason === null) return;
    if (!reason.trim()) {
      toast.error(t('toolRentals.declineReasonPrompt') || 'Why are you declining this request? The renter will see this reason.');
      return;
    }
    try {
      await toolRentalsApi.declineBooking(booking.id, reason.trim());
      toast.success(t('toolRentals.declineRequest') || 'Decline');
      loadBookings();
    } catch (err) {
      toast.error(t('toolRentals.declineFailed') || 'Could not decline the request');
    }
  };

  const handleStatusUpdate = async (bookingId: number, newStatus: string, extra: Record<string, unknown> = {}) => {
    try {
      await toolRentalsApi.updateBookingStatus(bookingId, newStatus, extra);
      toast.success(t('toolRentals.statusUpdated') || 'Status updated');
      loadBookings();
    } catch (err) {
      toast.error(t('toolRentals.statusUpdateFailed') || 'Failed to update status');
    }
  };

  // P3-12-F13: the renter confirms the tool was handed back, optionally
  // noting its condition; the owner confirms receipt the same way.
  const handleConfirmReturn = async (booking: Booking) => {
    const note = window.prompt(
      t('toolRentals.returnConditionPrompt') || 'How is the tool condition on return? (optional)',
      ''
    );
    if (note === null) return;
    await handleStatusUpdate(booking.id, 'returned', note.trim() ? { returnNote: note.trim() } : {});
  };

  // Review P3-1068: deposit return / withhold.
  const handleResolveDeposit = async (booking: Booking, action: 'return' | 'withhold') => {
    let body: { action: string; amount?: number; note?: string } = { action };
    if (action === 'withhold') {
      const amountText = window.prompt(t('toolRentals.depositWithholdAmount'), String(booking.deposit_amount ?? ''));
      if (amountText === null) return;
      const note = window.prompt(t('toolRentals.depositWithholdReason'));
      if (note === null) return;
      body = { action, amount: Number(amountText), note };
    } else if (!window.confirm(t('toolRentals.depositReturnConfirm'))) {
      return;
    }
    try {
      await toolRentalsApi.resolveDeposit(booking.id, body);
      toast.success(t('toolRentals.depositResolved'));
      loadBookings();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('toolRentals.depositResolveFailed'));
    }
  };

  const handleCancelHelperBooking = async (bookingId: string) => {
    if (!window.confirm(t('booking.confirmCancel') || 'Cancel this booking request?')) return;
    try {
      await cancelBookingRequest(bookingId);
      toast.success(t('booking.cancelSuccess') || 'Booking cancelled');
      loadBookings();
    } catch (err) {
      toast.error(t('booking.cancelFailed') || 'Failed to cancel booking');
    }
  };

  // RB1 — One-tap "Book again": open the booking flow prefilled with the
  // previous booking's service, provider, location, and details.
  const handleBookAgain = (b: HelperBooking) => {
    prefillBookingDraft(b.helperId, null, {
      serviceName: b.serviceName || '',
      serviceLocation: b.serviceLocation || '',
      description: b.description || '',
    });
    navigate(`/book/${b.helperId}`);
  };

  const handleConvertHelperBookingToJob = async (bookingId: string) => {
    try {
      const payload = await fetchBookingPrefillForJob(bookingId);
      const raw = payload?.prefill ?? payload;
      if (raw) {
        const parts: string[] = [];
        if (raw.serviceName) parts.push(raw.serviceName);
        if (raw.requestedDate && raw.requestedStartTime && raw.requestedEndTime) {
          parts.push(`${t('booking.prefillPreferredTime')}: ${raw.requestedDate} ${raw.requestedStartTime}–${raw.requestedEndTime}`);
        }
        if (raw.locationInput) parts.push(`${t('booking.prefillLocation')}: ${raw.locationInput}`);
        if (raw.description) { parts.push(''); parts.push(raw.description); }
        navigate('/post-job', { state: { bookingPrefill: { ...raw, description: parts.join('\n') } } });
      } else {
        navigate(`/post-job?fromBooking=${encodeURIComponent(bookingId)}`);
      }
    } catch {
      navigate(`/post-job?fromBooking=${encodeURIComponent(bookingId)}`);
    }
  };

  const getStatusColor = (status: string) => {
    const statusMap: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100',
      confirmed: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100',
      invoice_sent: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-100',
      payment_confirmed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100',
      returned: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-100',
      cancelled: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100',
      completed: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100',
    };
    return statusMap[status] || 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-100';
  };

  const getStatusLabel = (status: string) => {
    const statusMap: Record<string, string> = {
      pending: t('toolRentals.pending') || 'Pending',
      confirmed: t('toolRentals.confirmed') || 'Confirmed',
      invoice_sent: t('toolRentals.invoiceSent') || 'Invoice sent',
      payment_confirmed: t('toolRentals.paymentConfirmed') || 'Payment confirmed',
      returned: t('toolRentals.returned') || 'Returned',
      cancelled: t('toolRentals.cancelled') || 'Cancelled',
      completed: t('toolRentals.completed') || 'Completed',
    };
    return statusMap[status] || status;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(locale, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const calculateDays = (startDate: string, endDate: string) => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  };

  // Group 11 item 570: toggle the in-app confirmation receipt; fetch
  // once per booking, then reuse.
  // Group 11 item 575: renter confirms receipt at pickup. The server
  // enforces identity, payment_confirmed status and the pickup report;
  // the client only surfaces the refusal reason.
  const handleAcknowledgeCheckout = async (booking: Booking) => {
    try {
      await toolRentalsApi.acknowledgeCheckout(booking.id);
      toast.success(t('toolRentals.pickupConfirmed') || 'Pickup confirmed');
      loadBookings();
    } catch (err: any) {
      const code = err?.response?.data?.code;
      if (code === 'identity_not_verified') {
        toast.error(t('toolRentals.identityPickupBlocked') || 'Complete identity verification before pickup.');
      } else if (code === 'pickup_report_required') {
        toast.error(t('toolRentals.pickupReportRequired') || 'File the pickup condition report first, then confirm pickup.');
      } else {
        toast.error(t('toolRentals.checkoutAckFailed') || 'Could not record the pickup confirmation');
      }
    }
  };

  // Group 11 item 576: return reschedule. The renter proposes a new
  // return date/time; the owner approves or declines. Approval never
  // changes the charges (D-257); the server enforces that and the
  // calendar overlap check.
  const handleProposeReturnReschedule = async (booking: Booking) => {
    const draft = rescheduleDraft[booking.id] || { date: '', time: '' };
    if (!draft.date) {
      toast.error(t('toolRentals.returnRescheduleDateRequired') || 'Pick a new return date first.');
      return;
    }
    try {
      await toolRentalsApi.proposeReturnReschedule(booking.id, { proposedEndDate: draft.date, proposedTime: draft.time || null });
      toast.success(t('toolRentals.returnRescheduleProposed') || 'Return reschedule proposed');
      loadBookings();
    } catch (err: any) {
      const code = err?.response?.data?.code;
      if (code === 'return_reschedule_pending') {
        toast.error(t('toolRentals.returnReschedulePending') || 'A return reschedule is already waiting for the owner.');
      } else {
        toast.error(err?.response?.data?.error || t('toolRentals.returnRescheduleFailed') || 'Could not propose the new return date');
      }
    }
  };

  const handleApproveReturnReschedule = async (booking: Booking) => {
    try {
      await toolRentalsApi.approveReturnReschedule(booking.id);
      toast.success(t('toolRentals.returnRescheduleApproved') || 'New return date approved');
      loadBookings();
    } catch (err: any) {
      if (err?.response?.data?.code === 'conflict') {
        toast.error(t('toolRentals.returnRescheduleConflict') || 'The new return date overlaps another booking for this tool.');
      } else {
        toast.error(t('toolRentals.returnRescheduleFailed') || 'Could not approve the new return date');
      }
    }
  };

  const handleDeclineReturnReschedule = async (booking: Booking) => {
    const reason = window.prompt(
      t('toolRentals.returnRescheduleDeclinePrompt') || 'Why does the new return date not work? The renter will see this reason.',
      ''
    );
    if (reason === null) return;
    if (!reason.trim()) {
      toast.error(t('toolRentals.returnRescheduleDeclinePrompt') || 'Why does the new return date not work? The renter will see this reason.');
      return;
    }
    try {
      await toolRentalsApi.declineReturnReschedule(booking.id, reason.trim());
      toast.success(t('toolRentals.returnRescheduleDeclined') || 'Return reschedule declined');
      loadBookings();
    } catch {
      toast.error(t('toolRentals.returnRescheduleFailed') || 'Could not decline the new return date');
    }
  };

  // Group 11 item 583: cancellation recovery. Either party proposes a
  // refund settlement (record-only, D-257); the other party confirms it,
  // and either party marks it settled once the money moved off-platform.
  const handleProposeRefund = async (booking: Booking) => {
    const draft = recoveryDraft[booking.id] || { amount: '', direction: 'owner_to_renter', note: '' };
    const amount = Number(draft.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error(t('toolRentals.recoveryAmountRequired') || 'Enter a refund amount of 0 or more.');
      return;
    }
    try {
      const { recovery } = await toolRentalsApi.proposeRefundSettlement(booking.id, {
        amount,
        direction: amount === 0 ? 'none' : draft.direction,
        note: draft.note || null,
      });
      setRecoveries((prev) => ({ ...prev, [booking.id]: recovery }));
      toast.success(t('toolRentals.recoveryProposed') || 'Refund settlement proposed');
      loadBookings();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('toolRentals.recoveryFailed') || 'Could not record the refund settlement');
    }
  };

  const handleConfirmRefund = async (booking: Booking) => {
    try {
      const { recovery } = await toolRentalsApi.confirmRefundSettlement(booking.id);
      setRecoveries((prev) => ({ ...prev, [booking.id]: recovery }));
      toast.success(t('toolRentals.recoveryAgreed') || 'Refund settlement agreed');
      loadBookings();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('toolRentals.recoveryFailed') || 'Could not confirm the refund settlement');
    }
  };

  const handleSettleRefund = async (booking: Booking) => {
    if (!window.confirm(t('toolRentals.recoverySettleConfirm') || 'Confirm the refund money has already moved between you off-platform?')) return;
    try {
      const { recovery } = await toolRentalsApi.settleRefundSettlement(booking.id);
      setRecoveries((prev) => ({ ...prev, [booking.id]: recovery }));
      toast.success(t('toolRentals.recoverySettled') || 'Refund marked settled');
      loadBookings();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t('toolRentals.recoveryFailed') || 'Could not mark the refund settled');
    }
  };

  const handleToggleReceipt = async (booking: Booking) => {
    const open = !receiptOpen[booking.id];
    setReceiptOpen((prev) => ({ ...prev, [booking.id]: open }));
    if (!open || receipts[booking.id]) return;
    setReceiptLoading((prev) => ({ ...prev, [booking.id]: true }));
    try {
      const data = await toolRentalsApi.getBookingReceipt(booking.id);
      setReceipts((prev) => ({ ...prev, [booking.id]: data }));
    } catch {
      toast.error(t('toolRentals.receiptLoadFailed') || 'Could not load the receipt');
      setReceiptOpen((prev) => ({ ...prev, [booking.id]: false }));
    } finally {
      setReceiptLoading((prev) => ({ ...prev, [booking.id]: false }));
    }
  };

  const handleDownloadInvoicePdf = async (invoice: { id: number; invoice_number?: string }) => {
    try {
      await toolRentalsApi.downloadInvoicePdf(invoice.id, invoice.invoice_number);
    } catch {
      toast.error(t('toolRentals.receiptLoadFailed') || 'Could not load the receipt');
    }
  };

  // Group 11 item 576: return time + reschedule. The renter proposes a
  // new return date/time while the booking is paid; the owner decides.
  // Group 11 item 580: cleaning instructions at return, frozen in the
  // agreement snapshot at booking time.
  const renderReturnSection = (booking: Booking, isOwner: boolean) => {
    const cleaning = booking.agreement_snapshot?.tool?.cleaningInstructions;
    const proposedDate = booking.return_reschedule_proposed_end_date;
    const proposedTime = booking.return_reschedule_proposed_time;
    const status = booking.return_reschedule_status || 'none';
    const draft = rescheduleDraft[booking.id] || { date: '', time: '' };
    const showReturnInfo = booking.status === 'payment_confirmed' || booking.status === 'returned';
    if (!showReturnInfo) return null;
    return (
      <div className="booking-card-note" data-testid={`booking-return-${booking.id}`}>
        {booking.return_time && (
          <p>
            {t('toolRentals.returnTimeLabel') || 'Return time'}: {formatTime(booking.return_time, locale)}
            {' · '}
            {formatDate(booking.end_date)}
          </p>
        )}
        {cleaning && (
          <p>
            {t('toolRentals.cleaningInstructionsTitle') || 'Cleaning instructions'}: {cleaning}
          </p>
        )}
        {status === 'proposed' && (
          <p>
            {t('toolRentals.returnRescheduleProposedNote') || 'A new return date was proposed'}: {proposedDate ? formatDate(proposedDate) : ''}
            {proposedTime ? ` · ${formatTime(proposedTime, locale)}` : ''}
            {' · '}
            {t('toolRentals.returnRescheduleNoCharge') || 'No extra charge.'}
          </p>
        )}
        {status === 'approved' && (
          <p>{t('toolRentals.returnRescheduleApprovedNote') || 'The owner approved the new return date.'}</p>
        )}
        {status === 'declined' && booking.return_reschedule_reason && (
          <p>
            {t('toolRentals.returnRescheduleDeclinedNote') || 'The owner declined the new return date:'} {booking.return_reschedule_reason}
          </p>
        )}
        {!isOwner && status !== 'proposed' && booking.status === 'payment_confirmed' && (
          <div className="booking-card-actions">
            <label>
              {t('toolRentals.returnRescheduleNewDate') || 'New return date'}
              <input
                type="date"
                min={booking.start_date}
                value={draft.date}
                onChange={(e) => setRescheduleDraft((prev) => ({ ...prev, [booking.id]: { ...draft, date: e.target.value } }))}
              />
            </label>
            <label>
              {t('toolRentals.returnTimeTitle') || 'Return time'}
              <input
                type="time"
                value={draft.time}
                onChange={(e) => setRescheduleDraft((prev) => ({ ...prev, [booking.id]: { ...draft, time: e.target.value } }))}
              />
            </label>
            <button
              type="button"
              onClick={() => handleProposeReturnReschedule(booking)}
              className="booking-action-btn booking-action-approve" data-track="ui.5655b990ea.23"
            >
              {t('toolRentals.returnReschedulePropose') || 'Propose new return date'}
            </button>
          </div>
        )}
        {isOwner && status === 'proposed' && (
          <div className="booking-card-actions">
            <button
              type="button"
              onClick={() => handleApproveReturnReschedule(booking)}
              className="booking-action-btn booking-action-approve" data-track="ui.5655b990ea.24"
            >
              {t('toolRentals.returnRescheduleApprove') || 'Approve new return date'}
            </button>
            <button
              type="button"
              onClick={() => handleDeclineReturnReschedule(booking)}
              className="booking-action-btn booking-action-decline" data-track="ui.5655b990ea.25"
            >
              {t('toolRentals.returnRescheduleDecline') || 'Decline new return date'}
            </button>
          </div>
        )}
      </div>
    );
  };

  // Group 11 item 583: cancellation recovery (record-only refund
  // agreement) + Group 11 item 584: replacement suggestions for rebook.
  const renderRecoveryPanel = (booking: Booking) => {
    const recovery = recoveries[booking.id];
    const draft = recoveryDraft[booking.id] || { amount: '', direction: 'owner_to_renter', note: '' };
    const alternatives = bookingAlternatives[booking.id] || [];
    const isProposer = recovery?.proposed_by === user?.id;
    return (
      <div className="booking-card-note" data-testid={`booking-recovery-${booking.id}`}>
        <h4>{t('toolRentals.recoveryTitle') || 'Cancellation recovery'}</h4>
        {recovery ? (
          <div>
            <p>
              {t('toolRentals.recoveryAmount') || 'Refund'}: ${Number(recovery.refund_amount || 0).toFixed(2)}
              {' · '}
              {t(`toolRentals.recoveryDirection_${recovery.refund_direction}`) || recovery.refund_direction}
              {' · '}
              {t(`toolRentals.recoveryStatus_${recovery.refund_status}`) || recovery.refund_status}
            </p>
            {recovery.refund_note && <p>{recovery.refund_note}</p>}
            <p>{t('toolRentals.recoveryOffPlatformNote') || 'The platform only records this agreement. The money moves directly between you, off-platform.'}</p>
            {recovery.refund_status === 'proposed' && !isProposer && (
              <div className="booking-card-actions">
                <button
                  type="button"
                  onClick={() => handleConfirmRefund(booking)}
                  className="booking-action-btn booking-action-approve" data-track="ui.5655b990ea.26"
                >
                  {t('toolRentals.recoveryConfirm') || 'Agree to this refund'}
                </button>
              </div>
            )}
            {recovery.refund_status === 'proposed' && isProposer && (
              <p>{t('toolRentals.recoveryWaitingOther') || 'Waiting for the other party to agree.'}</p>
            )}
            {recovery.refund_status === 'agreed' && (
              <div className="booking-card-actions">
                <button
                  type="button"
                  onClick={() => handleSettleRefund(booking)}
                  className="booking-action-btn booking-action-approve" data-track="ui.5655b990ea.27"
                >
                  {t('toolRentals.recoverySettle') || 'Mark refund settled'}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div>
            <p>{t('toolRentals.recoveryNoRecord') || 'No refund agreement recorded yet.'}</p>
            <p>{t('toolRentals.recoveryOffPlatformNote') || 'The platform only records this agreement. The money moves directly between you, off-platform.'}</p>
            <div className="booking-card-actions">
              <label>
                {t('toolRentals.recoveryAmount') || 'Refund'}
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={Number(booking.total_price || 0)}
                  value={draft.amount}
                  onChange={(e) => setRecoveryDraft((prev) => ({ ...prev, [booking.id]: { ...draft, amount: e.target.value } }))}
                />
              </label>
              <label>
                {t('toolRentals.recoveryDirection') || 'Who pays whom'}
                <select
                  value={draft.direction}
                  onChange={(e) => setRecoveryDraft((prev) => ({ ...prev, [booking.id]: { ...draft, direction: e.target.value } }))}
                >
                  <option value="owner_to_renter">{t('toolRentals.recoveryDirection_owner_to_renter') || 'Owner refunds renter'}</option>
                  <option value="renter_to_owner">{t('toolRentals.recoveryDirection_renter_to_owner') || 'Renter pays owner'}</option>
                </select>
              </label>
              <label>
                {t('toolRentals.recoveryNote') || 'Note'}
                <input
                  type="text"
                  maxLength={2000}
                  value={draft.note}
                  onChange={(e) => setRecoveryDraft((prev) => ({ ...prev, [booking.id]: { ...draft, note: e.target.value } }))}
                />
              </label>
              <button
                type="button"
                onClick={() => handleProposeRefund(booking)}
                className="booking-action-btn booking-action-approve" data-track="ui.5655b990ea.28"
              >
                {t('toolRentals.recoveryPropose') || 'Propose refund'}
              </button>
            </div>
          </div>
        )}
        {alternatives.length > 0 && (
          <div>
            <h4>{t('toolRentals.alternativesTitle') || 'Similar tools for these dates'}</h4>
            <ul>
              {alternatives.map((alt: any) => (
                <li key={alt.id}>
                  <Link to={`/tool-rentals/${alt.id}`}>
                    {alt.name} · ${Number(alt.daily_rate).toFixed(2)}/day
                    {alt.distance_miles != null ? ` · ${Number(alt.distance_miles).toFixed(1)} mi` : ''}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Link to="/tool-rentals" className="booking-action-btn booking-action-invoice">
          {t('toolRentals.recoveryBrowseAgain') || 'Search for tools again'}
        </Link>
      </div>
    );
  };

  const renderReceipt = (booking: Booking) => {
    const receipt = receipts[booking.id];
    if (!receiptOpen[booking.id]) return null;
    if (receiptLoading[booking.id] || !receipt) {
      return <p className="booking-card-note">{t('common.loading')}</p>;
    }
    const fulfillment = receipt.booking?.agreement_snapshot?.rental?.fulfillment;
    return (
      <div className="booking-receipt" data-testid={`booking-receipt-${booking.id}`}>
        <h4>{t('toolRentals.receiptTitle') || 'Booking receipt'}</h4>
        <dl>
          <div><dt>{t('toolRentals.receiptTool') || 'Tool'}</dt><dd>{receipt.tool?.name || booking.name}</dd></div>
          <div>
            <dt>{t('toolRentals.receiptDates') || 'Rental dates'}</dt>
            <dd>{formatDate(booking.start_date)} - {formatDate(booking.end_date)} ({t('myBookings.daysCount', { count: calculateDays(booking.start_date, booking.end_date) })})</dd>
          </div>
          {booking.pickup_time && (
            <div><dt>{t('toolRentals.receiptPickupTime') || 'Pickup time'}</dt><dd>{formatTime(booking.pickup_time, locale)}</dd></div>
          )}
          {booking.return_time && (
            <div><dt>{t('toolRentals.receiptReturnTime') || 'Return time'}</dt><dd>{formatTime(booking.return_time, locale)}</dd></div>
          )}
          {receipt.booking?.agreement_snapshot?.tool?.cleaningInstructions && (
            <div><dt>{t('toolRentals.cleaningInstructionsTitle') || 'Cleaning instructions'}</dt><dd>{receipt.booking.agreement_snapshot.tool.cleaningInstructions}</dd></div>
          )}
          {booking.checkout_acknowledged_at && (
            <div><dt>{t('toolRentals.receiptCheckout') || 'Pickup confirmed'}</dt><dd>{new Date(booking.checkout_acknowledged_at).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })}</dd></div>
          )}
          {fulfillment && (
            <div><dt>{t('toolRentals.receiptFulfillment') || 'How you get it'}</dt><dd>{t(`toolRentals.receiptFulfillment_${fulfillment}`) || fulfillment}</dd></div>
          )}
          <div><dt>{t('toolRentals.receiptTotal') || 'Total'}</dt><dd>${Number(booking.total_price || 0).toFixed(2)}</dd></div>
          {(Number(receipt.invoice?.deposit_amount || 0) > 0 || Number(booking.deposit_amount || 0) > 0) && (
            <div>
              <dt>{t('toolRentals.receiptDeposit') || 'Deposit'}</dt>
              <dd>
                ${Number(receipt.invoice?.deposit_amount ?? booking.deposit_amount ?? 0).toFixed(2)}
                {booking.deposit_status && booking.deposit_status !== 'none' && (
                  <> · {t(`toolRentals.depositStatus_${booking.deposit_status}`) || booking.deposit_status}</>
                )}
              </dd>
            </div>
          )}
          <div>
            <dt>{t('toolRentals.receiptApproval') || 'Owner approval'}</dt>
            <dd>{t(`toolRentals.receiptApproval_${booking.owner_approval || 'pending'}`) || booking.owner_approval || 'pending'}</dd>
          </div>
          <div>
            <dt>{t('toolRentals.receiptTerms') || 'Terms'}</dt>
            <dd>
              {t('toolRentals.receiptTermsRenter') || 'Renter'}: {receipt.terms?.customerAccepted ? (t('toolRentals.receiptTermsAccepted') || 'Accepted') : (t('toolRentals.receiptTermsPending') || 'Not accepted yet')}
              {' · '}
              {t('toolRentals.receiptTermsOwner') || 'Owner'}: {receipt.terms?.ownerAccepted ? (t('toolRentals.receiptTermsAccepted') || 'Accepted') : (t('toolRentals.receiptTermsPending') || 'Not accepted yet')}
            </dd>
          </div>
          <div>
            <dt>{t('toolRentals.receiptInvoice') || 'Invoice'}</dt>
            <dd>
              {receipt.invoice ? (
                <>
                  {receipt.invoice.invoice_number} · {receipt.invoice.status} · ${Number(receipt.invoice.total_amount || 0).toFixed(2)}
                  {' '}
                  <button
                    type="button"
                    onClick={() => handleDownloadInvoicePdf(receipt.invoice)}
                    className="booking-receipt-pdf-link" data-track="ui.5655b990ea.22"
                  >
                    {t('toolRentals.receiptInvoiceDownload') || 'Download invoice PDF'}
                  </button>
                </>
              ) : (
                t('toolRentals.receiptNoInvoice') || 'No invoice sent yet.'
              )}
            </dd>
          </div>
        </dl>
      </div>
    );
  };

  // Group 11 item 571 (D-259): identity is the platform Didit state.
  // Shown to both parties; a renter who has not verified cannot
  // complete pickup (enforced server-side on the acknowledgment).
  const renderIdentityLine = (booking: Booking, isOwnerView: boolean) => {
    const identityStatusLabel = (status: string) =>
      t(`toolRentals.identity_${status}`) || status;
    return (
      <div className="booking-card-identity">
        <span>
          {isOwnerView
            ? `${t('toolRentals.identityRenter') || 'Renter identity'}: ${identityStatusLabel(booking.renter_identity?.status || 'not_started')}`
            : `${t('toolRentals.identityTitle') || 'Identity check'}: ${identityStatusLabel(booking.renter_identity?.status || 'not_started')}`}
        </span>
        {!isOwnerView && booking.renter_identity && !booking.renter_identity.verified && (
          <Link to="/verify-identity" className="booking-identity-link">
            {t('toolRentals.identityVerifyNow') || 'Verify your identity'}
          </Link>
        )}
        {!isOwnerView && (
          <span>
            {`${t('toolRentals.identityOwner') || 'Owner identity'}: ${identityStatusLabel(booking.owner_identity?.status || 'not_started')}`}
          </span>
        )}
      </div>
    );
  };

  const renderBookingCard = (booking: Booking, isOwner: boolean = false) => (
    <div key={booking.id} className="booking-card">
      <EquipmentBookingPanel bookingId={booking.id}/>
      <div className="booking-card-header">
        <div className="booking-card-info">
          <h3 className="booking-card-title">{booking.name || t('myBookings.unknownTool')}</h3>
          <span className={`booking-card-status ${getStatusColor(booking.status)}`}>
            {getStatusLabel(booking.status)}
          </span>
        </div>
        <div className="booking-card-price">
          <DollarSign className="w-4 h-4" />
          <span>${booking.total_price?.toFixed(2) || '0.00'}</span>
        </div>
      </div>

      <div className="booking-card-details">
        <div className="booking-card-date">
          <Calendar className="w-4 h-4" />
          <span>
            {formatDate(booking.start_date)} - {formatDate(booking.end_date)}
          </span>
          <span className="booking-card-days">
            ({t('myBookings.daysCount', { count: calculateDays(booking.start_date, booking.end_date) })})
          </span>
          {/* Group 11 item 574: pickup appointment time. */}
          {booking.pickup_time && (
            <span className="booking-card-pickup-time">
              {t('toolRentals.pickupTimeLabel') || 'Pickup time'}: {formatTime(booking.pickup_time, locale)}
            </span>
          )}
          {/* Group 11 item 576: return appointment time. */}
          {booking.return_time && (
            <span className="booking-card-pickup-time">
              {t('toolRentals.returnTimeLabel') || 'Return time'}: {formatTime(booking.return_time, locale)}
            </span>
          )}
        </div>

        {isOwner && booking.first_name && (
          <div className="booking-card-customer">
            <User className="w-4 h-4" />
            <span>
              {booking.first_name} {booking.last_name || ''}
            </span>
          </div>
        )}
      </div>

      {/* Group 11 item 568 (D-258): approval is a distinct step before
          invoicing. The owner approves or declines the request; the
          invoice button stays disabled until the request is approved. */}
      {isOwner && booking.status === 'pending' && (
        <div className="booking-card-actions">
          <button
            onClick={() => handleApproveBooking(booking)}
            className="booking-action-btn booking-action-approve" data-track="ui.5655b990ea.18"
          >
            {t('toolRentals.approveRequest') || 'Approve request'}
          </button>
          <button
            onClick={() => handleDeclineBooking(booking)}
            className="booking-action-btn booking-action-decline" data-track="ui.5655b990ea.19"
          >
            {t('toolRentals.declineRequest') || 'Decline request'}
          </button>
          <button
            onClick={() => handleSendInvoice(booking)}
            disabled={booking.owner_approval !== 'approved'}
            title={booking.owner_approval !== 'approved' ? (t('toolRentals.approvalRequiredBeforeInvoice') || 'Approve this request before sending the invoice.') : undefined}
            className="booking-action-btn booking-action-invoice" data-track="ui.5655b990ea.1"
          >
            <FileText className="w-4 h-4" />
            {t('toolRentals.sendInvoice') || 'Send Invoice'}
          </button>
        </div>
      )}

      {booking.status === 'pending' && booking.owner_approval === 'approved' && (
        <p className="booking-card-note">
          {isOwner
            ? (t('toolRentals.approvedNote') || 'You approved this request. You can now send the invoice.')
            : (t('toolRentals.approvedNoteRenter') || 'The owner approved your request. The invoice is on its way.')}
        </p>
      )}

      {!isOwner && booking.status === 'pending' && booking.owner_approval !== 'approved' && (
        <p className="booking-card-note">
          {t('toolRentals.awaitingApproval') || 'Waiting for the owner to approve this request.'}
        </p>
      )}

      {booking.status === 'cancelled' && booking.owner_decline_reason && (
        <p className="booking-card-note">
          {t('toolRentals.declineReasonLabel') || 'Decline reason:'} {booking.owner_decline_reason}
        </p>
      )}

      {/* Group 11 item 571: identity status for both parties. */}
      {renderIdentityLine(booking, isOwner)}

      {/* Group 11 item 576: return time + reschedule. Group 11 item 580:
          cleaning instructions at return, frozen in the snapshot. */}
      {renderReturnSection(booking, isOwner)}

      {/* Group 11 item 583: cancellation recovery + 584 alternatives. */}
      {booking.status === 'cancelled' && renderRecoveryPanel(booking)}

      {/* Group 11 Slice 2e: damage claims (586), escalation threads (589)
          and deposit acknowledgment (590) on every rental booking. */}
      <RentalDisputesPanel booking={booking} isOwner={isOwner} currentUserId={user?.id} onChanged={loadBookings} />

      {/* Group 11 item 575: checkout acknowledgment at pickup. The
          renter confirms receipt; the pickup condition report is the
          evidence and is shown in the booking panel above. */}
      {booking.checkout_acknowledged_at ? (
        <p className="booking-card-note">
          {isOwner
            ? (t('toolRentals.pickupConfirmedNoteOwner') || 'The renter confirmed pickup.')
            : (t('toolRentals.pickupConfirmedNote') || 'You confirmed receipt of the item as described.')}
          {' '}
          {new Date(booking.checkout_acknowledged_at).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })}
        </p>
      ) : !isOwner && booking.status === 'payment_confirmed' && (
        <div className="booking-card-actions">
          <button
            onClick={() => handleAcknowledgeCheckout(booking)}
            disabled={booking.renter_identity ? !booking.renter_identity.verified : false}
            title={booking.renter_identity && !booking.renter_identity.verified ? (t('toolRentals.identityPickupBlocked') || 'Complete identity verification before pickup.') : undefined}
            className="booking-action-btn booking-action-approve" data-track="ui.5655b990ea.21" data-track-private
          >
            {t('toolRentals.confirmPickup') || 'Confirm pickup'}
          </button>
        </div>
      )}

      {Number(booking.deposit_amount || 0) > 0 && booking.deposit_status && booking.deposit_status !== 'none' && (
        <div className="booking-card-deposit" data-testid="booking-deposit">
          <span>
            {t('toolRentals.depositLine', { amount: Number(booking.deposit_amount).toFixed(2) })}
            {' · '}
            {t(`toolRentals.depositStatus_${booking.deposit_status}`)}
          </span>
          {booking.deposit_withheld_amount != null && Number(booking.deposit_withheld_amount) > 0 && (
            <p>{t('toolRentals.depositWithheldDetail', { amount: Number(booking.deposit_withheld_amount).toFixed(2), reason: booking.deposit_resolution_note || '' })}</p>
          )}
          {isOwner && booking.deposit_status === 'held' && (
            <div className="booking-card-actions">
              <button onClick={() => handleResolveDeposit(booking, 'return')} className="booking-action-btn booking-action-approve" data-track="ui.5655b990ea.3">
                {t('toolRentals.depositReturn')}
              </button>
              <button onClick={() => handleResolveDeposit(booking, 'withhold')} className="booking-action-btn booking-action-decline" data-track="ui.5655b990ea.4">
                {t('toolRentals.depositWithhold')}
              </button>
            </div>
          )}
        </div>
      )}

      {isOwner && booking.status === 'payment_confirmed' && (
        <div className="booking-card-actions">
          <button
            onClick={() => handleConfirmReturn(booking)}
            className="booking-action-btn booking-action-approve" data-track="ui.5655b990ea.5"
          >
            {t('toolRentals.confirmReturnReceived') || 'Confirm return received'}
          </button>
          <button
            onClick={() => handleStatusUpdate(booking.id, 'cancelled')}
            className="booking-action-btn booking-action-cancel" data-track="ui.5655b990ea.6"
          >
            {t('toolRentals.cancelBooking') || 'Cancel Booking'}
          </button>
        </div>
      )}

      {isOwner && booking.status === 'returned' && (
        <div className="booking-card-actions">
          <button
            onClick={() => handleStatusUpdate(booking.id, 'completed')}
            className="booking-action-btn booking-action-approve" data-track="ui.5655b990ea.7"
          >
            {t('toolRentals.markCompleted') || 'Mark completed'}
          </button>
        </div>
      )}

      {!isOwner && booking.status === 'payment_confirmed' && (
        <div className="booking-card-actions">
          <button
            onClick={() => handleConfirmReturn(booking)}
            className="booking-action-btn booking-action-approve" data-track="ui.5655b990ea.8"
          >
            {t('toolRentals.confirmReturn') || 'Confirm return'}
          </button>
          <button
            onClick={() => handleStatusUpdate(booking.id, 'cancelled')}
            className="booking-action-btn booking-action-cancel" data-track="ui.5655b990ea.9"
          >
            {t('toolRentals.cancelBooking') || 'Cancel Booking'}
          </button>
        </div>
      )}

      {!isOwner && ['pending', 'invoice_sent'].includes(booking.status) && (
        <div className="booking-card-actions">
          <button
            onClick={() => handleStatusUpdate(booking.id, 'cancelled')}
            className="booking-action-btn booking-action-cancel" data-track="ui.5655b990ea.10"
          >
            {t('toolRentals.cancelBooking') || 'Cancel Booking'}
          </button>
        </div>
      )}

      {booking.status === 'returned' && booking.return_condition_note && (
        <p className="booking-card-note">
          {t('toolRentals.returnConditionLabel') || 'Return condition:'} {booking.return_condition_note}
        </p>
      )}

      {/* Group 11 item 570: in-app confirmation receipt. */}
      <div className="booking-card-actions">
        <button
          onClick={() => handleToggleReceipt(booking)}
          className="booking-action-btn booking-action-invoice" data-track="ui.5655b990ea.20"
        >
          {receiptOpen[booking.id]
            ? (t('toolRentals.hideReceipt') || 'Hide receipt')
            : (t('toolRentals.viewReceipt') || 'View receipt')}
        </button>
      </div>
      {renderReceipt(booking)}

      {!isOwner && booking.status !== 'cancelled' && booking.status !== 'completed' && (
        <div className="booking-card-actions">
          <button
            onClick={() => {
              setReportBookingId(booking.id);
              setReportOwnerId(booking.owner_id);
              setReportModalOpen(true);
            }}
            className="booking-action-btn booking-action-report" data-track="ui.5655b990ea.11"
          >
            <Flag className="w-4 h-4" />
            {t('toolRentals.reportUser') || 'Report User'}
          </button>
        </div>
      )}
    </div>
  );

  const helperBookingStatusConfig: Record<string, { icon: React.ElementType; colorClass: string; label: string }> = {
    pending:            { icon: Clock,        colorClass: 'hb-status-pending',   label: t('booking.statusPending') },
    accepted:           { icon: CheckCircle,  colorClass: 'hb-status-accepted',  label: t('booking.statusAccepted') },
    declined:           { icon: XCircle,      colorClass: 'hb-status-declined',  label: t('booking.statusDeclined') },
    expired:            { icon: AlertCircle,  colorClass: 'hb-status-expired',   label: t('booking.statusExpired') },
    cancelled:          { icon: XCircle,      colorClass: 'hb-status-cancelled', label: t('booking.statusCancelled') },
    accepted_cancelled: { icon: XCircle,      colorClass: 'hb-status-declined',  label: t('booking.statusAcceptedCancelled') },
  };

  const renderHelperBookingCard = (b: HelperBooking) => {
    const cfg = helperBookingStatusConfig[b.status] ?? helperBookingStatusConfig.pending;
    const StatusIcon = cfg.icon;
    const canCancel = b.status === 'pending' || b.status === 'accepted';
    const canConvert = b.status === 'declined' || b.status === 'expired' || b.status === 'cancelled' || b.status === 'accepted_cancelled';
    const formattedDate = new Date(`${b.requestedDate}T12:00:00`).toLocaleDateString(locale, {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    });

    return (
      <div key={b.id} className="booking-card hb-card">
        <div className={`hb-card-status-bar ${cfg.colorClass}`}>
          <StatusIcon size={16} />
          <span className="hb-status-label">{cfg.label}</span>
        </div>
        <div className="booking-card-header">
          <div className="booking-card-info">
            <h3 className="booking-card-title">{b.serviceName}</h3>
            <span className="hb-meta">{formattedDate} · {formatTime(b.requestedStartTime, locale)} – {formatTime(b.requestedEndTime, locale)}</span>
          </div>
        </div>
        {b.serviceLocation && (
          <div className="booking-card-details">
            <div className="booking-card-date">
              <MapPin size={14} />
              <span>{b.serviceLocation}</span>
            </div>
          </div>
        )}
        {b.helperResponseReason && (
          <p className="hb-reason">{b.helperResponseReason}</p>
        )}
        {b.status === 'accepted' && (
          <BookingRescheduleBox
            bookingId={b.id}
            proposal={b.pendingRescheduleProposal || null}
            currentUserId={user?.id}
            onDone={loadBookings}
          />
        )}
        <div className="booking-card-actions">
          <button
            onClick={() => handleBookAgain(b)}
            className="booking-action-btn booking-action-approve" data-track="ui.5655b990ea.12"
          >
            {t('booking.bookAgain')}
          </button>
          {b.status === 'pending' && (
            <Link
              to={`/messages?helperId=${encodeURIComponent(b.helperId)}`}
              className="booking-action-btn booking-action-invoice"
            >
              {t('booking.contactHelper')}
            </Link>
          )}
          {b.status === 'accepted' && (
            <Link to="/calendar" className="booking-action-btn booking-action-approve">
              {t('booking.viewCalendar')}
            </Link>
          )}
          {canConvert && (
            <button
              onClick={() => handleConvertHelperBookingToJob(b.id)}
              className="booking-action-btn booking-action-approve" data-track="ui.5655b990ea.13"
            >
              {t('booking.postAsJob')}
            </button>
          )}
          {canCancel && (
            <button
              onClick={() => handleCancelHelperBooking(b.id)}
              className="booking-action-btn booking-action-cancel" data-track="ui.5655b990ea.14"
            >
              {t('common.cancel')}
            </button>
          )}
        </div>
      </div>
    );
  };

  const myRentalsCount = myBookings.length;
  const myToolsCount = ownerBookings.length;
  const helperBookingsCount = helperBookings.length;
  const activeCount = [...myBookings, ...ownerBookings].filter((booking) => !['cancelled', 'completed'].includes(booking.status)).length
    + helperBookings.filter((booking) => !['declined', 'expired', 'cancelled', 'accepted_cancelled'].includes(booking.status)).length;
  const pendingCount = myBookings.filter((booking) => booking.status === 'pending' || booking.status === 'invoice_sent').length
    + ownerBookings.filter((booking) => booking.status === 'pending').length
    + helperBookings.filter((booking) => booking.status === 'pending').length;

  const renderEmptyState = (
    title: string,
    body: string,
    primaryLabel: string,
    primaryHref: string,
    secondaryLabel?: string,
    secondaryHref?: string
  ) => (
    <div className="my-bookings-empty-v2">
      <div className="my-bookings-empty-icon">
        <Calendar size={30} aria-hidden="true" />
      </div>
      <p className="my-bookings-empty-kicker">{title}</p>
      <p className="my-bookings-empty-copy">{body}</p>
      <div className="my-bookings-empty-actions">
        <Link to={primaryHref} className="booking-action-btn booking-action-approve">
          {primaryLabel}
        </Link>
        {secondaryHref && secondaryLabel && (
          <Link to={secondaryHref} className="booking-action-btn booking-action-invoice">
            {secondaryLabel}
          </Link>
        )}
      </div>
      <div className="my-bookings-empty-guide">
        <strong>{t('myBookings.connectTitle')}</strong>
        <span>{t('myBookings.connectBody')}</span>
      </div>
    </div>
  );

  return (
    <PageShell>
      <PageMeta
        title={t('toolRentals.myBookings')}
        description={t('myBookings.metaDescription')}
      />

      <div className="my-bookings-container">
        <MyBusinessVisits />
        <MyFormerWorkplaces />
        <div className="my-bookings-hero">
          <div className="my-bookings-header">
            <p className="my-bookings-eyebrow">{t('myBookings.eyebrow')}</p>
            <h1 className="my-bookings-title">{t('toolRentals.myBookings')}</h1>
            <p className="my-bookings-subtitle">
              {t('myBookings.subtitle')}
            </p>
            <div className="my-bookings-hero-actions">
              <Link to="/helpers" className="my-bookings-hero-btn primary">
                <Briefcase size={17} aria-hidden="true" />
                {t('myBookings.bookHelper')}
              </Link>
              <Link to="/tool-rentals" className="my-bookings-hero-btn secondary">
                <Wrench size={17} aria-hidden="true" />
                {t('myBookings.browseTools')}
              </Link>
            </div>
          </div>
          <div className="my-bookings-summary">
            <div>
              <span>{activeCount}</span>
              <p>{t('myBookings.activeItems')}</p>
            </div>
            <div>
              <span>{pendingCount}</span>
              <p>{t('myBookings.needAttention')}</p>
            </div>
            <div>
              <span>{myToolsCount}</span>
              <p>{t('myBookings.toolRequests')}</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="my-bookings-tabs">
          <button
            onClick={() => setActiveTab('helper-bookings')}
            className={`my-bookings-tab ${activeTab === 'helper-bookings' ? 'active' : ''}`} data-track="ui.5655b990ea.15"
          >
            {t('booking.tabTitle') || 'Service Bookings'} ({helperBookingsCount})
          </button>
          <button
            onClick={() => setActiveTab('my-rentals')}
            className={`my-bookings-tab ${activeTab === 'my-rentals' ? 'active' : ''}`} data-track="ui.5655b990ea.16"
          >
            {t('toolRentals.toolsRented') || 'Tools I Rented'} ({myRentalsCount})
          </button>
          <button
            onClick={() => setActiveTab('my-tools')}
            className={`my-bookings-tab ${activeTab === 'my-tools' ? 'active' : ''}`} data-track="ui.5655b990ea.17"
          >
            {t('toolRentals.toolsLent') || 'My Tools Rented'} ({myToolsCount})
          </button>
        </div>

        {/* Content */}
        <div className="my-bookings-content">
          {error && (
            <div className="my-bookings-error">
              <AlertCircle className="w-5 h-5" />
              <p>{error}</p>
            </div>
          )}

          {loading ? (
            <div className="my-bookings-loading">
              <Loader className="animate-spin w-8 h-8" />
              <p>{t('common.loading')}</p>
            </div>
          ) : activeTab === 'helper-bookings' ? (
            <div className="my-bookings-list">
              {helperBookings.length > 0 ? (
                helperBookings.map((b) => renderHelperBookingCard(b))
              ) : (
                renderEmptyState(
                  t('booking.noBookingsYet') || 'No service booking requests yet',
                  t('myBookings.helperEmptyBody'),
                  t('booking.backToDirectory') || 'Browse helpers',
                  '/helpers',
                  t('myBookings.postPublicJob'),
                  '/post-job'
                )
              )}
            </div>
          ) : activeTab === 'my-rentals' ? (
            <div className="my-bookings-list">
              {myBookings.length > 0 ? (
                myBookings.map((booking) => renderBookingCard(booking, false))
              ) : (
                renderEmptyState(
                  t('toolRentals.noBookings') || 'You have no bookings yet',
                  t('myBookings.rentalEmptyBody'),
                  t('myBookings.browseTools'),
                  '/tool-rentals',
                  t('myBookings.plannedNeeds'),
                  '/planned-needs'
                )
              )}
            </div>
          ) : (
            <div className="my-bookings-list">
              {ownerBookings.length > 0 ? (
                ownerBookings.map((booking) => renderBookingCard(booking, true))
              ) : (
                renderEmptyState(
                  t('toolRentals.noPendingBookings') || 'No one has booked your tools yet',
                  t('myBookings.ownerEmptyBody'),
                  t('myBookings.listTool'),
                  '/dashboard?tab=skills',
                  t('myBookings.openAnalytics'),
                  '/tool-rentals/analytics'
                )
              )}
            </div>
          )}
        </div>
      </div>

      {invoiceModalOpen && invoiceBookingId && (
        <InvoiceModal
          bookingId={invoiceBookingId}
          isOpen={invoiceModalOpen}
          onClose={() => {
            setInvoiceModalOpen(false);
            setInvoiceBookingId(null);
            loadBookings();
          }}
        />
      )}

      {termsModalOpen && termsBookingId && (
        <TermsAcceptanceModal
          isOpen={termsModalOpen}
          onClose={() => {
            setTermsModalOpen(false);
            setTermsBookingId(null);
          }}
          bookingId={termsBookingId}
          userRole="owner"
          onAccepted={() => {
            setTermsModalOpen(false);
            setInvoiceBookingId(termsBookingId);
            setTermsBookingId(null);
            setInvoiceModalOpen(true);
          }}
        />
      )}

      {reportModalOpen && reportBookingId && reportOwnerId && (
        <UserReportModal
          userId={reportOwnerId}
          bookingId={reportBookingId}
          isOpen={reportModalOpen}
          onClose={() => {
            setReportModalOpen(false);
            setReportBookingId(null);
            setReportOwnerId(null);
          }}
          onReportSubmitted={() => {
            toast.success(t('toolRentals.reportSubmitted') || 'Report submitted');
            setReportModalOpen(false);
            setReportBookingId(null);
            setReportOwnerId(null);
          }}
        />
      )}
    </PageShell>
  );
};

const MyBookingsPage=()=>{const {user}=useAuth();return user?.id?<MyBookingsPageContent key={`${user.id}:${currentAuthEpoch()}`}/>:null;};
export default MyBookingsPage;
