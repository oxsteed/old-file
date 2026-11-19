import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Calendar, CheckCircle2, Clock3, MapPin } from 'lucide-react';
import PageMeta from '../components/PageMeta';
import api from '../api/axios';
import { respondToRecipientInvite } from '../api/bookings';
import toast from 'react-hot-toast';

// G-7: public site-contact status link. Token-gated, no sign-in. Shows the
// service, its status, and the arrival window only. No amounts, no billing,
// no customer or helper identity, no payment state.
function formatTime(hhmm) {
  if (!hhmm) return hhmm;
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(2000, 0, 1, h, m || 0);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function PublicBookingStatusPage() {
  const { token } = useParams();
  const { t } = useTranslation();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [responding, setResponding] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await api.get(`/bookings/status/${encodeURIComponent(token)}`);
        if (mounted) setStatus(data?.data || null);
      } catch {
        if (mounted) setError(true);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [token]);

  // G-6: the recipient accepts or declines via their invite token. The
  // site-contact link never offers this: only the recipient token does.
  const handleRespond = async (decision) => {
    setResponding(true);
    try {
      const result = await respondToRecipientInvite(token, decision);
      setStatus((prev) => (prev ? {
        ...prev,
        recipientConsentStatus: result.recipientConsentStatus || decision,
        recipientConsentedAt: result.recipientConsentedAt || new Date().toISOString(),
        canRespondAsRecipient: false,
      } : prev));
      toast.success(t(decision === 'accepted' ? 'booking.recipientAccepted' : 'booking.recipientDeclined'));
    } catch {
      toast.error(t('booking.recipientResponseFailed'));
    } finally {
      setResponding(false);
    }
  };

  const dateLabel = status?.requestedDate
    ? new Date(`${status.requestedDate}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
    : null;

  return (
    <div className="public-booking-status" style={{ maxWidth: 640, margin: '2rem auto', padding: '0 1rem' }}>
      <PageMeta title={t('booking.publicStatusTitle')} />
      <h1>{t('booking.publicStatusTitle')}</h1>
      {loading && <p>{t('common.loading')}</p>}
      {!loading && error && (
        <p role="alert">
          <AlertCircle size={18} aria-hidden="true" /> {t('booking.publicStatusNotFound')}
        </p>
      )}
      {!loading && !error && status && (
        <div>
          <p>
            <Calendar size={18} aria-hidden="true" /> {dateLabel}
          </p>
          <p>
            <Clock3 size={18} aria-hidden="true" />{' '}
            {formatTime(status.requestedStartTime)} – {formatTime(status.requestedEndTime)}
          </p>
          <p>
            <MapPin size={18} aria-hidden="true" /> {status.serviceName}
          </p>
          <p>
            <CheckCircle2 size={18} aria-hidden="true" />{' '}
            {t(`booking.publicStatus.${status.status}`)}
          </p>
          {status.arrivedAt && (
            <p>{t('booking.publicStatusArrived', { time: new Date(status.arrivedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) })}</p>
          )}
          {status.siteContactName && (
            <p>{t('booking.publicStatusFor', { name: status.siteContactName })}</p>
          )}
          {status.hasRecipient && status.recipientConsentStatus === 'accepted' && (
            <p>{t('booking.recipientAcceptedNote')}</p>
          )}
          {status.hasRecipient && status.recipientConsentStatus === 'declined' && (
            <p>{t('booking.recipientDeclinedNote')}</p>
          )}
          {status.canRespondAsRecipient && (
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              <p style={{ width: '100%' }}>{t('booking.recipientRespondPrompt')}</p>
              <button
                type="button"
                disabled={responding}
                onClick={() => handleRespond('accepted')}
                data-track="ui.474702b501.8"
              >
                {t('booking.acceptBooking')}
              </button>
              <button
                type="button"
                disabled={responding}
                onClick={() => handleRespond('declined')}
                data-track="ui.474702b501.9"
              >
                {t('booking.declineBooking')}
              </button>
            </div>
          )}
          {status.statusTokenExpiresAt && (
            <p style={{ fontSize: '0.85rem', color: 'var(--muted-text)' }}>
              {t('booking.publicStatusExpires', { date: new Date(status.statusTokenExpiresAt).toLocaleDateString() })}
            </p>
          )}
          <p style={{ fontSize: '0.85rem', color: 'var(--muted-text)' }}>{t('booking.publicStatusNote')}</p>
        </div>
      )}
    </div>
  );
}
