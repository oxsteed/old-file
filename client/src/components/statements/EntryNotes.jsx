import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock } from 'lucide-react';
import { listStatementNotes, saveStatementNote, deleteStatementNote, statementNoteAttachmentUrl } from '../../api/statementExports';
import { uploadAppAsset } from '../../api/uploads';
import './EntryNotes.css';

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

// Private per-user note on a statement entry, with an optional receipt
// attachment uploaded through the existing generic upload surface
// (POST /upload, purpose "statement-note", always private).
// Integration: render inside StatementTransactionView with
//   <EntryNotes product={data.product} documentId={documentId} entryId={entryId} />
export default function EntryNotes({ product, documentId, entryId }) {
  const { t } = useTranslation('credit');
  const text = key => t(`statements.entryNotes.${key}`);
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [file, setFile] = useState(null);
  const [removeExisting, setRemoveExisting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const fileInput = useRef(null);

  const load = useCallback(async () => {
    if (!product || !entryId) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const notes = await listStatementNotes({ product, documentId: documentId || '', entryId });
      const current = Array.isArray(notes) ? notes[0] : null;
      setSaved(current || null);
      setDraft(current?.note || '');
    } catch { setError('loadError'); } finally { setLoading(false); }
  }, [product, documentId, entryId]);

  useEffect(() => { load(); }, [load]);

  async function uploadSelected(selected) {
    if (!selected) return undefined;
    if (selected.size > MAX_ATTACHMENT_BYTES) throw new Error('too-large');
    const uploaded = await uploadAppAsset(selected, 'statement-note');
    const key = uploaded?.key || uploaded?.data?.key;
    if (!key) throw new Error('no-key');
    return key;
  }

  async function onSave(event) {
    event.preventDefault();
    if (busy || !draft.trim()) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      let attachmentKey;
      if (removeExisting && !file) attachmentKey = '';
      else if (file) attachmentKey = await uploadSelected(file);
      const result = await saveStatementNote({
        product, documentId: documentId || null, entryId, note: draft.trim(), attachmentKey,
      });
      setSaved(result);
      setEditing(false); setFile(null); setRemoveExisting(false);
      if (fileInput.current) fileInput.current.value = '';
      setNotice('saved');
    } catch (err) {
      setError(err?.message === 'too-large' ? 'uploadError' : err?.response?.data?.code === 'statement_note_invalid_attachment' ? 'uploadError' : 'saveError');
    } finally { setBusy(false); }
  }

  async function onDelete() {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await deleteStatementNote(saved.id);
      setSaved(null); setDraft(''); setEditing(false); setConfirmingDelete(false);
      setNotice('deleted');
    } catch { setError('deleteError'); } finally { setBusy(false); }
  }

  if (loading) return <section className="sen-notes" aria-label={text('title')}><p role="status">…</p></section>;

  return <section className="sen-notes" aria-labelledby="entry-notes-heading">
    <div className="sen-head">
      <h3 id="entry-notes-heading">{text('title')}</h3>
      <span className="sen-private"><Lock size={14} aria-hidden="true" /> {text('privateBadge')}</span>
    </div>
    {notice && <p className="sen-notice" role="status">{text(notice)}</p>}
    {error && <p className="sen-error" role="alert">{text(error)}</p>}

    {!editing && saved && <>
      <p className="sen-text">{saved.note}</p>
      {saved.hasAttachment && <p><a href={statementNoteAttachmentUrl(saved.id)} target="_blank" rel="noreferrer">{text('viewAttachment')}</a></p>}
      <div className="sen-actions">
        <button type="button" disabled={busy} onClick={() => { setEditing(true); setDraft(saved.note); }}>{text('editNote')}</button>
        {!confirmingDelete
          ? <button type="button" disabled={busy} onClick={() => setConfirmingDelete(true)}>{text('delete')}</button>
          : <span className="sen-confirm">
            <span>{text('deleteConfirm')}</span>
            <button type="button" disabled={busy} onClick={onDelete}>{busy ? text('deleting') : text('delete')}</button>
            <button type="button" disabled={busy} onClick={() => setConfirmingDelete(false)}>{text('cancel')}</button>
          </span>}
      </div>
    </>}

    {!editing && !saved && <>
      <p className="sen-muted">{text('noNote')}</p>
      <button type="button" onClick={() => { setEditing(true); setDraft(''); }}>{text('addNote')}</button>
    </>}

    {editing && <form onSubmit={onSave} className="sen-form">
      <label className="sen-field">
        <span className="sen-label">{saved ? text('editNote') : text('addNote')}</span>
        <textarea value={draft} onChange={event => setDraft(event.target.value)} rows={4} maxLength={2000}
          placeholder={text('notePlaceholder')} required disabled={busy} />
      </label>
      <div className="sen-field">
        <span className="sen-label" id="sen-attach-label">{text('attachmentLabel')}</span>
        {saved?.hasAttachment && !removeExisting && !file && <p className="sen-muted">
          <a href={statementNoteAttachmentUrl(saved.id)} target="_blank" rel="noreferrer">{text('viewAttachment')}</a>
          <button type="button" disabled={busy} onClick={() => setRemoveExisting(true)}>{text('removeAttachment')}</button>
        </p>}
        {removeExisting && <p className="sen-muted">{text('removeAttachment')} · <button type="button" disabled={busy} onClick={() => setRemoveExisting(false)}>{text('cancel')}</button></p>}
        <input ref={fileInput} type="file" accept="image/*,.pdf" aria-labelledby="sen-attach-label"
          onChange={event => setFile(event.target.files?.[0] || null)} disabled={busy} />
        {file && <p className="sen-muted">{file.name}</p>}
        {!file && !saved?.hasAttachment && <p className="sen-muted">{text('attachReceipt')}</p>}
      </div>
      <div className="sen-actions">
        <button type="submit" disabled={busy || !draft.trim()}>{busy ? text('saving') : text('save')}</button>
        <button type="button" disabled={busy} onClick={() => { setEditing(false); setFile(null); setRemoveExisting(false); setDraft(saved?.note || ''); }}>{text('cancel')}</button>
      </div>
    </form>}
  </section>;
}
