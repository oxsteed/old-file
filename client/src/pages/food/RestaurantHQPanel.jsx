import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Building2, CheckCircle2, RefreshCw, Send } from 'lucide-react';
import { getRestaurantHQRollup, listFoodLocations, publishRestaurantHQMenu } from '../../api/food';
import { apiErrorMessage } from './foodShared';

function isoDate(daysFromToday = 0) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return date.toISOString().slice(0, 10);
}

function percent(value) {
  return value == null ? '—' : `${Number(value).toFixed(1)}%`;
}

export default function RestaurantHQPanel({ t, restaurant, bare = false }) {
  const [locations, setLocations] = useState([]);
  const [rollup, setRollup] = useState(null);
  const [sourceId, setSourceId] = useState('');
  const [targetIds, setTargetIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [storeRows, report] = await Promise.all([
        listFoodLocations(restaurant.id),
        getRestaurantHQRollup(restaurant.id, { from: isoDate(-30), to: isoDate(1) }),
      ]);
      const stores = Array.isArray(storeRows) ? storeRows : [];
      setLocations(stores);
      const primary = stores.find((store) => store.is_primary) || stores[0];
      setSourceId((current) => current || (primary ? String(primary.id) : ''));
      setTargetIds((current) => current.filter((id) => stores.some((store) => String(store.id) === String(id))));
      setRollup(report);
    } catch (err) {
      setError(apiErrorMessage(err, t('restaurants.ops.hq.loadError')));
    } finally {
      setLoading(false);
    }
  }, [restaurant.id, t]);

  useEffect(() => { load(); }, [load]);

  const targetOptions = useMemo(() => locations.filter((store) => String(store.id) !== String(sourceId)), [locations, sourceId]);
  const storesById = useMemo(() => new Map((rollup?.stores || []).map((store) => [String(store.id), store])), [rollup]);

  const toggleTarget = (id) => {
    const value = String(id);
    setTargetIds((current) => (current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value]));
  };

  const publish = async () => {
    if (!sourceId || targetIds.length === 0) return;
    setPublishing(true);
    try {
      await publishRestaurantHQMenu(restaurant.id, { sourceLocationId: Number(sourceId), targetLocationIds: targetIds.map(Number) });
      toast.success(t('restaurants.ops.hq.publishSuccess'));
      await load();
    } catch (err) {
      toast.error(apiErrorMessage(err, t('restaurants.ops.hq.publishError')));
    } finally {
      setPublishing(false);
    }
  };

  if (loading) return <div className="fd-empty" role="status">{t('restaurants.ops.hq.loading')}</div>;
  if (error) return <div className="fd-empty" role="alert">{error}</div>;
  if (locations.length < 2) {
    return <div className="fd-empty">{t('restaurants.ops.hq.singleStore')}</div>;
  }

  return (
    <div className={bare ? '' : 'fd-section'}>
      <div className="fd-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 className="fd-ops-subhead">{t('restaurants.ops.hq.title')}</h3>
          <p className="fd-card-meta">{t('restaurants.ops.hq.subtitle')}</p>
        </div>
        <button type="button" className="fd-btn fd-btn-sm" onClick={load} disabled={publishing} data-track="ui.17b0c32a57.55">
          <RefreshCw size={14} /> {t('restaurants.ops.hq.refresh')}
        </button>
      </div>

      <div className="fd-ops-checklists-grid">
        {(rollup?.stores || []).map((store) => (
          <div className="fd-ops-checklist-card" key={store.id}>
            <div className="fd-ops-checklist-top">
              <strong>{store.name}</strong>
              <span className="fd-tag">{store.status}</span>
            </div>
            <p className="fd-card-meta">{t('restaurants.ops.hq.auditScore')}: {percent(store.health?.latestAuditScorePercent)} · {t('restaurants.ops.hq.openFindings')}: {store.health?.openFindings ?? 0}</p>
            <p className="fd-card-meta">{t('restaurants.ops.hq.checklists')}: {percent(store.compliance?.checklistCompletionPercent)} · {t('restaurants.ops.hq.training')}: {percent(store.compliance?.trainingCompletionPercent)}</p>
          </div>
        ))}
      </div>

      <div className="fd-settings-note" style={{ marginTop: '1rem' }}>
        <h4 className="fd-settings-subhead fd-settings-subhead--flush"><Building2 size={15} /> {t('restaurants.ops.hq.publishTitle')}</h4>
        <p className="fd-card-meta">{t('restaurants.ops.hq.publishHint')}</p>
        <div className="fd-field">
          <label htmlFor="restaurant-hq-source">{t('restaurants.ops.hq.sourceStore')}</label>
          <select id="restaurant-hq-source" value={sourceId} onChange={(event) => { setSourceId(event.target.value); setTargetIds([]); }}>
            {locations.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
          </select>
        </div>
        <fieldset className="fd-field">
          <legend>{t('restaurants.ops.hq.targetStores')}</legend>
          {targetOptions.map((store) => (
            <label key={store.id} className="fd-checkbox-row">
              <input type="checkbox" checked={targetIds.includes(String(store.id))} onChange={() => toggleTarget(store.id)} data-track="ui.17b0c32a57.56" />
              <span>{store.name}</span>
              {storesById.get(String(store.id))?.compliance?.overdueTraining > 0 && <small>{t('restaurants.ops.hq.overdueTraining')}</small>}
            </label>
          ))}
        </fieldset>
        <button type="button" className="fd-btn fd-btn-primary" onClick={publish} disabled={publishing || !sourceId || targetIds.length === 0} data-track="ui.17b0c32a57.57">
          {publishing ? <RefreshCw size={14} className="fd-spin" /> : <Send size={14} />} {publishing ? t('restaurants.ops.hq.publishing') : t('restaurants.ops.hq.publish')}
        </button>
        <p className="fd-card-meta"><CheckCircle2 size={13} /> {t('restaurants.ops.hq.publishScope')}</p>
      </div>
    </div>
  );
}
