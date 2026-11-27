import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { X, DollarSign, ShieldAlert, Clock } from 'lucide-react';
import { toolRentalsApi } from '../api/toolRentals';
import toast from 'react-hot-toast';
import './BookingModal.css';
import { toolRentalDatesOverlap } from '../utils/toolRentalDates';
import ToolRentalCalendar from './ToolRentalCalendar';

interface BookingModalProps {
  tool: {
    id: number;
    name: string;
    daily_rate: number;
    deposit_amount?: number;
    requires_deposit?: boolean;
    replacement_value?: number;
    owner_rules?: string;
    accessories?: Array<{name:string;quantity:number}>;
    condition_checklist?: string[];
    equipment_version?: number;
    owner_custom_terms?: string;
    condition?: string;
    brand?: string;
    model?: string;
    pickup_only?: boolean;
    delivery_available?: boolean;
    owner_id?: number;
    pickup_window_start?: string | null;
    pickup_window_end?: string | null;
    // Group 11 item 576: owner daily return window.
    return_window_start?: string | null;
    return_window_end?: string | null;
    // Group 11 item 580: owner-written cleaning instructions.
    cleaning_instructions?: string | null;
  };
  isOpen: boolean;
  onClose: () => void;
}

const BookingModal: React.FC<BookingModalProps> = ({ tool, isOpen, onClose }) => {
  const { t } = useTranslation();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  const [fulfillment, setFulfillment] = useState<'pickup' | 'delivery'>('pickup');
  const [bookedDates, setBookedDates] = useState<Array<{ start_date: string; end_date: string }>>([]);
  // Group 11 item 574: pickup appointment time (HH:MM).
  const [pickupTime, setPickupTime] = useState('');
  // Group 11 item 576: return appointment time (HH:MM).
  const [returnTime, setReturnTime] = useState('');
  // Group 11 item 584: replacement suggestions when the requested dates
  // are already booked.
  const [alternatives, setAlternatives] = useState<Array<{ id: number; name: string; daily_rate: number; distance_miles?: number | null }>>([]);
  const [alternativesLoading, setAlternativesLoading] = useState(false);
  // Group 11 item 594: safety documents the owner uploaded for this
  // listing, shown to the renter before booking.
  const [safetyDocs, setSafetyDocs] = useState<Array<{ id: string; title: string; file_url: string }>>([]);
  // G11-A13 (D-625): the renter's own identity status, so the modal can
  // warn before booking that pickup will be blocked until verification
  // is complete. The pickup confirm is still the enforcement point;
  // this is the warning, not a second gate.
  const [identity, setIdentity] = useState<{ verified?: boolean } | null>(null);
  React.useEffect(() => {
    if (!isOpen) return;
    toolRentalsApi.getMyRentalIdentity()
      .then((r) => setIdentity(r))
      .catch(() => setIdentity(null));
  }, [isOpen]);
  React.useEffect(() => {
    if (!isOpen || !tool?.id) return;
    toolRentalsApi.getPublicSafetyDocuments(tool.id)
      .then((r) => setSafetyDocs(r.documents || []))
      .catch(() => setSafetyDocs([]));
  }, [isOpen, tool?.id]);

  const formatWindowTime = (value: string | null | undefined): string => {
    if (!value) return '';
    const [h, m] = value.split(':').map(Number);
    if (!Number.isFinite(h)) return value;
    return new Date(2000, 0, 1, h, m || 0).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };

  // 554: delivery is offered only when the listing offers it and is not
  // pickup-only; pickup is always available.
  const deliveryAvailable = tool.delivery_available === true && tool.pickup_only !== true;

  // Load booked dates on mount
  React.useEffect(() => {
    if (isOpen && tool.id) {
      loadBookedDates();
    }
  }, [isOpen, tool.id]);

  const loadBookedDates = async () => {
    try {
      const data = await toolRentalsApi.getAvailability(tool.id);
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

  // 566: the calendar is the date picker; the native inputs are gone.
  // The overlap preflight in handleSubmit still runs, and the server
  // re-checks the range under the per-tool lock.
  const handleCalendarChange = (nextStart: string, nextEnd: string) => {
    setStartDate(nextStart);
    setEndDate(nextEnd);
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
      toast.error(t('toolRentals.selectDates'));
      return;
    }

    if (new Date(startDate) >= new Date(endDate)) {
      toast.error(t('toolRentals.invalidDateRange'));
      return;
    }
    if (!agreementAccepted) {
      toast.error(t('toolRentals.peerAgreementRequired'));
      return;
    }

    // 554: refuse an unavailable fulfillment choice before submit; the
    // server re-checks the same flags and returns fulfillment_not_available.
    if (fulfillment === 'delivery' && !deliveryAvailable) {
      toast.error(t('toolRentals.fulfillmentNotAvailable'));
      return;
    }

    // 574: the pickup time must fall inside the owner's window when the
    // listing sets one; the server enforces the same rule.
    if (fulfillment === 'pickup' && pickupTime) {
      const windowStart = (tool.pickup_window_start || '').slice(0, 5);
      const windowEnd = (tool.pickup_window_end || '').slice(0, 5);
      if ((windowStart && pickupTime < windowStart) || (windowEnd && pickupTime > windowEnd)) {
        toast.error(t('toolRentals.pickupTimeInvalid', {
          start: formatWindowTime(tool.pickup_window_start),
          end: formatWindowTime(tool.pickup_window_end),
        }));
        return;
      }
    }

    // 576: the return time must fall inside the owner's return window
    // when the listing sets one; the server enforces the same rule.
    if (returnTime) {
      const windowStart = (tool.return_window_start || '').slice(0, 5);
      const windowEnd = (tool.return_window_end || '').slice(0, 5);
      if ((windowStart && returnTime < windowStart) || (windowEnd && returnTime > windowEnd)) {
        toast.error(t('toolRentals.returnTimeInvalid', {
          start: formatWindowTime(tool.return_window_start),
          end: formatWindowTime(tool.return_window_end),
        }));
        return;
      }
    }

    // Check for calendar conflicts
    for (const booking of bookedDates) {
      if (toolRentalDatesOverlap(startDate, endDate, booking.start_date, booking.end_date)) {
        toast.error(t('toolRentals.dateConflict'));
        // 584: the dates are taken; offer replacement listings for the
        // same dates instead of leaving the renter at a dead end.
        setAlternativesLoading(true);
        try {
          const found = await toolRentalsApi.getAlternatives(tool.id, { startDate, endDate });
          setAlternatives(found);
        } catch {
          setAlternatives([]);
        } finally {
          setAlternativesLoading(false);
        }
        return;
      }
    }

    setLoading(true);
    try {
      await toolRentalsApi.createBooking(tool.id, startDate, endDate, totalPrice, agreementAccepted, tool.equipment_version, fulfillment, fulfillment === 'pickup' ? (pickupTime || null) : null, returnTime || null);

      toast.success(t('toolRentals.bookingConfirmed'));
      onClose();
    } catch (err: any) {
      if (err.response?.data?.code === 'equipment_changed') {
        toast.error(t('equipmentOperations.changed'));
      } else if (err.response?.data?.code === 'fulfillment_not_available') {
        toast.error(t('toolRentals.fulfillmentNotAvailable'));
      } else if (err.response?.data?.code === 'previous_rental_overdue') {
        // G11-B4 (D-611): the tool is out on an overdue rental; the renter
        // cannot book it on any dates until the return is recorded. Offer
        // replacement listings for the same dates, like the conflict path.
        toast.error(t('toolRentals.previousRentalOverdue'));
        setAlternativesLoading(true);
        try {
          const found = await toolRentalsApi.getAlternatives(tool.id, { startDate, endDate });
          setAlternatives(found);
        } catch {
          setAlternatives([]);
        } finally {
          setAlternativesLoading(false);
        }
      } else if (err.response?.data?.code === 'owner_access_revoked') {
        // G11-A6 (D-610): the owner's equipment-owner grant was revoked
        // after the detail page loaded; the listing is unpublished now.
        toast.error(t('toolRentals.ownerAccessRevoked'));
      } else if (err.response?.data?.code === 'renter_email_not_verified') {
        // G11-A14 (D-626): the renter's email is not verified; the
        // booking is refused, not silently created.
        toast.error(t('toolRentals.renterEmailNotVerified'));
      } else if (err.response?.data?.code === 'conflict') {
        // 584: the dates are taken; offer replacement listings for the
        // same dates instead of leaving the renter at a dead end.
        toast.error(t('toolRentals.dateConflict'));
        setAlternativesLoading(true);
        try {
          const found = await toolRentalsApi.getAlternatives(tool.id, { startDate, endDate });
          setAlternatives(found);
        } catch {
          setAlternatives([]);
        } finally {
          setAlternativesLoading(false);
        }
      } else if (err.response?.status === 409) {
        toast.error(t('toolRentals.dateConflict'));
      } else {
        toast.error(t('toolRentals.bookingFailed'));
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
          <button onClick={onClose} className="booking-modal-close-btn" aria-label={t('common.aria.closeButton')} data-track="ui.043dee9378.1">
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

          {/* G11-A13 (D-625): warn an unverified renter before booking
              that pickup will be blocked until identity verification
              is complete. Warn-only: the booking still goes through;
              the pickup confirm enforces the block. The warning sits
              outside the form so the form's own tracking is unaffected:
              the growth-instrumentation script treats any element whose
              text mentions identity as private, and a data-track-private
              on the form would cascade to its submit button and radios. */}
          {identity && identity.verified === false && (
            <div className="booking-identity-warning" role="note">
              <ShieldAlert className="w-4 h-4" aria-hidden="true" />
              <span>{t('toolRentals.identityPickupBlocked')}</span>
              {' '}
              <Link to="/verify-identity">{t('toolRentals.identityVerifyNow')}</Link>
            </div>
          )}

          <form onSubmit={handleSubmit} className="booking-form" data-track="ui.043dee9378.2">
            {/* 566: month-view availability calendar. Booked days are
                blocked, past days disabled, and a range crossing a booked
                day cannot be picked. */}
            <div className="booking-form-group">
              <label id="booking-calendar-label">{t('toolRentals.calendarTitle')}</label>
              <ToolRentalCalendar
                bookedRanges={bookedDates}
                startDate={startDate}
                endDate={endDate}
                onChange={handleCalendarChange}
                disabled={loading}
              />
              <p className="booking-calendar-selection" aria-live="polite">
                {startDate && endDate
                  ? t('toolRentals.calendarSelectedRange', {
                      start: new Date(`${startDate}T12:00:00`).toLocaleDateString(),
                      end: new Date(`${endDate}T12:00:00`).toLocaleDateString(),
                    })
                  : startDate
                    ? t('toolRentals.calendarPickEnd')
                    : t('toolRentals.calendarPickStart')}
              </p>
            </div>

            {/* 554: pickup / delivery choice, enforced server-side. */}
            <fieldset className="booking-form-group">
              <legend>{t('toolRentals.fulfillmentTitle')}</legend>
              <label className="booking-fulfillment-option">
                <input
                  type="radio"
                  name="fulfillment"
                  value="pickup"
                  checked={fulfillment === 'pickup'}
                  onChange={() => setFulfillment('pickup')}
                  disabled={loading}
                  data-track="ui.043dee9378.5"
                />
                <span>{t('toolRentals.fulfillmentPickup')}</span>
              </label>
              <label className="booking-fulfillment-option">
                <input
                  type="radio"
                  name="fulfillment"
                  value="delivery"
                  checked={fulfillment === 'delivery'}
                  onChange={() => setFulfillment('delivery')}
                  disabled={loading || !deliveryAvailable}
                  data-track="ui.043dee9378.6"
                />
                <span>{t('toolRentals.fulfillmentDelivery')}</span>
              </label>
              {!deliveryAvailable && (
                <p className="booking-fulfillment-hint" role="note">
                  {tool.pickup_only ? t('toolRentals.fulfillmentPickupOnly') : t('toolRentals.fulfillmentDeliveryUnavailable')}
                </p>
              )}
            </fieldset>

            {/* 574: pickup appointment time, inside the owner's window
                when the listing sets one. */}
            {fulfillment === 'pickup' && (
              <div className="booking-form-group">
                <label htmlFor="pickup-time">{t('toolRentals.pickupTimeTitle')}</label>
                <div className="booking-date-input">
                  <Clock className="w-4 h-4" />
                  <input
                    id="pickup-time"
                    type="time"
                    value={pickupTime}
                    onChange={(e) => setPickupTime(e.target.value)}
                    min={(tool.pickup_window_start || '').slice(0, 5) || undefined}
                    max={(tool.pickup_window_end || '').slice(0, 5) || undefined}
                    disabled={loading}
                  />
                </div>
                {tool.pickup_window_start && tool.pickup_window_end ? (
                  <p className="booking-fulfillment-hint" role="note">
                    {t('toolRentals.pickupWindowHint', {
                      start: formatWindowTime(tool.pickup_window_start),
                      end: formatWindowTime(tool.pickup_window_end),
                    })}
                  </p>
                ) : (
                  <p className="booking-fulfillment-hint" role="note">
                    {t('toolRentals.pickupTimeHint')}
                  </p>
                )}
              </div>
            )}

            {/* 576: return appointment time. The tool always comes back
                for a handoff, so this applies to pickup and delivery. */}
            <div className="booking-form-group">
              <label htmlFor="return-time">{t('toolRentals.returnTimeTitle')}</label>
              <div className="booking-date-input">
                <Clock className="w-4 h-4" />
                <input
                  id="return-time"
                  type="time"
                  value={returnTime}
                  onChange={(e) => setReturnTime(e.target.value)}
                  min={(tool.return_window_start || '').slice(0, 5) || undefined}
                  max={(tool.return_window_end || '').slice(0, 5) || undefined}
                  disabled={loading}
                />
              </div>
              {tool.return_window_start && tool.return_window_end ? (
                <p className="booking-fulfillment-hint" role="note">
                  {t('toolRentals.returnWindowHint', {
                    start: formatWindowTime(tool.return_window_start),
                    end: formatWindowTime(tool.return_window_end),
                  })}
                </p>
              ) : (
                <p className="booking-fulfillment-hint" role="note">
                  {t('toolRentals.returnTimeHint')}
                </p>
              )}
            </div>

            {/* 584: replacement suggestions when the requested dates are
                already booked for this tool. */}
            {alternatives.length > 0 && (
              <div className="booking-form-group" data-testid="booking-alternatives">
                <h3>{t('toolRentals.alternativesTitle')}</h3>
                <p className="booking-fulfillment-hint" role="note">
                  {t('toolRentals.alternativesHint')}
                </p>
                <ul>
                  {alternatives.map((alt) => (
                    <li key={alt.id}>
                      <Link to={`/tool-rentals/${alt.id}`} onClick={onClose} data-track="ui.043dee9378.7">
                        {alt.name} · ${Number(alt.daily_rate).toFixed(2)}/day
                        {alt.distance_miles != null ? ` · ${Number(alt.distance_miles).toFixed(1)} mi` : ''}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {alternativesLoading && (
              <p className="booking-fulfillment-hint" role="status">{t('common.loading')}</p>
            )}
            {days > 0 && (
              <div className="booking-price-summary">
                <div className="booking-price-row">
                  <span>{t('toolRentals.days', { count: days })}</span>
                  <span>${(days * tool.daily_rate).toFixed(2)}</span>
                </div>
                <div className="booking-price-row booking-total">
                  <span>{t('toolRentals.totalPrice')}</span>
                  <span className="booking-total-amount">${totalPrice.toFixed(2)}</span>
                </div>
                {tool.requires_deposit && (
                  <div className="booking-price-row">
                    <span>{t('toolRentals.depositLabel')}</span>
                    <span>${Number(tool.deposit_amount || 0).toFixed(2)}</span>
                  </div>
                )}
              </div>
            )}

            <div className="booking-peer-agreement">
              {!!tool.accessories?.length && <><h3>{t('equipmentOperations.accessories')}</h3><ul>{tool.accessories.map(item=><li key={item.name}>{item.name} × {item.quantity}</li>)}</ul></>}
              {!!tool.condition_checklist?.length && <><h3>{t('equipmentOperations.checklist')}</h3><ul>{tool.condition_checklist.map(label=><li key={label}>{label}</li>)}</ul></>}
              <div className="booking-peer-agreement-title">
                <ShieldAlert className="w-4 h-4" />
                <span>{t('toolRentals.peerAgreementTitle')}</span>
              </div>
              <ul>
                <li>{t('toolRentals.peerAgreementOxSteedRole')}</li>
                <li>{t('toolRentals.peerAgreementInspect')}</li>
                <li>{t('toolRentals.peerAgreementDamage')}</li>
                <li>{t('toolRentals.peerAgreementReport')}</li>
              </ul>
              {(tool.brand || tool.model || tool.condition || tool.replacement_value || tool.owner_rules) && (
                <div className="booking-peer-tool-snapshot">
                  {tool.brand || tool.model ? <p><strong>{t('toolRentals.makeModel')}:</strong> {[tool.brand, tool.model].filter(Boolean).join(' ')}</p> : null}
                  {tool.condition ? <p><strong>{t('toolRentals.condition')}:</strong> {tool.condition}</p> : null}
                  {tool.replacement_value ? <p><strong>{t('toolRentals.replacementValue')}:</strong> ${Number(tool.replacement_value).toFixed(2)}</p> : null}
                  {tool.owner_rules ? <p><strong>{t('toolRentals.ownerRules')}:</strong> {tool.owner_rules}</p> : null}
                </div>
              )}
              {/* 580: cleaning instructions, as the owner wrote them. */}
              {tool.cleaning_instructions && (
                <div className="booking-peer-tool-snapshot">
                  <p><strong>{t('toolRentals.cleaningInstructionsTitle')}:</strong> {tool.cleaning_instructions}</p>
                </div>
              )}
              {/* Group 11 item 594: safety documents for this listing. */}
              {safetyDocs.length > 0 && (
                <div className="booking-peer-tool-snapshot">
                  <p><strong>{t('toolRentals.safetyDocsTitle')}:</strong></p>
                  <ul>
                    {safetyDocs.map((doc) => (
                      <li key={doc.id}>
                        <a href={doc.file_url} target="_blank" rel="noreferrer" data-track="ui.043dee9378.8">{doc.title}</a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {tool.owner_custom_terms && (
                <div className="booking-owner-terms">
                  <p className="booking-owner-terms-label">{t('toolRentals.ownerProvidedTerms')}</p>
                  <p>{tool.owner_custom_terms}</p>
                  <small>{t('toolRentals.ownerTermsDisclaimer')}</small>
                </div>
              )}
              <label className="booking-peer-checkbox">
                <input
                  type="checkbox"
                  checked={agreementAccepted}
                  onChange={(e) => setAgreementAccepted(e.target.checked)}
                  disabled={loading} data-track="ui.043dee9378.3"
                />
                <span>{t('toolRentals.peerAgreementAccept')}</span>
              </label>
            </div>

            <button
              type="submit"
              disabled={loading || !startDate || !endDate || !agreementAccepted}
              className="booking-submit-btn" data-track="ui.043dee9378.4"
            >
              {loading ? t('common.loading') : t('toolRentals.confirmBooking')}
            </button>
          </form>

          <p className="booking-disclaimer">
            {t('toolRentals.bookingDisclaimer')}
          </p>
        </div>
      </div>
    </div>
  );
};

export default BookingModal;
