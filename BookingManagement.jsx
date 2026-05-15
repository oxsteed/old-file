/**
 * Booking Management Component
 * Business owner interface for managing appointments and bookings
 */

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import './BookingManagement.css';

export default function BookingManagement({ businessId }) {
  const { t } = useTranslation();
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [filter, setFilter] = useState({
    status: 'all',
    dateFrom: '',
    dateTo: '',
    page: 0,
  });

  // Stats
  const [stats, setStats] = useState({
    totalBookings: 0,
    confirmed: 0,
    pending: 0,
    completed: 0,
  });

  // Load bookings on mount and filter change
  useEffect(() => {
    loadBookings();
  }, [businessId, filter]);

  const loadBookings = async () => {
    try {
      setLoading(true);
      const params = {};
      if (filter.status !== 'all') params.status = filter.status;
      if (filter.dateFrom) params.dateFrom = filter.dateFrom;
      if (filter.dateTo) params.dateTo = filter.dateTo;
      params.page = filter.page;
      params.limit = 20;

      const response = await axios.get(
        `/api/businesses/${businessId}/bookings`,
        { params }
      );

      setBookings(response.data.data);

      // Calculate stats
      const all = response.data.data;
      setStats({
        totalBookings: response.data.total,
        confirmed: all.filter(b => b.status === 'confirmed').length,
        pending: all.filter(b => b.status === 'pending_confirmation').length,
        completed: all.filter(b => b.status === 'completed').length,
      });
    } catch (error) {
      console.error('Failed to load bookings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (bookingId, newStatus) => {
    try {
      await axios.put(`/api/businesses/${businessId}/bookings/${bookingId}`, {
        status: newStatus,
      });
      loadBookings();
      alert(t('booking.updated'));
    } catch (error) {
      console.error('Failed to update booking:', error);
      alert(t('common.failedToUpdate'));
    }
  };

  const handleCancelBooking = async (bookingId, reason = '') => {
    if (!window.confirm(t('booking.confirmCancel'))) return;

    try {
      await axios.post(`/api/businesses/${businessId}/bookings/${bookingId}/cancel`, {
        reason,
      });
      loadBookings();
      setSelectedBooking(null);
      alert(t('booking.cancelled'));
    } catch (error) {
      console.error('Failed to cancel booking:', error);
      alert(t('common.failedToUpdate'));
    }
  };

  const getStatusColor = (status) => {
    const colors = {
      pending_confirmation: 'warning',
      confirmed: 'success',
      in_progress: 'info',
      completed: 'success',
      cancelled: 'danger',
      no_show: 'danger',
    };
    return colors[status] || 'default';
  };

  const getStatusLabel = (status) => {
    const labels = {
      pending_confirmation: t('booking.pendingConfirmation'),
      confirmed: t('booking.confirmed'),
      in_progress: t('booking.inProgress'),
      completed: t('booking.completed'),
      cancelled: t('booking.cancelled'),
      no_show: t('booking.noShow'),
    };
    return labels[status] || status;
  };

  return (
    <div className="booking-management">
      {/* Header */}
      <div className="bm-header">
        <h2>{t('booking.management')}</h2>
      </div>

      {/* Stats */}
      <div className="bm-stats">
        <div className="bm-stat-card">
          <div className="bm-stat-value">{stats.totalBookings}</div>
          <div className="bm-stat-label">{t('booking.totalBookings')}</div>
        </div>
        <div className="bm-stat-card">
          <div className="bm-stat-value bm-stat-confirmed">{stats.confirmed}</div>
          <div className="bm-stat-label">{t('booking.confirmed')}</div>
        </div>
        <div className="bm-stat-card">
          <div className="bm-stat-value bm-stat-pending">{stats.pending}</div>
          <div className="bm-stat-label">{t('booking.pending')}</div>
        </div>
        <div className="bm-stat-card">
          <div className="bm-stat-value bm-stat-completed">{stats.completed}</div>
          <div className="bm-stat-label">{t('booking.completed')}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="bm-filters">
        <select
          value={filter.status}
          onChange={e => setFilter({ ...filter, status: e.target.value, page: 0 })}
        >
          <option value="all">{t('booking.allStatuses')}</option>
          <option value="pending_confirmation">{t('booking.pendingConfirmation')}</option>
          <option value="confirmed">{t('booking.confirmed')}</option>
          <option value="in_progress">{t('booking.inProgress')}</option>
          <option value="completed">{t('booking.completed')}</option>
          <option value="cancelled">{t('booking.cancelled')}</option>
        </select>

        <input
          type="date"
          value={filter.dateFrom}
          onChange={e => setFilter({ ...filter, dateFrom: e.target.value, page: 0 })}
          placeholder={t('booking.from')}
        />

        <input
          type="date"
          value={filter.dateTo}
          onChange={e => setFilter({ ...filter, dateTo: e.target.value, page: 0 })}
          placeholder={t('booking.to')}
        />
      </div>

      {/* Bookings List */}
      <div className="bm-list">
        {loading ? (
          <p>{t('common.loading')}</p>
        ) : bookings.length === 0 ? (
          <div className="bm-empty">
            <p>{t('booking.noBookings')}</p>
          </div>
        ) : (
          <table className="bm-table">
            <thead>
              <tr>
                <th>{t('common.date')}</th>
                <th>{t('common.time')}</th>
                <th>{t('booking.customer')}</th>
                <th>{t('booking.service')}</th>
                <th>{t('common.status')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map(booking => (
                <tr key={booking.id} onClick={() => setSelectedBooking(booking)}>
                  <td>
                    {new Date(booking.slotStart).toLocaleDateString()}
                  </td>
                  <td>
                    {new Date(booking.slotStart).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td>
                    <div className="bm-customer">
                      <strong>{booking.customerName}</strong>
                      <br />
                      <small>{booking.customerEmail}</small>
                    </div>
                  </td>
                  <td>{booking.serviceName}</td>
                  <td>
                    <span className={`bm-status bm-status-${getStatusColor(booking.status)}`}>
                      {getStatusLabel(booking.status)}
                    </span>
                  </td>
                  <td className="bm-actions">
                    <select
                      onClick={e => e.stopPropagation()}
                      onChange={e => {
                        handleUpdateStatus(booking.id, e.target.value);
                        e.target.value = booking.status;
                      }}
                      value=""
                      defaultValue=""
                    >
                      <option value="">{t('common.changeStatus')}</option>
                      {booking.status !== 'confirmed' && (
                        <option value="confirmed">{t('booking.markConfirmed')}</option>
                      )}
                      {booking.status === 'confirmed' && (
                        <option value="in_progress">{t('booking.markInProgress')}</option>
                      )}
                      {booking.status === 'in_progress' && (
                        <option value="completed">{t('booking.markCompleted')}</option>
                      )}
                      {['pending_confirmation', 'confirmed'].includes(booking.status) && (
                        <option value="cancelled">{t('booking.markCancelled')}</option>
                      )}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Booking Detail Panel */}
      {selectedBooking && (
        <div className="bm-detail">
          <div className="bm-detail-header">
            <h3>{selectedBooking.customerName}</h3>
            <button className="bm-btn-close" onClick={() => setSelectedBooking(null)}>
              ✕
            </button>
          </div>

          <div className="bm-detail-body">
            <div className="bm-detail-section">
              <h4>{t('booking.appointmentDetails')}</h4>
              <p>
                <strong>{t('booking.service')}:</strong> {selectedBooking.serviceName}
              </p>
              <p>
                <strong>{t('booking.date')}:</strong>{' '}
                {new Date(selectedBooking.slotStart).toLocaleDateString()}
              </p>
              <p>
                <strong>{t('booking.time')}:</strong>{' '}
                {new Date(selectedBooking.slotStart).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                {' - '}
                {new Date(selectedBooking.slotEnd).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
              <p>
                <strong>{t('common.status')}:</strong>{' '}
                <span className={`bm-status bm-status-${getStatusColor(selectedBooking.status)}`}>
                  {getStatusLabel(selectedBooking.status)}
                </span>
              </p>
            </div>

            <div className="bm-detail-section">
              <h4>{t('booking.customerInfo')}</h4>
              <p>
                <strong>{t('common.name')}:</strong> {selectedBooking.customerName}
              </p>
              <p>
                <strong>{t('common.email')}:</strong> {selectedBooking.customerEmail}
              </p>
              <p>
                <strong>{t('common.phone')}:</strong> {selectedBooking.customerPhone}
              </p>
            </div>

            {selectedBooking.notes && (
              <div className="bm-detail-section">
                <h4>{t('booking.notes')}</h4>
                <p>{selectedBooking.notes}</p>
              </div>
            )}

            <div className="bm-detail-actions">
              {['pending_confirmation', 'confirmed'].includes(selectedBooking.status) && (
                <button
                  className="bm-btn-danger"
                  onClick={() =>
                    handleCancelBooking(selectedBooking.id, 'Cancelled by business')
                  }
                >
                  {t('booking.cancel')}
                </button>
              )}
              <button className="bm-btn-secondary" onClick={() => setSelectedBooking(null)}>
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
