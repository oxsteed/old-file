import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquare } from 'lucide-react';
import { listEntryAnnotations, addEntryAnnotation } from '../../api/statementInvestigation';
import './EntryAnnotations.css';

// Group 14 Slice 5b (708, D-425): shared annotations on a statement entry.
// Append-only and visible to every reader authorized for the document, so
// a bookkeeper can annotate a difference for another reader to see. Unlike
// the private per-user entry notes (EntryNotes, owner-only), these carry
// the author's name and can never be edited or deleted.
// Integration: render inside StatementTransactionView with
//   <EntryAnnotations documentId={documentId} entryId={entryId} />
export default function EntryAnnotations({ documentId, entryId }) {
  const { t } = useTranslation('credit');
  const text = (key) => t(`statements.entryAnnotations.${key}`);
  const [annotations, setAnnotations] = useState([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!documentId || !entryId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const data = await listEntryAnnotations(documentId, entryId);
      setAnnotations(Array.isArray(data?.annotations) ? data.annotations : []);
    } catch {
      setError('loadError');
    } finally {
      setLoading(false);
    }
  }, [documentId, entryId]);

  useEffect(() => { load(); }, [load]);

  async function onAdd(event) {
    event.preventDefault();
    const body = draft.trim();
    if (busy || !body) return;
    setBusy(true);
    setError(null);
    try {
      const data = await addEntryAnnotation(documentId, entryId, { body });
      if (data?.annotation) setAnnotations((prev) => [data.annotation, ...prev]);
      else await load();
      setDraft('');
    } catch {
      setError('saveError');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <section className="sea-annotations" aria-label={text('title')}><p role="status">…</p></section>;

  return <section className="sea-annotations" aria-labelledby="entry-annotations-heading">
    <div className="sea-head">
      <h3 id="entry-annotations-heading"><MessageSquare size={16} aria-hidden="true" /> {text('title')}</h3>
    </div>
    <p className="sea-muted">{text('sharedNote')}</p>
    {error && <p className="sea-error" role="alert">{text(error)}</p>}
    {annotations.length === 0 ? (
      <p className="sea-muted">{text('noAnnotations')}</p>
    ) : (
      <ul className="sea-list">
        {annotations.map((annotation) => (
          <li key={annotation.id} className="sea-item">
            <p className="sea-body">{annotation.body}</p>
            <p className="sea-meta">
              {annotation.authorName || annotation.authorEmail || text('authorUnknown')}
              {annotation.createdAt ? ` · ${new Date(annotation.createdAt).toLocaleString()}` : ''}
            </p>
          </li>
        ))}
      </ul>
    )}
    <form onSubmit={onAdd} className="sea-form">
      <label className="sea-field">
        <span className="sea-label">{text('addAnnotation')}</span>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={3}
          maxLength={2000}
          placeholder={text('annotationPlaceholder')}
          required
          disabled={busy}
        />
      </label>
      <div className="sea-actions">
        <button type="submit" disabled={busy || !draft.trim()}>
          {busy ? text('saving') : text('addAnnotation')}
        </button>
      </div>
    </form>
  </section>;
}
