import { useState } from 'react';

// Group 9 Slice C (items 462/463/465): the multi-stop sequence UI — the
// driver's working order for a job, the window warnings on it, and the
// navigation-app handoff per stop. Used by the detail page
// (DeliveryDetailPage) for participants and for marketplace drivers
// opening a posted offer read-only (D-65): masked stops carry rounded
// coordinates only, which is still enough to open navigation.

// Navigation handoff (item 465, D-70): links only, no map SDK and no geo
// provider. Google Maps directions, Apple Maps, and a geo: URI (Android
// app chooser) as fallbacks. Coordinates when the stop has them, else
// the address as the query. A stop with neither renders no links.
export function navigationLinks(stop) {
  if (!stop) return [];
  const lat = stop.lat;
  const lng = stop.lng;
  const hasCoords = lat !== null && lat !== undefined && lat !== ''
    && lng !== null && lng !== undefined && lng !== ''
    && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
  const address = [stop.address, stop.city, stop.state].filter(Boolean).join(', ');
  const destination = hasCoords ? `${lat},${lng}` : address;
  if (!destination) return [];
  const encoded = encodeURIComponent(destination);
  const links = [
    { key: 'google', href: `https://www.google.com/maps/dir/?api=1&destination=${encoded}` },
    { key: 'apple', href: `https://maps.apple.com/?daddr=${encoded}` },
  ];
  if (hasCoords) links.push({ key: 'geo', href: `geo:${lat},${lng}?q=${encoded}` });
  return links;
}

export function NavigationLinks({ stop, t }) {
  const links = navigationLinks(stop);
  if (!links.length) return null;
  return (
    <span className="delivery-nav-links">
      <span>{t('delivery.driver.navigate')}:</span>
      {links.map((link) => (
        <a key={link.key} href={link.href} target="_blank" rel="noreferrer" data-track="ui.68852bb3d7.1">
          {t(`delivery.driver.navigateApps.${link.key}`)}
        </a>
      ))}
    </span>
  );
}

// Window warnings (item 463): the closing/expired warnings computed on
// the detail read. The assigned driver sees them here; the sweep owns
// the once-only in-app notification. Warn-only: nothing here cancels
// or reschedules the job.
export function WindowWarningBanner({ warnings, t, date }) {
  if (!warnings?.length) return null;
  return (
    <div className="delivery-alert delivery-alert--warning" role="alert">
      {warnings.map((warning) => (
        <p key={`${warning.stopId}-${warning.kind}`}>
          {warning.kind === 'closing'
            ? t('delivery.driver.windowClosing', {
              stop: warning.stopOrder,
              type: t(`delivery.driver.stopTypes.${warning.stopType}`),
              minutes: warning.minutesUntilEnd,
              when: date(warning.windowEnd),
            })
            : t('delivery.driver.windowExpired', {
              stop: warning.stopOrder,
              type: t(`delivery.driver.stopTypes.${warning.stopType}`),
              minutes: warning.minutesOverdue,
              when: date(warning.windowEnd),
            })}
        </p>
      ))}
    </div>
  );
}

function stopLabel(stop, t) {
  return `${stop.stop_order}. ${t(`delivery.driver.stopTypes.${stop.stop_type}`)}`;
}

