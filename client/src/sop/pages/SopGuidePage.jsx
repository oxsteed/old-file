/**
 * SopGuidePage.jsx - full rendering of one SOP guide.
 * Route: /how-it-works/:area/:guideSlug
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import PageMeta from '../../components/PageMeta';
import { getArea, getGuide, getGuideById, guideUrl } from '../guideRegistry.js';
import SopProcessMap from '../components/SopProcessMap.jsx';
import SopStep from '../components/SopStep.jsx';
import SopChecklist from '../components/SopChecklist.jsx';
import '../sop.css';

export default function SopGuidePage() {
  const { t } = useTranslation();
  const { area, guideSlug } = useParams();

  const guide = useMemo(() => getGuide(area, guideSlug), [area, guideSlug]);
  const areaRecord = getArea(area);

  if (!guide) {
    return (
      <div className="sop-page">
        <PageMeta title={t('sop.guide.notFound')} />
        <div className="sop-container">
          <Link className="sop-back-link" to="/how-it-works/guides">
            {t('sop.guide.backToLibrary')}
          </Link>
          <h1 className="sop-title">{t('sop.guide.notFound')}</h1>
          <p className="sop-subtitle">{t('sop.guide.notFoundBody')}</p>
        </div>
      </div>
    );
  }

  const relatedGuides = (guide.relatedGuides || [])
    .map(getGuideById)
    .filter(Boolean);

  return (
    <div className="sop-page">
      <PageMeta title={guide.title} description={guide.goal} />
      <div className="sop-container">
        <Link className="sop-back-link" to="/how-it-works/guides">
          {t('sop.guide.backToLibrary')}
        </Link>

        <header className="sop-guide-head">
          <p className="sop-eyebrow">{areaRecord ? areaRecord.title : guide.area}</p>
          <h1 className="sop-guide-title">{guide.title}</h1>
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

        <section className="sop-section" aria-labelledby="sop-goal">
          <h2 id="sop-goal">{t('sop.guide.goal')}</h2>
          <p className="sop-lead">{guide.goal}</p>
        </section>

        {(guide.prerequisites || []).length > 0 && (
          <section className="sop-section" aria-labelledby="sop-prereqs">
            <h2 id="sop-prereqs">{t('sop.guide.prerequisites')}</h2>
            <ul className="sop-list">
              {guide.prerequisites.map((prerequisite, index) => (
                <li key={index}>
                  {prerequisite.guideId && getGuideById(prerequisite.guideId) ? (
                    <Link to={guideUrl(getGuideById(prerequisite.guideId))}>{prerequisite.text}</Link>
                  ) : prerequisite.href ? (
                    <Link to={prerequisite.href}>{prerequisite.text}</Link>
                  ) : (
                    prerequisite.text
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="sop-section" aria-labelledby="sop-process-map">
          <h2 id="sop-process-map">{t('sop.guide.processMap')}</h2>
          <SopProcessMap processMap={guide.processMap} processMapText={guide.processMapText} />
        </section>

        <section className="sop-section" aria-labelledby="sop-steps">
          <h2 id="sop-steps">{t('sop.guide.steps')}</h2>
          {guide.steps.map((step, index) => (
            <SopStep key={step.id} guide={guide} step={step} index={index} />
          ))}
        </section>

        <section className="sop-section" aria-label={t('sop.checklist.title')}>
          <SopChecklist guide={guide} />
        </section>

        <section className="sop-section" aria-labelledby="sop-confirm">
          <h2 id="sop-confirm">{t('sop.guide.confirmOutcome')}</h2>
          <div className="sop-callout sop-callout-success">
            <p>{guide.confirmOutcome}</p>
          </div>
        </section>

        {(guide.recovery || []).length > 0 && (
          <section className="sop-section" aria-labelledby="sop-recovery">
            <h2 id="sop-recovery">{t('sop.guide.recovery')}</h2>
            {guide.recovery.map((entry, index) => (
              <div key={index} className="sop-callout sop-recovery-item">
                <p><strong>{entry.problem}</strong></p>
                <p>{entry.solution}</p>
              </div>
            ))}
          </section>
        )}

        <section className="sop-section" aria-labelledby="sop-support">
          <h2 id="sop-support">{t('sop.guide.support')}</h2>
          <p className="sop-lead">{guide.supportContact}</p>
        </section>

        {relatedGuides.length > 0 && (
          <section className="sop-section" aria-labelledby="sop-related">
            <h2 id="sop-related">{t('sop.guide.relatedGuides')}</h2>
            <ul className="sop-link-list">
              {relatedGuides.map((related) => (
                <li key={related.id}>
                  <Link to={guideUrl(related)}>{related.title}</Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(guide.siteLinks || []).length > 0 && (
          <section className="sop-section" aria-labelledby="sop-site-links">
            <h2 id="sop-site-links">{t('sop.guide.siteLinks')}</h2>
            <ul className="sop-link-list">
              {guide.siteLinks.map((link, index) => (
                <li key={index}>
                  <Link to={link.href}>{link.label}</Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(guide.sources || []).length > 0 && (
          <section className="sop-section" aria-labelledby="sop-sources">
            <h2 id="sop-sources">{t('sop.guide.sources')}</h2>
            <ul className="sop-source-list">
              {guide.sources.map((source, index) => (
                <li key={index}>{source.type}: {source.ref}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
