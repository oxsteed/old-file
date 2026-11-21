import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import './SeasonalPacks.css';

/**
 * Group 1, item 29: seasonal task packs. Each pack is a curated bundle of
 * the seeded planned-need templates for one season. Applying a pack creates
 * planned needs from the templates; needs the customer already has open are
 * skipped, so re-applying never duplicates work.
 */
export default function SeasonalPacks({ onApplied }) {
  const { t } = useTranslation();
  const [packs, setPacks] = useState([]);
  const [loadError, setLoadError] = useState(false);
  const [applying, setApplying] = useState(null);
  const [applied, setApplied] = useState({});

  const load = useCallback(() => {
    setLoadError(false);
    api.get('/planned-needs/seasonal-packs')
      .then((r) => setPacks(Array.isArray(r.data?.packs) ? r.data.packs : []))
      .catch(() => setLoadError(true));
  }, []);

  useEffect(load, [load]);

  async function applyPack(season) {
    setApplying(season);
    try {
      const { data } = await api.post(`/planned-needs/seasonal-packs/${season}/apply`);
      setApplied((prev) => ({
        ...prev,
        [season]: { created: data.created?.length ?? 0, skipped: data.skipped?.length ?? 0 },
      }));
      if (onApplied) onApplied();
    } catch {
      setApplied((prev) => ({ ...prev, [season]: { error: true } }));
    } finally {
      setApplying(null);
    }
  }

  if (loadError) return null;
  if (!packs.length) return null;

  return (
    <div className="pn-suggestions sp-wrap">
      <h3 className="pn-suggestions-title">{t('plannedNeeds.seasonalPacksTitle')}</h3>
      <p className="pn-muted-center sp-hint">
        {t('plannedNeeds.seasonalPacksHint')}
      </p>
      <div className="pn-cards">
        {packs.map((pack) => {
          const result = applied[pack.season];
          return (
            <div key={pack.season} className="pn-card sp-card">
              <h4 className="pn-card-title">{t(`plannedNeeds.season.${pack.season}`)}</h4>
              <ul className="sp-list">
                {pack.templates.map((tpl) => (
                  <li key={tpl.id}>{tpl.default_title}</li>
                ))}
              </ul>
              <button
                type="button"
                className="pn-btn"
                onClick={() => applyPack(pack.season)}
                disabled={applying === pack.season} data-track="ui.2e86129280.1"
              >
                {applying === pack.season
                  ? t('plannedNeeds.seasonalApplying')
                  : t('plannedNeeds.seasonalApply')}
              </button>
              {result && !result.error && (
                <p role="status" className="sp-status">
                  {t('plannedNeeds.seasonalApplied', { created: result.created, skipped: result.skipped })}
                </p>
              )}
              {result?.error && (
                <p role="alert" className="sp-status sp-error">
                  {t('plannedNeeds.seasonalApplyFailed')}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
