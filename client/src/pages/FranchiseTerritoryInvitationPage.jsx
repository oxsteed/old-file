import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Mail, XCircle } from 'lucide-react';
import PageMeta from '../components/PageMeta';
import api from '../api/axios';
import { useAuth } from '../hooks/useAuth';
import './FranchiseTerritoryInvitationPage.css';

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// G12-A1 (D-640): the territory invitation accept page — token-gated and
// public, the same pattern as the booking status page. Shows what the
// invite is for, then accepts/declines through the existing respond
// endpoint, which still enforces the invited-email match. Anonymous
// visitors are sent to sign in with the invite link as the return path.
export default function FranchiseTerritoryInvitationPage() {
  const { t } = useTranslation();
  const copy = (key, options) => t(`dashboards.franchise.${key}`, options);
  const { token } = useParams();
  const { user } = useAuth();
  const [invite, setInvite] = useState(null);
  const [territory, setTerritory] = useState(null);
  const [inviter, setInviter] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | not-found | error
  const [respondError, setRespondError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get(`/franchise/invitations/${token}`);
        if (cancelled) return;
        setInvite(res.data.invitation);
        setTerritory(res.data.territory);
        setInviter(res.data.inviter);
        setState('ready');
      } catch (err) {
        if (cancelled) return;
        setState(err?.response?.status === 404 ? 'not-found' : 'error');
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const expired = invite?.status === 'invited'
    && invite?.expires_at && new Date(invite.expires_at).getTime() <= Date.now();
  const answered = invite?.status === 'accepted' || invite?.status === 'declined';
  const wrongEmail = Boolean(user && invite
    && String(user.email || '').trim().toLowerCase() !== String(invite.email).toLowerCase());
  const inviterName = [inviter?.first_name, inviter?.last_name].filter(Boolean).join(' ');
  const territoryLabel = [
    territory?.desired_brand_name || copy('territoryInvitePageTerritory'),
    [territory?.desired_city, territory?.desired_region, territory?.desired_country].filter(Boolean).join(', '),
  ].filter(Boolean).join(' — ');

  async function respond(response) {
    setBusy(true);
    setRespondError('');
    try {
      const res = await api.post(`/franchise/invitations/${token}/respond`, { response });
      setInvite(res.data.invitation);
    } catch (err) {
      const code = err?.response?.data?.code;
      if (code === 'territory_invite_email_mismatch') setRespondError('wrong-email');
      else if (code === 'territory_invite_not_pending') setRespondError('already-answered');
      else if (code === 'territory_invite_expired') setRespondError('expired');
      else setRespondError('failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="territory-invite-page">
      <PageMeta title={copy('territoryInvitePageTitle')} />
      <div className="ti-card">
        <div className="ti-heading">
          <Mail size={20} className="ti-heading-icon" />
          <h1 className="ti-title">{copy('territoryInvitePageTitle')}</h1>
        </div>

        {state === 'loading' && <p className="ti-muted">{copy('territoryInvitePageLoading')}</p>}

        {state === 'not-found' && (
          <>
            <p className="ti-error">{copy('territoryInvitePageNotFound')}</p>
            <p className="ti-muted">{copy('territoryInvitePageNotFoundHint')}</p>
          </>
        )}

        {state === 'error' && <p className="ti-error">{copy('territoryInvitePageLoadFailed')}</p>}

        {state === 'ready' && invite && (
          <>
            <p className="ti-subtitle">{copy('territoryInvitePageSubtitle')}</p>
            {inviterName && (
              <p className="ti-muted">{copy('territoryInvitePageInvitedBy', { name: inviterName })}</p>
            )}
            {invite.expires_at && (
              <p className="ti-muted">{copy('territoryInvitePageExpires', { date: formatDate(invite.expires_at) })}</p>
            )}
            <dl className="ti-details">
              <div className="ti-detail-row">
                <dt>{copy('territoryInvitePageTerritory')}</dt>
                <dd>{territoryLabel}</dd>
              </div>
              <div className="ti-detail-row">
                <dt>{copy('territoryInvitesEmailLabel')}</dt>
                <dd>{invite.email}</dd>
              </div>
              <div className="ti-detail-row">
                <dt>{copy('territoryInvitesRoleLabel')}</dt>
                <dd>{invite.role === 'manager' ? copy('territoryInvitesRoleManager') : copy('territoryInvitesRoleMember')}</dd>
              </div>
            </dl>

            {answered && (
              <div className="ti-result">
                {invite.status === 'accepted'
                  ? <CheckCircle2 size={20} className="ti-result-icon ti-accepted" />
                  : <XCircle size={20} className="ti-result-icon ti-declined" />}
                <p>
                  {invite.status === 'accepted'
                    ? copy('territoryInvitePageAccepted')
                    : copy('territoryInvitePageDeclined')}
                </p>
                {invite.responded_at && (
                  <p className="ti-muted">{copy('territoryInvitePageAnsweredOn', { date: formatDate(invite.responded_at) })}</p>
                )}
                {invite.status === 'accepted' && (
                  <Link className="ti-button" to="/franchise/territory">{copy('territoryInvitePageGoToTerritory')}</Link>
                )}
              </div>
            )}

            {!answered && expired && (
              <p className="ti-error">{copy('territoryInvitePageExpired')}</p>
            )}

            {!answered && !expired && !user && (
              <>
                <p className="ti-muted">{copy('territoryInvitePageSignInHint', { email: invite.email })}</p>
                <Link className="ti-button" to={`/login?next=${encodeURIComponent(`/franchise/invitations/${token}`)}`}>
                  {copy('territoryInvitePageSignIn')}
                </Link>
              </>
            )}

            {!answered && !expired && user && wrongEmail && (
              <p className="ti-error">
                {copy('territoryInvitePageWrongEmail', { invitedEmail: invite.email, email: user.email })}
              </p>
            )}

            {!answered && !expired && user && !wrongEmail && (
              <>
                <div className="ti-button-row">
                  <button type="button" className="ti-button" disabled={busy} onClick={() => respond('accepted')}>
                    {copy('territoryInvitePageAccept')}
                  </button>
                  <button type="button" className="ti-button ti-button-secondary" disabled={busy} onClick={() => respond('declined')}>
                    {copy('territoryInvitePageDecline')}
                  </button>
                </div>
                {respondError === 'wrong-email' && (
                  <p className="ti-error">{copy('territoryInvitePageWrongEmail', { invitedEmail: invite.email, email: user.email })}</p>
                )}
                {respondError === 'already-answered' && (
                  <p className="ti-error">{copy('territoryInvitePageAlreadyAnswered')}</p>
                )}
                {respondError === 'expired' && (
                  <p className="ti-error">{copy('territoryInvitePageExpired')}</p>
                )}
                {respondError === 'failed' && (
                  <p className="ti-error">{copy('territoryInvitePageRespondFailed')}</p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
