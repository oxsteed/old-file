import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mail } from 'lucide-react';

const STATUS_KEYS = {
  invited: 'territoryInviteStatusInvited',
  accepted: 'territoryInviteStatusAccepted',
  declined: 'territoryInviteStatusDeclined',
  cancelled: 'territoryInviteStatusCancelled',
  expired: 'territoryInviteStatusExpired',
};
const STATUS_BADGE = {
  invited: 'fr-status-pending',
  accepted: 'fr-status-accepted',
  declined: 'fr-status-rejected',
  cancelled: 'fr-status-rejected',
  expired: 'fr-status-rejected',
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

// Group 12 Slice 3d (616, D-316): territory-scoped invitations — the
// operator or HQ invites a person to the territory by email, scoped to
// the territory/application, with accept/decline tracked. An invite
// never grants business-wide access.
export default function FranchiseTerritoryInvitations({
  invitations = [],
  canInvite = false,
  onInvite = null,
  onCancel = null,
  disabled = false,
}) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`dashboards.franchise.${key}`, options);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [formError, setFormError] = useState('');
  // G12-A1 (D-640): the accept link for the invite just sent, so the
  // inviter can share it with someone who has no OxSteed account yet.
  // Account holders also get the invite by email and in-app.
  const [lastInvite, setLastInvite] = useState(null);
  const [linkCopied, setLinkCopied] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (!onInvite) return;
    setFormError('');
    setLinkCopied(false);
    try {
      const result = await onInvite({ email: email.trim(), role });
      if (result?.token) {
        setLastInvite({
          email: email.trim(),
          link: `${window.location.origin}/franchise/invitations/${result.token}`,
        });
      }
      setEmail('');
      setRole('member');
    } catch (err) {
      setFormError(err?.response?.data?.error || copy('territoryInvitesFailed'));
    }
  }

  async function copyLink() {
    if (!lastInvite?.link) return;
    try {
      await navigator.clipboard?.writeText(lastInvite.link);
      setLinkCopied(true);
    } catch {
      setLinkCopied(false);
    }
  }

  return (
    <section className="fr-detail-card">
      <div className="fr-detail-heading">
        <Mail size={16} className="fr-detail-heading-icon" />
        <div>
          <h2 className="fr-detail-title">{copy('territoryInvitesTitle')}</h2>
          <p className="fr-detail-subtitle">{copy('territoryInvitesSubtitle')}</p>
        </div>
      </div>

      {canInvite && onInvite && (
        <form onSubmit={submit} className="fr-doc-list" data-track="ui.bc1d7a34f9.1">
          <div>
            <label className="fr-detail-list-label" htmlFor="fr-territory-invite-email">{copy('territoryInvitesEmailLabel')}</label>
            <input
              id="fr-territory-invite-email"
              type="email"
              required
              className="fr-followup-input"
              value={email}
              disabled={disabled}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={copy('territoryInvitesEmailPlaceholder')}
            />
          </div>
          <div>
            <label className="fr-detail-list-label" htmlFor="fr-territory-invite-role">{copy('territoryInvitesRoleLabel')}</label>
            <select
              id="fr-territory-invite-role"
              className="fr-followup-input"
              value={role}
              disabled={disabled}
              onChange={(event) => setRole(event.target.value)}
            >
              <option value="member">{copy('territoryInvitesRoleMember')}</option>
              <option value="manager">{copy('territoryInvitesRoleManager')}</option>
            </select>
          </div>
          {formError && <p className="fr-detail-empty">{formError}</p>}
          <div>
            <button type="submit" className="fr-btn-primary" disabled={disabled || !email.trim()} data-track="ui.bc1d7a34f9.2">
              {copy('territoryInvitesSend')}
            </button>
          </div>
        </form>
      )}

      {canInvite && onInvite && lastInvite && (
        <div className="fr-doc-list">
          <p className="fr-detail-list-label">{copy('territoryInvitesLinkTitle', { email: lastInvite.email })}</p>
          <p className="fr-detail-empty">{copy('territoryInvitesLinkHint')}</p>
          <p className="fr-doc-file-name" style={{ overflowWrap: 'anywhere' }}>{lastInvite.link}</p>
          <div>
            <button type="button" className="fr-btn-primary" onClick={copyLink} data-track="ui.bc1d7a34f9.4">
              {linkCopied ? copy('territoryInvitesLinkCopied') : copy('territoryInvitesCopyLink')}
            </button>
          </div>
        </div>
      )}

      {invitations.length === 0 ? (
        <p className="fr-detail-empty">{copy('territoryInvitesEmpty')}</p>
      ) : (
        <ul className="fr-doc-files">
          {invitations.map((invite) => (
            <li key={invite.id} className="fr-doc-file">
              <div>
                <div className="fr-doc-file-name">{invite.email}</div>
                <div className="fr-doc-file-meta">
                  {invite.role === 'manager' ? copy('territoryInvitesRoleManager') : copy('territoryInvitesRoleMember')}
                  {' · '}
                  {formatDateTime(invite.created_at)}
                  {invite.responded_at && (
                    <>
                      {' · '}
                      {formatDateTime(invite.responded_at)}
                    </>
                  )}
                </div>
              </div>
              <span className={`fr-status-badge ${STATUS_BADGE[invite.status] || 'fr-status-pending'}`}>
                {copy(STATUS_KEYS[invite.status] || 'territoryInviteStatusInvited')}
              </span>
              {canInvite && onCancel && invite.status === 'invited' && (
                <button
                  type="button"
                  className="fr-btn-primary"
                  disabled={disabled}
                  onClick={() => onCancel(invite.id)} data-track="ui.bc1d7a34f9.3"
                >
                  {copy('territoryInvitesCancel')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
