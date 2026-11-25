import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookUser } from 'lucide-react';
import './FranchiseApplicationDetail.css';

// Group 12 Slice 3i (643, D-343): the operator-maintained contact
// directory — roster-linked entries (name/email read live from the user
// row) plus manual entries for contacts with no account. The operator
// edits role/notes/phone and adds/removes entries; HQ reads the same
// directory and never writes it.
export default function FranchiseContactDirectory({
  directory = null,
  canWrite = false,
  onAdd = null,
  onUpdate = null,
  onRemove = null,
  busy = false,
}) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`dashboards.franchise.${key}`, options);
  const [rosterId, setRosterId] = useState('');
  const [rosterRole, setRosterRole] = useState('');
  const [rosterNotes, setRosterNotes] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editing, setEditing] = useState({ phone: '', role: '', notes: '' });

  const entries = directory?.entries || [];
  const roster = directory?.roster || [];
  const unlisted = roster.filter((member) => !member.listed);

  async function addRoster(event) {
    event.preventDefault();
    if (!onAdd || !rosterId) return;
    setFormError('');
    try {
      await onAdd({ contact_user_id: rosterId, role: rosterRole.trim() || undefined, notes: rosterNotes.trim() || undefined });
      setRosterId('');
      setRosterRole('');
      setRosterNotes('');
    } catch (err) {
      setFormError(err?.response?.data?.error || copy('directoryAddFailed'));
    }
  }

  async function addManual(event) {
    event.preventDefault();
    if (!onAdd || !name.trim() || !email.trim()) return;
    setFormError('');
    try {
      await onAdd({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        role: role.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      setName('');
      setEmail('');
      setPhone('');
      setRole('');
      setNotes('');
    } catch (err) {
      setFormError(err?.response?.data?.error || copy('directoryAddFailed'));
    }
  }

  async function saveEdit(entry) {
    if (!onUpdate) return;
    setFormError('');
    try {
      await onUpdate(entry.id, {
        phone: editing.phone,
        role: editing.role,
        notes: editing.notes,
      });
      setEditingId(null);
      setEditing({ phone: '', role: '', notes: '' });
    } catch (err) {
      setFormError(err?.response?.data?.error || copy('directoryUpdateFailed'));
    }
  }

  async function remove(entry) {
    if (!onRemove) return;
    setFormError('');
    try {
      await onRemove(entry.id);
    } catch (err) {
      setFormError(err?.response?.data?.error || copy('directoryRemoveFailed'));
    }
  }

  return (
    <section className="fr-detail-card">
      <div className="fr-detail-heading">
        <BookUser size={16} className="fr-detail-heading-icon" />
        <div>
          <h2 className="fr-detail-title">{copy('directoryTitle')}</h2>
          <p className="fr-detail-subtitle">{copy('directorySubtitle')}</p>
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="fr-detail-empty">{copy('directoryEmpty')}</p>
      ) : (
        <ul className="fr-doc-files">
          {entries.map((entry) => (
            <li key={entry.id} className="fr-doc-file">
              <div>
                <div className="fr-doc-file-name">{entry.name || '—'}</div>
                <div className="fr-doc-file-meta">
                  {entry.email || '—'}
                  {entry.phone ? ` · ${entry.phone}` : ''}
                </div>
                {editingId === entry.id ? (
                  <div className="fr-doc-list">
                    <input
                      className="fr-followup-input"
                      value={editing.phone}
                      onChange={(event) => setEditing((prev) => ({ ...prev, phone: event.target.value }))}
                      placeholder={copy('directoryPhoneLabel')}
                    />
                    <input
                      className="fr-followup-input"
                      value={editing.role}
                      onChange={(event) => setEditing((prev) => ({ ...prev, role: event.target.value }))}
                      placeholder={copy('directoryRoleLabel')}
                    />
                    <input
                      className="fr-followup-input"
                      value={editing.notes}
                      onChange={(event) => setEditing((prev) => ({ ...prev, notes: event.target.value }))}
                      placeholder={copy('directoryNotesLabel')}
                    />
                    <div>
                      <button type="button" className="fr-btn-primary" disabled={busy} onClick={() => saveEdit(entry)} data-track="ui.e7d122ca2e.1">
                        {copy('directorySave')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="fr-doc-file-meta">
                    {entry.role || '—'}
                    {entry.notes ? ` · ${entry.notes}` : ''}
                  </div>
                )}
                {canWrite && editingId !== entry.id && (
                  <div className="fr-doc-file-meta">
                    <button
                      type="button"
                      className="fr-btn-ghost"
                      disabled={busy}
                      onClick={() => {
                        setEditingId(entry.id);
                        setEditing({ phone: entry.phone || '', role: entry.role || '', notes: entry.notes || '' });
                      }}
                      data-track="ui.e7d122ca2e.2"
                    >
                      {copy('directoryEdit')}
                    </button>
                    <button type="button" className="fr-btn-ghost" disabled={busy} onClick={() => remove(entry)} data-track="ui.e7d122ca2e.3">
                      {copy('directoryRemove')}
                    </button>
                  </div>
                )}
              </div>
              <span className="fr-status-badge fr-status-pending">{copy(entry.source === 'roster' ? 'directoryRoster' : 'directoryManual')}</span>
            </li>
          ))}
        </ul>
      )}

      {canWrite && onAdd && (
        <>
          <form onSubmit={addRoster} className="fr-doc-list" data-track="ui.e7d122ca2e.4">
            <div>
              <label className="fr-detail-list-label" htmlFor="directory-roster-member">
                {copy('directoryRosterLabel')}
              </label>
              <select
                id="directory-roster-member"
                className="fr-followup-input"
                value={rosterId}
                onChange={(event) => setRosterId(event.target.value)}
              >
                <option value="">{unlisted.length ? '' : copy('directoryRosterNone')}</option>
                {unlisted.map((member) => (
                  <option key={member.user_id} value={member.user_id}>
                    {member.name} · {member.email}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="fr-detail-list-label" htmlFor="directory-roster-role">
                {copy('directoryRoleLabel')}
              </label>
              <input
                id="directory-roster-role"
                className="fr-followup-input"
                value={rosterRole}
                onChange={(event) => setRosterRole(event.target.value)}
              />
            </div>
            <div>
              <label className="fr-detail-list-label" htmlFor="directory-roster-notes">
                {copy('directoryNotesLabel')}
              </label>
              <input
                id="directory-roster-notes"
                className="fr-followup-input"
                value={rosterNotes}
                onChange={(event) => setRosterNotes(event.target.value)}
              />
            </div>
            <div>
              <button type="submit" className="fr-btn-primary" disabled={busy || !rosterId} data-track="ui.e7d122ca2e.5">
                {copy('directoryAdd')}
              </button>
            </div>
          </form>

          <form onSubmit={addManual} className="fr-doc-list" data-track="ui.e7d122ca2e.6">
            <div>
              <p className="fr-detail-list-label">{copy('directoryAddTitle')}</p>
              <label className="fr-detail-list-label" htmlFor="directory-manual-name">
                {copy('directoryNameLabel')}
              </label>
              <input
                id="directory-manual-name"
                className="fr-followup-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div>
              <label className="fr-detail-list-label" htmlFor="directory-manual-email">
                {copy('directoryEmailLabel')}
              </label>
              <input
                id="directory-manual-email"
                className="fr-followup-input"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div>
              <label className="fr-detail-list-label" htmlFor="directory-manual-phone">
                {copy('directoryPhoneLabel')}
              </label>
              <input
                id="directory-manual-phone"
                className="fr-followup-input"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </div>
            <div>
              <label className="fr-detail-list-label" htmlFor="directory-manual-role">
                {copy('directoryRoleLabel')}
              </label>
              <input
                id="directory-manual-role"
                className="fr-followup-input"
                value={role}
                onChange={(event) => setRole(event.target.value)}
              />
            </div>
            <div>
              <label className="fr-detail-list-label" htmlFor="directory-manual-notes">
                {copy('directoryNotesLabel')}
              </label>
              <input
                id="directory-manual-notes"
                className="fr-followup-input"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>
            <div>
              <button type="submit" className="fr-btn-primary" disabled={busy || !name.trim() || !email.trim()} data-track="ui.e7d122ca2e.7">
                {copy('directoryAdd')}
              </button>
            </div>
            {formError && <p className="fr-detail-error">{formError}</p>}
          </form>
        </>
      )}
      {formError && !canWrite && <p className="fr-detail-error">{formError}</p>}
    </section>
  );
}