export default function DeliveryStops({ job, stops, warnings, isAssigned, isOwner, t, date, busy, onComplete, onMove, onAdd, onNote }) {
  const [form, setForm] = useState({ stopType: 'dropoff', address: '', city: '', state: '', country: '', contactName: '', contactPhone: '', instructions: '', windowStart: '', windowEnd: '' });
  const [noteDrafts, setNoteDrafts] = useState({});
  const [formOpen, setFormOpen] = useState(false);
  const canAdd = isOwner && ['posted', 'assigned'].includes(job?.status);
  const canNote = isAssigned && !['delivered', 'cancelled', 'returned'].includes(job?.status);
  const warningByStop = new Map((warnings || []).map((warning) => [String(warning.stopId), warning]));
  const move = (stop, direction) => {
    const ordered = [...stops].sort((a, b) => a.stop_order - b.stop_order);
    const index = ordered.findIndex((entry) => String(entry.id) === String(stop.id));
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    const next = [...ordered];
    [next[index], next[target]] = [next[target], next[index]];
    onMove(next.map((entry) => entry.id));
  };
  const submitAdd = (event) => {
    event.preventDefault();
    if (!form.address.trim()) return;
    onAdd({
      stopType: form.stopType,
      address: form.address.trim(),
      city: form.city.trim() || undefined,
      state: form.state.trim() || undefined,
      country: form.country.trim() || undefined,
      contactName: form.contactName.trim() || undefined,
      contactPhone: form.contactPhone.trim() || undefined,
      instructions: form.instructions.trim() || undefined,
      windowStart: form.windowStart ? new Date(form.windowStart).toISOString() : undefined,
      windowEnd: form.windowEnd ? new Date(form.windowEnd).toISOString() : undefined,
    });
    setForm({ stopType: 'dropoff', address: '', city: '', state: '', country: '', contactName: '', contactPhone: '', instructions: '', windowStart: '', windowEnd: '' });
    setFormOpen(false);
  };
  if (!stops?.length) return null;
  return (
    <div className="delivery-stops">
      <h3>{t('delivery.driver.stopsTitle')}</h3>
      <ol className="delivery-stops__list">
        {[...stops].sort((a, b) => a.stop_order - b.stop_order).map((stop) => {
          const warning = warningByStop.get(String(stop.id));
          const done = stop.status !== 'pending';
          return (
            <li key={stop.id} className={`delivery-stops__stop${done ? ' delivery-stops__stop--done' : ''}`}>
              <div>
                <strong>{stopLabel(stop, t)}</strong>
                {stop.address && <p>{[stop.address, stop.city, stop.state].filter(Boolean).join(', ')}</p>}
                {!stop.address && [stop.city, stop.state].filter(Boolean).length > 0 && <p>{[stop.city, stop.state].filter(Boolean).join(', ')}</p>}
                {/* Group 9 partials Wave 2 Batch O (471, G9-A6, D-546):
                  the stop phone is masked like the job-level mask
                  (bullet + last 4); the driver calls through the tel:
                  link, which carries the number as a dial value only
                  and never renders it as text. */}
                {stop.contact_name && <p>{stop.contact_name}{stop.contact_phone ? ` ${stop.contact_phone}` : ''}{stop.contact_phone_tel && <>{' '}<a href={`tel:${stop.contact_phone_tel}`} data-track="ui.68852bb3d7.10">{t('delivery.driver.stopCall')}</a></>}</p>}
                {stop.instructions && <p>{stop.instructions}</p>}
                {/* Group 9 partials Wave 2 Batch O (462/464, G9-A13,
                  D-543): the driver note on the stop, written by the
                  assigned driver and read by the participants. */}
                {stop.driver_note && <p>{t('delivery.driver.stopNoteLabel')}: {stop.driver_note}</p>}
                {canNote && onNote && (
                  <form onSubmit={(event) => { event.preventDefault(); onNote(stop.id, noteDrafts[stop.id] ?? stop.driver_note ?? ''); }} className="delivery-form" data-track="ui.68852bb3d7.9">
                    <label className="delivery-field">{t('delivery.driver.stopNote')}
                      <input className="delivery-input" value={noteDrafts[stop.id] ?? stop.driver_note ?? ''} onChange={(event) => setNoteDrafts({ ...noteDrafts, [stop.id]: event.target.value })} maxLength={500} placeholder={t('delivery.driver.stopNotePlaceholder')} disabled={busy} />
                    </label>
                    <button className="delivery-button delivery-button--secondary" disabled={busy} data-track="ui.68852bb3d7.11">{t('delivery.driver.stopNoteSave')}</button>
                  </form>
                )}
                {stop.window_start && stop.window_end && <p>{date(stop.window_start)} – {date(stop.window_end)}</p>}
                {warning && (
                  <p className="delivery-stops__warning" role="status">
                    {warning.kind === 'closing'
                      ? t('delivery.driver.windowClosingShort', { minutes: warning.minutesUntilEnd })
                      : t('delivery.driver.windowExpiredShort', { minutes: warning.minutesOverdue })}
                  </p>
                )}
                {done && <p>{t('delivery.driver.stopCompleted')}</p>}
                <NavigationLinks stop={stop} t={t} />
              </div>
              {isAssigned && !done && (
                <div className="delivery-stops__actions">
                  <button type="button" className="delivery-button delivery-button--primary" disabled={busy} onClick={() => onComplete(stop.id)} data-track="ui.68852bb3d7.2">
                    {t('delivery.driver.stopComplete')}
                  </button>
                  <button type="button" className="delivery-button delivery-button--secondary" disabled={busy || stop.stop_order <= 1} onClick={() => move(stop, -1)} aria-label={t('delivery.driver.stopMoveUp')} data-track="ui.68852bb3d7.3">
                    ↑
                  </button>
                  <button type="button" className="delivery-button delivery-button--secondary" disabled={busy || stop.stop_order >= stops.length} onClick={() => move(stop, 1)} aria-label={t('delivery.driver.stopMoveDown')} data-track="ui.68852bb3d7.4">
                    ↓
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {canAdd && !formOpen && (
        <button type="button" className="delivery-button delivery-button--secondary" disabled={busy} onClick={() => setFormOpen(true)} data-track="ui.68852bb3d7.5">
          {t('delivery.driver.stopAdd')}
        </button>
      )}
      {canAdd && formOpen && (
        <form onSubmit={submitAdd} className="delivery-form" data-track="ui.68852bb3d7.6">
          <fieldset className="delivery-form-fields" disabled={busy}>
            <label className="delivery-field">{t('delivery.driver.stopType')}
              <select className="delivery-input" value={form.stopType} onChange={(event) => setForm({ ...form, stopType: event.target.value })}>
                <option value="pickup">{t('delivery.driver.stopTypes.pickup')}</option>
                <option value="dropoff">{t('delivery.driver.stopTypes.dropoff')}</option>
              </select>
            </label>
            <label className="delivery-field">{t('delivery.driver.stopAddress')}
              <input className="delivery-input" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} maxLength={500} required />
            </label>
            <div className="delivery-stop-grid">
              <label className="delivery-field">{t('delivery.driver.stopCity')}
                <input className="delivery-input" value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} maxLength={120} />
              </label>
              <label className="delivery-field">{t('delivery.driver.stopState')}
                <input className="delivery-input" value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value })} maxLength={120} />
              </label>
              <label className="delivery-field">{t('delivery.driver.stopCountry')}
                <input className="delivery-input" value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value })} maxLength={3} />
              </label>
            </div>
            <label className="delivery-field">{t('delivery.driver.stopContact')}
              <input className="delivery-input" value={form.contactName} onChange={(event) => setForm({ ...form, contactName: event.target.value })} maxLength={160} />
            </label>
            {/* Group 9 partials Wave 2 Batch O (462/464, G9-A13,
              D-543): the add-stop form used to drop the contact phone
              and the instructions although the server accepts both.
              Both are collected now, so a shipper can attach "leave
              with the concierge" to a new stop. */}
            <label className="delivery-field">{t('delivery.driver.stopContactPhone')}
              <input className="delivery-input" type="tel" value={form.contactPhone} onChange={(event) => setForm({ ...form, contactPhone: event.target.value })} maxLength={40} />
            </label>
            <label className="delivery-field">{t('delivery.driver.stopInstructions')}
              <textarea className="delivery-input" value={form.instructions} onChange={(event) => setForm({ ...form, instructions: event.target.value })} maxLength={2000} />
            </label>
            <div className="delivery-stop-grid">
              <label className="delivery-field">{t('delivery.ui.windowStart')}
                <input className="delivery-input" type="datetime-local" value={form.windowStart} onChange={(event) => setForm({ ...form, windowStart: event.target.value })} />
              </label>
              <label className="delivery-field">{t('delivery.ui.windowEnd')}
                <input className="delivery-input" type="datetime-local" min={form.windowStart || undefined} value={form.windowEnd} onChange={(event) => setForm({ ...form, windowEnd: event.target.value })} />
              </label>
            </div>
            <button className="delivery-button delivery-button--primary" data-track="ui.68852bb3d7.7">{t('delivery.driver.stopAddSubmit')}</button>
            <button type="button" className="delivery-button delivery-button--secondary" onClick={() => setFormOpen(false)} data-track="ui.68852bb3d7.8">
              {t('delivery.ui.cancel')}
            </button>
          </fieldset>
        </form>
      )}
    </div>
  );
}
