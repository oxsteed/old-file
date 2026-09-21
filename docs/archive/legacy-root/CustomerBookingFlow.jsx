/**
 * Customer Booking Flow Component
 * Self-serve appointment booking interface with calendar and slot selection
 */

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import './CustomerBookingFlow.css';

export default function CustomerBookingFlow({ businessId, serviceId }) {
  const { t } = useTranslation();
  const [step, setStep] = useState(1); // 1: date selection, 2: slot selection, 3: details
  const [selectedDate, setSelectedDate] = useState(null);
  const [availableSlots, setAvailableSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [service, setService] = useState(null);

  // Form data
  const [formData, setFormData] = useState({
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    notes: '',
  });

  // Load service details
  useEffect(() => {
    const loadService = async () => {
      try {
        // This would fetch service details - for now mock
        setService({
          id: serviceId,
          name: 'Professional Service',
          duration: 60,
          price: 99.99,
        });
      } catch (error) {
        console.error('Failed to load service:', error);
      }
    };
    loadService();
  }, [serviceId]);

  // Load available slots when date changes
  useEffect(() => {
    if (selectedDate) {
      loadAvailableSlots(selectedDate);
    }
  }, [selectedDate]);

  const loadAvailableSlots = async (date) => {
    try {
      setLoading(true);
      const dateStr = date.toISOString().split('T')[0];
      const response = await axios.get(
        `/api/businesses/${businessId}/services/${serviceId}/availability`,
        { params: { date: dateStr } }
      );
      setAvailableSlots(response.data.data.slots);
      setSelectedSlot(null);
    } catch (error) {
      console.error('Failed to load slots:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDateSelect = (date) => {
    setSelectedDate(date);
    setStep(2);
  };

  const handleSlotSelect = (slot) => {
    setSelectedSlot(slot);
    setStep(3);
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleConfirmBooking = async (e) => {
    e.preventDefault();
    if (!selectedSlot || !formData.customerName || !formData.customerEmail) {
      alert(t('common.fillRequiredFields'));
      return;
    }

    try {
      setLoading(true);
      const response = await axios.post(
        `/api/businesses/${businessId}/bookings`,
        {
          serviceId,
          slotStart: `${selectedDate.toISOString().split('T')[0]}T${selectedSlot.startTime}`,
          slotEnd: `${selectedDate.toISOString().split('T')[0]}T${selectedSlot.endTime}`,
          customerName: formData.customerName,
          customerEmail: formData.customerEmail,
          customerPhone: formData.customerPhone,
          notes: formData.notes,
        }
      );

      // Success - show confirmation
      alert(t('booking.confirmationSent'));
      // Reset form
      setStep(1);
      setSelectedDate(null);
      setSelectedSlot(null);
      setFormData({ customerName: '', customerEmail: '', customerPhone: '', notes: '' });
    } catch (error) {
      console.error('Failed to create booking:', error);
      alert(t('common.errorCreating'));
    } finally {
      setLoading(false);
    }
  };

  // Step 1: Date Selection
  if (step === 1) {
    return (
      <div className="cbf-container">
        <h2>{t('booking.selectDate')}</h2>
        <div className="cbf-calendar">
          {/* Simple week view - next 14 days */}
          {Array.from({ length: 14 }).map((_, i) => {
            const date = new Date();
            date.setDate(date.getDate() + i);
            const isSelected = selectedDate?.toDateString() === date.toDateString();
            const dayName = date.toLocaleDateString(undefined, { weekday: 'short' });
            const dateNum = date.getDate();

            return (
              <button
                key={i}
                className={`cbf-date-btn ${isSelected ? 'selected' : ''}`}
                onClick={() => handleDateSelect(date)}
              >
                <div className="cbf-day-name">{dayName}</div>
                <div className="cbf-date-num">{dateNum}</div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Step 2: Slot Selection
  if (step === 2) {
    return (
      <div className="cbf-container">
        <button className="cbf-btn-back" onClick={() => setStep(1)}>
          ← {t('common.back')}
        </button>
        <h2>
          {t('booking.selectTime')} - {selectedDate?.toLocaleDateString()}
        </h2>

        {loading ? (
          <p>{t('common.loading')}</p>
        ) : availableSlots.length === 0 ? (
          <p className="cbf-no-slots">{t('booking.noAvailableSlots')}</p>
        ) : (
          <div className="cbf-slots-grid">
            {availableSlots.map(slot => (
              <button
                key={slot.slotId}
                className={`cbf-slot-btn ${selectedSlot?.slotId === slot.slotId ? 'selected' : ''}`}
                onClick={() => handleSlotSelect(slot)}
              >
                {slot.startTime} - {slot.endTime}
                {slot.staffName && <div className="cbf-staff">{slot.staffName}</div>}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Step 3: Confirm Details
  if (step === 3) {
    return (
      <div className="cbf-container">
        <button className="cbf-btn-back" onClick={() => setStep(2)}>
          ← {t('common.back')}
        </button>
        <h2>{t('booking.confirmDetails')}</h2>

        <div className="cbf-summary">
          <div className="cbf-summary-item">
            <strong>{t('booking.service')}:</strong> {service?.name}
          </div>
          <div className="cbf-summary-item">
            <strong>{t('booking.date')}:</strong> {selectedDate?.toLocaleDateString()}
          </div>
          <div className="cbf-summary-item">
            <strong>{t('booking.time')}:</strong> {selectedSlot?.startTime} - {selectedSlot?.endTime}
          </div>
          <div className="cbf-summary-item">
            <strong>{t('booking.duration')}:</strong> {service?.duration} {t('common.minutes')}
          </div>
          <div className="cbf-summary-item">
            <strong>{t('booking.price')}:</strong> ${service?.price?.toFixed(2)}
          </div>
        </div>

        <form onSubmit={handleConfirmBooking} className="cbf-form">
          <div className="cbf-form-group">
            <label>{t('common.name')} *</label>
            <input
              type="text"
              name="customerName"
              value={formData.customerName}
              onChange={handleInputChange}
              required
              placeholder={t('booking.yourName')}
            />
          </div>

          <div className="cbf-form-group">
            <label>{t('common.email')} *</label>
            <input
              type="email"
              name="customerEmail"
              value={formData.customerEmail}
              onChange={handleInputChange}
              required
              placeholder={t('booking.yourEmail')}
            />
          </div>

          <div className="cbf-form-group">
            <label>{t('common.phone')} *</label>
            <input
              type="tel"
              name="customerPhone"
              value={formData.customerPhone}
              onChange={handleInputChange}
              required
              placeholder={t('booking.yourPhone')}
            />
          </div>

          <div className="cbf-form-group">
            <label>{t('booking.notes')}</label>
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleInputChange}
              placeholder={t('booking.additionalNotes')}
              rows="3"
            />
          </div>

          <button type="submit" className="cbf-btn-confirm" disabled={loading}>
            {loading ? t('common.loading') : t('booking.confirmBooking')}
          </button>
        </form>
      </div>
    );
  }
}
