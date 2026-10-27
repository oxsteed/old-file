import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { declineCareerInvitation, listMyCareerInvitations, muteCareerBusiness } from '../../../api/careers';
import { formatDate } from '../../../features/careers/careersModel';
import { ActionButton, Empty, Loading, LoadError, useLoad } from '../ui';

export default function InvitationsTab() {
  const { t, i18n } = useTranslation();
  const { data, loading, error, reload } = useLoad(() => listMyCareerInvitations().then((r) => r.invitations || []), []);
  if (loading && !data) return <Loading />;
  if (error) return <LoadError error={error} onRetry={reload} />;
  return (
    <div className="ox-careers-grid">
      <p className="ox-careers-subtle">{t('careers.invitations.intro')}</p>
      {!data?.length ? <Empty>{t('careers.invitations.empty')}</Empty> : data.map((inv) => {
        const open = ['sent', 'viewed'].includes(inv.status) && new Date(inv.expires_at) > new Date();
        return (
          <article key={inv.id} className="ox-careers-panel">
            <div className="ox-careers-row">
              <div>
                <p className="ox-careers-kicker">{inv.employer_name}</p>
                <h2 className="ox-careers-card-title">{inv.opening_title || t('careers.invitations.general')}</h2>
              </div>
              <span className="ox-careers-chip">{t(`careers.invitations.status.${inv.status}`)}</span>
            </div>
            <p>{t(`careers.invitations.reason.${inv.reason_code}`)}</p>
            {inv.message ? <p className="ox-careers-prose">{inv.message}</p> : null}
            <p className="ox-careers-subtle">{t('careers.invitations.expires', { date: formatDate(inv.expires_at, i18n.language) })}</p>
            <div className="ox-careers-actions">
              {inv.opening_id && open ? <Link className="ox-careers-btn primary" to={`/careers/${inv.opening_id}`}>{t('careers.viewRole')}</Link> : null}
              {open ? <ActionButton onClick={async () => { await declineCareerInvitation(inv.id); reload(); }}>{t('careers.invitations.decline')}</ActionButton> : null}
              <ActionButton confirm={t('careers.invitations.muteConfirm', { name: inv.employer_name })} onClick={async () => { await muteCareerBusiness(inv.business_id); reload(); }}>
                {t('careers.invitations.mute')}
              </ActionButton>
            </div>
          </article>
        );
      })}
    </div>
  );
}
