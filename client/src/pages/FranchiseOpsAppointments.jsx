import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock } from 'lucide-react';
import './FranchiseApplicationDetail.css';

const STATUS_BADGE = {
  proposed: 'fr-status-pending',
  booked: 'fr-status-pending',
  confirmed: 'fr-status-accepted',
  completed: 'fr-status-accepted',
  cancelled: 'fr-status-rejected',
};

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Group 12 Slice 3j (647, D-348): dedicated HQ operations appointments
// for the territory — NOT the consulting strategy call (D-300). HQ
// publishes slots; the operator books one (one live booking per
// territory); HQ confirms or cancels; HQ marks a confirmed appointment
// completed. Surfaced on the operator dashboard and in HQ.
export default function FranchiseOpsAppointments({
  slots = [],
  currentUserId = null,
  canBook = false,
  canPublish = false,
  canManage = false,
  onBook = null,
  onCancelBooking = null,
  onPublish = null,
  onConfirm = null,
  onComplete = null,
  onCancelSlot = null,
  busy = false,
}) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`dashboards.franchise.${key}`, options);
  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState('');
  const [actionError, setActionError] = useState('');

  const hasLiveBooking = (slots || []).some(
    (slot) => ['booked', 'confirmed'].includes(slot.status) && String(slot.booked_by) === String(currentUserId),
  );

  async function submitPublish(event) {
    event.preventDefault();
    if (!onPublish || !startsAt) return;
    setFormError('');
    try {
      await onPublish({
        title: title.trim() || undefined,
        starts_at: new Date(startsAt).toISOString(),
        ends_at: endsAt ? new Date(endsAt).toISOString() : undefined,
        note: note.trim() || undefined,
      });
      setTitle('');
      setStartsAt('');
      setEndsAt('');
      setNote('');
    } catch (err) {
      setFormError(err?.response?.data?.error || copy('opsPublishFailed'));
    }
  }

  async function run(action, slotId) {
    if (!action) return;
    setActionError('');
    try {
      await action(slotId);
    } catch (err) {
      setActionError(err?.response?.data?.error || copy('opsUpdateFailed'));
    }
  }

  return (
    <section className="fr-detail-card">
      <div className="fr-detail-heading">
        <CalendarClock size={16} className="fr-detail-heading-icon" />
        <div>
          <h2 className="fr-detail-title">{copy('opsTitle')}</h2>
          <p className="fr-detail-subtitle">{copy('opsSubtitle')}</p>
        </div>
      </div>

      {slots.length === 0 ? (
        <p className="fr-detail-empty">{copy('opsEmpty')}</p>
      ) : (
        <ul className="fr-doc-files">
          {slots.map((slot) => {
            const isMine = String(slot.booked_by) === String(currentUserId);
            return (
              <li key={slot.id} className="fr-doc-file">
                <div>
                  <div className="fr-doc-file-name">
                    {slot.title || copy('opsUntitled')}
                  </div>
                  <div className="fr-doc-file-meta">
                    {formatDateTime(slot.starts_at)}
                    {slot.ends_at && (
                      <>
                        {' — '}
                        {formatDateTime(slot.ends_at)}
                      </>
                    )}
                    {slot.booked_by_name && (
                      <>
                        {' · '}
                        {copy('opsBookedBy', { name: slot.booked_by_name })}
                      </>
                    )}
                    {slot.note && (
                      <>
                        {' · '}
                        {slot.note}
                      </>
                    )}
                    {slot.status === 'cancelled' && slot.cancel_reason && (
                      <>
                        {' · '}
                        {slot.cancel_reason}
                      </>
                    )}
                  </div>
                </div>
                <span className={`fr-status-badge ${STATUS_BADGE[slot.status] || 'fr-status-pending'}`}>
                  {copy(`opsStatus_${slot.status}`)}
                </span>
                {canBook && onBook && slot.status === 'proposed' && (
                  <button
                    type="button"
                    className="fr-btn-primary"
                    disabled={busy || hasLiveBooking}
                    title={hasLiveBooking ? copy('opsLiveBooking') : undefined}
                    onClick={() => run(onBook, slot.id)}
                  >
                    {copy('opsBook')}
                  </button>
                )}
                {canBook && onCancelBooking && isMine && ['booked', 'confirmed'].includes(slot.status) && (
                  <button
                    type="button"
                    className="fr-btn-ghost"
                    disabled={busy}
                    onClick={() => run(onCancelBooking, slot.id)}
                  >
                    {copy('opsCancelBooking')}
                  </button>
                )}
                {canManage && onConfirm && slot.status === 'booked' && (
                  <button
                    type="button"
                    className="fr-btn-primary"
                    disabled={busy}
                    onClick={() => run(onConfirm, slot.id)}
                  >
                    {copy('opsConfirm')}
                  </button>
                )}
                {canManage && onComplete && slot.status === 'confirmed' && (
                  <button
                    type="button"
                    className="fr-btn-primary"
                    disabled={busy}
                    onClick={() => run(onComplete, slot.id)}
                  >
                    {copy('opsComplete')}
                  </button>
                )}
                {canManage && onCancelSlot && ['proposed', 'booked', 'confirmed'].includes(slot.status) && (
                  <button
                    type="button"
                    className="fr-btn-ghost"
                    disabled={busy}
                    onClick={() => run(onCancelSlot, slot.id)}
                  >
                    {copy('opsCancelSlot')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {actionError && <p className="fr-detail-error">{actionError}</p>}

      {canPublish && onPublish && (
        <form onSubmit={submitPublish} className="fr-doc-list">
          <div>
            <label className="fr-detail-list-label" htmlFor="ops-publish-title">
              {copy('opsPublishTitle')}
            </label>
            <input
              id="ops-publish-title"
              className="fr-followup-input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={copy('opsPublishTitlePlaceholder')}
            />
          </div>
          <div>
            <label className="fr-detail-list-label" htmlFor="ops-publish-start">
              {copy('opsStartLabel')}
            </label>
            <input
              id="ops-publish-start"
              type="datetime-local"
              required
              className="fr-followup-input"
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
            />
          </div>
          <div>
            <label className="fr-detail-list-label" htmlFor="ops-publish-end">
              {copy('opsEndLabel')}
            </label>
            <input
              id="ops-publish-end"
              type="datetime-local"
              className="fr-followup-input"
              value={endsAt}
              onChange={(event) => setEndsAt(event.target.value)}
            />
          </div>
          <div>
            <label className="fr-detail-list-label" htmlFor="ops-publish-note">
              {copy('opsNoteLabel')}
            </label>
            <input
              id="ops-publish-note"
              className="fr-followup-input"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={copy('opsNotePlaceholder')}
            />
          </div>
          <div>
            <button type="submit" className="fr-btn-primary" disabled={busy || !startsAt}>
              {copy('opsPublish')}
            </button>
          </div>
          {formError && <p className="fr-detail-error">{formError}</p>}
        </form>
      )}
    </section>
  );
}
