import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bookmark, Trash2 } from 'lucide-react';
import { listSavedViews, createSavedView, deleteSavedView } from '../../api/statementSearch';
import './StatementSearch.css';

// User-named filter+sort presets for a statement table.
//
// Props:
//   product        one of the five statement products; views are listed and
//                  saved scoped to it.
//   getCurrentView () => ({ filters, sort }) describing the table's current
//                  filter+sort combination.
//   onApply(view)  called with the saved { filters, sort } when the user
//                  applies a view; the host writes them to state/URL.
//
// Mounted inside the interactive statement table (CreditStatementsPage) by
// Group B; the coordinator may reuse it on archive pages owned by other
// groups.
export default function SavedViews({ product, getCurrentView, onApply }) {
  const { t } = useTranslation('credit');
  const text = (key, options = {}) => t(`statements.${key}`, options);
  const [views, setViews] = useState([]);
  const [status, setStatus] = useState('loading');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [notice, setNotice] = useState(null);

  const refresh = useCallback(async () => {
    setStatus('loading');
    setNotice(null);
    try {
      setViews(await listSavedViews({ product }));
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [product]);

  useEffect(() => { refresh(); }, [refresh]);

  async function save(event) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setNotice(null);
    try {
      const current = typeof getCurrentView === 'function' ? getCurrentView() : {};
      const view = await createSavedView({
        name: trimmed,
        product,
        filters: current.filters || {},
        sort: current.sort || {},
      });
      if (!view) throw new Error('Save failed');
      setName('');
      setViews((currentViews) => [view, ...currentViews]);
      setNotice({ kind: 'status', text: text('savedViews.saved') });
    } catch (error) {
      const code = error?.response?.data?.code;
      setNotice({ kind: 'alert', text: text(code === 'statement_saved_view_exists' ? 'savedViews.duplicate' : 'savedViews.saveError') });
    } finally {
      setSaving(false);
    }
  }

  async function remove(view) {
    if (deleting || !window.confirm(text('savedViews.confirmDelete'))) return;
    setDeleting(view.id);
    setNotice(null);
    try {
      await deleteSavedView(view.id);
      setViews((currentViews) => currentViews.filter((item) => item.id !== view.id));
      setNotice({ kind: 'status', text: text('savedViews.deleted') });
    } catch {
      setNotice({ kind: 'alert', text: text('savedViews.deleteError') });
    } finally {
      setDeleting(null);
    }
  }

  return (
    <section className="stmt-saved-views" aria-labelledby="stmt-saved-views-heading">
      <h3 id="stmt-saved-views-heading"><Bookmark size={16} aria-hidden="true" />{text('savedViews.title')}</h3>
      <p>{text('savedViews.description')}</p>
      <form className="stmt-saved-views-form" onSubmit={save}>
        <label className="stmt-sr-only" htmlFor="stmt-saved-view-name">{text('savedViews.nameLabel')}</label>
        <input
          id="stmt-saved-view-name"
          type="text"
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          placeholder={text('savedViews.namePlaceholder')}
        />
        <button type="submit" disabled={saving || !name.trim()}>{text('savedViews.save')}</button>
      </form>
      {notice && <p role={notice.kind} className={notice.kind === 'alert' ? 'stmt-search-error' : undefined}>{notice.text}</p>}
      {status === 'loading' && <p role="status">{text('savedViews.loading')}</p>}
      {status === 'error' && <p role="alert" className="stmt-search-error">{text('savedViews.error')} <button type="button" onClick={refresh}>{text('savedViews.retry')}</button></p>}
      {status === 'ready' && (
        views.length === 0
          ? <p>{text('savedViews.empty')}</p>
          : <ul className="stmt-saved-views-list">
            {views.map((view) => (
              <li key={view.id}>
                <button type="button" className="stmt-saved-view-apply" onClick={() => onApply?.(view)}>
                  {view.name}
                </button>
                <button
                  type="button"
                  className="stmt-saved-view-delete"
                  onClick={() => remove(view)}
                  disabled={deleting === view.id}
                  aria-label={`${text('savedViews.delete')}: ${view.name}`}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
      )}
    </section>
  );
}
