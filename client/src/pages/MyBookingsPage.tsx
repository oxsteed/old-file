import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import { useAuth } from '../hooks/useAuth';
import { toolRentalsApi } from '../api/toolRentals';
import api from '../api/axios';
import { cancelBookingRequest, fetchBookingPrefillForJob } from '../api/bookings';
import { Calendar, MapPin, User, DollarSign, AlertCircle, Loader, FileText, Flag, Clock, CheckCircle, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import InvoiceModal from '../components/InvoiceModal';
import UserReportModal from '../components/UserReportModal';
import './MyBookingsPage.css';

function formatTime(hhmm: string | null | undefined): string {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(2000, 0, 1, h, m || 0);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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
}

interface Booking {
  id: number;
  tool_id: number;
  customer_id: number | string;
  owner_id: number | string;
  start_date: string;
  end_date: string;
  total_price: number;
  status: 'pending' | 'invoice_sent' | 'payment_confirmed' | 'cancelled' | 'completed';
  created_at: string;
  name?: string;
  daily_rate?: number;
  first_name?: string;
  last_name?: string;
}

const MyBookingsPage = () => {
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
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportBookingId, setReportBookingId] = useState<number | null>(null);
  const [reportOwnerId, setReportOwnerId] = useState<number | string | null>(null);

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
    } catch (err) {
      setError(t('toolRentals.loadingError') || 'Failed to load bookings');
    } finally {
      setLoading(false);
    }
  }, [t]);

  const handleStatusUpdate = async (bookingId: number, newStatus: string) => {
    try {
      await toolRentalsApi.updateBookingStatus(bookingId, newStatus);
      toast.success(t('toolRentals.statusUpdated') || 'Status updated');
      loadBookings();
    } catch (err) {
      toast.error(t('toolRentals.statusUpdateFailed') || 'Failed to update status');
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
      cancelled: t('toolRentals.cancelled') || 'Cancelled',
      completed: t('toolRentals.completed') || 'Completed',
    };
    return statusMap[status] || status;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(undefined, {
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

  const renderBookingCard = (booking: Booking, isOwner: boolean = false) => (
    <div key={booking.id} className="booking-card">
      <div className="booking-card-header">
        <div className="booking-card-info">
          <h3 className="booking-card-title">{booking.name || 'Unknown Tool'}</h3>
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
            ({calculateDays(booking.start_date, booking.end_date)} days)
          </span>
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

      {isOwner && booking.status === 'pending' && (
        <div className="booking-card-actions">
          <button
            onClick={() => {
              setInvoiceBookingId(booking.id);
              setInvoiceModalOpen(true);
            }}
            className="booking-action-btn booking-action-invoice"
          >
            <FileText className="w-4 h-4" />
            {t('toolRentals.sendInvoice') || 'Send Invoice'}
          </button>
          <button
            onClick={() => handleStatusUpdate(booking.id, 'cancelled')}
            className="booking-action-btn booking-action-decline"
          >
            {t('toolRentals.decline') || 'Decline'}
          </button>
        </div>
      )}

      {isOwner && booking.status === 'payment_confirmed' && (
        <div className="booking-card-actions">
          <button
            onClick={() => handleStatusUpdate(booking.id, 'completed')}
            className="booking-action-btn booking-action-approve"
          >
            {t('toolRentals.markCompleted') || 'Mark completed'}
          </button>
        </div>
      )}

      {!isOwner && ['pending', 'invoice_sent'].includes(booking.status) && (
        <div className="booking-card-actions">
          <button
            onClick={() => handleStatusUpdate(booking.id, 'cancelled')}
            className="booking-action-btn booking-action-cancel"
          >
            {t('toolRentals.cancelBooking') || 'Cancel Booking'}
          </button>
        </div>
      )}

      {!isOwner && booking.status !== 'cancelled' && booking.status !== 'completed' && (
        <div className="booking-card-actions">
          <button
            onClick={() => {
              setReportBookingId(booking.id);
              setReportOwnerId(booking.owner_id);
              setReportModalOpen(true);
            }}
            className="booking-action-btn booking-action-report"
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
            <span className="hb-meta">{formattedDate} · {formatTime(b.requestedStartTime)} – {formatTime(b.requestedEndTime)}</span>
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
        <div className="booking-card-actions">
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
              className="booking-action-btn booking-action-approve"
            >
              {t('booking.postAsJob')}
            </button>
          )}
          {canCancel && (
            <button
              onClick={() => handleCancelHelperBooking(b.id)}
              className="booking-action-btn booking-action-cancel"
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

  return (
    <PageShell>
      <PageMeta
        title={t('toolRentals.myBookings') || 'My Bookings'}
        description="Manage your tool rentals and bookings"
      />

      <div className="my-bookings-container">
        <div className="my-bookings-header">
          <h1 className="my-bookings-title">{t('toolRentals.myBookings')}</h1>
          <p className="my-bookings-subtitle">
            {t('toolRentals.manageBookings') || 'View and manage your tool rentals'}
          </p>
        </div>

        {/* Tabs */}
        <div className="my-bookings-tabs">
          <button
            onClick={() => setActiveTab('helper-bookings')}
            className={`my-bookings-tab ${activeTab === 'helper-bookings' ? 'active' : ''}`}
          >
            {t('booking.tabTitle') || 'Service Bookings'} ({helperBookingsCount})
          </button>
          <button
            onClick={() => setActiveTab('my-rentals')}
            className={`my-bookings-tab ${activeTab === 'my-rentals' ? 'active' : ''}`}
          >
            {t('toolRentals.toolsRented') || 'Tools I Rented'} ({myRentalsCount})
          </button>
          <button
            onClick={() => setActiveTab('my-tools')}
            className={`my-bookings-tab ${activeTab === 'my-tools' ? 'active' : ''}`}
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
                <div className="my-bookings-empty">
                  <p>{t('booking.noBookingsYet') || 'No service booking requests yet'}</p>
                  <Link to="/helpers" className="booking-action-btn booking-action-approve" style={{ display: 'inline-block', marginTop: '0.75rem' }}>
                    {t('booking.backToDirectory')}
                  </Link>
                </div>
              )}
            </div>
          ) : activeTab === 'my-rentals' ? (
            <div className="my-bookings-list">
              {myBookings.length > 0 ? (
                myBookings.map((booking) => renderBookingCard(booking, false))
              ) : (
                <div className="my-bookings-empty">
                  <p>{t('toolRentals.noBookings') || 'You have no bookings yet'}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="my-bookings-list">
              {ownerBookings.length > 0 ? (
                ownerBookings.map((booking) => renderBookingCard(booking, true))
              ) : (
                <div className="my-bookings-empty">
                  <p>{t('toolRentals.noPendingBookings') || 'No one has booked your tools yet'}</p>
                </div>
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

export default MyBookingsPage;
