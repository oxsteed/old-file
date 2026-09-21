import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, Loader2, X } from 'lucide-react';
import api from '../../../api/axios';
import { listBusinessServices } from '../../../api/businesses';
import { fetchHelperProfile } from '../../../api/helpers';
import './MessengerDock.css';
import {
  buildAvailabilityRange,
  filterBookableServices,
  listAvailabilityDates,
  normalizeBusinessAvailabilityPayload,
  normalizeHelperAvailabilityPayload,
  pickDefaultBookableService,
  resolveClientTimezone,
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
 * Business (and multi-service helpers): client picks a bookable service, then slots load.
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
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [error, setError] = useState(null);
  const [slots, setSlots] = useState([]);
  const [hasTemplate, setHasTemplate] = useState(true);
  const [services, setServices] = useState([]);
  const [selectedServiceId, setSelectedServiceId] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);

  const selectedService = useMemo(
    () => services.find((s) => String(s.id) === String(selectedServiceId)) || null,
    [services, selectedServiceId],
  );

  const dates = useMemo(() => listAvailabilityDates(slots), [slots]);
  const daySlots = useMemo(
    () => slotsForDate(slots, selectedDate),
    [slots, selectedDate],
  );

  const loadSlotsForService = useCallback(async (service) => {
    if (!businessId || !service?.id) return;
    setLoadingSlots(true);
    setError(null);
    const { from, to } = buildAvailabilityRange(14);
    try {
      const { data } = await api.get(
        `/businesses/${businessId}/services/${service.id}/slots`,
        { params: { from, to } },
      );
      const normalized = normalizeBusinessAvailabilityPayload({
        ...data,
        service_id: service.id,
      });
      const withMeta = normalized.slots.map((slot) => ({
        ...slot,
        serviceId: service.id,
        serviceName: service.name,
        timezone: resolveClientTimezone(),
      }));
      setSlots(withMeta);
      setHasTemplate(normalized.hasTemplate || withMeta.length > 0);
      setSelectedDate(listAvailabilityDates(withMeta)[0] || null);
    } catch {
      setError(t('helperProfile.messenger.availabilityLoadError'));
      setSlots([]);
      setHasTemplate(false);
    } finally {
      setLoadingSlots(false);
    }
  }, [businessId, t]);

  const load = useCallback(async () => {
    if (!helperId && !businessId) return;
    setLoading(true);
    setError(null);
    const { from, to } = buildAvailabilityRange(14);
    try {
      if (businessId) {
        const list = await listBusinessServices(businessId);
        const bookable = filterBookableServices(list);
        setServices(bookable);
        if (!bookable.length) {
          setSlots([]);
          setHasTemplate(false);
          setSelectedServiceId(null);
          return;
        }
        const initial = pickDefaultBookableService(bookable);
        setSelectedServiceId(initial.id);
        setLoading(false);
        await loadSlotsForService(initial);
        return;
      }

      // Helper path: optional multi-service chooser from public profile services
      let helperServices = [];
      try {
        const profile = await fetchHelperProfile(helperId);
        helperServices = filterBookableServices(profile?.services || []);
      } catch {
        helperServices = [];
      }
      setServices(helperServices);
      if (helperServices.length) {
        setSelectedServiceId((prev) => prev ?? helperServices[0].id);
      } else {
        setSelectedServiceId(null);
      }

      const { data } = await api.get(`/helpers/${helperId}/available-slots`, {
        params: { from, to },
      });
      const normalized = normalizeHelperAvailabilityPayload(data);
      const svc = helperServices[0] || null;
      const withMeta = normalized.slots.map((slot) => ({
        ...slot,
        serviceId: svc?.id ?? null,
        serviceName: svc?.name || '',
        timezone: resolveClientTimezone(),
      }));
      setSlots(withMeta);
      setHasTemplate(normalized.hasTemplate);
      setSelectedDate(listAvailabilityDates(withMeta)[0] || null);
    } catch {
      setError(t('helperProfile.messenger.availabilityLoadError'));
      setSlots([]);
      setHasTemplate(false);
    } finally {
      setLoading(false);
    }
  }, [helperId, businessId, t, loadSlotsForService]);

  useEffect(() => {
    if (!open) return undefined;
    load();
    return undefined;
  }, [open, load]);

  const onServiceChange = async (serviceId) => {
    setSelectedServiceId(serviceId);
    const svc = services.find((s) => String(s.id) === String(serviceId));
    if (businessId && svc) {
      await loadSlotsForService(svc);
      return;
    }
    // Helper multi-service: same weekly slots, annotate with selected service
    if (svc) {
      setSlots((prev) =>
        prev.map((slot) => ({
          ...slot,
          serviceId: svc.id,
          serviceName: svc.name,
          timezone: slot.timezone || resolveClientTimezone(),
        })),
      );
    }
  };

  if (!open) return null;

  const busy = loading || loadingSlots;
  const showServiceChooser = services.length > 1;

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
        {selectedService && !showServiceChooser ? ` · ${selectedService.name}` : ''}
      </p>

      {showServiceChooser ? (
        <div className="messenger-availability__services" role="listbox" aria-label={t('helperProfile.messenger.availabilityServices')}>
          {services.map((svc) => (
            <button
              key={svc.id}
              type="button"
              role="option"
              aria-selected={String(selectedServiceId) === String(svc.id)}
              className={`messenger-availability__service${String(selectedServiceId) === String(svc.id) ? ' is-active' : ''}`}
              onClick={() => onServiceChange(svc.id)}
              disabled={busy}
            >
              {svc.name}
            </button>
          ))}
        </div>
      ) : null}

      {busy ? (
        <div className="messenger-availability__status">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          <span>{t('helperProfile.messenger.availabilityLoading')}</span>
        </div>
      ) : null}

      {!busy && error ? (
        <p className="messenger-availability__status messenger-availability__status--error">{error}</p>
      ) : null}

      {!busy && !error && !hasTemplate ? (
        <p className="messenger-availability__status">
          {t('helperProfile.messenger.availabilityEmpty')}
        </p>
      ) : null}

      {!busy && !error && hasTemplate && dates.length === 0 ? (
        <p className="messenger-availability__status">
          {t('helperProfile.messenger.availabilityNoSlots')}
        </p>
      ) : null}

      {!busy && dates.length > 0 ? (
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
                  onClick={() =>
                    onSelectSlot?.({
                      ...slot,
                      serviceId: slot.serviceId ?? selectedService?.id ?? null,
                      serviceName: slot.serviceName || selectedService?.name || '',
                      timezone: slot.timezone || resolveClientTimezone(),
                    })
                  }
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
