import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutGrid } from 'lucide-react';
import './FranchiseApplicationDetail.css';

function areaLabel(area) {
  if (!area) return '—';
  if (area.area_type === 'unassigned') return null;
  return [area.city, area.region, area.country].filter(Boolean).join(', ') || '—';
}

// Group 12 Slice 3h (637, D-337): the territory capacity view — a
// structured per-area capacity view, not a geographic map (D-294). For
// each boundary area: the HQ-set target, open and planned locations,
// candidates by status, staffing load, and open-exception load, with
// utilization as (open + approved candidates) / target. HQ sets the
// target per area; the target never gates launches.
export default function FranchiseTerritoryCapacity({
  capacity = null,
  canSetTarget = false,
  onSetTarget = null,
  busy = false,
}) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`dashboards.franchise.${key}`, options);
  const [targetForm, setTargetForm] = useState({ area_id: '', target_locations: '' });
  const [formError, setFormError] = useState('');

  const areas = capacity?.areas || [];
  const totals = capacity?.totals || {};
  const includedAreas = areas.filter((area) => area.area_type !== 'unassigned');
  const unassigned = areas.find((area) => area.area_type === 'unassigned');

  async function submitTarget(event) {
    event.preventDefault();
    if (!onSetTarget || !targetForm.area_id || !targetForm.target_locations) return;
    setFormError('');
    try {
      await onSetTarget(targetForm.area_id, Number(targetForm.target_locations));
      setTargetForm({ area_id: '', target_locations: '' });
    } catch (err) {
      setFormError(err?.response?.data?.error || copy('capacityTargetFailed'));
    }
  }

  return (
    <section className="fr-detail-card">
      <div className="fr-detail-heading">
        <LayoutGrid size={16} className="fr-detail-heading-icon" />
        <div>
          <h2 className="fr-detail-title">{copy('capacityTitle')}</h2>
          <p className="fr-detail-subtitle">{copy('capacitySubtitle')}</p>
        </div>
      </div>

      {!capacity || areas.length === 0 ? (
        <p className="fr-detail-empty">{copy('capacityEmpty')}</p>
      ) : (
        <>
          <p className="fr-doc-file-meta">
            {copy('capacityOpen', { count: totals.open_locations ?? 0 })}
            {' · '}
            {copy('capacityPlanned', { count: totals.planned_locations ?? 0 })}
            {' · '}
            {copy('capacityCandidates', { count: totals.candidates?.total ?? 0 })}
            {' · '}
            {copy('capacityTeam', { count: totals.team_members ?? 0 })}
            {' · '}
            {copy('capacityExceptions', { count: totals.open_exceptions ?? 0 })}
            {' · '}
            {totals.target_locations
              ? copy('capacityUtilization', { pct: totals.utilization_pct ?? 0 })
              : copy('capacityNoTarget')}
          </p>
          <ul className="fr-doc-files">
            {includedAreas.map((area) => (
              <li key={area.area_id} className="fr-doc-file">
                <div>
                  <div className="fr-doc-file-name">{areaLabel(area)}</div>
                  <div className="fr-doc-file-meta">
                    {area.area_type === 'excluded' ? copy('capacityExcluded') : copy('capacityTarget', { count: area.target_locations ?? 0 })}
                    {' · '}
                    {copy('capacityOpen', { count: area.open_locations ?? 0 })}
                    {' · '}
                    {copy('capacityPlanned', { count: area.planned_locations ?? 0 })}
                    {' · '}
                    {copy('capacityCandidates', { count: area.candidates?.total ?? 0 })}
                    {' · '}
                    {copy('capacityTeam', { count: area.team_members ?? 0 })}
                    {' · '}
                    {copy('capacityExceptions', { count: area.open_exceptions ?? 0 })}
                  </div>
                  <div className="fr-doc-file-meta">
                    {copy('capacityCandidatesScouting', { count: area.candidates?.scouting ?? 0 })}
                    {' · '}
                    {copy('capacityCandidatesShortlisted', { count: area.candidates?.shortlisted ?? 0 })}
                    {' · '}
                    {copy('capacityCandidatesApproved', { count: area.candidates?.approved ?? 0 })}
                    {' · '}
                    {copy('capacityCandidatesRejected', { count: area.candidates?.rejected ?? 0 })}
                    {' · '}
                    {area.target_locations
                      ? copy('capacityUtilization', { pct: area.utilization_pct ?? 0 })
                      : copy('capacityNoTarget')}
                  </div>
                </div>
                <span className="fr-status-badge fr-status-pending">
                  {area.area_type === 'excluded' ? copy('capacityExcluded') : copy('capacityArea')}
                </span>
              </li>
            ))}
            {unassigned && (unassigned.planned_locations > 0 || unassigned.open_locations > 0 || unassigned.candidates?.total > 0) && (
              <li key="unassigned" className="fr-doc-file">
                <div>
                  <div className="fr-doc-file-name">{copy('capacityUnassigned')}</div>
                  <div className="fr-doc-file-meta">
                    {copy('capacityOpen', { count: unassigned.open_locations ?? 0 })}
                    {' · '}
                    {copy('capacityPlanned', { count: unassigned.planned_locations ?? 0 })}
                    {' · '}
                    {copy('capacityCandidates', { count: unassigned.candidates?.total ?? 0 })}
                    {' · '}
                    {copy('capacityTeam', { count: unassigned.team_members ?? 0 })}
                    {' · '}
                    {copy('capacityExceptions', { count: unassigned.open_exceptions ?? 0 })}
                  </div>
                </div>
                <span className="fr-status-badge fr-status-pending">{copy('capacityArea')}</span>
              </li>
            )}
          </ul>
        </>
      )}

      {canSetTarget && onSetTarget && includedAreas.length > 0 && (
        <form onSubmit={submitTarget} className="fr-doc-list" data-track="ui.f50122c77e.1">
          <div>
            <label className="fr-detail-list-label" htmlFor="capacity-target-area">
              {copy('capacityArea')}
            </label>
            <select
              id="capacity-target-area"
              className="fr-followup-input"
              value={targetForm.area_id}
              onChange={(event) => setTargetForm((v) => ({ ...v, area_id: event.target.value }))}
            >
              <option value="">{copy('capacityTargetChooseArea')}</option>
              {includedAreas.map((area) => (
                <option key={area.area_id} value={area.area_id}>{areaLabel(area)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="fr-detail-list-label" htmlFor="capacity-target-count">
              {copy('capacityTargetLabel')}
            </label>
            <input
              id="capacity-target-count"
              className="fr-followup-input"
              type="number"
              min={1}
              max={1000}
              value={targetForm.target_locations}
              onChange={(event) => setTargetForm((v) => ({ ...v, target_locations: event.target.value }))}
            />
          </div>
          <div>
            <button type="submit" className="fr-btn-primary" disabled={busy || !targetForm.area_id || !targetForm.target_locations} data-track="ui.f50122c77e.2">
              {copy('capacitySetTarget')}
            </button>
          </div>
          {formError && <p className="fr-detail-error">{formError}</p>}
        </form>
      )}
    </section>
  );
}
