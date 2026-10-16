/**
 * SopHandbookPage.jsx - role handbook: its guides in order with a linked
 * table of contents. Guide ids that are not published yet render as
 * placeholders so a partial handbook never breaks.
 * Route: /how-it-works/handbooks/:role
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import PageMeta from '../../components/PageMeta';
import { getGuideById, getHandbook, guideUrl } from '../guideRegistry.js';
import { HANDBOOK_ROLES } from '../model.js';
import '../sop.css';

export default function SopHandbookPage() {
  const { t } = useTranslation();
  const { role } = useParams();

  const handbook = useMemo(() => getHandbook(role), [role]);

  if (!handbook || !HANDBOOK_ROLES.includes(role)) {
    return (
      <div className="sop-page">
        <PageMeta title={t('sop.handbook.notFound')} />
        <div className="sop-container">
          <Link className="sop-back-link" to="/how-it-works/guides">
            {t('sop.handbook.backToLibrary')}
          </Link>
          <h1 className="sop-title">{t('sop.handbook.notFound')}</h1>
          <p className="sop-subtitle">{t('sop.handbook.notFoundBody')}</p>
        </div>
      </div>
    );
  }

  const entries = (handbook.guideIds || []).map((guideId) => ({
    guideId,
    guide: getGuideById(guideId),
  }));

  return (
    <div className="sop-page">
      <PageMeta title={handbook.title} />
      <div className="sop-container">
        <Link className="sop-back-link" to="/how-it-works/guides">
          {t('sop.handbook.backToLibrary')}
        </Link>

        <div className="sop-page-head">
          <p className="sop-eyebrow">{t(`sop.audience.${handbook.role}`)}</p>
          <h1 className="sop-title">{handbook.title}</h1>
          <div className="sop-badges">
            <span className="sop-badge sop-badge-english">{t('sop.englishBadge')}</span>
          </div>
        </div>

        <p><a className="sop-btn" href={`/sop/pdfs/handbooks/${role}.pdf`} download>{t("sop.downloadHandbook")}</a></p>
        <nav className="sop-toc" aria-label={t('sop.handbook.contents')}>
          <h2>{t('sop.handbook.contents')}</h2>
          <ol>
            {entries.map((entry, index) => (
              <li key={entry.guideId}>
                {entry.guide ? (
                  <a href={`#sop-handbook-guide-${entry.guideId}`}>{entry.guide.title}</a>
                ) : (
                  <span className="is-missing">
                    {index + 1}. {t('sop.handbook.guideNotPublished')}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>

        {entries.map((entry, index) => (
          <section
            key={entry.guideId}
            id={`sop-handbook-guide-${entry.guideId}`}
            className="sop-handbook-guide"
            aria-label={entry.guide ? entry.guide.title : entry.guideId}
          >
            {entry.guide ? (
              <article className="sop-guide-card">
                <div className="sop-badges" style={{ marginBlock: 0 }}>
                  <span className="sop-badge sop-badge-english">{t('sop.englishBadge')}</span>
                  <span className="sop-badge">{t('sop.guide.revision', { revision: entry.guide.revision })}</span>
                </div>
                <h3 className="sop-guide-card-title">
                  {index + 1}. {entry.guide.title}
                </h3>
                <p className="sop-guide-card-goal">{entry.guide.goal}</p>
                <div className="sop-guide-card-foot">
                  <span className="sop-area-tag">
                    {t('sop.guide.steps')}: {entry.guide.steps.length}
                  </span>
                  <Link className="sop-view-link" to={guideUrl(entry.guide)}>
                    {t('sop.handbook.openGuide')}
                  </Link>
                </div>
              </article>
            ) : (
              <div className="sop-missing-guide">
                <strong>{index + 1}.</strong> {t('sop.handbook.guideNotPublished')}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
