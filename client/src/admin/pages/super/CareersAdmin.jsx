import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import HiringPipelineBoard from '../../../components/careers/HiringPipelineBoard';
import { Tabs } from '../../../components/careers/ui';
import ModerationPanel from '../../../components/careers/admin/ModerationPanel';
import DisputesPanel from '../../../components/careers/admin/DisputesPanel';
import RankingPanel from '../../../components/careers/admin/RankingPanel';
import { EorPanel, PayRulesPanel, RetentionPanel } from '../../../components/careers/admin/RulesPanel';
import '../../../styles/CareerSystem.css';

const TABS = ['hiring', 'moderation', 'disputes', 'ranking', 'eor', 'retention', 'payRules'];

/**
 * OxSteed careers admin. Hiring uses the manage_hiring grant; moderation,
 * disputes and the AI gate need moderate_careers; the server enforces both.
 */
export default function CareersAdmin() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('hiring');
  return (
    <div className="ox-careers ox-careers-admin">
      <h1>{t('careers.admin.title')}</h1>
      <Tabs tabs={TABS.map((id) => ({ id, label: t(`careers.admin.tabs.${id}`) }))} active={tab} onChange={setTab} label={t('careers.admin.title')} />
      {tab === 'hiring' ? <HiringPipelineBoard employerType="platform" /> : null}
      {tab === 'moderation' ? <ModerationPanel /> : null}
      {tab === 'disputes' ? <DisputesPanel /> : null}
      {tab === 'ranking' ? <RankingPanel /> : null}
      {tab === 'eor' ? <EorPanel /> : null}
      {tab === 'retention' ? <RetentionPanel /> : null}
      {tab === 'payRules' ? <PayRulesPanel /> : null}
    </div>
  );
}
