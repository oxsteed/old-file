import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { bulkCareerStage, listCareerApplications } from '../../../api/careers';
import { STAGES, applicantLabel, factValueText, formatDate, groupByStage, rankingNotice } from '../../../features/careers/careersModel';
import { ActionButton, Empty, Loading, LoadError, Notice, StageChip, useLoad } from '../ui';
import ApplicationDetail from './ApplicationDetail';

const BULK = ['screening', 'interview', 'assessment'];

export default function Pipeline({ ctx, opening, locations, canApprove, onChanged }) {
  const { t, i18n } = useTranslation();
  const [sort, setSort] = useState('applied');
  const [stage, setStage] = useState('');
  const [selected, setSelected] = useState(null);
  const [picked, setPicked] = useState([]);
  const [bulkTo, setBulkTo] = useState('screening');
  const [view, setView] = useState('list');
  const list = useLoad(() => listCareerApplications(opening.id, { sort, stage: stage || undefined }), [opening.id, sort, stage]);
  const apps = list.data?.applications || [];
  const notice = rankingNotice(list.data?.ranking);
  const counts = groupByStage(apps);

  const renderCard = (a) => (
    <div className={`ox-careers-app ox-careers-list-item${selected === a.id ? ' selected' : ''}`}>
      <div className="ox-careers-row">
        {ctx.employerType !== 'platform' ? (
          <input
            type="checkbox"
            aria-label={t('careers.employer.select', { name: applicantLabel(a, t) })}
            checked={picked.includes(a.id)}
            onChange={(e) => setPicked((p) => (e.target.checked ? [...p, a.id] : p.filter((x) => x !== a.id)))} data-track="ui.57d21505cf.1"
          />
        ) : null}
        <button type="button" className="ox-careers-btn" onClick={() => setSelected(a.id)} data-track="ui.57d21505cf.2">{applicantLabel(a, t)}</button>
        <StageChip stage={a.stage} />
      </div>
      <p>{formatDate(a.created_at, i18n.language)}{a.is_guest ? ` · ${t('careers.employer.verified.guest_not_verified')}` : ''}</p>
      {a.shared_facts?.length ? (
        <div className="ox-careers-facts">
          {a.shared_facts.slice(0, 4).map((f, i) => <span key={`${f.fact_type}-${i}`} className="ox-careers-chip">{t(`careers.facts.${f.fact_type}`)} {factValueText(f, i18n.language)}</span>)}
        </div>
      ) : null}
      {a.ai_reasons?.length ? (
        <p className="ox-careers-subtle">
          {t('careers.ranking.why')}{' '}
          {a.ai_reasons.map((r) => `${t(`careers.employer.checklist.${r.kind}`, { code: r.code || '' })}: ${r.status === 'met' ? t('careers.employer.met') : t('careers.employer.notShown')}`).join(' · ')}
        </p>
      ) : null}
    </div>
  );

  return (
    <div className="ox-careers-split">
      <div>
        <div className="ox-careers-filters">
          <select aria-label={t('careers.employer.sort')} value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="applied">{t('careers.employer.sortApplied')}</option>
            <option value="distance">{t('careers.employer.sortStore')}</option>
            <option value="ai">{t('careers.employer.sortAi')}</option>
          </select>
          <select aria-label={t('careers.employer.stageFilter')} value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="">{t('careers.employer.allStages')}</option>
            {STAGES.map((s) => <option key={s} value={s}>{t(`careers.stage.${s}`)}{counts[s]?.length && !stage ? ` (${counts[s].length})` : ''}</option>)}
          </select>
          <div className="ox-careers-row" role="group" aria-label={t('careers.employer.viewLabel')}>
            <button type="button" className={`ox-careers-btn${view === 'list' ? ' primary' : ''}`} aria-pressed={view === 'list'} onClick={() => setView('list')} data-track="ui.57d21505cf.3">{t('careers.employer.viewList')}</button>
            <button type="button" className={`ox-careers-btn${view === 'board' ? ' primary' : ''}`} aria-pressed={view === 'board'} onClick={() => setView('board')} data-track="ui.57d21505cf.4">{t('careers.employer.viewBoard')}</button>
          </div>
        </div>
        {sort === 'ai' && notice ? <Notice>{t(`careers.ranking.neutral.${notice}`)}</Notice> : null}
        {sort === 'ai' && !notice ? <p className="ox-careers-subtle">{t('careers.ranking.aiOn')}</p> : null}
        {list.loading && !list.data ? <Loading /> : null}
        <LoadError error={list.error} onRetry={list.reload} />
        {list.data && !apps.length ? <Empty>{t('careers.employer.noApplicants')}</Empty> : null}
        {ctx.employerType !== 'platform' && picked.length ? (
          <div className="ox-careers-row ox-careers-app">
            <span>{t('careers.employer.selected', { count: picked.length })}</span>
            <select aria-label={t('careers.employer.bulkMove')} value={bulkTo} onChange={(e) => setBulkTo(e.target.value)}>
              {BULK.map((s) => <option key={s} value={s}>{t(`careers.stage.${s}`)}</option>)}
            </select>
            <ActionButton
              onClick={async () => {
                const r = await bulkCareerStage(ctx.businessId, picked, bulkTo);
                if (r.checkout_url) { window.location.assign(r.checkout_url); return; }
                toast.success(t('careers.employer.bulkMoved', { count: (r.moved || []).length }));
                setPicked([]);
                list.reload();
              }}
            >
              {t('careers.employer.bulkMove')}
            </ActionButton>
          </div>
        ) : null}
        {view === 'board' ? (
          <div className="ox-careers-board" aria-label={t('careers.employer.viewBoard')}>
            {STAGES.filter((s) => !stage || s === stage).map((s) => (
              <section key={s} className="ox-careers-board-col" aria-labelledby={`stage-col-${s}`}>
                <h4 id={`stage-col-${s}`}>{t(`careers.stage.${s}`)} <span className="ox-careers-subtle">({counts[s]?.length || 0})</span></h4>
                <ul className="ox-careers-list">
                  {(counts[s] || []).map((a) => <li key={a.id}>{renderCard(a)}</li>)}
                </ul>
              </section>
            ))}
          </div>
        ) : null}
        <ul className="ox-careers-list" hidden={view === 'board'}>
          {(view === 'board' ? [] : apps).map((a) => (
            <li key={a.id}>
              {renderCard(a)}
            </li>
          ))}
        </ul>
      </div>
      <div>
        {selected ? (
          <ApplicationDetail
            key={selected}
            applicationId={selected}
            opening={opening}
            locations={locations}
            canApprove={canApprove}
            onChanged={() => { list.reload(); onChanged?.(); }}
          />
        ) : <Empty>{t('careers.employer.pickApplicant')}</Empty>}
      </div>
    </div>
  );
}
