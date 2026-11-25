import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BadgeCheck } from 'lucide-react';
import './FranchiseApplicationDetail.css';

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Group 12 Slice 3c (615, D-315): the opening confirmation — the
// operator's record that a launched location actually opened, with the
// date it opened and notes. The launch is only complete once this record
// exists (`launch_complete` in the payload). When no confirmation exists
// yet and the location is launched, the operator confirms from here; HQ
// renders the same component read-only (no `onConfirm`).
export default function FranchiseOpeningConfirmation({
  location,
  onConfirm = null,
  disabled = false,
}) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`dashboards.franchise.${key}`, options);
  const [openedDate, setOpenedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const confirmation = location.opening_confirmation || null;

  if (confirmation) {
    return (
      <div>
        <div className="fr-detail-list-label">{copy('openingConfirmationTitle')}</div>
        <ul className="fr-doc-files">
          <li className="fr-doc-file">
            <div>
              <div className="fr-doc-file-name">{copy('openingConfirmationOpened', { date: formatDate(confirmation.opened_date) })}</div>
              {confirmation.notes && (
                <div className="fr-doc-file-meta">{confirmation.notes}</div>
              )}
            </div>
            <span className="fr-status-badge fr-status-accepted">{copy('openingConfirmationLaunchComplete')}</span>
          </li>
        </ul>
      </div>
    );
  }

  if (location.status !== 'launched' || !onConfirm) return null;

  async function confirm() {
    setSaving(true);
    try {
      await onConfirm(location.id, { opened_date: openedDate, notes: notes.trim() || undefined });
      setOpenedDate('');
      setNotes('');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="fr-detail-list-label">{copy('openingConfirmationTitle')}</div>
      <div className="fr-followup-compose">
        <label className="fr-detail-list-label" htmlFor={`fr-opening-date-${location.id}`}>{copy('openingConfirmationDate')}</label>
        <input
          id={`fr-opening-date-${location.id}`}
          type="date"
          className="fr-followup-input"
          value={openedDate}
          disabled={disabled || saving}
          onChange={(event) => setOpenedDate(event.target.value)}
        />
        <input
          className="fr-followup-input"
          placeholder={copy('openingConfirmationNotes')}
          value={notes}
          disabled={disabled || saving}
          onChange={(event) => setNotes(event.target.value)}
        />
        <button type="button" className="fr-btn-primary" disabled={disabled || saving || !openedDate} onClick={confirm} data-track="ui.7045994088.1">
          <BadgeCheck size={14} /> {copy('openingConfirmationConfirm')}
        </button>
      </div>
    </div>
  );
}
