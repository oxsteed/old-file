import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CalendarClock,
} from 'lucide-react';
import api from '../api/axios';
import './FranchiseApplicationDetail.css';

const INTERVIEW_STATUS_KEYS = {
  proposed: 'interviewProposedLabel',
  booked: 'interviewBookedLabel',
  completed: 'interviewCompleted',
  cancelled: 'interviewCancelled',
};

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Group 12 Slice 3a (604): the applicant-facing interview section for
// one franchise application. Loads the applicant
// detail endpoint, which never carries internal notes.
export default function FranchiseApplicationDetail({ applicationId }) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`dashboards.franchise.${key}`, options);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get(`/franchise/my-applications/${applicationId}`)
      .then((response) => {
        if (!cancelled) setDetail(response.data);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  async function bookSlot(slotId) {
    setBusy(true);
    setError('');
    try {
      const response = await api.post(`/franchise/my-applications/${applicationId}/interviews/${slotId}/book`);
      setDetail(response.data);
    } catch {
      setError(copy('interviewActionFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function cancelBooking(slotId) {
    setBusy(true);
    setError('');
    try {
      const response = await api.post(`/franchise/my-applications/${applicationId}/interviews/${slotId}/cancel`);
      setDetail(response.data);
    } catch {
      setError(copy('interviewActionFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (!detail) return null;

  const interviews = detail.interviews || [];
  const booked = interviews.find((slot) => slot.status === 'booked');
  const proposed = interviews.filter((slot) => slot.status === 'proposed');
  const past = interviews.filter((slot) => ['completed', 'cancelled'].includes(slot.status));

  return (
    <div className="fr-detail">
      {error && <div className="fr-detail-error" role="alert">{error}</div>}

      <section className="fr-detail-card">
        <div className="fr-detail-heading">
          <CalendarClock size={16} className="fr-detail-heading-icon" />
          <div>
            <h2 className="fr-detail-title">{copy('interviewTitle')}</h2>
            <p className="fr-detail-subtitle">{copy('interviewSubtitle')}</p>
          </div>
        </div>

        {booked && (
          <div className="fr-interview-booked">
            <div className="fr-interview-booked-label">{copy('interviewBooked')}</div>
            <div className="fr-interview-when">{formatDateTime(booked.starts_at)}</div>
            {booked.interviewer_name && <div className="fr-interview-meta">{copy('interviewer')}: {booked.interviewer_name}</div>}
            {booked.note && <div className="fr-interview-meta">{booked.note}</div>}
            <button type="button" className="fr-btn-ghost" disabled={busy} onClick={() => cancelBooking(booked.id)}>
              {copy('interviewCancelBooking')}
            </button>
          </div>
        )}

        {proposed.length > 0 && (
          <div className="fr-interview-list">
            <div className="fr-detail-list-label">{copy('interviewProposed')}</div>
            {proposed.map((slot) => (
              <div key={slot.id} className="fr-interview-row">
                <div>
                  <div className="fr-interview-when">{formatDateTime(slot.starts_at)}</div>
                  {slot.interviewer_name && <div className="fr-interview-meta">{copy('interviewer')}: {slot.interviewer_name}</div>}
                  {slot.note && <div className="fr-interview-meta">{slot.note}</div>}
                </div>
                <button type="button" className="fr-btn-primary" disabled={busy || Boolean(booked)} onClick={() => bookSlot(slot.id)}>
                  {copy('interviewBook')}
                </button>
              </div>
            ))}
          </div>
        )}

        {past.length > 0 && (
          <div className="fr-interview-list">
            {past.map((slot) => (
              <div key={slot.id} className="fr-interview-row fr-interview-row-past">
                <div>
                  <div className="fr-interview-when">{formatDateTime(slot.starts_at)}</div>
                  {slot.interviewer_name && <div className="fr-interview-meta">{copy('interviewer')}: {slot.interviewer_name}</div>}
                </div>
                <span className="fr-status-badge">{copy(INTERVIEW_STATUS_KEYS[slot.status])}</span>
              </div>
            ))}
          </div>
        )}

        {!booked && proposed.length === 0 && past.length === 0 && (
          <p className="fr-detail-empty">{copy('interviewNone')}</p>
        )}
      </section>


    </div>
  );
}
