import { useTranslation } from 'react-i18next';
import {
  getCareerAccessLog, getCareerProfile, listMyBackgroundChecks, unmuteCareerBusiness,
} from '../../../api/careers';
import { formatDate, formatWhen } from '../../../features/careers/careersModel';
import { ActionButton, Empty, Loading, LoadError, useLoad } from '../ui';

export default function PrivacyTab() {
  const { t, i18n } = useTranslation();
  const log = useLoad(() => getCareerAccessLog().then((r) => r.entries || []), []);
  const profile = useLoad(() => getCareerProfile(), []);
  const checks = useLoad(() => listMyBackgroundChecks().then((r) => r.checks || []), []);
  return (
    <div className="ox-careers-grid">
      <section className="ox-careers-panel">
        <h2>{t('careers.privacy.checksTitle')}</h2>
        <p className="ox-careers-subtle">{t('careers.privacy.checksIntro')}</p>
        {checks.loading && !checks.data ? <Loading /> : null}
        <LoadError error={checks.error} onRetry={checks.reload} />
        {checks.data && !checks.data.length ? <Empty>{t('careers.privacy.noChecks')}</Empty> : null}
        {(checks.data || []).map((c) => (
          <div key={c.id} className="ox-careers-app">
            <p><strong>{c.opening_title}</strong> · {c.employer_name}</p>
            <p>{t(`careers.check.status.${c.status}`)}</p>
            {c.status === 'invited' && c.invitation_url ? <p><a href={c.invitation_url} target="_blank" rel="noopener noreferrer" data-track="ui.cbc8174950.1">{t('careers.check.startConsent')}</a></p> : null}
            {c.status === 'pre_adverse_sent' ? <p>{t('careers.check.preAdverseHelp')}</p> : null}
            {c.report_portal_url ? <p><a href={c.report_portal_url} target="_blank" rel="noopener noreferrer" data-track="ui.cbc8174950.2">{t('careers.check.viewReport')}</a></p> : null}
          </div>
        ))}
      </section>

      <section className="ox-careers-panel">
        <h2>{t('careers.privacy.disputesTitle')}</h2>
        {profile.data?.disputes?.length ? (
          <table className="ox-careers-table">
            <thead><tr><th>{t('careers.profile.fact')}</th><th>{t('careers.privacy.status')}</th><th>{t('careers.privacy.due')}</th><th>{t('careers.privacy.resolution')}</th></tr></thead>
            <tbody>
              {profile.data.disputes.map((d) => (
                <tr key={d.id}>
                  <td>{t(`careers.facts.${d.fact_type}`)}</td>
                  <td>{t(`careers.privacy.disputeStatus.${d.status}`)}</td>
                  <td>{formatDate(d.due_at, i18n.language)}</td>
                  <td>{d.resolution_note || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>{t('careers.privacy.noDisputes')}</Empty>}
      </section>

      <section className="ox-careers-panel">
        <h2>{t('careers.privacy.mutesTitle')}</h2>
        <p className="ox-careers-subtle">{t('careers.privacy.mutesIntro')}</p>
        {profile.data?.mutes?.length ? profile.data.mutes.map((m) => (
          <div key={m.business_id} className="ox-careers-row ox-careers-app">
            <span>{m.business_name}</span>
            <ActionButton onClick={async () => { await unmuteCareerBusiness(m.business_id); profile.reload(); }}>{t('careers.privacy.unmute')}</ActionButton>
          </div>
        )) : <Empty>{t('careers.privacy.noMutes')}</Empty>}
      </section>

      <section className="ox-careers-panel">
        <h2>{t('careers.privacy.logTitle')}</h2>
        <p className="ox-careers-subtle">{t('careers.privacy.logIntro')}</p>
        {log.loading && !log.data ? <Loading /> : null}
        <LoadError error={log.error} onRetry={log.reload} />
        {log.data && !log.data.length ? <Empty>{t('careers.privacy.noLog')}</Empty> : null}
        {log.data?.length ? (
          <table className="ox-careers-table">
            <thead><tr><th>{t('careers.privacy.when')}</th><th>{t('careers.privacy.who')}</th><th>{t('careers.privacy.context')}</th><th>{t('careers.privacy.what')}</th></tr></thead>
            <tbody>
              {log.data.map((e, i) => (
                <tr key={`${e.created_at}-${i}`}>
                  <td>{formatWhen(e.created_at, undefined, i18n.language)}</td>
                  <td>{e.business_name || t('careers.privacy.oxsteed')}</td>
                  <td>{t(`careers.privacy.contexts.${e.context}`)}</td>
                  <td>{(e.fact_types || []).map((f) => t(`careers.facts.${f}`)).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </div>
  );
}
