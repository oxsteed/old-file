import { useTranslation } from 'react-i18next';
import { MapPin } from 'lucide-react';
import { ALL_COUNTRIES } from '../lib/countries';
import './FranchiseApplicationDetail.css';

function formatArea(area) {
  const country = area.country ? ALL_COUNTRIES[area.country] || area.country : null;
  return [area.city, area.region, country].filter(Boolean).join(', ');
}

// Group 12 Slice 3b (607, D-294/D-308): the structured boundary summary —
// the explicit area list (country/region/city), included vs excluded, plus
// the agreement's exclusivity flag. Shared by the applicant dashboard and
// the territory ops page; the operator sees it read-only.
export default function FranchiseBoundarySummary({ areas = [], territoryExclusive = false, territorySummary = null }) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`dashboards.franchise.${key}`, options);
  const included = areas.filter((area) => area.area_type !== 'excluded');
  const excluded = areas.filter((area) => area.area_type === 'excluded');

  return (
    <section className="fr-detail-card">
      <div className="fr-detail-heading">
        <MapPin size={16} className="fr-detail-heading-icon" />
        <div>
          <h2 className="fr-detail-title">{copy('boundaryTitle')}</h2>
          <p className="fr-detail-subtitle">{copy('boundarySubtitle')}</p>
        </div>
      </div>

      <div>
        <span className={`fr-status-badge ${territoryExclusive ? 'fr-status-accepted' : ''}`}>
          {territoryExclusive ? copy('boundaryExclusive') : copy('boundaryNonExclusive')}
        </span>
      </div>

      {territorySummary && (
        <p className="fr-detail-empty">{territorySummary}</p>
      )}

      {areas.length === 0 ? (
        <p className="fr-detail-empty">{copy('boundaryEmpty')}</p>
      ) : (
        <div className="fr-doc-list">
          <div className="fr-doc-category">
            <div className="fr-detail-list-label">{copy('boundaryIncluded')}</div>
            {included.length === 0 ? (
              <p className="fr-detail-empty">{copy('boundaryNoneIncluded')}</p>
            ) : (
              <ul className="fr-doc-files">
                {included.map((area) => (
                  <li key={area.id} className="fr-doc-file">
                    <div className="fr-doc-file-name">{formatArea(area)}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="fr-doc-category">
            <div className="fr-detail-list-label">{copy('boundaryExcluded')}</div>
            {excluded.length === 0 ? (
              <p className="fr-detail-empty">{copy('boundaryNoneExcluded')}</p>
            ) : (
              <ul className="fr-doc-files">
                {excluded.map((area) => (
                  <li key={area.id} className="fr-doc-file">
                    <div className="fr-doc-file-name">{formatArea(area)}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
