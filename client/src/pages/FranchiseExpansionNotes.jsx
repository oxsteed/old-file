import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PenLine } from 'lucide-react';
import './FranchiseApplicationDetail.css';

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Group 12 Slice 3h (640, D-340): expansion readiness notes — the
// operator's notes per territory or location, shown in one view next to
// HQ's own readiness fields (market assessment, recommendation, risk
// notes), which the operator sees read-only. HQ never writes operator
// notes; the operator writes only their own.
export default function FranchiseExpansionNotes({
  notes = null,
  hqNotes = null,
  locations = [],
  canWrite = false,
  onAdd = null,
  onUpdate = null,
  onRemove = null,
  busy = false,
}) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`dashboards.franchise.${key}`, options);
  const [body, setBody] = useState('');
  const [locationId, setLocationId] = useState('');
  const [formError, setFormError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingBody, setEditingBody] = useState('');

  const list = notes?.notes || [];
  const hasHqNotes = Boolean(
    hqNotes && (hqNotes.market_assessment || hqNotes.hq_recommendation || hqNotes.risk_notes)
  );

  async function submit(event) {
    event.preventDefault();
    if (!onAdd || !body.trim()) return;
    setFormError('');
    try {
      await onAdd({ body: body.trim(), location_id: locationId || undefined });
      setBody('');
      setLocationId('');
    } catch (err) {
      setFormError(err?.response?.data?.error || copy('notesAddFailed'));
    }
  }

  async function saveEdit(note) {
    if (!onUpdate || !editingBody.trim()) return;
    setFormError('');
    try {
      await onUpdate(note.id, { body: editingBody.trim() });
      setEditingId(null);
      setEditingBody('');
    } catch (err) {
      setFormError(err?.response?.data?.error || copy('notesUpdateFailed'));
    }
  }

  async function remove(note) {
    if (!onRemove) return;
    setFormError('');
    try {
      await onRemove(note.id);
    } catch (err) {
      setFormError(err?.response?.data?.error || copy('notesRemoveFailed'));
    }
  }

  return (
    <section className="fr-detail-card">
      <div className="fr-detail-heading">
        <PenLine size={16} className="fr-detail-heading-icon" />
        <div>
          <h2 className="fr-detail-title">{copy('notesTitle')}</h2>
          <p className="fr-detail-subtitle">{copy('notesSubtitle')}</p>
        </div>
      </div>

      {list.length === 0 ? (
        <p className="fr-detail-empty">{copy('notesEmpty')}</p>
      ) : (
        <ul className="fr-doc-files">
          {list.map((note) => (
            <li key={note.id} className="fr-doc-file">
              <div>
                <div className="fr-doc-file-name">
                  {note.location_name || copy('notesLocationTerritory')}
                </div>
                {editingId === note.id ? (
                  <div className="fr-doc-list">
                    <input
                      className="fr-followup-input"
                      value={editingBody}
                      onChange={(event) => setEditingBody(event.target.value)}
                    />
                    <div>
                      <button type="button" className="fr-btn-primary" disabled={busy || !editingBody.trim()} onClick={() => saveEdit(note)} data-track="ui.956cc84aab.1">
                        {copy('notesSave')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="fr-doc-file-meta">{note.body}</div>
                )}
                <div className="fr-doc-file-meta">
                  {copy('notesBy', { name: note.author_name || '—' })}
                  {' · '}
                  {formatDate(note.created_at)}
                </div>
                {canWrite && editingId !== note.id && (
                  <div className="fr-doc-file-meta">
                    <button
                      type="button"
                      className="fr-btn-ghost"
                      disabled={busy}
                      onClick={() => { setEditingId(note.id); setEditingBody(note.body); }}
                      data-track="ui.956cc84aab.2"
                    >
                      {copy('notesEdit')}
                    </button>
                    <button type="button" className="fr-btn-ghost" disabled={busy} onClick={() => remove(note)} data-track="ui.956cc84aab.3">
                      {copy('notesRemove')}
                    </button>
                  </div>
                )}
              </div>
              <span className="fr-status-badge fr-status-pending">{copy('notesNote')}</span>
            </li>
          ))}
        </ul>
      )}

      {canWrite && onAdd && (
        <form onSubmit={submit} className="fr-doc-list" data-track="ui.956cc84aab.4">
          <div>
            <label className="fr-detail-list-label" htmlFor="expansion-note-body">
              {copy('notesBodyLabel')}
            </label>
            <input
              id="expansion-note-body"
              className="fr-followup-input"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder={copy('notesBodyPlaceholder')}
            />
          </div>
          <div>
            <label className="fr-detail-list-label" htmlFor="expansion-note-location">
              {copy('notesLocationLabel')}
            </label>
            <select
              id="expansion-note-location"
              className="fr-followup-input"
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
            >
              <option value="">{copy('notesLocationTerritory')}</option>
              {(locations || []).map((location) => (
                <option key={location.id} value={location.id}>{location.name}</option>
              ))}
            </select>
          </div>
          <div>
            <button type="submit" className="fr-btn-primary" disabled={busy || !body.trim()} data-track="ui.956cc84aab.5">
              {copy('notesAdd')}
            </button>
          </div>
          {formError && <p className="fr-detail-error">{formError}</p>}
        </form>
      )}
      {formError && !canWrite && <p className="fr-detail-error">{formError}</p>}

      {hqNotes && (
        <div>
          <p className="fr-detail-list-label">{copy('notesHqTitle')}</p>
          {!hasHqNotes ? (
            <p className="fr-detail-empty">{copy('notesHqEmpty')}</p>
          ) : (
            <ul className="fr-doc-files">
              {hqNotes.market_assessment && (
                <li className="fr-doc-file">
                  <div>
                    <div className="fr-doc-file-name">{copy('notesHqMarket')}</div>
                    <div className="fr-doc-file-meta">{hqNotes.market_assessment}</div>
                  </div>
                </li>
              )}
              {hqNotes.hq_recommendation && (
                <li className="fr-doc-file">
                  <div>
                    <div className="fr-doc-file-name">{copy('notesHqRecommendation')}</div>
                    <div className="fr-doc-file-meta">{hqNotes.hq_recommendation}</div>
                  </div>
                </li>
              )}
              {hqNotes.risk_notes && (
                <li className="fr-doc-file">
                  <div>
                    <div className="fr-doc-file-name">{copy('notesHqRisk')}</div>
                    <div className="fr-doc-file-meta">{hqNotes.risk_notes}</div>
                  </div>
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
