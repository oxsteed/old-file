import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Megaphone } from 'lucide-react';

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

// Group 12 Slice 3d (620, D-320): the territory announcement feed —
// HQ broadcast announcements to a territory. The operator reads the
// feed on the territory ops page with read tracking; HQ posts and
// removes from the HQ page. The activity log stays the event record —
// this feed carries HQ announcements, not territory events.
export default function FranchiseAnnouncements({
  announcements = [],
  canPost = false,
  canManage = false,
  canRead = false,
  onPost = null,
  onDelete = null,
  onMarkRead = null,
  disabled = false,
}) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`dashboards.franchise.${key}`, options);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [formError, setFormError] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (!onPost) return;
    setFormError('');
    try {
      await onPost({
        title: title.trim(),
        body: body.trim(),
        expires_at: expiresAt || undefined,
      });
      setTitle('');
      setBody('');
      setExpiresAt('');
    } catch (err) {
      setFormError(err?.response?.data?.error || copy('announcementsPostFailed'));
    }
  }

  return (
    <section className="fr-detail-card">
      <div className="fr-detail-heading">
        <Megaphone size={16} className="fr-detail-heading-icon" />
        <div>
          <h2 className="fr-detail-title">{copy('announcementsTitle')}</h2>
          <p className="fr-detail-subtitle">{copy('announcementsSubtitle')}</p>
        </div>
      </div>

      {canPost && onPost && (
        <form onSubmit={submit} className="fr-doc-list">
          <div>
            <label className="fr-detail-list-label" htmlFor="fr-announcement-title">{copy('announcementsPostTitle')}</label>
            <input
              id="fr-announcement-title"
              type="text"
              required
              className="fr-followup-input"
              value={title}
              disabled={disabled}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={copy('announcementsPostTitlePlaceholder')}
            />
          </div>
          <div>
            <label className="fr-detail-list-label" htmlFor="fr-announcement-body">{copy('announcementsPostBody')}</label>
            <textarea
              id="fr-announcement-body"
              required
              rows={3}
              className="fr-followup-input"
              value={body}
              disabled={disabled}
              onChange={(event) => setBody(event.target.value)}
              placeholder={copy('announcementsPostBodyPlaceholder')}
            />
          </div>
          <div>
            <label className="fr-detail-list-label" htmlFor="fr-announcement-expiry">{copy('announcementsPostExpiry')}</label>
            <input
              id="fr-announcement-expiry"
              type="datetime-local"
              className="fr-followup-input"
              value={expiresAt}
              disabled={disabled}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
          </div>
          {formError && <p className="fr-detail-empty">{formError}</p>}
          <div>
            <button type="submit" className="fr-btn-primary" disabled={disabled || !title.trim() || !body.trim()}>
              {copy('announcementsPost')}
            </button>
          </div>
        </form>
      )}

      {announcements.length === 0 ? (
        <p className="fr-detail-empty">{copy('announcementsEmpty')}</p>
      ) : (
        <ul className="fr-doc-files">
          {announcements.map((announcement) => (
            <li key={announcement.id} className="fr-doc-file">
              <div>
                <div className="fr-doc-file-name">{announcement.title}</div>
                <div className="fr-doc-file-meta">{announcement.body}</div>
                <div className="fr-doc-file-meta">
                  {formatDateTime(announcement.created_at)}
                  {announcement.expires_at && (
                    <>
                      {' · '}
                      {copy('announcementsExpires', { date: formatDateTime(announcement.expires_at) })}
                    </>
                  )}
                  {canManage && (
                    <>
                      {' · '}
                      {copy('announcementsReadCount', { count: announcement.read_count ?? 0 })}
                    </>
                  )}
                </div>
              </div>
              <span className={`fr-status-badge ${announcement.expired ? 'fr-status-rejected' : announcement.read_by_me ? 'fr-status-accepted' : 'fr-status-pending'}`}>
                {announcement.expired
                  ? copy('announcementsExpired')
                  : announcement.read_by_me
                    ? copy('announcementsRead')
                    : copy('announcementsUnread')}
              </span>
              {canRead && onMarkRead && !announcement.read_by_me && !announcement.expired && (
                <button
                  type="button"
                  className="fr-btn-primary"
                  disabled={disabled}
                  onClick={() => onMarkRead(announcement.id)}
                >
                  {copy('announcementsMarkRead')}
                </button>
              )}
              {canManage && onDelete && (
                <button
                  type="button"
                  className="fr-btn-primary"
                  disabled={disabled}
                  onClick={() => onDelete(announcement.id)}
                >
                  {copy('announcementsDelete')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
