import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getCareerSettings, listEmployerOpenings } from '../../api/careers';
import { formatPayRange } from '../../features/careers/careersModel';
import { Empty, Loading, LoadError, Notice, Tabs, useLoad } from './ui';
import OpeningEditor from './employer/OpeningEditor';
import Pipeline from './employer/Pipeline';
import TalentPanel from './employer/TalentPanel';
import SettingsPanel from './employer/SettingsPanel';
import PaidPanel from './employer/PaidPanel';
import ReportsPanel from './employer/ReportsPanel';
import '../../styles/CareerSystem.css';

/**
 * Employer hiring workspace. employerType="business" (Business Hub) or
 * "platform" (OxSteed HR in admin; same endpoints with employer=platform).
 */
export default function HiringPipelineBoard({ employerType = 'business', businessId = null }) {
  const { t, i18n } = useTranslation();
  const ctx = useMemo(() => ({ employerType, businessId }), [employerType, businessId]);
  const platform = employerType === 'platform';
  const [tab, setTab] = useState('openings');
  const [editing, setEditing] = useState(null); // null | 'new' | id
  const [pipelineFor, setPipelineFor] = useState(null);
  const list = useLoad(() => listEmployerOpenings(ctx), [employerType, businessId]);
  const settings = useLoad(() => (platform ? Promise.resolve(null) : getCareerSettings(businessId).catch(() => null)), [platform, businessId]);
  const openings = list.data?.openings || [];
  const locations = list.data?.locations || [];
  const access = list.data?.access || {};
  const attention = openings.reduce((n, o) => n + (o.offers_expiring || 0) + (o.onboarding_attention || 0), 0);
  const pipelineOpening = openings.find((o) => Number(o.id) === Number(pipelineFor)) || openings.find((o) => o.status === 'open') || openings[0];

  const tabs = [
    { id: 'openings', label: t('careers.employer.tabs.openings') },
    { id: 'pipeline', label: t('careers.employer.tabs.pipeline'), badge: attention || null },
    ...(platform ? [] : [
      { id: 'talent', label: t('careers.employer.tabs.talent') },
      { id: 'paid', label: t('careers.employer.tabs.paid') },
      { id: 'reports', label: t('careers.employer.tabs.reports') },
      { id: 'settings', label: t('careers.employer.tabs.settings') },
    ]),
  ];

  if (list.loading && !list.data) return <div className="ox-careers"><Loading /></div>;
  if (list.error) return <div className="ox-careers"><LoadError error={list.error} onRetry={list.reload} /></div>;

  return (
    <div className="ox-careers">
      <h2>{platform ? t('careers.employer.platformTitle') : t('careers.employer.title')}</h2>
      {access.scope?.mode && !platform && !access.is_owner ? <p className="ox-careers-subtle">{t(`careers.employer.scopeMode.${access.scope.mode}`)}</p> : null}
      <Tabs tabs={tabs} active={tab} onChange={setTab} label={t('careers.employer.title')} />

      {tab === 'openings' ? (
        editing ? (
          <OpeningEditor
            ctx={ctx}
            openingId={editing === 'new' ? null : editing}
            locations={locations}
            onSaved={() => { setEditing(null); list.reload(); }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <div className="ox-careers-grid">
            <div className="ox-careers-actions">
              <button type="button" className="ox-careers-btn primary" onClick={() => setEditing('new')}>{t('careers.employer.newOpening')}</button>
            </div>
            {!openings.length ? <Empty>{t('careers.employer.noOpenings')}</Empty> : openings.map((o) => {
              const total = Object.values(o.stage_counts || {}).reduce((a, b) => a + b, 0);
              return (
                <article key={o.id} className="ox-careers-panel">
                  <div className="ox-careers-row">
                    <div>
                      <h3>{o.title}</h3>
                      <p className="ox-careers-subtle">{formatPayRange(o, i18n.language)} {t(`careers.period.${o.compensation_period}`)} · {t(`careers.openingStatus.${o.status}`)}{o.moderation_status && o.moderation_status !== 'ok' ? ` · ${t(`careers.moderation.${o.moderation_status}`)}` : ''}</p>
                    </div>
                    <span className="ox-careers-chip">{t('careers.employer.applicantCount', { count: total })}</span>
                  </div>
                  {o.removed_reason ? <Notice tone="error">{t('careers.employer.removedReason', { reason: o.removed_reason })}</Notice> : null}
                  {o.offers_expiring ? <Notice tone="warn">{t('careers.employer.offersExpiring', { count: o.offers_expiring })}</Notice> : null}
                  {o.onboarding_attention ? <Notice tone="warn">{t('careers.employer.onboardingAttention', { count: o.onboarding_attention })}</Notice> : null}
                  <div className="ox-careers-actions">
                    <button type="button" className="ox-careers-btn" onClick={() => setEditing(o.id)}>{t('careers.employer.edit')}</button>
                    <button type="button" className="ox-careers-btn" onClick={() => { setPipelineFor(o.id); setTab('pipeline'); }}>{t('careers.employer.viewApplicants')}</button>
                  </div>
                </article>
              );
            })}
          </div>
        )
      ) : null}

      {tab === 'pipeline' ? (
        pipelineOpening ? (
          <>
            <div className="ox-careers-filters">
              <select aria-label={t('careers.talent.opening')} value={pipelineOpening.id} onChange={(e) => setPipelineFor(Number(e.target.value))}>
                {openings.map((o) => <option key={o.id} value={o.id}>{o.title} · {t(`careers.openingStatus.${o.status}`)}</option>)}
              </select>
            </div>
            <Pipeline key={pipelineOpening.id} ctx={ctx} opening={pipelineOpening} locations={locations} canApprove={access.can_approve_above_range} onChanged={list.reload} />
          </>
        ) : <Empty>{t('careers.employer.noOpenings')}</Empty>
      ) : null}
      {tab === 'talent' ? <TalentPanel ctx={ctx} openings={openings} locations={locations} /> : null}
      {tab === 'paid' ? <PaidPanel ctx={ctx} openings={openings} locations={locations} billing={settings.data?.providers?.billing} /> : null}
      {tab === 'reports' ? <ReportsPanel ctx={ctx} /> : null}
      {tab === 'settings' ? <SettingsPanel ctx={ctx} /> : null}
    </div>
  );
}
