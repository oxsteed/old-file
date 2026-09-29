import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, CalendarClock, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import { bookDirectServiceSlot, getDirectServiceSlots, holdDirectServiceSlot } from '../api/direct';

function formatSlot(iso, locale) {
  try {
    return new Intl.DateTimeFormat(locale || undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function groupSlotsByDay(slots, locale) {
  const groups = new Map();
  for (const slot of slots || []) {
    const dayKey = new Date(slot.start).toISOString().slice(0, 10);
    const label = (() => {
      try {
        return new Intl.DateTimeFormat(locale || undefined, {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        }).format(new Date(slot.start));
      } catch {
        return dayKey;
      }
    })();
    if (!groups.has(dayKey)) groups.set(dayKey, { label, slots: [] });
    groups.get(dayKey).slots.push(slot);
  }
  return [...groups.values()];
}

export default function DirectBookSlotPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const serviceId = params.get('serviceId') || '';
  const serviceName = params.get('service') || '';
  const serviceSlug = params.get('serviceSlug') || '';

  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    serviceLocation: '',
    serviceCity: '',
    serviceZipCode: '',
    details: '',
  });

  const requestHref = `/direct/request-quote?service=${encodeURIComponent(serviceName || '')}&serviceSlug=${encodeURIComponent(serviceSlug || '')}&serviceId=${encodeURIComponent(serviceId || '')}`;

  async function loadSlots() {
    if (!serviceId) {
      setLoading(false);
      setError(t('directCatalog.bookMissingService', { defaultValue: 'Choose a service from the catalog to book a slot.' }));
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await getDirectServiceSlots(serviceId);
      setSlots(data.slots || []);
      if (!(data.slots || []).length) {
        setError(t('directCatalog.noSlotsFallback', { defaultValue: 'No instant book times are open right now. You can still request a quote.' }));
      }
    } catch (err) {
      setError(err?.response?.data?.error || t('directCatalog.loadSlotsError', { defaultValue: 'Could not load bookable slots.' }));
      setSlots([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadSlots(); }, [serviceId]);

  const dayGroups = useMemo(() => groupSlotsByDay(slots, i18n.resolvedLanguage), [slots, i18n.resolvedLanguage]);

  function update(field) {
    return (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!selected || !serviceId) return;
    setSubmitting(true);
    setError('');
    try {
      let holdToken = null;
      try {
        const hold = await holdDirectServiceSlot(serviceId, {
          startsAt: selected.start,
          endsAt: selected.end,
        });
        holdToken = hold?.hold?.holdToken || null;
      } catch (_) {
        // Hold is optional; transactional book still guards capacity.
      }
      const result = await bookDirectServiceSlot(serviceId, {
        startsAt: selected.start,
        endsAt: selected.end,
        holdToken,
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        phone: form.phone,
        serviceLocation: form.serviceLocation,
        serviceCity: form.serviceCity,
        serviceZipCode: form.serviceZipCode,
        details: form.details || `Booked slot for ${serviceName || 'Direct service'}`,
      });
      navigate(`/direct/request-quote/thanks?booked=1&requestId=${encodeURIComponent(result.requestId || '')}`);
    } catch (err) {
      const code = err?.response?.data?.code;
      const message = err?.response?.data?.error || t('directCatalog.bookFailed', { defaultValue: 'Could not book that slot.' });
      setError(message);
      if (code === 'slot_conflict' || code === 'capacity_exhausted') {
        setSelected(null);
        await loadSlots();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageShell>
      <PageMeta title={t('directCatalog.bookTitle', { defaultValue: 'Book a Direct slot' })} />
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-orange-300">OxSteed Direct</div>
            <h1 className="mt-2 text-3xl font-bold text-white">{t('directCatalog.bookTitle', { defaultValue: 'Book a Direct slot' })}</h1>
            <p className="mt-2 text-sm text-slate-400">
              {serviceName
                ? t('directCatalog.bookingFor', { service: serviceName, defaultValue: 'Booking for {{service}}' })
                : t('directCatalog.bookMissingService', { defaultValue: 'Choose a service from the catalog to book a slot.' })}
            </p>
          </div>
          <Link to={requestHref} className="rounded-full border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10">
            {t('directCatalog.requestInstead', { defaultValue: 'Request a quote instead' })}
          </Link>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-slate-900/70 p-6 text-slate-300">
            <Loader2 className="animate-spin" size={18} />
            {t('directCatalog.loadingSlots', { defaultValue: 'Loading open slots…' })}
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <CalendarClock size={18} className="text-orange-300" />
                {t('directCatalog.openSlots', { defaultValue: 'Open slots' })}
              </div>
              {error && (
                <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">
                  {error}
                  {!slots.length && (
                    <div className="mt-3">
                      <Link to={requestHref} className="inline-flex items-center gap-1 rounded-lg bg-orange-500 px-3 py-2 text-xs font-bold text-white hover:bg-orange-600">
                        {t('directCatalog.request', { defaultValue: 'Request' })} <ArrowRight size={14} />
                      </Link>
                    </div>
                  )}
                </div>
              )}
              <div className="mt-4 space-y-5">
                {dayGroups.map((group) => (
                  <div key={group.label}>
                    <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{group.label}</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {group.slots.map((slot) => {
                        const active = selected?.start === slot.start;
                        return (
                          <button
                            key={`${slot.start}-${slot.end}`}
                            type="button"
                            onClick={() => setSelected(slot)}
                            className={`rounded-xl border px-3 py-2 text-sm font-semibold ${active ? 'border-orange-400 bg-orange-500 text-white' : 'border-white/10 bg-white/5 text-slate-200 hover:border-orange-400/40'}`}
                          >
                            {formatSlot(slot.start, i18n.resolvedLanguage)}
                            {slot.freeAssigneeCount != null && (
                              <span className="ms-2 text-[10px] opacity-80">×{slot.freeAssigneeCount}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {!dayGroups.length && !error && (
                  <p className="text-sm text-slate-500">{t('directCatalog.noSlotsFallback', { defaultValue: 'No instant book times are open right now. You can still request a quote.' })}</p>
                )}
              </div>
            </section>

            <form onSubmit={handleSubmit} className="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
              <h2 className="text-lg font-semibold text-white">{t('directCatalog.confirmBooking', { defaultValue: 'Confirm booking' })}</h2>
              <p className="mt-1 text-xs text-slate-500">
                {selected
                  ? formatSlot(selected.start, i18n.resolvedLanguage)
                  : t('directCatalog.pickSlotFirst', { defaultValue: 'Pick an open slot first.' })}
              </p>
              <div className="mt-4 grid gap-3">
                <input required value={form.firstName} onChange={update('firstName')} placeholder={t('directPortal.request.fields.firstName', { defaultValue: 'First name' })} className="rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2.5 text-sm text-white" />
                <input value={form.lastName} onChange={update('lastName')} placeholder={t('directPortal.request.fields.lastName', { defaultValue: 'Last name' })} className="rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2.5 text-sm text-white" />
                <input required type="email" value={form.email} onChange={update('email')} placeholder={t('directPortal.request.fields.email', { defaultValue: 'Email' })} className="rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2.5 text-sm text-white" />
                <input value={form.phone} onChange={update('phone')} placeholder={t('directPortal.request.fields.phone', { defaultValue: 'Phone' })} className="rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2.5 text-sm text-white" />
                <input required value={form.serviceLocation} onChange={update('serviceLocation')} placeholder={t('directPortal.request.fields.workLocation', { defaultValue: 'Work location' })} className="rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2.5 text-sm text-white" />
                <div className="grid grid-cols-2 gap-3">
                  <input value={form.serviceCity} onChange={update('serviceCity')} placeholder={t('directPortal.request.fields.serviceCity', { defaultValue: 'City' })} className="rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2.5 text-sm text-white" />
                  <input value={form.serviceZipCode} onChange={update('serviceZipCode')} placeholder={t('directPortal.request.fields.serviceZipCode', { defaultValue: 'ZIP' })} className="rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2.5 text-sm text-white" maxLength={5} />
                </div>
                <textarea rows={3} value={form.details} onChange={update('details')} placeholder={t('directPortal.request.fields.details', { defaultValue: 'Details' })} className="rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2.5 text-sm text-white" />
              </div>
              <button
                type="submit"
                disabled={!selected || submitting || !slots.length}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
              >
                {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
                {t('directCatalog.confirmBook', { defaultValue: 'Confirm book' })}
              </button>
            </form>
          </div>
        )}
      </div>
    </PageShell>
  );
}
