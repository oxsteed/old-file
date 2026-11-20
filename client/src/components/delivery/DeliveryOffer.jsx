import { useEffect, useState } from 'react';

// Group 9 Slice B (items 457/460): the shared offer UI for marketplace
// jobs — the response-deadline countdown and the decline (pass) form.
// Used by the inbox card (DeliveryPage) and the detail page
// (DeliveryDetailPage), so both surfaces agree on what an offer is.

export const DECLINE_REASONS = ['too_far', 'schedule_conflict', 'capacity', 'vehicle', 'pay', 'other'];

// An offer is expired once the sweep stamped it, or the moment its
// deadline passes (the claim path enforces the same rule server-side).
export function isOfferExpired(job, nowMs = Date.now()) {
  if (!job) return false;
  if (job.offer_expired_at) return true;
  if (job.offer_expired === true) return true;
  if (job.offer_expires_at == null) return false;
  const deadline = Date.parse(job.offer_expires_at);
  return Number.isFinite(deadline) && deadline <= nowMs;
}

export function hasRouteCoords(job) {
  if (!job) return false;
  return [job.origin_lat, job.origin_lng, job.destination_lat, job.destination_lng]
    .every((value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)));
}

// Live countdown to the offer deadline. Ticks every 30s so the card
// flips to the expired state without a reload. Renders nothing when the
// job carries no deadline (legacy rows predate the offer clock).
export function OfferCountdown({ job, t }) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  if (!job || job.offer_expires_at == null) return null;
  if (isOfferExpired(job, nowMs)) {
    return (
      <p className="delivery-offer-countdown delivery-offer-countdown--expired" role="status">
        {t('delivery.driver.offerExpired')} · {t('delivery.driver.offerExpiredNote')}
      </p>
    );
  }
  const remainingMs = Date.parse(job.offer_expires_at) - nowMs;
  const hours = Math.floor(remainingMs / 3600000);
  const minutes = Math.max(1, Math.ceil((remainingMs % 3600000) / 60000));
  const urgent = remainingMs < 3600000;
  return (
    <p className={`delivery-offer-countdown${urgent ? ' delivery-offer-countdown--urgent' : ''}`} role="status">
      {hours > 0
        ? t('delivery.driver.offerExpiresHours', { hours, minutes })
        : t('delivery.driver.offerExpiresMinutes', { minutes })}
    </p>
  );
}

// The decline (pass) form: a reason code plus an optional note. The
// submitter decides; declining never blocks the driver from claiming
// this job later or any other job (D-62).
export function DeclineForm({ job, t, busy, onSubmit, onCancel }) {
  const [reason, setReason] = useState(job?.my_decline?.reason_code || 'too_far');
  const [note, setNote] = useState(job?.my_decline?.note || '');
  return (
    <form
      className="delivery-decline-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ reasonCode: reason, note: note.trim() || undefined });
      }} data-track="ui.c7c9b7ed89.1"
    >
      <h4>{t('delivery.driver.declineTitle')}</h4>
      <label className="delivery-field">{t('delivery.driver.declineReason')}
        <select className="delivery-input" value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy}>
          {DECLINE_REASONS.map((code) => (
            <option key={code} value={code}>{t(`delivery.driver.declineReasons.${code}`)}</option>
          ))}
        </select>
      </label>
      <label className="delivery-field">{t('delivery.driver.declineNote')}
        <textarea
          className="delivery-input"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={500}
          placeholder={t('delivery.driver.declineNotePlaceholder')}
          disabled={busy}
        />
      </label>
      <div className="delivery-dispatch-actions">
        <button type="submit" className="delivery-button delivery-button--secondary" disabled={busy} data-track="ui.c7c9b7ed89.2">
          {t('delivery.driver.declineSubmit')}
        </button>
        <button type="button" className="delivery-button delivery-button--secondary" disabled={busy} onClick={onCancel} data-track="ui.c7c9b7ed89.3">
          {t('delivery.ui.cancel')}
        </button>
      </div>
    </form>
  );
}
