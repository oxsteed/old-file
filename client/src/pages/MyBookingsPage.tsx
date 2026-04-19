import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import { toolRentalsApi } from '../api/toolRentals';
import { Calendar, MapPin, User, DollarSign, AlertCircle, Loader, FileText, Flag } from 'lucide-react';
import toast from 'react-hot-toast';
import InvoiceModal from '../components/InvoiceModal';
import UserReportModal from '../components/UserReportModal';
import './MyBookingsPage.css';

interface Booking {
  id: number;
  tool_id: number;
  customer_id: number;
  owner_id: number;
  start_date: string;
  end_date: string;
  total_price: number;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  created_at: string;
  name?: string;
  daily_rate?: number;
  first_name?: string;
  last_name?: string;
}

const MyBookingsPage = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'my-rentals' | 'my-tools'>('my-rentals');
  const [myBookings, setMyBookings] = useState<Booking[]>([]);
  const [ownerBookings, setOwnerBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [invoiceBookingId, setInvoiceBookingId] = useState<number | null>(null);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportBookingId, setReportBookingId] = useState<number | null>(null);
  const [reportOwnerId, setReportOwnerId] = useState<number | null>(null);

  useEffect(() => {
    loadBookings();
  }, []);

  const loadBookings = async () => {
    try {
      setLoading(true);
      setError(null);

      const [myRentals, toolBookings] = await Promise.all([
        toolRentalsApi.getMyBookings().catch(() => []),
        toolRentalsApi.getBookingsByOwner().catch(() => []),
      ]);

      setMyBookings(myRentals);
      setOwnerBookings(toolBookings);
    } catch (err) {
      setError(t('toolRentals.loadingError') || 'Failed to load bookings');
    } finally {
      setLoading(false);
    }
  };

  const handleStatusUpdate = async (bookingId: number, newStatus: string) => {
    try {
      await toolRentalsApi.updateBookingStatus(bookingId, newStatus);
      toast.success(t('toolRentals.statusUpdated') || 'Status updated');
      loadBookings();
    } catch (err) {
      toast.error(t('toolRentals.statusUpdateFailed') || 'Failed to update status');
    }
  };

  const getStatusColor = (status: string) => {
    const statusMap: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100',
      confirmed: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100',
      cancelled: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100',
      completed: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100',
    };
    return statusMap[status] || 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-100';
  };

  const getStatusLabel = (status: string) => {
    const statusMap: Record<string, string> = {
      pending: t('toolRentals.pending') || 'Pending',
      confirmed: t('toolRentals.confirmed') || 'Confirmed',
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
              {booking.first_name} {booking.last_name}
            </span>
          </div>
        )}
      </div>

      {isOwner && booking.status === 'pending' && (
        <div className="booking-card-actions">
          <button
            onClick={() => handleStatusUpdate(booking.id, 'confirmed')}
            className="booking-action-btn booking-action-approve"
          >
            {t('toolRentals.approve') || 'Approve'}
          </button>
          <button
            onClick={() => handleStatusUpdate(booking.id, 'cancelled')}
            className="booking-action-btn booking-action-decline"
          >
            {t('toolRentals.decline') || 'Decline'}
          </button>
        </div>
      )}

      {isOwner && booking.status === 'confirmed' && (
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
        </div>
      )}

      {!isOwner && booking.status !== 'cancelled' && booking.status !== 'completed' && (
        <div className="booking-card-actions">
          <button
            onClick={() => handleStatusUpdate(booking.id, 'cancelled')}
            className="booking-action-btn booking-action-cancel"
          >
            {t('toolRentals.cancelBooking') || 'Cancel Booking'}
          </button>
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

  const myRentalsCount = myBookings.length;
  const myToolsCount = ownerBookings.length;

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
