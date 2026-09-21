import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, Loader2, X } from 'lucide-react';
import api from '../../../api/axios';
import { listBusinessServices } from '../../../api/businesses';
import './MessengerDock.css';
import {
  buildAvailabilityRange,
  listAvailabilityDates,
  normalizeBusinessAvailabilityPayload,
  normalizeHelperAvailabilityPayload,
  slotsForDate,
} from './messengerAvailability.js';

function formatDayChip(dateKey, locale) {
  try {
    const [y, m, d] = String(dateKey).split('-').map(Number);
    const date = new Date(y, (m || 1) - 1, d || 1);
    return date.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });
  } catch {
    return dateKey;
  }
}

function formatTimeRange(slot, locale) {
  try {
    const [y, m, d] = String(slot.date).split('-').map(Number);
    const [sh, sm] = String(slot.start).split(':').map(Number);
    const [eh, em] = String(slot.end).split(':').map(Number);
    const start = new Date(y, (m || 1) - 1, d || 1, sh || 0, sm || 0);
    const end = new Date(y, (m || 1) - 1, d || 1, eh || 0, em || 0);
    return `${start.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })} – ${end.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })}`;
  } catch {
    return `${slot.start} – ${slot.end}`;
  }
}

/**
 * Compact availability calendar for the public profile messenger dock.
 * Loads helper weekly slots or the first bookable business service slots.
 */
export default function MessengerAvailabilityPicker({
  helperId,
  businessId,
  open = false,
  onClose,
  onSelectSlot,
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || 'en';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [slots, setSlots] = useState([]);
  const [hasTemplate, setHasTemplate] = useState(true);
  const [serviceLabel, setServiceLabel] = useState('');
  const [selectedDate, setSelectedDate] = useState(null);

  const dates = useMemo(() => listAvailabilityDates(slots), [slots]);
  const daySlots = useMemo(
    () => slotsForDate(slots, selectedDate),
    [slots, selectedDate],
  );

  const load = useCallback(async () => {
    if (!helperId && !businessId) return;
    setLoading(true);
    setError(null);
    const { from, to } = buildAvailabilityRange(14);
    try {
      if (businessId) {
        const services = await listBusinessServices(businessId);
        const list = Array.isArray(services) ? services : [];
        const bookable =
          list.find((s) => s?.allow_online_booking !== false && s?.is_active !== false) ||
          list[0];
        if (!bookable?.id) {
          setSlots([]);
          setHasTemplate(false);
          setServiceLabel('');
          return;
        }
        setServiceLabel(String(bookable.name || bookable.title || '').trim());
        const { data } = await api.get(
          `/businesses/${businessId}/services/${bookable.id}/slots`,
          { params: { from, to } },
        );
        const normalized = normalizeBusinessAvailabilityPayload({
          ...data,
          service_id: bookable.id,
        });
        setSlots(normalized.slots);
        setHasTemplate(normalized.hasTemplate);
        setSelectedDate(listAvailabilityDates(normalized.slots)[0] || null);
      } else {
        const { data } = await api.get(`/helpers/${helperId}/available-slots`, {
          params: { from, to },
        });
        const normalized = normalizeHelperAvailabilityPayload(data);
        setSlots(normalized.slots);
        setHasTemplate(normalized.hasTemplate);
        setServiceLabel('');
        setSelectedDate(listAvailabilityDates(normalized.slots)[0] || null);
      }
    } catch {
      setError(t('helperProfile.messenger.availabilityLoadError'));
      setSlots([]);
      setHasTemplate(false);
    } finally {
      setLoading(false);
    }
  }, [helperId, businessId, t]);

  useEffect(() => {
    if (!open) return undefined;
    load();
    return undefined;
  }, [open, load]);

  if (!open) return null;

  return (
    <div className="messenger-availability" role="region" aria-label={t('helperProfile.messenger.availabilityTitle')}>
      <div className="messenger-availability__head">
        <div className="messenger-availability__title-row">
          <Calendar className="w-4 h-4" aria-hidden="true" />
          <h3 className="messenger-availability__title">
            {t('helperProfile.messenger.availabilityTitle')}
          </h3>
        </div>
        <button
          type="button"
          className="messenger-availability__close"
          onClick={onClose}
          aria-label={t('helperProfile.messenger.close')}
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
      <p className="messenger-availability__hint">
        {businessId
          ? t('helperProfile.messenger.availabilityHintBusiness')
          : t('helperProfile.messenger.availabilityHintHelper')}
        {serviceLabel ? ` · ${serviceLabel}` : ''}
      </p>

      {loading ? (
        <div className="messenger-availability__status">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          <span>{t('helperProfile.messenger.availabilityLoading')}</span>
        </div>
      ) : null}

      {!loading && error ? (
        <p className="messenger-availability__status messenger-availability__status--error">{error}</p>
      ) : null}

      {!loading && !error && !hasTemplate ? (
        <p className="messenger-availability__status">
          {t('helperProfile.messenger.availabilityEmpty')}
        </p>
      ) : null}

      {!loading && !error && hasTemplate && dates.length === 0 ? (
        <p className="messenger-availability__status">
          {t('helperProfile.messenger.availabilityNoSlots')}
        </p>
      ) : null}

      {!loading && dates.length > 0 ? (
        <>
          <div className="messenger-availability__dates" role="listbox" aria-label={t('helperProfile.messenger.availabilityDates')}>
            {dates.map((dateKey) => (
              <button
                key={dateKey}
                type="button"
                role="option"
                aria-selected={selectedDate === dateKey}
                className={`messenger-availability__date${selectedDate === dateKey ? ' is-active' : ''}`}
                onClick={() => setSelectedDate(dateKey)}
              >
                {formatDayChip(dateKey, locale)}
              </button>
            ))}
          </div>
          <div className="messenger-availability__slots">
            {daySlots.length === 0 ? (
              <p className="messenger-availability__status">
                {t('helperProfile.messenger.availabilityNoSlotsDay')}
              </p>
            ) : (
              daySlots.map((slot) => (
                <button
                  key={slot.startIso || `${slot.date}-${slot.start}`}
                  type="button"
                  className="messenger-availability__slot"
                  onClick={() => onSelectSlot?.(slot)}
                >
                  {formatTimeRange(slot, locale)}
                </button>
              ))
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
