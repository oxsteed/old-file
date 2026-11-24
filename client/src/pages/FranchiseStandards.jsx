import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen } from 'lucide-react';
import api from '../api/axios';
import './FranchiseApplicationDetail.css';

// Group 12 Slice 3e (621, D-321): the franchise standards library —
// franchise-scoped views over the Learn guides catalog. Operators
// browse the standards for their territory (franchise-wide rows plus
// their territory's own); HQ curates Learn guides into the library
// and removes them. Version acknowledgment (622) plugs into this same
// component.
export default function FranchiseStandards({
  standards = [],
  canCurate = false,
  canRemove = false,
  onCurate = null,
  onRemove = null,
  disabled = false,
}) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`dashboards.franchise.${key}`, options);
  const [guideId, setGuideId] = useState('');
  const [scope, setScope] = useState('territory');
  const [guides, setGuides] = useState(null);
  const [formError, setFormError] = useState('');

  // HQ curates from the published Learn guide catalog; the picker lists
  // the guides not already curated for the picked scope. When the
  // catalog cannot be loaded the form falls back to a typed guide id.
  useEffect(() => {
    if (!canCurate) return undefined;
    let cancelled = false;
    api.get('/learn/guides')
      .then((res) => {
        if (!cancelled) setGuides(Array.isArray(res.data?.guides) ? res.data.guides : []);
      })
      .catch(() => { if (!cancelled) setGuides([]); });
    return () => { cancelled = true; };
  }, [canCurate]);

  const curatedForScope = new Set(
    standards.filter((standard) => standard.scope === scope).map((standard) => standard.guide_id),
  );
  const availableGuides = (guides || []).filter((guide) => !curatedForScope.has(guide.id));

  async function submit(event) {
    event.preventDefault();
    if (!onCurate || !guideId.trim()) return;
    setFormError('');
    try {
      await onCurate({ guide_id: guideId.trim(), scope });
      setGuideId('');
    } catch (err) {
      setFormError(err?.response?.data?.error || copy('standardsCurateFailed'));
    }
  }

  return (
    <section className="fr-detail-card">
      <div className="fr-detail-heading">
        <BookOpen size={16} className="fr-detail-heading-icon" />
        <div>
          <h2 className="fr-detail-title">{copy('standardsTitle')}</h2>
          <p className="fr-detail-subtitle">{copy('standardsSubtitle')}</p>
        </div>
      </div>

      {canCurate && onCurate && (
        <form onSubmit={submit} className="fr-doc-list">
          <div>
            <label className="fr-detail-list-label" htmlFor="fr-standard-guide">{copy('standardsCurateGuideLabel')}</label>
            {guides === null ? (
              <input
                id="fr-standard-guide"
                type="text"
                required
                className="fr-followup-input"
                value={guideId}
                disabled={disabled}
                onChange={(event) => setGuideId(event.target.value)}
                placeholder={copy('standardsGuidePlaceholder')}
              />
            ) : (
              <select
                id="fr-standard-guide"
                required
                className="fr-followup-input"
                value={guideId}
                disabled={disabled}
                onChange={(event) => setGuideId(event.target.value)}
              >
                <option value="">{copy('standardsGuidePlaceholder')}</option>
                {availableGuides.map((guide) => (
                  <option key={guide.id} value={guide.id}>
                    {guide.title}
                    {guide.category ? ` (${guide.category})` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="fr-detail-list-label" htmlFor="fr-standard-scope">{copy('standardsCurateScopeLabel')}</label>
            <select
              id="fr-standard-scope"
              className="fr-followup-input"
              value={scope}
              disabled={disabled}
              onChange={(event) => { setScope(event.target.value); setGuideId(''); }}
            >
              <option value="territory">{copy('standardsCurateScopeTerritory')}</option>
              <option value="franchise">{copy('standardsCurateScopeFranchise')}</option>
            </select>
          </div>
          {formError && <p className="fr-detail-empty">{formError}</p>}
          <div>
            <button type="submit" className="fr-btn-primary" disabled={disabled || !guideId.trim()}>
              {copy('standardsCurateSubmit')}
            </button>
          </div>
        </form>
      )}

      {standards.length === 0 ? (
        <p className="fr-detail-empty">{copy('standardsEmpty')}</p>
      ) : (
        <ul className="fr-doc-files">
          {standards.map((standard) => (
            <li key={standard.id} className="fr-doc-file">
              <div>
                <div className="fr-doc-file-name">
                  {standard.guide_title || copy('standardsGuideUnknown', { guideId: standard.guide_id })}
                </div>
                <div className="fr-doc-file-meta">
                  {standard.guide_category || standard.guide_id}
                  {standard.guide_minutes ? ` · ${copy('standardsMinutes', { count: standard.guide_minutes })}` : ''}
                  {' · '}
                  {copy('standardsVersion', { version: standard.version })}
                </div>
              </div>
              <span className="fr-status-badge fr-status-pending">
                {standard.scope === 'franchise' ? copy('standardsScopeFranchise') : copy('standardsScopeTerritory')}
              </span>
              {canRemove && onRemove && (
                <button
                  type="button"
                  className="fr-btn-primary"
                  disabled={disabled}
                  onClick={() => onRemove(standard)}
                >
                  {copy('standardsRemove')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
