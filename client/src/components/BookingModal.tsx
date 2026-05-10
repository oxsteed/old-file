import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Calendar, DollarSign } from 'lucide-react';
import { toolRentalsApi } from '../api/toolRentals';
import toast from 'react-hot-toast';
import './BookingModal.css';

interface BookingModalProps {
  tool: {
    id: number;
    name: string;
    daily_rate: number;
    owner_id?: number;
  };
  isOpen: boolean;
  onClose: () => void;
}

const BookingModal: React.FC<BookingModalProps> = ({ tool, isOpen, onClose }) => {
  const { t } = useTranslation();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [bookedDates, setBookedDates] = useState<Array<{ start_date: string; end_date: string }>>([]);

  // Load booked dates on mount
  React.useEffect(() => {
    if (isOpen && tool.id) {
      loadBookedDates();
    }
  }, [isOpen, tool.id]);

  const loadBookedDates = async () => {
    try {
      const response = await fetch(`/api/tool-rentals/${tool.id}/availability`);
      const data = await response.json();
      setBookedDates(data.booked_dates || []);
    } catch (err) {
      console.error('Failed to load booked dates:', err);
    }
  };

  const isDateBooked = (date: string): boolean => {
    const checkDate = new Date(date);
    return bookedDates.some((booking) => {
      const start = new Date(booking.start_date);
      const end = new Date(booking.end_date);
      return checkDate >= start && checkDate <= end;
    });
  };

  if (!isOpen) return null;

  const handleStartDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setStartDate(e.target.value);
  };

  const handleEndDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEndDate(e.target.value);
  };

  const calculateDays = (): number => {
    if (!startDate || !endDate) return 0;
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return Math.max(0, diffDays);
  };

  const days = calculateDays();
  const totalPrice = days * tool.daily_rate;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!startDate || !endDate) {
      toast.error(t('toolRentals.selectDates') || 'Please select start and end dates');
      return;
    }

    if (new Date(startDate) >= new Date(endDate)) {
      toast.error(t('toolRentals.invalidDateRange') || 'End date must be after start date');
      return;
    }

    // Check for calendar conflicts
    const checkDate = new Date(startDate);
    const endCheckDate = new Date(endDate);
    for (const booking of bookedDates) {
      const bookStart = new Date(booking.start_date);
      const bookEnd = new Date(booking.end_date);
      if (checkDate < bookEnd && endCheckDate > bookStart) {
        toast.error(t('toolRentals.dateConflict') || 'Tool is already booked for these dates');
        return;
      }
    }

    setLoading(true);
    try {
      await toolRentalsApi.createBooking(tool.id, startDate, endDate, totalPrice);

      toast.success(t('toolRentals.bookingConfirmed') || 'Booking confirmed!');
      onClose();
    } catch (err: any) {
      if (err.response?.status === 409) {
        toast.error(t('toolRentals.dateConflict') || 'Tool is already booked for these dates');
      } else {
        toast.error(t('toolRentals.bookingFailed') || 'Failed to create booking');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="booking-modal-overlay" onClick={onClose}>
      <div className="booking-modal-content" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="booking-modal-header">
          <h2 className="booking-modal-title">{t('toolRentals.booking')}</h2>
          <button onClick={onClose} className="booking-modal-close-btn" aria-label="Close modal">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Body */}
        <div className="booking-modal-body">
          <div className="booking-tool-info">
            <h3 className="booking-tool-name">{tool.name}</h3>
            <div className="booking-rate">
              <DollarSign className="w-4 h-4" />
              <span>{tool.daily_rate}/day</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="booking-form">
            <div className="booking-form-group">
              <label htmlFor="start-date">{t('toolRentals.startDate')}</label>
              <div className="booking-date-input">
                <Calendar className="w-4 h-4" />
                <input
                  id="start-date"
                  type="date"
                  value={startDate}
                  onChange={handleStartDateChange}
                  min={new Date().toISOString().split('T')[0]}
                  required
                  disabled={loading}
                />
              </div>
            </div>

            <div className="booking-form-group">
              <label htmlFor="end-date">{t('toolRentals.endDate')}</label>
              <div className="booking-date-input">
                <Calendar className="w-4 h-4" />
                <input
                  id="end-date"
                  type="date"
                  value={endDate}
                  onChange={handleEndDateChange}
                  min={startDate || new Date().toISOString().split('T')[0]}
                  required
                  disabled={loading}
                />
              </div>
            </div>

            {/* Price Summary */}
            {days > 0 && (
              <div className="booking-price-summary">
                <div className="booking-price-row">
                  <span>{days} day(s)</span>
                  <span>${(days * tool.daily_rate).toFixed(2)}</span>
                </div>
                <div className="booking-price-row booking-total">
                  <span>{t('toolRentals.totalPrice')}</span>
                  <span className="booking-total-amount">${totalPrice.toFixed(2)}</span>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !startDate || !endDate}
              className="booking-submit-btn"
            >
              {loading ? t('common.loading') : t('toolRentals.confirmBooking')}
            </button>
          </form>

          <p className="booking-disclaimer">
            {t('toolRentals.bookingDisclaimer') || 'Your booking will be pending owner approval.'}
          </p>
        </div>
      </div>
    </div>
  );
};

export default BookingModal;
