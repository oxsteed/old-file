import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import {
  followCareerEmployer, reportCareerOpening, saveCareerJob, trackCareerEvent, unfollowCareerEmployer, unsaveCareerJob,
} from '../../../api/careers';
import { ActionButton } from '../ui';
import { ReportForm } from './shared';
import { OPENING_REPORT_REASONS } from '../../../features/careers/marketplaceModel';

/**
 * Save / share / follow / report bar on a job page, plus the employer's
 * response-speed badge and the "same-day hire" and "urgent" signals.
 */
export default function OpeningActions({ opening, user }) {
  const { t } = useTranslation();
  const [saved, setSaved] = useState(Boolean(opening.viewer?.saved));
  const [following, setFollowing] = useState(Boolean(opening.viewer?.following));
  const [reporting, setReporting] = useState(false);
  const employerKey = opening.employer_type === 'platform' ? { employer: 'platform' } : { business_id: opening.business_id };
  const employerSlug = opening.employer_type === 'platform' ? 'oxsteed' : (opening.employer_slug || `b-${opening.business_id}`);

  useEffect(() => { trackCareerEvent(opening.id, 'view'); }, [opening.id]);

  const share = async () => {
    const url = `${window.location.origin}/careers/${opening.id}`;
    try {
      if (navigator.share) await navigator.share({ title: opening.title, url });
      else { await navigator.clipboard.writeText(url); toast.success(t('careers.mk.actions.linkCopied')); }
      trackCareerEvent(opening.id, 'share');
    } catch { /* cancelled */ }
  };
  const loginNext = `/login?next=${encodeURIComponent(`/careers/${opening.id}`)}`;

  return (
    <div className="ox-careers-section">
      <div className="ox-careers-meta">
        {opening.same_day_hire ? <span className="ox-careers-chip ok">{t('careers.mk.badges.sameDay')}</span> : null}
        {opening.urgently_hiring ? <span className="ox-careers-chip warn">{t('careers.mk.badges.urgent')}</span> : null}
        {opening.via_agency ? <span className="ox-careers-chip">{t('careers.mk.badges.viaAgency')}</span> : null}
        {opening.industry ? <span className="ox-careers-chip">{t(`careers.mk.industry.${opening.industry}`)}</span> : null}
        {opening.experience_level ? <span className="ox-careers-chip">{t(`careers.mk.experience.${opening.experience_level}`)}</span> : null}
        {opening.response_speed ? <span className="ox-careers-chip ok">{t('careers.mk.badges.responds', { count: opening.response_speed.days })}</span> : null}
      </div>
      <div className="ox-careers-actions">
        {user ? (
          <ActionButton onClick={async () => {
            if (saved) { await unsaveCareerJob(opening.id); setSaved(false); } else { await saveCareerJob(opening.id); setSaved(true); toast.success(t('careers.mk.actions.savedToast')); }
          }}
          >
            {saved ? t('careers.mk.actions.unsave') : t('careers.mk.actions.save')}
          </ActionButton>
        ) : <Link className="ox-careers-btn" to={loginNext}>{t('careers.mk.actions.save')}</Link>}
        <button type="button" className="ox-careers-btn" onClick={share} data-track="ui.22a0b7c54e.1">{t('careers.mk.actions.share')}</button>
        {user ? (
          <ActionButton onClick={async () => {
            if (following) { await unfollowCareerEmployer(employerKey); setFollowing(false); } else { await followCareerEmployer(employerKey); setFollowing(true); toast.success(t('careers.mk.actions.followToast', { name: opening.employer_name })); }
          }}
          >
            {following ? t('careers.mk.actions.unfollow') : t('careers.mk.actions.follow')}
          </ActionButton>
        ) : null}
        <Link className="ox-careers-btn" to={`/careers/employers/${encodeURIComponent(employerSlug)}`}>{t('careers.mk.actions.companyPage')}</Link>
        <button type="button" className="ox-careers-btn danger" onClick={() => setReporting((v) => !v)} data-track="ui.22a0b7c54e.2">{t('careers.mk.actions.report')}</button>
      </div>
      {reporting ? (
        <ReportForm
          idPrefix={`report-${opening.id}`}
          reasons={OPENING_REPORT_REASONS}
          reasonKey="careers.mk.report.openingReasons"
          onCancel={() => setReporting(false)}
          onSubmit={async (body) => { await reportCareerOpening(opening.id, body); setReporting(false); }}
        />
      ) : null}
    </div>
  );
}
