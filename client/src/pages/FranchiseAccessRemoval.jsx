import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserX } from 'lucide-react';
import './FranchiseApplicationDetail.css';

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Group 12 Slice 3i (645, D-345): explicit HQ removal of a territory
// member's access — the missing half of 645, after the server-side
// revocation that already existed. The operator is never listed here:
// operator access ends only through a completed handoff. Removals are
// audited with the member, the reason, and who removed them.
export default function FranchiseAccessRemoval({
  members = [],
  ownerUserId = null,
  removals = null,
  onRemove = null,
  busy = false,
}) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`dashboards.franchise.${key}`, options);
  const [memberId, setMemberId] = useState('');
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState('');

  const removable = (members || []).filter((member) => String(member.user_id) !== String(ownerUserId));
  const list = removals?.access_removals || [];

  async function submit(event) {
    event.preventDefault();
    if (!onRemove || !memberId || !reason.trim()) return;
    setFormError('');
    try {
      await onRemove({ user_id: memberId, reason: reason.trim() });
      setMemberId('');
      setReason('');
    } catch (err) {
      setFormError(err?.response?.data?.error || copy('accessRemovalFailed'));
    }
  }

  return (
    <section className="fr-detail-card">
      <div className="fr-detail-heading">
        <UserX size={16} className="fr-detail-heading-icon" />
        <div>
          <h2 className="fr-detail-title">{copy('accessRemovalTitle')}</h2>
          <p className="fr-detail-subtitle">{copy('accessRemovalSubtitle')}</p>
        </div>
      </div>

      {list.length === 0 ? (
        <p className="fr-detail-empty">{copy('accessRemovalEmpty')}</p>
      ) : (
        <ul className="fr-doc-files">
          {list.map((removal) => (
            <li key={removal.id} className="fr-doc-file">
              <div>
                <div className="fr-doc-file-name">{removal.user_name || '—'}</div>
                <div className="fr-doc-file-meta">
                  {removal.reason}
                  {' · '}
                  {formatDate(removal.created_at)}
                </div>
                <div className="fr-doc-file-meta">
                  {copy('accessRemovalRemovedBy', { name: removal.removed_by_name || '—' })}
                </div>
              </div>
              <span className="fr-status-badge fr-status-pending">{copy(`accessRemovalKind_${removal.membership_kind}`)}</span>
            </li>
          ))}
        </ul>
      )}

      {onRemove && (
        <form onSubmit={submit} className="fr-doc-list" data-track="ui.86b4a9e6e4.1">
          <div>
            <label className="fr-detail-list-label" htmlFor="access-removal-member">
              {copy('accessRemovalMemberLabel')}
            </label>
            <select
              id="access-removal-member"
              className="fr-followup-input"
              value={memberId}
              onChange={(event) => setMemberId(event.target.value)}
            >
              <option value="" />
              {removable.map((member) => (
                <option key={member.user_id} value={member.user_id}>
                  {member.name} · {member.email}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="fr-detail-list-label" htmlFor="access-removal-reason">
              {copy('accessRemovalReasonLabel')}
            </label>
            <input
              id="access-removal-reason"
              className="fr-followup-input"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={copy('accessRemovalReasonPlaceholder')}
            />
          </div>
          <div>
            <button type="submit" className="fr-btn-primary" disabled={busy || !memberId || !reason.trim()} data-track="ui.86b4a9e6e4.2">
              {copy('accessRemovalRemove')}
            </button>
          </div>
          {formError && <p className="fr-detail-error">{formError}</p>}
        </form>
      )}
    </section>
  );
}
