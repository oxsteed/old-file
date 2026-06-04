import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/axios';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { Calendar, Clock, DollarSign, User, Mail, Phone } from 'lucide-react';
import '../styles/BookServicePage.css';
import { formatCents, formatDate } from '../lib/format';

export default function BookServicePage() {
  const { businessId, serviceId } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [business, setBusiness] = useState(null);
  const [service, setService] = useState(null);
  const [availableSlots, setAvailableSlots] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [calculatedPrice, setCalculatedPrice] = useState(null);
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    customer_name: '',
    customer_email: '',
    customer_phone: '',
    customer_notes: '',
    agree_to_terms: false
  });

  // Load service details
  useEffect(() => {
    loadServiceDetails();
  }, [businessId, serviceId]);

  // Load available slots when date changes
  useEffect(() => {
    if (selectedDate) {
      loadAvailableSlots();
    }
  }, [selectedDate]);

  // Calculate price when slot is selected
  useEffect(() => {
    if (selectedDate && selectedSlot) {
      calculatePrice();
    }
  }, [selectedDate, selectedSlot]);

  const loadServiceDetails = async () => {
    try {
      setLoading(true);
      // Load business info
      const businessRes = await api.get(`/businesses/${businessId}/profile`);
      setBusiness(businessRes.data);

      // Load service
      const serviceRes = await api.get(
        `/businesses/${businessId}/services`
      );
      const svc = serviceRes.data.find(s => s.id === serviceId);
      setService(svc);
    } catch (error) {
      toast.error(t('bookService.errors.loadServiceDetails'));
      navigate('/');
    } finally {
      setLoading(false);
    }
  };

  const loadAvailableSlots = async () => {
    try {
      const response = await api.get(
        `/businesses/${businessId}/services/${serviceId}/slots`,
        { params: { date: selectedDate } }
      );
      setAvailableSlots(response.data.available_slots);
      setSelectedSlot(null);
    } catch (error) {
      toast.error(t('bookService.errors.loadSlots'));
      setAvailableSlots([]);
    }
  };

  const calculatePrice = async () => {
    try {
      const response = await api.get(
        `/businesses/${businessId}/services/${serviceId}/calculate-price`,
        {
          params: {
            booking_date: selectedDate,
            booking_time: selectedSlot?.start_time,
            customer_id: null // Can be customer_id if logged in
          }
        }
      );
      setCalculatedPrice(response.data);
    } catch (error) {
      toast.error(t('bookService.errors.calculatePrice'));
    }
  };

  const handleBooking = async () => {
    if (!formData.agree_to_terms) {
      toast.error(t('bookService.errors.agreeTerms'));
      return;
    }

    if (!formData.customer_name || !formData.customer_email) {
      toast.error(t('bookService.errors.requiredFields'));
      return;
    }

    if (!selectedDate || !selectedSlot) {
      toast.error(t('bookService.errors.selectDateTime'));
      return;
    }

    try {
      setLoading(true);

      // Create appointment
      const response = await api.post(
        `/businesses/${businessId}/appointments`,
        {
          service_id: serviceId,
          customer_name: formData.customer_name,
          customer_email: formData.customer_email,
          customer_phone: formData.customer_phone,
          customer_notes: formData.customer_notes,
          start_time: `${selectedDate}T${selectedSlot.start_time}:00Z`,
          end_time: `${selectedDate}T${selectedSlot.end_time}:00Z`,
          base_price_cents: calculatedPrice.final_price_cents
        }
      );

      toast.success(t('bookService.success'));
      navigate(`/bookings/${response.data.id}`);
    } catch (error) {
      toast.error(error.response?.data?.message || t('bookService.errors.createBooking'));
    } finally {
      setLoading(false);
    }
  };

  if (loading && !service) {
    return <div className="bsp-loading">{t('bookService.loading')}</div>;
  }

  if (!service) {
    return <div className="bsp-error">{t('bookService.notFound')}</div>;
  }

  const nextDays = Array.from({ length: 30 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() + i);
    return date.toISOString().split('T')[0];
  });

  return (
    <div className="bsp-container">
      <div className="bsp-header">
        <div className="bsp-business-info">
          {business && (
            <>
              <h1>{business.business_name}</h1>
              <p>{service.name}</p>
            </>
          )}
        </div>
      </div>

      <div className="bsp-content">
        <div className="bsp-main">
          {/* Service Details */}
          <section className="bsp-section">
            <h2>{t('bookService.sections.details')}</h2>
            <div className="bsp-details">
              <div className="bsp-detail-item">
                <Clock size={20} />
                <div>
                  <div className="label">{t('bookService.durationLabel')}</div>
                  <div className="value">{service.duration_minutes} minutes</div>
                </div>
              </div>
              <div className="bsp-detail-item">
                <DollarSign size={20} />
                <div>
                  <div className="label">{t('bookService.basePriceLabel')}</div>
                  <div className="value">{formatCents(service.base_price_cents)}</div>
                </div>
              </div>
            </div>
            {service.description && (
              <p className="bsp-description">{service.description}</p>
            )}
          </section>

          {/* Date Selection */}
          <section className="bsp-section">
            <h2>{t('bookService.sections.selectDate')}</h2>
            <div className="bsp-date-grid">
              {nextDays.map(date => (
                <button
                  key={date}
                  onClick={() => setSelectedDate(date)}
                  className={`bsp-date-btn ${selectedDate === date ? 'active' : ''}`}
                >
                  <div className="date">{formatDate(`${date}T12:00:00`, { year: undefined })}</div>
                  <div className="day">{formatDate(`${date}T12:00:00`, { weekday: 'short', month: undefined, day: undefined, year: undefined })}</div>
                </button>
              ))}
            </div>
          </section>

          {/* Time Selection */}
          {selectedDate && (
            <section className="bsp-section">
              <h2>{t('bookService.sections.selectTime')}</h2>
              {availableSlots.length > 0 ? (
                <div className="bsp-time-grid">
                  {availableSlots.map((slot, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedSlot(slot)}
                      className={`bsp-time-btn ${selectedSlot === slot ? 'active' : ''}`}
                    >
                      {slot.start_time} - {slot.end_time}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="bsp-no-slots">{t('bookService.noAvailableSlots')}</p>
              )}
            </section>
          )}
        </div>

        <div className="bsp-sidebar">
          {/* Booking Summary */}
          <div className="bsp-summary">
            <h3>{t('bookService.summary.title')}</h3>

            {selectedDate && (
              <div className="bsp-summary-item">
                <span>{t('bookService.summary.dateLabel')}:</span>
                <span>{formatDate(`${selectedDate}T12:00:00`)}</span>
              </div>
            )}

            {selectedSlot && (
              <div className="bsp-summary-item">
                <span>{t('bookService.summary.timeLabel')}:</span>
                <span>{selectedSlot.start_time} - {selectedSlot.end_time}</span>
              </div>
            )}

            {calculatedPrice && (
              <>
                <div className="bsp-price-breakdown">
                  <div className="bsp-summary-item">
                    <span>{t('bookService.summary.basePriceLabel')}:</span>
                    <span>{formatCents(calculatedPrice.base_price_cents)}</span>
                  </div>
                  {calculatedPrice.modifiers && calculatedPrice.modifiers.length > 0 && (
                    <>
                      {calculatedPrice.modifiers.map((mod, idx) => (
                        <div key={idx} className="bsp-summary-item modifier">
                          <span>{mod.type}:</span>
                          <span>{mod.multiplier ? `×${mod.multiplier}` : `+${formatCents(mod.modifier)}`}</span>
                        </div>
                      ))}
                    </>
                  )}
                </div>

                <div className="bsp-summary-divider"></div>

                <div className="bsp-summary-item final-price">
                  <span>{t('bookService.summary.totalPriceLabel')}:</span>
                  <span>{formatCents(calculatedPrice.final_price_cents)}</span>
                </div>
              </>
            )}
          </div>

          {/* Customer Info Form */}
          <form className="bsp-form">
            <h3>{t('bookService.form.title')}</h3>

            <div className="bsp-form-group">
              <label>{t('bookService.form.nameLabel')} *</label>
              <input
                type="text"
                value={formData.customer_name}
                onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })}
                placeholder={t('bookService.form.namePlaceholder')}
                required
              />
            </div>

            <div className="bsp-form-group">
              <label>{t('bookService.form.emailLabel')} *</label>
              <input
                type="email"
                value={formData.customer_email}
                onChange={(e) => setFormData({ ...formData, customer_email: e.target.value })}
                placeholder={t('bookService.form.emailPlaceholder')}
                required
              />
            </div>

            <div className="bsp-form-group">
              <label>{t('bookService.form.phoneLabel')}</label>
              <input
                type="tel"
                value={formData.customer_phone}
                onChange={(e) => setFormData({ ...formData, customer_phone: e.target.value })}
                placeholder={t('bookService.form.phonePlaceholder')}
              />
            </div>

            <div className="bsp-form-group">
              <label>{t('bookService.form.notesLabel')}</label>
              <textarea
                value={formData.customer_notes}
                onChange={(e) => setFormData({ ...formData, customer_notes: e.target.value })}
                placeholder={t('bookService.form.notesPlaceholder')}
                rows="4"
              />
            </div>

            <div className="bsp-checkbox">
              <input
                type="checkbox"
                id="agree"
                checked={formData.agree_to_terms}
                onChange={(e) => setFormData({ ...formData, agree_to_terms: e.target.checked })}
              />
              <label htmlFor="agree">{t('bookService.form.termsText')}</label>
            </div>

            <button
              type="button"
              onClick={handleBooking}
              disabled={!selectedDate || !selectedSlot || !formData.customer_email || loading}
              className="bsp-btn-book"
            >
              {loading
                ? t('bookService.buttons.booking')
                : t('bookService.buttons.bookNow', { price: calculatedPrice ? formatCents(calculatedPrice.final_price_cents) : formatCents(0) })
              }
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
