/**
 * SopLibraryPage.jsx - searchable, filterable index of all SOP guides.
 * Route: /how-it-works/guides
 *
 * The default audience filter follows the signed-in user's role as a
 * suggestion only; picking another audience never switches the user's
 * account mode. Every guide card carries an "English" badge because guide
 * content is English-only.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import PageMeta from '../../components/PageMeta';
import { useAuth } from '../../context/AuthContext';
import {
  AREAS,
  HANDBOOKS,
  getArea,
  guideUrl,
  handbookUrl,
  searchGuides,
} from '../guideRegistry.js';
import { AUDIENCES } from '../model.js';
import '../sop.css';

export function suggestAudienceForRole(role) {
  const normalized = String(role || '').toLowerCase();
  if (!normalized) return null;
  if (normalized === 'customer') return 'customer';
  if (['helper', 'helper_pro', 'broker'].includes(normalized)) return 'helper';
  if (normalized.includes('business')) return 'business';
  if (normalized.includes('restaurant')) return 'restaurant';
  if (normalized.includes('logistics')) return 'logistics';
  return null;
}

function GuideCard({ guide }) {
  const { t } = useTranslation();
  const area = getArea(guide.area);
  return (
    <Link className="sop-guide-card" to={guideUrl(guide)}>
      <div className="sop-badges" style={{ marginBlock: 0 }}>
        <span className="sop-badge sop-badge-english">{t('sop.englishBadge')}</span>
        <span
          className={`sop-badge ${
            guide.availability === 'conditional' ? 'sop-badge-conditional' : 'sop-badge-supported'
          }`}
        >
          {t(`sop.library.${guide.availability}`)}
        </span>
      </div>
      <h3 className="sop-guide-card-title">{guide.title}</h3>
      <p className="sop-guide-card-goal">{guide.goal}</p>
      <div className="sop-guide-card-foot">
        <span className="sop-area-tag">{area ? area.title : guide.area}</span>
        <span className="sop-view-link">{t('sop.library.viewGuide')}</span>
      </div>
    </Link>
  );
}

export default function SopLibraryPage() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const suggestedAudience = useMemo(() => suggestAudienceForRole(user?.role), [user?.role]);

  const [query, setQuery] = useState('');
  const [areaFilter, setAreaFilter] = useState('all');
  const [audienceFilter, setAudienceFilter] = useState('all');

  const results = useMemo(
    () =>
      searchGuides(query, {
        audience: audienceFilter === 'all' ? null : audienceFilter,
        area: areaFilter === 'all' ? null : areaFilter,
      }),
    [query, audienceFilter, areaFilter],
  );

  const filtersActive = query.trim() !== '' || areaFilter !== 'all' || audienceFilter !== 'all';

  const clearFilters = () => {
    setQuery('');
    setAreaFilter('all');
    setAudienceFilter('all');
  };

  return (
    <div className="sop-page">
      <PageMeta title={t('sop.library.title')} description={t('sop.library.subtitle')} />
      <div className="sop-container">
        <div className="sop-page-head">
          <p className="sop-eyebrow">{t('sop.library.title')}</p>
          <h1 className="sop-title">{t('sop.library.title')}</h1>
          <p className="sop-subtitle">{t('sop.library.subtitle')}</p>
        </div>

        <div className="sop-search-row">
          <div className="sop-search-field">
            <label className="sop-label" htmlFor="sop-search">
              {t('sop.library.searchLabel')}
            </label>
            <input
              id="sop-search"
              className="sop-input"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('sop.library.searchPlaceholder')}
            />
          </div>
          <div className="sop-filter-field">
            <label className="sop-label" htmlFor="sop-area-filter">
              {t('sop.library.areaLabel')}
            </label>
            <select
              id="sop-area-filter"
              className="sop-select"
              value={areaFilter}
              onChange={(event) => setAreaFilter(event.target.value)}
            >
              <option value="all">{t('sop.library.allAreas')}</option>
              {AREAS.map((area) => (
                <option key={area.slug} value={area.slug}>
                  {area.title}
                </option>
              ))}
            </select>
          </div>
          <div className="sop-filter-field">
            <label className="sop-label" htmlFor="sop-audience-filter">
              {t('sop.library.audienceLabel')}
            </label>
            <select
              id="sop-audience-filter"
              className="sop-select"
              value={audienceFilter}
              onChange={(event) => setAudienceFilter(event.target.value)}
            >
              <option value="all">{t('sop.library.allAudiences')}</option>
              {AUDIENCES.map((audience) => (
                <option key={audience} value={audience}>
                  {t(`sop.audience.${audience}`)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {suggestedAudience && audienceFilter === 'all' && (
          <div className="sop-suggestion-row">
            <span>{t('sop.library.suggestedForYou')}: {t(`sop.audience.${suggestedAudience}`)}</span>
            <button
              type="button"
              className="sop-btn"
              onClick={() => setAudienceFilter(suggestedAudience)}
            >
              {t('sop.library.useSuggestion')}
            </button>
          </div>
        )}

        {filtersActive && (
          <div className="sop-suggestion-row">
            <button type="button" className="sop-btn sop-btn-ghost" onClick={clearFilters}>
              {t('sop.library.clearFilters')}
            </button>
          </div>
        )}

        <p className="sop-result-meta" role="status">
          {t('sop.library.results', { count: results.length })}
        </p>

        {results.length === 0 ? (
          <div className="sop-empty">
            <p>{t('sop.library.noResults')}</p>
          </div>
        ) : (
          <div className="sop-guide-grid">
            {results.map((guide) => (
              <GuideCard key={guide.id} guide={guide} />
            ))}
          </div>
        )}

        <h2 className="sop-section-title">{t('sop.library.handbooksTitle')}</h2>
        <p className="sop-section-sub">{t('sop.library.handbooksSubtitle')}</p>
        <div className="sop-handbook-grid">
          {HANDBOOKS.map((handbook) => (
            <Link key={handbook.role} className="sop-handbook-card" to={handbookUrl(handbook.role)}>
              <h3>{handbook.title}</h3>
              <div className="sop-badges" style={{ marginBlock: 0 }}>
                <span className="sop-badge sop-badge-english">{t('sop.englishBadge')}</span>
                <span className="sop-badge">
                  {t('sop.library.guidesInHandbook', { count: handbook.guideIds.length })}
                </span>
              </div>
              <span className="sop-view-link">{t('sop.library.openHandbook')}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
