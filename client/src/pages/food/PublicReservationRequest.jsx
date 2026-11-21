import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, Check, CheckCircle2, Clock3, Users } from 'lucide-react';
import { requestRestaurantReservation } from '../../api/food';
import { apiErrorMessage } from './foodShared';
import './PublicReservationRequest.css';

function localInputDate(offsetMinutes) {
  const date = new Date(Date.now() + offsetMinutes * 60 * 1000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function newKey() {
  return globalThis.crypto?.randomUUID?.() || `reservation:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export default function PublicReservationRequest({ t, restaurantId, locationId, locations = [], accent = '#f97316' }) {
  const id = useId();
  const initial = useMemo(() => ({
    locationId: locationId ? String(locationId) : '', guestName: '', guestPhone: '', guestEmail: '', partySize: 2,
    startsAt: localInputDate(60), endsAt: localInputDate(120), notes: '',
  }), [locationId]);
  const [form, setForm] = useState(initial);
  const [step, setStep] = useState('visit');
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [error, setError] = useState('');
  const active = useRef(false);
  const heading = useRef(null);
  const previousStep = useRef(step);
  const msg = (key) => t(`food.restaurant.reservation.${key}`);
  const copy = (key) => t(`reservationRequest.${key}`);
  useEffect(() => {
    if (previousStep.current !== step || confirmation) heading.current?.focus();
    previousStep.current = step;
  }, [step, confirmation]);
  const set = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setError('');
  };
  const submit = async (event) => {
    event.preventDefault();
    if (active.current) return;
    if (new Date(form.endsAt) <= new Date(form.startsAt)) { setError(copy('invalidWindow')); return; }
    if (step === 'visit') { setError(''); setStep('contact'); return; }
    if (!form.guestPhone.trim() && !form.guestEmail.trim()) { setError(copy('contactRequired')); return; }
    active.current = true; setBusy(true); setError('');
    try {
      const result = await requestRestaurantReservation(restaurantId, {
        ...form,
        locationId: form.locationId || locationId || undefined,
        partySize: Number(form.partySize),
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: new Date(form.endsAt).toISOString(),
      }, newKey());
      if (!result?.reservation) { setError(msg('error')); return; }
      setConfirmation(result.reservation);
    } catch (failure) {
      setError(apiErrorMessage(failure, msg('error')));
    } finally { active.current = false; setBusy(false); }
  };
  const field = (name, label, type = 'text', props = {}) => <div className="reservation-request__field">
    <label htmlFor={`${id}-${name}`}>{label}</label>
    <input id={`${id}-${name}`} type={type} value={form[name]} onChange={set(name)} {...props} />
  </div>;
  const editVisit = () => { setError(''); setStep('visit'); };
  const formatTime = (value) => new Intl.DateTimeFormat(
    typeof document === 'undefined' ? undefined : document.documentElement.lang || undefined,
    { dateStyle: 'medium', timeStyle: 'short' },
  ).format(new Date(value));

  return <section className="reservation-request" style={{ '--reservation-accent': accent }} aria-labelledby={`${id}-title`}>
    <header className="reservation-request__header">
      <span className="reservation-request__icon" aria-hidden="true">{confirmation ? <CheckCircle2 size={23} /> : <CalendarDays size={23} />}</span>
      <div><p className="reservation-request__eyebrow">{copy('eyebrow')}</p>
        <h3 id={`${id}-title`} ref={heading} tabIndex={-1}>{confirmation ? msg('received') : msg('title')}</h3>
      </div>
    </header>
    {confirmation ? <div className="reservation-request__success" role="status">
      <p>{msg('pendingHint')}</p>
      <button type="button" className="reservation-request__button reservation-request__button--secondary" onClick={() => {
        setConfirmation(null); setForm({ ...initial, startsAt: localInputDate(60), endsAt: localInputDate(120) }); editVisit();
      }} data-track="ui.a612ceb6f0.55">{msg('requestAnother')}</button>
    </div> : <>
      <ol className="reservation-request__steps" aria-label={copy('steps')}>
        {['visit', 'contact'].map((part, index) => <li key={part} aria-current={step === part ? 'step' : undefined}>
          <span aria-hidden="true">{part === 'visit' && step === 'contact' ? <Check size={13} /> : index + 1}</span>{copy(part)}
        </li>)}
      </ol>
      <form onSubmit={submit} aria-busy={busy} data-track="ui.a612ceb6f0.54" data-track-private>
        {step === 'visit' ? <fieldset className="reservation-request__fields">
          <legend className="reservation-request__sr-only">{copy('visit')}</legend>
          {locations.length > 1 && <div className="reservation-request__field">
            <label htmlFor={`${id}-store`}>{msg('store')}</label>
            <select id={`${id}-store`} value={form.locationId || String(locationId || '')} onChange={set('locationId')} required>
              <option value="">{msg('chooseStore')}</option>
              {locations.map((store) => <option key={store.id} value={store.id} disabled={store.status === 'archived'}>{store.name}</option>)}
            </select>
          </div>}
          {field('partySize', msg('partySize'), 'number', { min: 1, max: 20, required: true })}
          {field('startsAt', copy('arrival'), 'datetime-local', { required: true })}
          {field('endsAt', copy('departure'), 'datetime-local', { required: true })}
        </fieldset> : <>
          <div className="reservation-request__summary">
            <div><Users size={16} aria-hidden="true" /><span>{msg('partySize')}: <strong>{form.partySize}</strong></span></div>
            {locations.length > 1 && <p className="reservation-request__summary-store">{locations.find((store) => String(store.id) === String(form.locationId || locationId))?.name}</p>}
            <dl className="reservation-request__times">
              <div><dt>{copy('arrival')}</dt><dd><time dateTime={new Date(form.startsAt).toISOString()}>{formatTime(form.startsAt)}</time></dd></div>
              <div><dt>{copy('departure')}</dt><dd><time dateTime={new Date(form.endsAt).toISOString()}>{formatTime(form.endsAt)}</time></dd></div>
            </dl>
            <button type="button" onClick={editVisit} disabled={busy}><ArrowLeft size={14} aria-hidden="true" />{copy('editVisit')}</button>
          </div>
          <fieldset className="reservation-request__fields" disabled={busy} aria-describedby={`${id}-contact-hint`}>
            <legend className="reservation-request__sr-only">{copy('contact')}</legend>
            {field('guestName', msg('name'), 'text', { autoComplete: 'name', maxLength: 160, required: true })}
            <p id={`${id}-contact-hint`} className="reservation-request__help">{copy('contactHint')}</p>
            {field('guestPhone', msg('phone'), 'tel', { autoComplete: 'tel', maxLength: 40 })}
            {field('guestEmail', msg('email'), 'email', { autoComplete: 'email', maxLength: 320 })}
            <details className="reservation-request__notes">
              <summary>{copy('addNote')}</summary>
              <label htmlFor={`${id}-notes`} className="reservation-request__sr-only">{msg('notes')}</label>
              <textarea id={`${id}-notes`} placeholder={copy('notePlaceholder')} value={form.notes} onChange={set('notes')} maxLength={500} rows={3} />
            </details>
          </fieldset>
        </>}
        {error && <p className="reservation-request__error" role="alert">{error}</p>}
        <button type="submit" className="reservation-request__button" disabled={busy} data-track="ui.a612ceb6f0.56">
          {busy ? msg('sending') : step === 'visit' ? copy('continue') : msg('submit')}<ArrowRight size={17} aria-hidden="true" />
        </button>
      </form>
      <p className="reservation-request__notice"><Clock3 size={15} aria-hidden="true" /><span>{msg('pendingHint')}</span></p>
    </>}
  </section>;
}
