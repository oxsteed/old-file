import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { getArea, getGuideById, guideUrl } from '../guideRegistry.js';
import SopProcessMap from './SopProcessMap.jsx';
import SopStep from './SopStep.jsx';
import SopChecklist from './SopChecklist.jsx';

export default function SopGuideContent({ guide, embedded = false }) {
  const { t } = useTranslation();
  const uid = useId();
  const areaRecord = getArea(guide.area);
  const Heading = embedded ? 'h3' : 'h1';
  const relatedGuides = (guide.relatedGuides || []).map(getGuideById).filter(Boolean);
  const ContentLink = ({to, children, ...props}) => /\/:[A-Za-z]/.test(to)
    ? <span>{children} (open the corresponding record from your workspace)</span>
    : embedded
    ? <a {...props} href={to} target="_blank" rel="noopener noreferrer">{children}</a>
    : <Link {...props} to={to}>{children}</Link>;
  return <div lang="en" dir="ltr">
        <header className="sop-guide-head">
          <p className="sop-eyebrow">{areaRecord ? areaRecord.title : guide.area}</p>
          <Heading className="sop-guide-title">{guide.title}</Heading>
          <div className="sop-badges">
            <span className="sop-badge sop-badge-english">{t('sop.englishBadge')}</span>
            <span
              className={`sop-badge ${
                guide.availability === 'conditional' ? 'sop-badge-conditional' : 'sop-badge-supported'
              }`}
            >
              {t(`sop.library.${guide.availability}`)}
            </span>
            <span className="sop-revision">{t('sop.guide.revision', { revision: guide.revision })}</span>
          </div>
          {guide.availability === 'conditional' && (guide.conditions || []).length > 0 && (
            <div className="sop-callout sop-callout-warning">
              <ul className="sop-list">
                {guide.conditions.map((condition, index) => (
                  <li key={index}>{condition}</li>
                ))}
              </ul>
            </div>
          )}
        </header>

        <p><a className="sop-btn" href={`/sop/pdfs/guides/${guide.id}.pdf?revision=${guide.revision}`} download>{t("sop.downloadGuide")}</a></p>
        <section className="sop-section" aria-labelledby={`${uid}-sop-goal`}>
          <h2 id={`${uid}-sop-goal`}>{t('sop.guide.goal')}</h2>
          <p className="sop-lead">{guide.goal}</p>
        </section>

        {(guide.prerequisites || []).length > 0 && (
          <section className="sop-section" aria-labelledby={`${uid}-sop-prereqs`}>
            <h2 id={`${uid}-sop-prereqs`}>{t('sop.guide.prerequisites')}</h2>
            <ul className="sop-list">
              {guide.prerequisites.map((prerequisite, index) => (
                <li key={index}>
                  {prerequisite.guideId && getGuideById(prerequisite.guideId) ? (
                    <ContentLink to={guideUrl(getGuideById(prerequisite.guideId))}>{prerequisite.text}</ContentLink>
                  ) : prerequisite.href ? (
                    <ContentLink to={prerequisite.href}>{prerequisite.text}</ContentLink>
                  ) : (
                    prerequisite.text
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="sop-section" aria-labelledby={`${uid}-sop-process-map`}>
          <h2 id={`${uid}-sop-process-map`}>{t('sop.guide.processMap')}</h2>
          <SopProcessMap processMap={guide.processMap} processMapText={guide.processMapText} />
        </section>

        <section className="sop-section" aria-labelledby={`${uid}-sop-steps`}>
          <h2 id={`${uid}-sop-steps`}>{t('sop.guide.steps')}</h2>
          {guide.steps.map((step, index) => (
            <SopStep key={step.id} guide={guide} step={step} index={index} />
          ))}
        </section>

        <section className="sop-section" aria-label={t('sop.checklist.title')}>
          <SopChecklist key={guide.id} guide={guide} />
        </section>

        <section className="sop-section" aria-labelledby={`${uid}-sop-confirm`}>
          <h2 id={`${uid}-sop-confirm`}>{t('sop.guide.confirmOutcome')}</h2>
          <div className="sop-callout sop-callout-success">
            <p>{guide.confirmOutcome}</p>
          </div>
        </section>

        {(guide.recovery || []).length > 0 && (
          <section className="sop-section" aria-labelledby={`${uid}-sop-recovery`}>
            <h2 id={`${uid}-sop-recovery`}>{t('sop.guide.recovery')}</h2>
            {guide.recovery.map((entry, index) => (
              <div key={index} className="sop-callout sop-recovery-item">
                <p><strong>{entry.problem}</strong></p>
                <p>{entry.solution}</p>
              </div>
            ))}
          </section>
        )}

        <section className="sop-section" aria-labelledby={`${uid}-sop-support`}>
          <h2 id={`${uid}-sop-support`}>{t('sop.guide.support')}</h2>
          <p className="sop-lead">{guide.supportContact}</p>
        </section>

        {relatedGuides.length > 0 && (
          <section className="sop-section" aria-labelledby={`${uid}-sop-related`}>
            <h2 id={`${uid}-sop-related`}>{t('sop.guide.relatedGuides')}</h2>
            <ul className="sop-link-list">
              {relatedGuides.map((related) => (
                <li key={related.id}>
                  <ContentLink to={guideUrl(related)}>{related.title}</ContentLink>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(guide.siteLinks || []).length > 0 && (
          <section className="sop-section" aria-labelledby={`${uid}-sop-site-links`}>
            <h2 id={`${uid}-sop-site-links`}>{t('sop.guide.siteLinks')}</h2>
            <ul className="sop-link-list">
              {guide.siteLinks.map((link, index) => (
                <li key={index}>
                  <ContentLink to={link.href}>{link.label}</ContentLink>
                </li>
              ))}
            </ul>
          </section>
        )}


  </div>;
}
