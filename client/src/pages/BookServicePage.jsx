import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/axios';
import toast from 'react-hot-toast';
import { Calendar, Clock, DollarSign, User, Mail, Phone } from 'lucide-react';
import '../styles/BookServicePage.css';

export default function BookServicePage() {
  const { businessId, serviceId } = useParams();
  const navigate = useNavigate();

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
      const businessRes = await api.get(`/api/businesses/${businessId}/profile`);
      setBusiness(businessRes.data);

      // Load service
      const serviceRes = await api.get(
        `/api/businesses/${businessId}/services`
      );
      const svc = serviceRes.data.find(s => s.id === serviceId);
      setService(svc);
    } catch (error) {
      toast.error('Failed to load service details');
      navigate('/');
    } finally {
      setLoading(false);
    }
  };

  const loadAvailableSlots = async () => {
    try {
      const response = await api.get(
        `/api/businesses/${businessId}/services/${serviceId}/slots`,
        { params: { date: selectedDate } }
      );
      setAvailableSlots(response.data.available_slots);
      setSelectedSlot(null);
    } catch (error) {
      toast.error('Failed to load available slots');
      setAvailableSlots([]);
    }
  };

  const calculatePrice = async () => {
    try {
      const response = await api.get(
        `/api/businesses/${businessId}/services/${serviceId}/calculate-price`,
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
      toast.error('Failed to calculate price');
    }
  };

  const handleBooking = async () => {
    if (!formData.agree_to_terms) {
      toast.error('Please agree to terms and conditions');
      return;
    }

    if (!formData.customer_name || !formData.customer_email) {
      toast.error('Please fill in all required fields');
      return;
    }

    if (!selectedDate || !selectedSlot) {
      toast.error('Please select a date and time');
      return;
    }

    try {
      setLoading(true);

      // Create appointment
      const response = await api.post(
        `/api/businesses/${businessId}/appointments`,
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

      toast.success('Booking confirmed!');
      navigate(`/bookings/${response.data.id}`);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to create booking');
    } finally {
      setLoading(false);
    }
  };

  if (loading && !service) {
    return <div className="bsp-loading">Loading service...</div>;
  }

  if (!service) {
    return <div className="bsp-error">Service not found</div>;
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
            <h2>Service Details</h2>
            <div className="bsp-details">
              <div className="bsp-detail-item">
                <Clock size={20} />
                <div>
                  <div className="label">Duration</div>
                  <div className="value">{service.duration_minutes} minutes</div>
                </div>
              </div>
              <div className="bsp-detail-item">
                <DollarSign size={20} />
                <div>
                  <div className="label">Base Price</div>
                  <div className="value">${(service.base_price_cents / 100).toFixed(2)}</div>
                </div>
              </div>
            </div>
            {service.description && (
              <p className="bsp-description">{service.description}</p>
            )}
          </section>

          {/* Date Selection */}
          <section className="bsp-section">
            <h2>Select Date</h2>
            <div className="bsp-date-grid">
              {nextDays.map(date => (
                <button
                  key={date}
                  onClick={() => setSelectedDate(date)}
                  className={`bsp-date-btn ${selectedDate === date ? 'active' : ''}`}
                >
                  <div className="date">{new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                  <div className="day">{new Date(date).toLocaleDateString('en-US', { weekday: 'short' })}</div>
                </button>
              ))}
            </div>
          </section>

          {/* Time Selection */}
          {selectedDate && (
            <section className="bsp-section">
              <h2>Select Time</h2>
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
                <p className="bsp-no-slots">No available times for this date</p>
              )}
            </section>
          )}
        </div>

        <div className="bsp-sidebar">
          {/* Booking Summary */}
          <div className="bsp-summary">
            <h3>Booking Summary</h3>

            {selectedDate && (
              <div className="bsp-summary-item">
                <span>Date:</span>
                <span>{new Date(selectedDate).toLocaleDateString()}</span>
              </div>
            )}

            {selectedSlot && (
              <div className="bsp-summary-item">
                <span>Time:</span>
                <span>{selectedSlot.start_time} - {selectedSlot.end_time}</span>
              </div>
            )}

            {calculatedPrice && (
              <>
                <div className="bsp-price-breakdown">
                  <div className="bsp-summary-item">
                    <span>Base Price:</span>
                    <span>${(calculatedPrice.base_price_cents / 100).toFixed(2)}</span>
                  </div>
                  {calculatedPrice.modifiers && calculatedPrice.modifiers.length > 0 && (
                    <>
                      {calculatedPrice.modifiers.map((mod, idx) => (
                        <div key={idx} className="bsp-summary-item modifier">
                          <span>{mod.type}:</span>
                          <span>{mod.multiplier ? `×${mod.multiplier}` : `+$${(mod.modifier / 100).toFixed(2)}`}</span>
                        </div>
                      ))}
                    </>
                  )}
                </div>

                <div className="bsp-summary-divider"></div>

                <div className="bsp-summary-item final-price">
                  <span>Total Price:</span>
                  <span>${(calculatedPrice.final_price_cents / 100).toFixed(2)}</span>
                </div>
              </>
            )}
          </div>

          {/* Customer Info Form */}
          <form className="bsp-form">
            <h3>Your Information</h3>

            <div className="bsp-form-group">
              <label>Name *</label>
              <input
                type="text"
                value={formData.customer_name}
                onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })}
                placeholder="Your full name"
                required
              />
            </div>

            <div className="bsp-form-group">
              <label>Email *</label>
              <input
                type="email"
                value={formData.customer_email}
                onChange={(e) => setFormData({ ...formData, customer_email: e.target.value })}
                placeholder="your@email.com"
                required
              />
            </div>

            <div className="bsp-form-group">
              <label>Phone</label>
              <input
                type="tel"
                value={formData.customer_phone}
                onChange={(e) => setFormData({ ...formData, customer_phone: e.target.value })}
                placeholder="(123) 456-7890"
              />
            </div>

            <div className="bsp-form-group">
              <label>Notes</label>
              <textarea
                value={formData.customer_notes}
                onChange={(e) => setFormData({ ...formData, customer_notes: e.target.value })}
                placeholder="Any special requests or notes..."
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
              <label htmlFor="agree">I agree to the terms and cancellation policy</label>
            </div>

            <button
              type="button"
              onClick={handleBooking}
              disabled={!selectedDate || !selectedSlot || !formData.customer_email || loading}
              className="bsp-btn-book"
            >
              {loading ? 'Booking...' : `Book Now - $${calculatedPrice ? (calculatedPrice.final_price_cents / 100).toFixed(2) : '0.00'}`}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
