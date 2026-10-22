import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Building2, Network, RefreshCw, Send, ShieldCheck, TrendingUp } from 'lucide-react';
import {
  attachBrandRestaurant,
  getBrandCompliance,
  getBrandOverview,
  getBrandStoreComparison,
  listRestaurantBrands,
  publishBrandMenu,
} from '../../api/food';
import { apiErrorMessage } from './foodShared';

function isoDate(daysFromToday = 0) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return date.toISOString().slice(0, 10);
}

function money(cents, currency = 'USD') {
  if (cents == null) return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

function percent(value) {
  return value == null ? '—' : `${Number(value).toFixed(1)}%`;
}

export default function BrandHQPanel({ t, restaurant }) {
  const [brands, setBrands] = useState([]);
  const [brandId, setBrandId] = useState('');
  const [overview, setOverview] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [compliance, setCompliance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [sourceRestaurantId, setSourceRestaurantId] = useState('');
  const [targetRestaurantIds, setTargetRestaurantIds] = useState([]);
  const [priceOverride, setPriceOverride] = useState('');
  const [availabilityOverride, setAvailabilityOverride] = useState('');
  const [attachRestaurantId, setAttachRestaurantId] = useState('');

  const load = useCallback(async (id) => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const params = { from: isoDate(-30), to: isoDate(1) };
      const [ov, comp, compl] = await Promise.all([
        getBrandOverview(id),
        getBrandStoreComparison(id, params),
        getBrandCompliance(id, params),
      ]);
      setOverview(ov);
      setComparison(comp);
      setCompliance(compl);
      const restaurants = ov?.restaurants || [];
      setSourceRestaurantId((current) => current || (restaurants[0] ? String(restaurants[0].id) : ''));
      setTargetRestaurantIds((current) => current.filter((rid) => restaurants.some((r) => String(r.id) === String(rid))));
    } catch (err) {
      setError(apiErrorMessage(err, t('restaurants.ops.brandHq.loadError')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await listRestaurantBrands();
        if (cancelled) return;
        setBrands(rows);
        const first = rows[0];
        if (first) {
          setBrandId(String(first.id));
          await load(String(first.id));
        } else {
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(apiErrorMessage(err, t('restaurants.ops.brandHq.loadError')));
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [load, t]);

  const selectBrand = (id) => {
    setBrandId(id);
    setSourceRestaurantId('');
    setTargetRestaurantIds([]);
    load(id);
  };

  const restaurants = useMemo(() => overview?.restaurants || [], [overview]);
  const toggleTarget = (id) => {
    const value = String(id);
    setTargetRestaurantIds((current) => (current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value]));
  };

  const publish = async () => {
    if (!brandId || !sourceRestaurantId || targetRestaurantIds.length === 0) return;
    setPublishing(true);
    try {
      const payload = {
        sourceRestaurantId: Number(sourceRestaurantId),
        targetRestaurantIds: targetRestaurantIds.map(Number),
        idempotencyKey: (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `brand-${Date.now()}`),
      };
      if (priceOverride.trim() !== '') payload.priceCents = Math.round(Number(priceOverride) * 100);
      if (availabilityOverride !== '') payload.isAvailable = availabilityOverride === 'true';
      const result = await publishBrandMenu(brandId, payload);
      toast.success(t('restaurants.ops.brandHq.publishSuccess'));
      if (result?.failed > 0) toast.error(t('restaurants.ops.brandHq.publishPartial', { count: result.failed }));
      await load(brandId);
    } catch (err) {
      toast.error(apiErrorMessage(err, t('restaurants.ops.brandHq.publishError')));
    } finally {
      setPublishing(false);
    }
  };

  const attach = async (event) => {
    event.preventDefault();
    if (!brandId || !attachRestaurantId.trim()) return;
    setAttaching(true);
    try {
      await attachBrandRestaurant(brandId, { restaurantId: Number(attachRestaurantId) });
      toast.success(t('restaurants.ops.brandHq.attachSuccess'));
      setAttachRestaurantId('');
      await load(brandId);
    } catch (err) {
      toast.error(apiErrorMessage(err, t('restaurants.ops.brandHq.attachError')));
    } finally {
      setAttaching(false);
    }
  };

  if (loading) return <div className="fd-empty" role="status">{t('restaurants.ops.brandHq.loading')}</div>;
  if (error) return <div className="fd-empty" role="alert">{error}</div>;
  if (!brands.length) return <div className="fd-empty">{t('restaurants.ops.brandHq.noBrands')}</div>;

  const ranked = comparison?.ranked || [];

  return (
    <div>
      <div className="fd-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 className="fd-ops-subhead">{t('restaurants.ops.brandHq.title')}</h3>
          <p className="fd-card-meta">{t('restaurants.ops.brandHq.subtitle')}</p>
        </div>
        <button type="button" className="fd-btn fd-btn-sm" onClick={() => load(brandId)} disabled={publishing} data-track="ui.eb078cc8b5.1">
          <RefreshCw size={14} /> {t('restaurants.ops.brandHq.refresh')}
        </button>
      </div>

      {brands.length > 1 && (
        <div className="fd-field" style={{ maxWidth: '24rem' }}>
          <label htmlFor="brand-hq-brand">{t('restaurants.ops.brandHq.selectBrand')}</label>
          <select id="brand-hq-brand" value={brandId} onChange={(event) => selectBrand(event.target.value)}>
            {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
          </select>
        </div>
      )}

      <div className="fd-settings-note" style={{ marginTop: '1rem' }}>
        <h4 className="fd-settings-subhead fd-settings-subhead--flush"><Network size={15} /> {t('restaurants.ops.brandHq.hierarchyTitle')}</h4>
        {(restaurants || []).map((entry) => (
          <div key={entry.id} style={{ marginTop: '0.75rem' }}>
            <strong>{entry.displayName}</strong>
            <p className="fd-card-meta">
              {t('restaurants.ops.brandHq.storesLabel', { count: entry.stores.length })}
              {entry.regions?.length > 0 && ` · ${t('restaurants.ops.brandHq.regionsLabel', { count: entry.regions.length })}`}
            </p>
            <ul className="fd-card-meta" style={{ margin: '0.25rem 0 0 1rem', padding: 0, listStyle: 'disc' }}>
              {entry.stores.map((store) => (
                <li key={store.id}>
                  {store.name}
                  {store.regionName ? ` (${store.regionName})` : ''}
                  {store.isPrimary ? ` · ${t('restaurants.ops.brandHq.primaryStore')}` : ''}
                  {' · '}{store.status}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="fd-settings-note" style={{ marginTop: '1rem' }}>
        <h4 className="fd-settings-subhead fd-settings-subhead--flush"><TrendingUp size={15} /> {t('restaurants.ops.brandHq.comparisonTitle')}</h4>
        <div style={{ overflowX: 'auto' }}>
          <table className="fd-table">
            <thead>
              <tr>
                <th scope="col">{t('restaurants.ops.brandHq.storeCol')}</th>
                <th scope="col">{t('restaurants.ops.brandHq.restaurantCol')}</th>
                <th scope="col">{t('restaurants.ops.brandHq.ordersCol')}</th>
                <th scope="col">{t('restaurants.ops.brandHq.salesCol')}</th>
                <th scope="col">{t('restaurants.ops.brandHq.auditCol')}</th>
                <th scope="col">{t('restaurants.ops.brandHq.trainingCol')}</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((store) => {
                const orders = (store.sales || []).reduce((sum, s) => sum + (s.orderCount || 0), 0);
                const sales = (store.sales || [])[0];
                return (
                  <tr key={`${store.restaurantId}-${store.id}`}>
                    <td><strong>{store.name}</strong></td>
                    <td>{store.restaurantName}</td>
                    <td>{orders}</td>
                    <td>{sales ? money(sales.netCollectedCents, sales.currencyCode) : '—'}</td>
                    <td>{percent(store.health?.latestAuditScorePercent)}</td>
                    <td>{percent(store.compliance?.trainingCompletionPercent)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="fd-settings-note" style={{ marginTop: '1rem' }}>
        <h4 className="fd-settings-subhead fd-settings-subhead--flush"><ShieldCheck size={15} /> {t('restaurants.ops.brandHq.complianceTitle')}</h4>
        <p className="fd-card-meta">
          {t('restaurants.ops.brandHq.checklistRuns', { count: compliance?.checklistRuns ?? 0 })} ·{' '}
          {t('restaurants.ops.brandHq.trainingAssignments', { count: compliance?.trainingAssignments ?? 0 })} ·{' '}
          {t('restaurants.ops.brandHq.overdueTraining', { count: compliance?.overdueTraining ?? 0 })} ·{' '}
          {t('restaurants.ops.brandHq.openFindings', { count: compliance?.openFindings ?? 0 })}
        </p>
        <p className="fd-card-meta">
          {t('restaurants.ops.brandHq.checklistPct')}: {percent(compliance?.checklistCompletionPercent)} ·{' '}
          {t('restaurants.ops.brandHq.trainingPct')}: {percent(compliance?.trainingCompletionPercent)} ·{' '}
          {t('restaurants.ops.brandHq.auditAvg')}: {percent(compliance?.averageAuditScorePercent)}
        </p>
      </div>

      <div className="fd-settings-note" style={{ marginTop: '1rem' }}>
        <h4 className="fd-settings-subhead fd-settings-subhead--flush"><Send size={15} /> {t('restaurants.ops.brandHq.publishTitle')}</h4>
        <p className="fd-card-meta">{t('restaurants.ops.brandHq.publishHint')}</p>
        <div className="fd-field">
          <label htmlFor="brand-hq-source">{t('restaurants.ops.brandHq.sourceRestaurant')}</label>
          <select id="brand-hq-source" value={sourceRestaurantId} onChange={(event) => { setSourceRestaurantId(event.target.value); setTargetRestaurantIds([]); }}>
            {restaurants.map((entry) => <option key={entry.id} value={entry.id}>{entry.displayName}</option>)}
          </select>
        </div>
        <fieldset className="fd-field">
          <legend>{t('restaurants.ops.brandHq.targetRestaurants')}</legend>
          {restaurants.filter((entry) => String(entry.id) !== String(sourceRestaurantId)).map((entry) => (
            <label key={entry.id} className="fd-checkbox-row">
              <input type="checkbox" checked={targetRestaurantIds.includes(String(entry.id))} onChange={() => toggleTarget(entry.id)} data-track="ui.eb078cc8b5.2" />
              <span>{entry.displayName} ({t('restaurants.ops.brandHq.storesLabel', { count: entry.stores.length })})</span>
            </label>
          ))}
        </fieldset>
        <div className="fd-row" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
          <div className="fd-field">
            <label htmlFor="brand-hq-price">{t('restaurants.ops.brandHq.priceOverride')}</label>
            <input id="brand-hq-price" inputMode="decimal" placeholder="19.99" value={priceOverride} onChange={(event) => setPriceOverride(event.target.value)} />
          </div>
          <div className="fd-field">
            <label htmlFor="brand-hq-avail">{t('restaurants.ops.brandHq.availabilityOverride')}</label>
            <select id="brand-hq-avail" value={availabilityOverride} onChange={(event) => setAvailabilityOverride(event.target.value)}>
              <option value="">{t('restaurants.ops.brandHq.availDefault')}</option>
              <option value="true">{t('restaurants.ops.brandHq.availOn')}</option>
              <option value="false">{t('restaurants.ops.brandHq.availOff')}</option>
            </select>
          </div>
        </div>
        <button type="button" className="fd-btn fd-btn-primary" onClick={publish} disabled={publishing || !sourceRestaurantId || targetRestaurantIds.length === 0} data-track="ui.eb078cc8b5.3">
          {publishing ? <RefreshCw size={14} className="fd-spin" /> : <Send size={14} />} {publishing ? t('restaurants.ops.brandHq.publishing') : t('restaurants.ops.brandHq.publish')}
        </button>
        <p className="fd-card-meta">{t('restaurants.ops.brandHq.idempotencyNote')}</p>
      </div>

      <div className="fd-settings-note" style={{ marginTop: '1rem' }}>
        <h4 className="fd-settings-subhead fd-settings-subhead--flush"><Building2 size={15} /> {t('restaurants.ops.brandHq.attachTitle')}</h4>
        <p className="fd-card-meta">{t('restaurants.ops.brandHq.attachHint')}</p>
        <form onSubmit={attach} className="fd-row" style={{ alignItems: 'end', gap: '0.75rem', flexWrap: 'wrap' }} data-track="ui.eb078cc8b5.4">
          <div className="fd-field">
            <label htmlFor="brand-hq-attach">{t('restaurants.ops.brandHq.restaurantIdLabel')}</label>
            <input id="brand-hq-attach" inputMode="numeric" value={attachRestaurantId} onChange={(event) => setAttachRestaurantId(event.target.value)} required />
          </div>
          <button type="submit" className="fd-btn fd-btn-sm" disabled={attaching} data-track="ui.eb078cc8b5.5">
            {attaching ? <RefreshCw size={14} className="fd-spin" /> : <Building2 size={14} />} {t('restaurants.ops.brandHq.attach')}
          </button>
        </form>
      </div>
    </div>
  );
}
