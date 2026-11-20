import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

function formatTime(hhmm) {
  if (!hhmm) return hhmm;
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(2000, 0, 1, h, m || 0);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
import { Link } from 'react-router-dom';
import {
  Clock, CheckCircle, XCircle, AlertCircle, RefreshCw,
  ChevronDown,
} from 'lucide-react';
import api from '../../api/axios';
import {
  getBookingSharingPreview,
  getBookingPaymentBreakdown,
  listBookingSponsorships,
  createBookingSponsorship,
  requestSponsorshipCharge,
  listBookingSiteActions,
  listBookingFeedback,
  listBookingSitePhotos,
  replaceBookingContact,
  renewBookingStatusLink,
  deliverBookingLinkAlternate,
  setBookingCareInstructions,
  shareBookingReceipt,
  getBookingReceipt,
} from '../../api/bookings';
import toast from 'react-hot-toast';
import './BookingRequestCard.css';

function statusDescriptionKey(status) {
  const map = {
    pending: 'booking.statusPendingDesc',
    accepted: 'booking.statusAcceptedDesc',
    declined: 'booking.statusDeclinedDesc',
    expired: 'booking.statusExpiredDesc',
    cancelled: 'booking.statusCancelledDesc',
    accepted_cancelled: 'booking.statusAcceptedCancelledDesc',
    // D-53: completed is a real booking status now (sweeper-delivered).
    completed: 'booking.statusCompletedDesc',
  };
  return map[status] || 'booking.statusPendingDesc';
}

/**
 * Booking request status card with optional "Post as public job" when booking failed.
 */
export default function BookingRequestCard({ booking, onConvertToJob }) {
  const { t } = useTranslation();
  const [timeRemaining, setTimeRemaining] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [live, setLive] = useState(booking);
  // Recipient's public QR pay link, loaded lazily once the booking is accepted.
  const [payUrl, setPayUrl] = useState(null);
  const [payUrlChecked, setPayUrlChecked] = useState(false);
  // Group 3: booker participant panel (sharing preview, sponsors,
  // breakdown, link management, site actions, feedback). Loaded lazily
  // when the booker opens it, so the card stays cheap by default.
  const [showParticipants, setShowParticipants] = useState(false);
  const [participants, setParticipants] = useState(null);
  const [participantsLoading, setParticipantsLoading] = useState(false);
  const [sponsorName, setSponsorName] = useState('');
  const [sponsorEmail, setSponsorEmail] = useState('');
  const [sponsorAmount, setSponsorAmount] = useState('');
  const [replaceRole, setReplaceRole] = useState('recipient');
  const [replaceName, setReplaceName] = useState('');
  const [replacePhone, setReplacePhone] = useState('');
  const [replaceEmail, setReplaceEmail] = useState('');
  const [deliverKind, setDeliverKind] = useState('recipient');
  const [deliverEmail, setDeliverEmail] = useState('');
  const [careText, setCareText] = useState('');
  const [chargeAmount, setChargeAmount] = useState('');
  const [chargeReason, setChargeReason] = useState('');
  const [chargeSponsorshipId, setChargeSponsorshipId] = useState('');

  const loadParticipants = async () => {
    setParticipantsLoading(true);
    try {
      const [sharing, breakdown, sponsorships, siteActions, feedback, photos] = await Promise.all([
        getBookingSharingPreview(live.id).catch(() => null),
        getBookingPaymentBreakdown(live.id).catch(() => null),
        listBookingSponsorships(live.id).catch(() => []),
        listBookingSiteActions(live.id).catch(() => []),
        listBookingFeedback(live.id).catch(() => []),
        listBookingSitePhotos(live.id).catch(() => []),
      ]);
      setParticipants({
        sharing,
        breakdown,
        sponsorships: sponsorships || [],
        siteActions: siteActions || [],
        feedback: feedback || [],
        photos: photos || [],
      });
    } finally {
      setParticipantsLoading(false);
    }
  };

  const toggleParticipants = () => {
    const next = !showParticipants;
    setShowParticipants(next);
    if (next && !participants) loadParticipants();
  };

  const money = (cents) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format((cents || 0) / 100);
  const dollarsToCents = (value) => {
    const n = Math.round(Number.parseFloat(value) * 100);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  // Sync when parent passes a fresh booking (BookingFlow owns the poll cycle)
  useEffect(() => {
    setLive(booking);
  }, [booking]);

  // Once accepted, offer a direct pay path via the recipient's QR pay link.
  useEffect(() => {
    if (live.status !== 'accepted' || payUrlChecked || !live.helperId) return;
    setPayUrlChecked(true);
    api
      .get(`/qr-payments/public/user/${encodeURIComponent(live.helperId)}/pay-code`)
      .then((res) => {
        if (res.data?.pay_url) setPayUrl(res.data.pay_url);
      })
      .catch(() => {
        /* no pay link available; the card simply omits the button */
      });
  }, [live.status, live.helperId, payUrlChecked]);

  useEffect(() => {
    if (live.status !== 'pending') return;

    const updateCountdown = () => {
      const expiresAt = new Date(live.expiresAt);
      const now = new Date();
      const diffMs = expiresAt - now;

      if (diffMs <= 0) {
        setTimeRemaining(null);
      } else {
        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        setTimeRemaining(`${hours}h ${minutes}m`);
      }
    };

    updateCountdown();
    const timer = setInterval(updateCountdown, 60000);

    return () => clearInterval(timer);
  }, [live.expiresAt, live.status]);

  const statusConfig = {
    pending: {
      icon: Clock,
      color: 'status-pending',
      label: t('booking.statusPending'),
    },
    accepted: {
      icon: CheckCircle,
      color: 'status-accepted',
      label: t('booking.statusAccepted'),
    },
    declined: {
      icon: XCircle,
      color: 'status-declined',
      label: t('booking.statusDeclined'),
    },
    expired: {
      icon: AlertCircle,
      color: 'status-expired',
      label: t('booking.statusExpired'),
    },
    cancelled: {
      icon: XCircle,
      color: 'status-cancelled',
      label: t('booking.statusCancelled'),
    },
    accepted_cancelled: {
      icon: XCircle,
      color: 'status-declined',
      label: t('booking.statusAcceptedCancelled'),
    },
    completed: {
      icon: CheckCircle,
      color: 'status-accepted',
      label: t('booking.statusCompleted'),
    },
  };

  const config = statusConfig[live.status] || statusConfig.pending;
  const StatusIcon = config.icon;

  const shouldShowConvertOption =
    live.status === 'declined' ||
    live.status === 'expired' ||
    live.status === 'cancelled' ||
    live.status === 'accepted_cancelled';

  const refresh = () => {
    api.get(`/bookings/${live.id}`).then((res) => {
      if (res.data?.data) setLive(res.data.data);
    });
  };

  return (
    <div className="booking-request-card">
      <div className={`booking-status-header ${config.color}`}>
        <StatusIcon size={24} />
        <div className="booking-status-text">
          <h3>{config.label}</h3>
          {live.status === 'pending' && timeRemaining && (
            <p className="booking-countdown">
              {t('booking.expiresIn')} {timeRemaining}
            </p>
          )}
          {live.status === 'pending' && live.autoPostOnExpiry && (
            <p className="booking-countdown">{t('booking.autoPostPending', { hours: live.confirmationHours || 1 })}</p>
          )}
          {live.helperResponseReason && (
            <p className="booking-reason">{live.helperResponseReason}</p>
          )}
        </div>
      </div>

      <div className="booking-status-body">
        <p className="booking-status-description">{t(statusDescriptionKey(live.status))}</p>

        <div className="booking-details-summary">
          <div className="detail-row">
            <span className="detail-label">{t('booking.service')}:</span>
            <span className="detail-value">{live.serviceName}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">{t('booking.date')}:</span>
            <span className="detail-value">
              {new Date(live.requestedDate).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
          </div>
          <div className="detail-row">
            <span className="detail-label">{t('booking.time')}:</span>
            <span className="detail-value">
              {live.availabilityMode === 'request_only'
                ? t('booking.flexibleTime')
                : `${formatTime(live.requestedStartTime)} – ${formatTime(live.requestedEndTime)}`}
            </span>
          </div>
          <div className="detail-row">
            <span className="detail-label">{t('booking.location')}:</span>
            <span className="detail-value">{live.serviceLocation}</span>
          </div>
          {live.confirmationHours != null && (
            <div className="detail-row">
              <span className="detail-label">{t('booking.confirmationWindowShort')}:</span>
              <span className="detail-value">
                {t('booking.hoursCount', { count: live.confirmationHours })}
              </span>
            </div>
          )}
          {/* G-6: who the work is for, when the booker booked for someone else. */}
          {(live.recipientName || live.recipientPhone) && (
            <div className="detail-row">
              <span className="detail-label">{t('booking.bookedFor')}:</span>
              <span className="detail-value">
                {[live.recipientName, live.recipientPhone].filter(Boolean).join(' · ')}
              </span>
            </div>
          )}
          {/* Group 2, item 54: the visit ownership label — who the visit
              is for and whether a household delegate booked it. */}
          {live.ownershipLabel && (
            <div className="detail-row">
              <span className="detail-label">{t('booking.visitOwnership')}:</span>
              <span className="detail-value">{live.ownershipLabel}</span>
            </div>
          )}
          {/* G-7: site contact + their status link (status and arrival window
              only, no amounts, no billing). The booker shares this link. */}
          {(live.siteContactName || live.siteContactPhone) && (
            <div className="detail-row">
              <span className="detail-label">{t('booking.siteContact')}:</span>
              <span className="detail-value">
                {[live.siteContactName, live.siteContactPhone].filter(Boolean).join(' · ')}
              </span>
            </div>
          )}
          {live.statusToken && !live.statusTokenRevokedAt && (
            <div className="detail-row">
              <span className="detail-label">{t('booking.statusLink')}:</span>
              <span className="detail-value" style={{ overflowWrap: 'anywhere' }}>
                {`${window.location.origin}/bookings/status/${live.statusToken}`}
                <button
                  type="button"
                  className="booking-btn-secondary"
                  style={{ marginLeft: '0.5rem' }}
                  onClick={() => {
                    navigator.clipboard?.writeText(`${window.location.origin}/bookings/status/${live.statusToken}`);
                    toast.success(t('booking.linkCopied'));
                  }} data-track="ui.474702b501.5"
                >
                  {t('booking.copyLink')}
                </button>
              </span>
            </div>
          )}
          {/* G-6: the recipient invite link (accept/decline). The booker
              shares it with a named recipient; account recipients get it
              in-app. Only the booker ever sees this token. */}
          {live.recipientToken && !live.statusTokenRevokedAt && (
            <div className="detail-row">
              <span className="detail-label">{t('booking.recipientInviteLink')}:</span>
              <span className="detail-value" style={{ overflowWrap: 'anywhere' }}>
                {`${window.location.origin}/bookings/status/${live.recipientToken}`}
                <button
                  type="button"
                  className="booking-btn-secondary"
                  style={{ marginLeft: '0.5rem' }}
                  onClick={() => {
                    navigator.clipboard?.writeText(`${window.location.origin}/bookings/status/${live.recipientToken}`);
                    toast.success(t('booking.linkCopied'));
                  }} data-track="ui.474702b501.6"
                >
                  {t('booking.copyLink')}
                </button>
              </span>
            </div>
          )}
          {/* G-6/G-7: the booker revokes both links before the recipient
              responds. Shown only while consent is still pending. */}
          {(live.statusToken || live.recipientToken) && !live.statusTokenRevokedAt && (live.recipientConsentStatus || 'pending') === 'pending' && (
            <div className="detail-row">
              <span className="detail-label">{t('booking.statusLinkRevoke')}:</span>
              <span className="detail-value">
                <button
                  type="button"
                  className="booking-btn-secondary"
                  onClick={async () => {
                    try {
                      const { data } = await api.post(`/bookings/${live.id}/status-link/revoke`);
                      if (data?.data) setLive(data.data);
                      toast.success(t('booking.statusLinkRevoked'));
                    } catch {
                      toast.error(t('booking.statusLinkRevokeFailed'));
                    }
                  }} data-track="ui.474702b501.7"
                >
                  {t('booking.revokeLink')}
                </button>
              </span>
            </div>
          )}
        </div>

        {live.description && (
          <button type="button" onClick={() => setExpanded(!expanded)} className="booking-expand-btn" data-track="ui.474702b501.1">
            <ChevronDown size={18} style={{ transform: expanded ? 'rotate(180deg)' : 'none' }} />
            {t('booking.additionalDetails')}
          </button>
        )}

        {expanded && live.description && (
          <div className="booking-description-section">
            <p>{live.description}</p>
          </div>
        )}

        {/* Group 3: who sees what, who pays, and what happened on site.
            Booker only: the card renders inside the booker's own flow. */}
        <button type="button" onClick={toggleParticipants} className="booking-expand-btn" data-track="ui.474702b501.25">
          <ChevronDown size={18} style={{ transform: showParticipants ? 'rotate(180deg)' : 'none' }} />
          {t('booking.participantsTitle')}
        </button>
        {showParticipants && (
          <div className="booking-participant-section">
            {participantsLoading && <p>{t('common.loading')}</p>}
            {participants?.sharing && (
              <div>
                <h4>{t('booking.sharingPreviewTitle')}</h4>
                {['recipient', 'siteContact', 'sponsor'].map((role) => (
                  <div key={role}>
                    <p><strong>{t(`booking.sharingRole.${role}`)}</strong></p>
                    <p>{t('booking.sharingSees')}: {(participants.sharing[role]?.sees || []).join(', ')}</p>
                    <p>{t('booking.sharingNeverSees')}: {(participants.sharing[role]?.neverSees || []).join(', ')}</p>
                    <p>{t('booking.sharingCanDo')}: {(participants.sharing[role]?.canDo || []).join(', ')}</p>
                  </div>
                ))}
              </div>
            )}
            {participants?.breakdown && (
              <div>
                <h4>{t('booking.breakdownTitle')}</h4>
                {participants.breakdown.declaredCents != null && (
                  <p>{t('booking.breakdownDeclared')}: {money(participants.breakdown.declaredCents)}</p>
                )}
                {participants.breakdown.remainingCents != null && (
                  <p>{t('booking.breakdownRemaining')}: {money(participants.breakdown.remainingCents)}</p>
                )}
                <ul className="booking-participant-list">
                  {(participants.breakdown.payments || []).map((p, i) => (
                    <li key={`${p.payer}-${i}`}>
                      {p.payerLabel} — {p.amountCents != null ? money(p.amountCents) : t('common.notProvided')} — {p.paymentStatus}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <h4>{t('booking.sponsorsTitle')}</h4>
              {(participants?.sponsorships || []).length === 0 && <p>{t('booking.noSponsors')}</p>}
              <ul className="booking-participant-list">
                {(participants?.sponsorships || []).map((s) => (
                  <li key={s.id}>{s.sponsorName || s.sponsorEmail} — {money(s.amountCents)} — {s.status}</li>
                ))}
              </ul>
              <div className="booking-participant-form">
                <label className="booking-field">
                  <span>{t('booking.sponsorNameLabel')}</span>
                  <input type="text" value={sponsorName} onChange={(e) => setSponsorName(e.target.value)} />
                </label>
                <label className="booking-field">
                  <span>{t('booking.sponsorEmailLabel')}</span>
                  <input type="email" value={sponsorEmail} onChange={(e) => setSponsorEmail(e.target.value)} />
                </label>
                <label className="booking-field">
                  <span>{t('booking.sponsorAmountLabel')}</span>
                  <input type="number" min="0.5" step="0.01" value={sponsorAmount} onChange={(e) => setSponsorAmount(e.target.value)} placeholder="50.00" />
                </label>
                <button
                  type="button"
                  className="booking-btn-secondary"
                  data-track="ui.474702b501.26"
                  onClick={async () => {
                    const cents = dollarsToCents(sponsorAmount);
                    if (!sponsorEmail.trim() || !cents) {
                      toast.error(t('booking.sponsorInviteInvalid'));
                      return;
                    }
                    try {
                      await createBookingSponsorship(live.id, { sponsorEmail: sponsorEmail.trim(), sponsorName: sponsorName.trim() || undefined, amountCents: cents });
                      toast.success(t('booking.sponsorInvited'));
                      setSponsorName('');
                      setSponsorEmail('');
                      setSponsorAmount('');
                      loadParticipants();
                    } catch {
                      toast.error(t('booking.sponsorInviteFailed'));
                    }
                  }}
                >
                  {t('booking.inviteSponsor')}
                </button>
              </div>
              {(participants?.sponsorships || []).some((s) => ['accepted', 'paid'].includes(s.status)) && (
                <div className="booking-participant-form">
                  <label className="booking-field">
                    <span>{t('booking.chargeSponsorLabel')}</span>
                    <select value={chargeSponsorshipId} onChange={(e) => setChargeSponsorshipId(e.target.value)}>
                      <option value="">{t('booking.chargeSponsorPlaceholder')}</option>
                      {(participants.sponsorships || []).filter((s) => ['accepted', 'paid'].includes(s.status)).map((s) => (
                        <option key={s.id} value={s.id}>{s.sponsorName || s.sponsorEmail} — {money(s.amountCents)}</option>
                      ))}
                    </select>
                  </label>
                  <label className="booking-field">
                    <span>{t('booking.chargeAmountLabel')}</span>
                    <input type="number" min="0.5" step="0.01" value={chargeAmount} onChange={(e) => setChargeAmount(e.target.value)} placeholder="10.00" />
                  </label>
                  <label className="booking-field">
                    <span>{t('booking.chargeReasonLabel')}</span>
                    <input type="text" value={chargeReason} onChange={(e) => setChargeReason(e.target.value)} />
                  </label>
                  <button
                    type="button"
                    className="booking-btn-secondary"
                    data-track="ui.474702b501.27"
                    onClick={async () => {
                      const cents = dollarsToCents(chargeAmount);
                      if (!chargeSponsorshipId || !cents || !chargeReason.trim()) {
                        toast.error(t('booking.chargeInvalid'));
                        return;
                      }
                      try {
                        await requestSponsorshipCharge(live.id, chargeSponsorshipId, { amountCents: cents, reason: chargeReason.trim() });
                        toast.success(t('booking.chargeRequested'));
                        setChargeAmount('');
                        setChargeReason('');
                        loadParticipants();
                      } catch {
                        toast.error(t('booking.chargeFailed'));
                      }
                    }}
                  >
                    {t('booking.requestCharge')}
                  </button>
                </div>
              )}
            </div>
            <div>
              <h4>{t('booking.linkManageTitle')}</h4>
              <div className="booking-participant-form">
                <label className="booking-field">
                  <span>{t('booking.replaceRoleLabel')}</span>
                  <select value={replaceRole} onChange={(e) => setReplaceRole(e.target.value)}>
                    <option value="recipient">{t('booking.replaceRole.recipient')}</option>
                    <option value="site_contact">{t('booking.replaceRole.site_contact')}</option>
                  </select>
                </label>
                <label className="booking-field">
                  <span>{t('booking.replaceNameLabel')}</span>
                  <input type="text" value={replaceName} onChange={(e) => setReplaceName(e.target.value)} />
                </label>
                <label className="booking-field">
                  <span>{t('booking.replacePhoneLabel')}</span>
                  <input type="tel" value={replacePhone} onChange={(e) => setReplacePhone(e.target.value)} />
                </label>
                <label className="booking-field">
                  <span>{t('booking.replaceEmailLabel')}</span>
                  <input type="email" value={replaceEmail} onChange={(e) => setReplaceEmail(e.target.value)} />
                </label>
                <button
                  type="button"
                  className="booking-btn-secondary"
                  data-track="ui.474702b501.28"
                  onClick={async () => {
                    try {
                      await replaceBookingContact(live.id, { role: replaceRole, name: replaceName.trim(), phone: replacePhone.trim(), email: replaceEmail.trim() });
                      toast.success(t('booking.contactReplaced'));
                      refresh();
                      loadParticipants();
                    } catch {
                      toast.error(t('booking.contactReplaceFailed'));
                    }
                  }}
                >
                  {t('booking.replaceContact')}
                </button>
                <button
                  type="button"
                  className="booking-btn-secondary"
                  data-track="ui.474702b501.29"
                  onClick={async () => {
                    try {
                      await renewBookingStatusLink(live.id, {});
                      toast.success(t('booking.linkRenewed'));
                      refresh();
                    } catch {
                      toast.error(t('booking.linkRenewFailed'));
                    }
                  }}
                >
                  {t('booking.renewLink')}
                </button>
                <label className="booking-field">
                  <span>{t('booking.deliverKindLabel')}</span>
                  <select value={deliverKind} onChange={(e) => setDeliverKind(e.target.value)}>
                    <option value="recipient">{t('booking.replaceRole.recipient')}</option>
                    <option value="site_contact">{t('booking.replaceRole.site_contact')}</option>
                  </select>
                </label>
                <label className="booking-field">
                  <span>{t('booking.deliverEmailLabel')}</span>
                  <input type="email" value={deliverEmail} onChange={(e) => setDeliverEmail(e.target.value)} />
                </label>
                <button
                  type="button"
                  className="booking-btn-secondary"
                  data-track="ui.474702b501.30"
                  onClick={async () => {
                    if (!deliverEmail.trim()) {
                      toast.error(t('booking.deliverInvalid'));
                      return;
                    }
                    try {
                      await deliverBookingLinkAlternate(live.id, { kind: deliverKind, email: deliverEmail.trim() });
                      toast.success(t('booking.linkDelivered'));
                      setDeliverEmail('');
                    } catch {
                      toast.error(t('booking.linkDeliverFailed'));
                    }
                  }}
                >
                  {t('booking.deliverLink')}
                </button>
              </div>
            </div>
            <div>
              <h4>{t('booking.token.careTitle')}</h4>
              <label className="booking-field">
                <span>{t('booking.careLabel')}</span>
                <textarea value={careText} onChange={(e) => setCareText(e.target.value)} placeholder={t('booking.carePlaceholder')} />
              </label>
              <button
                type="button"
                className="booking-btn-secondary"
                data-track="ui.474702b501.31"
                onClick={async () => {
                  try {
                    await setBookingCareInstructions(live.id, careText.trim());
                    toast.success(t('booking.careSaved'));
                    setCareText('');
                  } catch {
                    toast.error(t('booking.careFailed'));
                  }
                }}
              >
                {t('common.save')}
              </button>
              <button
                type="button"
                className="booking-btn-secondary"
                data-track="ui.474702b501.32"
                onClick={async () => {
                  try {
                    await shareBookingReceipt(live.id);
                    toast.success(t('booking.receiptShared'));
                    const r = await getBookingReceipt(live.id).catch(() => null);
                    if (r) toast.success(`${t('booking.receiptShared')} ${r.confirmationCode}`);
                  } catch {
                    toast.error(t('booking.receiptShareFailed'));
                  }
                }}
              >
                {t('booking.shareReceipt')}
              </button>
            </div>
            <div>
              <h4>{t('booking.token.actionsTitle')}</h4>
              {(participants?.siteActions || []).length === 0 && <p>{t('booking.noSiteActions')}</p>}
              <ul className="booking-participant-list">
                {(participants?.siteActions || []).map((a) => (
                  <li key={a.id}>{a.label} — {a.createdAt ? new Date(a.createdAt).toLocaleString() : ''}</li>
                ))}
              </ul>
              <h4>{t('booking.token.feedbackTitle')}</h4>
              {(participants?.feedback || []).length === 0 && <p>{t('booking.noFeedback')}</p>}
              <ul className="booking-participant-list">
                {(participants?.feedback || []).map((f) => (
                  <li key={f.id}>{f.rating ? `${f.rating}/5 — ` : ''}{f.body}</li>
                ))}
              </ul>
              {(participants?.photos || []).length > 0 && (
                <>
                  <h4>{t('booking.token.photosTitle')}</h4>
                  <ul className="booking-participant-list">
                    {participants.photos.map((p) => (
                      <li key={p.id}>
                        {p.url ? (
                          <a href={p.url} target="_blank" rel="noreferrer" data-track="ui.474702b501.33">{t('booking.photoLink')}</a>
                        ) : (
                          t('booking.token.photoBy', { who: p.contributorType })
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        )}

        <div className="booking-status-actions">
          {live.status === 'pending' && (
            <>
              <Link
                className="booking-btn-secondary"
                to={`/messages?helperId=${encodeURIComponent(live.helperId)}`}
                style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                {t('booking.contactHelper')}
              </Link>
              <button type="button" className="booking-btn-secondary" onClick={refresh} data-track="ui.474702b501.2">
                <RefreshCw size={16} />
                {t('booking.refreshStatus')}
              </button>
              <Link
                to="/my-bookings"
                className="booking-btn-secondary"
                style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                {t('booking.viewMyBookings', { defaultValue: 'View my bookings' })}
              </Link>
            </>
          )}

          {live.status === 'accepted' && (
            <div className="booking-accepted-actions">
              {payUrl && (
                <a
                  href={payUrl}
                  className="booking-btn-primary"
                  style={{ textDecoration: 'none' }} data-track="ui.474702b501.3"
                >
                  {t('booking.payNow', { defaultValue: 'Pay now' })}
                </a>
              )}
              <Link to="/calendar" className="booking-btn-secondary" style={{ textDecoration: 'none' }}>
                {t('booking.viewCalendar')}
              </Link>
              <Link to="/my-bookings" className="booking-btn-secondary" style={{ textDecoration: 'none' }}>
                {t('booking.viewMyBookings', { defaultValue: 'View my bookings' })}
              </Link>
            </div>
          )}

          {live.status === 'expired' && live.convertedToJobId ? (
            <Link to={`/jobs/${encodeURIComponent(live.convertedToJobId)}`} className="booking-btn-primary" style={{ textDecoration: 'none' }}>
              {t('booking.viewPublicJob')}
            </Link>
          ) : shouldShowConvertOption && (
            <button type="button" onClick={onConvertToJob} className="booking-btn-primary" data-track="ui.474702b501.4">
              {t('booking.postAsJob')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
