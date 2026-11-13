import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Building2, Coins, FileText, Layers, Network, RefreshCw, Send, ShieldCheck, TrendingUp, Wallet } from 'lucide-react';
import {
  attachBrandRestaurant,
  getBrandCompliance,
  getBrandOverview,
  getBrandStoreComparison,
  listRestaurantBrands,
  publishBrandMenu,
  getBrandFxPolicy,
  updateBrandFxPolicy,
  listBrandFxRates,
  createBrandFxRate,
  listBrandPayRuns,
  listPayRunConsolidations,
  createPayRunConsolidation,
  finalizePayRunConsolidation,
  approvePayRunConsolidation,
  voidPayRunConsolidation,
  approveVoidPayRunConsolidation,
  listMenuRollouts,
  createMenuRollout,
  advanceMenuRollout,
  cancelMenuRollout,
  getBrandFranchiseReport,
  listBrandFranchiseMappings,
  assignBrandFranchiseMapping,
  removeBrandFranchiseMapping,
} from '../../api/food';
import { apiErrorMessage } from './foodShared';
import { moneyMinor } from '../../lib/moneyExact';

function isoDate(daysFromToday = 0) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return date.toISOString().slice(0, 10);
}

function percent(value) {
  return value == null ? '—' : `${Number(value).toFixed(1)}%`;
}

export default function BrandHQPanel({ t, restaurant }) {
  const { i18n } = useTranslation();
  // Finding 20: money renders in the currency's own precision via
  // the shared helper (JPY has no decimals, BHD has three), never
  // cents / 100. A missing currency renders as an em dash, never as
  // invented USD.
  const money = (cents, currency) => {
    if (cents == null || !currency) return '—';
    return moneyMinor(cents, currency, i18n.language);
  };
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
  // Phase 8: brand FX, staged rollouts, consolidated pay runs,
  // franchise reporting.
  const [fxPolicy, setFxPolicy] = useState(null);
  const [fxRates, setFxRates] = useState([]);
  const [fxForm, setFxForm] = useState({ reportingCurrency: '', rateSource: 'stored', rateDateMode: 'period_end', rateDate: '' });
  const [rateForm, setRateForm] = useState({ baseCurrency: '', quoteCurrency: '', rate: '', rateDate: '' });
  const [rollouts, setRollouts] = useState([]);
  const [pilotRestaurantIds, setPilotRestaurantIds] = useState([]);
  const [rolloutTargets, setRolloutTargets] = useState([]);
  const [brandPayRuns, setBrandPayRuns] = useState([]);
  const [consolidations, setConsolidations] = useState([]);
  const [selectedRunIds, setSelectedRunIds] = useState([]);
  const [franchiseReport, setFranchiseReport] = useState(null);
  const [franchiseError, setFranchiseError] = useState('');
  // Item 44: explicit store-to-agreement mappings + the operator's
  // per-store selection before assigning.
  const [franchiseMappings, setFranchiseMappings] = useState(null);
  const [mappingSelection, setMappingSelection] = useState({});

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
      // Phase 8 sections load independently: a 403 or empty result
      // hides one section without breaking the rest of the console.
      try {
        const policy = await getBrandFxPolicy(id);
        setFxPolicy(policy);
        setFxForm({
          reportingCurrency: policy?.reportingCurrency || '',
          rateSource: policy?.rateSource || 'stored',
          rateDateMode: policy?.rateDateMode || 'period_end',
          rateDate: policy?.rateDate || '',
        });
        setFxRates(await listBrandFxRates(id, { limit: 20 }));
      } catch { setFxPolicy(null); setFxRates([]); }
      try { setRollouts(await listMenuRollouts(id)); } catch { setRollouts([]); }
      try { setBrandPayRuns(await listBrandPayRuns(id, { from: params.from, to: params.to, limit: 100 })); } catch { setBrandPayRuns([]); }
      try { setConsolidations(await listPayRunConsolidations(id)); } catch { setConsolidations([]); }
      try {
        setFranchiseError('');
        setFranchiseReport(await getBrandFranchiseReport(id, params));
      } catch (err) {
        setFranchiseReport(null);
        setFranchiseError(apiErrorMessage(err, t('restaurants.ops.brandHq.franchise.loadError')));
      }
      try {
        setFranchiseMappings(await listBrandFranchiseMappings(id));
      } catch { setFranchiseMappings(null); }
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

  // ── Phase 8 handlers ──────────────────────────────────────────
  const saveBrandFxPolicy = async (event) => {
    event.preventDefault();
    setPublishing(true);
    try {
      const saved = await updateBrandFxPolicy(brandId, {
        reportingCurrency: fxForm.reportingCurrency.trim().toUpperCase() || undefined,
        rateSource: fxForm.rateSource,
        rateDateMode: fxForm.rateDateMode,
        rateDate: fxForm.rateDateMode === 'rate_date' ? fxForm.rateDate || undefined : undefined,
      });
      setFxPolicy(saved);
      toast.success(t('restaurants.ops.brandHq.fx.policySaved'));
      await load(brandId);
    } catch (err) {
      toast.error(apiErrorMessage(err, t('restaurants.ops.brandHq.fx.policyError')));
    } finally {
      setPublishing(false);
    }
  };

  const saveBrandFxRate = async (event) => {
    event.preventDefault();
    if (!rateForm.baseCurrency.trim() || !rateForm.quoteCurrency.trim() || !rateForm.rate || !rateForm.rateDate) return;
    setPublishing(true);
    try {
      await createBrandFxRate(brandId, {
        baseCurrency: rateForm.baseCurrency.trim().toUpperCase(),
        quoteCurrency: rateForm.quoteCurrency.trim().toUpperCase(),
        rate: Number(rateForm.rate),
        rateDate: rateForm.rateDate,
      });
      setRateForm({ baseCurrency: '', quoteCurrency: '', rate: '', rateDate: '' });
      toast.success(t('restaurants.ops.brandHq.fx.rateSaved'));
      await load(brandId);
    } catch (err) {
      toast.error(apiErrorMessage(err, t('restaurants.ops.brandHq.fx.rateError')));
    } finally {
      setPublishing(false);
    }
  };

  const toggleRolloutPilot = (id) => {
    const value = String(id);
    setPilotRestaurantIds((current) => (current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value]));
    setRolloutTargets((current) => (current.includes(value) ? current : [...current, value]));
  };

  const toggleRolloutTarget = (id) => {
    const value = String(id);
    setRolloutTargets((current) => (current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value]));
    setPilotRestaurantIds((current) => current.filter((entry) => entry !== value));
  };

  const createRollout = async () => {
    if (!brandId || !sourceRestaurantId || pilotRestaurantIds.length === 0 || rolloutTargets.length === 0) return;
    setPublishing(true);
    try {
      await createMenuRollout(brandId, {
        sourceRestaurantId: Number(sourceRestaurantId),
        pilotRestaurantIds: pilotRestaurantIds.map(Number),
        targetRestaurantIds: rolloutTargets.map(Number),
        idempotencyKey: (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `rollout-${Date.now()}`),
      });
      toast.success(t('restaurants.ops.brandHq.rollouts.created'));
      setPilotRestaurantIds([]);
      setRolloutTargets([]);
      await load(brandId);
    } catch (err) {
      toast.error(apiErrorMessage(err, t('restaurants.ops.brandHq.rollouts.createError')));
    } finally {
      setPublishing(false);
    }
  };

  const advanceRollout = async (rolloutId) => {
    setPublishing(true);
    try {
      await advanceMenuRollout(brandId, rolloutId);
      toast.success(t('restaurants.ops.brandHq.rollouts.advanced'));
      await load(brandId);
    } catch (err) {
      toast.error(apiErrorMessage(err, t('restaurants.ops.brandHq.rollouts.advanceError')));
    } finally {
      setPublishing(false);
    }
  };

  const cancelRollout = async (rolloutId) => {
    setPublishing(true);
    try {
      await cancelMenuRollout(brandId, rolloutId);
      toast.success(t('restaurants.ops.brandHq.rollouts.cancelled'));
      await load(brandId);
    } catch (err) {
      toast.error(apiErrorMessage(err, t('restaurants.ops.brandHq.rollouts.cancelError')));
    } finally {
      setPublishing(false);
    }
  };

  const toggleRun = (id) => {
    const value = Number(id);
    setSelectedRunIds((current) => (current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value]));
  };

  const createConsolidation = async () => {
    const members = brandPayRuns.filter((run) => selectedRunIds.includes(Number(run.payRunId)));
    if (members.length < 2) return;
    setPublishing(true);
    try {
      await createPayRunConsolidation(brandId, {
        anchorRestaurantId: Number(members[0].restaurantId),
        periodFrom: members[0].periodFrom,
        periodTo: members[0].periodTo,
        payRunIds: members.map((run) => Number(run.payRunId)),
      });
      toast.success(t('restaurants.ops.brandHq.consolidations.created'));
      setSelectedRunIds([]);
      await load(brandId);
    } catch (err) {
      toast.error(apiErrorMessage(err, t('restaurants.ops.brandHq.consolidations.createError')));
    } finally {
      setPublishing(false);
    }
  };

  const consolidationAction = async (consolidationId, action) => {
    setPublishing(true);
    try {
      // Money-flows R8: voiding a finalized/approved consolidation is
      // two-step. The maker step answers 202 with the group still
      // finalized/approved and voidPending true, so the toast must say
      // "requested", not "voided", until the checker step completes it.
      if (action === 'void') {
        const updated = await voidPayRunConsolidation(brandId, consolidationId);
        toast.success(t(updated?.voidPending
          ? 'restaurants.ops.brandHq.consolidations.voidRequested'
          : 'restaurants.ops.brandHq.consolidations.voided'));
      } else {
        if (action === 'finalize') await finalizePayRunConsolidation(brandId, consolidationId);
        if (action === 'approve') await approvePayRunConsolidation(brandId, consolidationId);
        if (action === 'voidApprove') await approveVoidPayRunConsolidation(brandId, consolidationId);
        toast.success(t(`restaurants.ops.brandHq.consolidations.${action}d`));
      }
      await load(brandId);
    } catch (err) {
      toast.error(apiErrorMessage(err, t('restaurants.ops.brandHq.consolidations.actionError')));
    } finally {
      setPublishing(false);
    }
  };

  const finalizedRuns = brandPayRuns.filter((run) => run.status === 'finalized');
  const openRollout = rollouts.find((rollout) => rollout.status !== 'cancelled' && rollout.stage !== 'rolled_out');

  // ── Item 44: assign / change / remove a store's agreement ──────
  const agreementLabel = (agreement) => {
    const territory = [agreement.territoryCity, agreement.territoryRegion].filter(Boolean).join(', ');
    const terms = t('restaurants.ops.brandHq.franchise.royaltyBps', { bps: agreement.royaltyBps });
    return territory ? `${territory} · ${terms}` : terms;
  };

  const assignMapping = async (locationId) => {
    const agreementId = mappingSelection[locationId];
    if (!brandId || !agreementId) return;
    setPublishing(true);
    try {
      await assignBrandFranchiseMapping(brandId, { locationId: Number(locationId), agreementId });
      toast.success(t('restaurants.ops.brandHq.franchise.mappings.assigned'));
      await load(brandId);
    } catch (err) {
      toast.error(apiErrorMessage(err, t('restaurants.ops.brandHq.franchise.mappings.assignError')));
    } finally {
      setPublishing(false);
    }
  };

  const removeMapping = async (locationId) => {
    if (!brandId) return;
    setPublishing(true);
    try {
      await removeBrandFranchiseMapping(brandId, locationId);
      toast.success(t('restaurants.ops.brandHq.franchise.mappings.removed'));
      await load(brandId);
    } catch (err) {
      toast.error(apiErrorMessage(err, t('restaurants.ops.brandHq.franchise.mappings.removeError')));
    } finally {
      setPublishing(false);
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
            <ul className="fd-card-meta fd-list-disc-sm">
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
        {comparison?.converted && (
          <div className="fd-stack-sm">
            <p className="fd-card-meta">
              {t('restaurants.ops.brandHq.fx.reportingCurrency', { currency: comparison.converted.reportingCurrency })}
              {comparison.converted.rateDate ? ` · ${t('restaurants.ops.brandHq.fx.rateDate', { date: comparison.converted.rateDate })}` : ''}
              {comparison.converted.isDefaultPolicy ? ` · ${t('restaurants.ops.brandHq.fx.defaultPolicy')}` : ''}
            </p>
            {comparison.converted.convertedTotalCents == null ? (
              <p role="alert">{t('restaurants.ops.brandHq.fx.missingRate', { currencies: (comparison.converted.missingCurrencies || []).join(', ') })}</p>
            ) : (
              <p><strong>{money(comparison.converted.convertedTotalCents, comparison.converted.reportingCurrency)}</strong> {t('restaurants.ops.brandHq.fx.convertedTotal')}</p>
            )}
            {comparison.converted.stale && comparison.converted.stalestRateDate && (
              <p role="alert">{t('restaurants.ops.brandHq.fx.staleRate', { date: comparison.converted.stalestRateDate, days: comparison.converted.maxRateAgeDays })}</p>
            )}
            <ul className="fd-card-meta fd-list-disc-sm">
              {(comparison.converted.lines || []).map((line) => (
                <li key={line.currencyCode}>
                  {money(line.amountCents, line.currencyCode)}
                  {line.convertedCents != null
                    ? ` → ${money(line.convertedCents, comparison.converted.reportingCurrency)} (${t('restaurants.ops.brandHq.fx.rate', { rate: line.rate, date: line.rateDate })})`
                    : ` · ${t('restaurants.ops.brandHq.fx.noRate')}`}
                </li>
              ))}
            </ul>
          </div>
        )}
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

      <div className="fd-settings-note fd-stack">
        <h4 className="fd-settings-subhead fd-settings-subhead--flush"><Coins size={15} /> {t('restaurants.ops.brandHq.fx.title')}</h4>
        <p className="fd-card-meta">{t('restaurants.ops.brandHq.fx.hint')}</p>
        <form onSubmit={saveBrandFxPolicy} className="fd-row fd-form-row-end" data-track="ui.eb078cc8b5.6">
          <div className="fd-field">
            <label htmlFor="brand-hq-fx-currency">{t('restaurants.ops.brandHq.fx.reportingCurrencyLabel')}</label>
            <input id="brand-hq-fx-currency" value={fxForm.reportingCurrency} placeholder={fxPolicy?.reportingCurrency || 'USD'} onChange={(event) => setFxForm((f) => ({ ...f, reportingCurrency: event.target.value }))} className="fd-input-currency" />
          </div>
          <div className="fd-field">
            <label htmlFor="brand-hq-fx-source">{t('restaurants.ops.brandHq.fx.rateSourceLabel')}</label>
            <select id="brand-hq-fx-source" value={fxForm.rateSource} onChange={(event) => setFxForm((f) => ({ ...f, rateSource: event.target.value }))}>
              <option value="stored">{t('restaurants.ops.brandHq.fx.sourceStored')}</option>
              <option value="admin_entered">{t('restaurants.ops.brandHq.fx.sourceAdmin')}</option>
              <option value="import">{t('restaurants.ops.brandHq.fx.sourceImport')}</option>
            </select>
          </div>
          <div className="fd-field">
            <label htmlFor="brand-hq-fx-mode">{t('restaurants.ops.brandHq.fx.rateDateModeLabel')}</label>
            <select id="brand-hq-fx-mode" value={fxForm.rateDateMode} onChange={(event) => setFxForm((f) => ({ ...f, rateDateMode: event.target.value }))}>
              <option value="period_end">{t('restaurants.ops.brandHq.fx.modePeriodEnd')}</option>
              <option value="rate_date">{t('restaurants.ops.brandHq.fx.modeRateDate')}</option>
            </select>
          </div>
          {fxForm.rateDateMode === 'rate_date' && (
            <div className="fd-field">
              <label htmlFor="brand-hq-fx-date">{t('restaurants.ops.brandHq.fx.rateDateLabel')}</label>
              <input id="brand-hq-fx-date" type="date" value={fxForm.rateDate} onChange={(event) => setFxForm((f) => ({ ...f, rateDate: event.target.value }))} />
            </div>
          )}
          <button type="submit" className="fd-btn fd-btn-sm" disabled={publishing} data-track="ui.eb078cc8b5.7">{t('restaurants.ops.brandHq.fx.savePolicy')}</button>
        </form>
        <form onSubmit={saveBrandFxRate} className="fd-row fd-form-row-end fd-stack-sm" data-track="ui.eb078cc8b5.8">
          <div className="fd-field">
            <label htmlFor="brand-hq-rate-base">{t('restaurants.ops.brandHq.fx.baseLabel')}</label>
            <input id="brand-hq-rate-base" value={rateForm.baseCurrency} placeholder="HTG" onChange={(event) => setRateForm((f) => ({ ...f, baseCurrency: event.target.value }))} className="fd-input-currency" />
          </div>
          <div className="fd-field">
            <label htmlFor="brand-hq-rate-quote">{t('restaurants.ops.brandHq.fx.quoteLabel')}</label>
            <input id="brand-hq-rate-quote" value={rateForm.quoteCurrency} placeholder="USD" onChange={(event) => setRateForm((f) => ({ ...f, quoteCurrency: event.target.value }))} className="fd-input-currency" />
          </div>
          <div className="fd-field">
            <label htmlFor="brand-hq-rate-value">{t('restaurants.ops.brandHq.fx.rateLabel')}</label>
            <input id="brand-hq-rate-value" type="number" step="any" min="0" value={rateForm.rate} placeholder="0.0076" onChange={(event) => setRateForm((f) => ({ ...f, rate: event.target.value }))} className="fd-input-rate" />
          </div>
          <div className="fd-field">
            <label htmlFor="brand-hq-rate-date">{t('restaurants.ops.brandHq.fx.rateDateLabel')}</label>
            <input id="brand-hq-rate-date" type="date" value={rateForm.rateDate} onChange={(event) => setRateForm((f) => ({ ...f, rateDate: event.target.value }))} />
          </div>
          <button type="submit" className="fd-btn fd-btn-sm" disabled={publishing} data-track="ui.eb078cc8b5.9">{t('restaurants.ops.brandHq.fx.addRate')}</button>
        </form>
        {fxRates.length > 0 && (
          <ul className="fd-card-meta">
            {fxRates.slice(0, 10).map((rate) => (
              <li key={`${rate.baseCurrency}-${rate.quoteCurrency}-${rate.rateDate}`}>
                1 {rate.baseCurrency} = {rate.rate} {rate.quoteCurrency} · {rate.rateDate} ({rate.source})
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="fd-settings-note fd-stack">
        <h4 className="fd-settings-subhead fd-settings-subhead--flush"><Layers size={15} /> {t('restaurants.ops.brandHq.rollouts.title')}</h4>
        <p className="fd-card-meta">{t('restaurants.ops.brandHq.rollouts.hint')}</p>
        <div className="fd-field">
          <label htmlFor="brand-hq-rollout-source">{t('restaurants.ops.brandHq.sourceRestaurant')}</label>
          <select id="brand-hq-rollout-source" value={sourceRestaurantId} onChange={(event) => { setSourceRestaurantId(event.target.value); setPilotRestaurantIds([]); setRolloutTargets([]); }}>
            {restaurants.map((entry) => <option key={entry.id} value={entry.id}>{entry.displayName}</option>)}
          </select>
        </div>
        <fieldset className="fd-field">
          <legend>{t('restaurants.ops.brandHq.rollouts.pilotRestaurants')}</legend>
          {restaurants.filter((entry) => String(entry.id) !== String(sourceRestaurantId)).map((entry) => (
            <label key={entry.id} className="fd-checkbox-row">
              <input type="checkbox" checked={pilotRestaurantIds.includes(String(entry.id))} onChange={() => toggleRolloutPilot(entry.id)} data-track="ui.eb078cc8b5.10" />
              <span>{entry.displayName}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className="fd-field">
          <legend>{t('restaurants.ops.brandHq.rollouts.targetRestaurants')}</legend>
          {restaurants.filter((entry) => String(entry.id) !== String(sourceRestaurantId)).map((entry) => (
            <label key={entry.id} className="fd-checkbox-row">
              <input type="checkbox" checked={rolloutTargets.includes(String(entry.id))} onChange={() => toggleRolloutTarget(entry.id)} data-track="ui.eb078cc8b5.11" />
              <span>{entry.displayName}</span>
            </label>
          ))}
        </fieldset>
        <button type="button" className="fd-btn fd-btn-sm" onClick={createRollout} disabled={publishing || !sourceRestaurantId || pilotRestaurantIds.length === 0 || rolloutTargets.length === 0} data-track="ui.eb078cc8b5.12">
          {t('restaurants.ops.brandHq.rollouts.create')}
        </button>
        {rollouts.length > 0 && (
          <ul className="fd-card-meta fd-stack-sm">
            {rollouts.map((rollout) => (
              <li key={rollout.id}>
                {t('restaurants.ops.brandHq.rollouts.stage', { stage: rollout.stage })} · {rollout.pilotRestaurantIds.length} {t('restaurants.ops.brandHq.rollouts.pilotCount')} · {rollout.targetRestaurantIds.length} {t('restaurants.ops.brandHq.rollouts.targetCount')}
                {rollout.stage === 'created' && (
                  <>
                    {' '}
                    <button type="button" className="fd-btn fd-btn-sm" disabled={publishing} onClick={() => advanceRollout(rollout.id)} data-track="ui.eb078cc8b5.13">{t('restaurants.ops.brandHq.rollouts.advancePilot')}</button>
                  </>
                )}
                {rollout.stage === 'pilot_published' && (
                  <>
                    {' '}
                    <button type="button" className="fd-btn fd-btn-sm" disabled={publishing} onClick={() => advanceRollout(rollout.id)} data-track="ui.eb078cc8b5.14">{t('restaurants.ops.brandHq.rollouts.advanceAll')}</button>
                  </>
                )}
                {rollout.status !== 'cancelled' && rollout.stage !== 'rolled_out' && (
                  <>
                    {' '}
                    <button type="button" className="fd-btn fd-btn-sm" disabled={publishing} onClick={() => cancelRollout(rollout.id)} data-track="ui.eb078cc8b5.15">{t('restaurants.ops.brandHq.rollouts.cancel')}</button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="fd-settings-note fd-stack">
        <h4 className="fd-settings-subhead fd-settings-subhead--flush"><Wallet size={15} /> {t('restaurants.ops.brandHq.consolidations.title')}</h4>
        <p className="fd-card-meta">{t('restaurants.ops.brandHq.consolidations.hint')}</p>
        {finalizedRuns.length === 0 ? (
          <p className="fd-card-meta">{t('restaurants.ops.brandHq.consolidations.noFinalized')}</p>
        ) : (
          <>
            <fieldset className="fd-field">
              <legend>{t('restaurants.ops.brandHq.consolidations.selectRuns')}</legend>
              {finalizedRuns.map((run) => (
                <label key={run.payRunId} className="fd-checkbox-row">
                  <input type="checkbox" checked={selectedRunIds.includes(Number(run.payRunId))} onChange={() => toggleRun(run.payRunId)} data-track="ui.eb078cc8b5.16" />
                  <span>{run.periodFrom} → {run.periodTo} · {run.currencyCode} · {run.attribution}</span>
                </label>
              ))}
            </fieldset>
            <button type="button" className="fd-btn fd-btn-sm" onClick={createConsolidation} disabled={publishing || selectedRunIds.length < 2} data-track="ui.eb078cc8b5.17">
              {t('restaurants.ops.brandHq.consolidations.create')}
            </button>
          </>
        )}
        {consolidations.length > 0 && (
          <ul className="fd-card-meta fd-stack-sm">
            {consolidations.map((consolidation) => (
              <li key={consolidation.id}>
                {consolidation.periodFrom} → {consolidation.periodTo} · {consolidation.status} · {consolidation.members?.length || 0} {t('restaurants.ops.brandHq.consolidations.members')}
                {consolidation.totals?.converted?.convertedTotalCents != null && (
                  <> · {money(consolidation.totals.converted.convertedTotalCents, consolidation.totals.converted.reportingCurrency)}</>
                )}
                {consolidation.status === 'draft' && (
                  <>
                    {' '}
                    <button type="button" className="fd-btn fd-btn-sm" disabled={publishing} onClick={() => consolidationAction(consolidation.id, 'finalize')} data-track="ui.eb078cc8b5.18">{t('restaurants.ops.brandHq.consolidations.finalize')}</button>
                  </>
                )}
                {consolidation.status === 'finalized' && (
                  <>
                    {' '}
                    <button type="button" className="fd-btn fd-btn-sm" disabled={publishing} onClick={() => consolidationAction(consolidation.id, 'approve')} data-track="ui.eb078cc8b5.19">{t('restaurants.ops.brandHq.consolidations.approve')}</button>
                  </>
                )}
                {(consolidation.status === 'draft' || consolidation.status === 'finalized' || consolidation.status === 'approved') && !consolidation.voidPending && (
                  <>
                    {' '}
                    <button type="button" className="fd-btn fd-btn-sm" disabled={publishing} onClick={() => consolidationAction(consolidation.id, 'void')} data-track="ui.eb078cc8b5.20">{t('restaurants.ops.brandHq.consolidations.void')}</button>
                  </>
                )}
                {consolidation.voidPending && (
                  <>
                    {' '}
                    <span className="fd-card-meta">{t('restaurants.ops.brandHq.consolidations.voidPending')}</span>
                    {' '}
                    <button type="button" className="fd-btn fd-btn-sm" disabled={publishing} onClick={() => consolidationAction(consolidation.id, 'voidApprove')} data-track="ui.eb078cc8b5.21">{t('restaurants.ops.brandHq.consolidations.voidApprove')}</button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="fd-settings-note fd-stack">
        <h4 className="fd-settings-subhead fd-settings-subhead--flush"><FileText size={15} /> {t('restaurants.ops.brandHq.franchise.title')}</h4>
        {franchiseError && <p role="alert">{franchiseError}</p>}
        {franchiseReport && (
          <>
            <p className="fd-card-meta">
              {t('restaurants.ops.brandHq.franchise.reportingCurrency', { currency: franchiseReport.reportingCurrency })}
              {franchiseReport.rateDate ? ` · ${t('restaurants.ops.brandHq.franchise.rateDate', { date: franchiseReport.rateDate })}` : ''}
              {franchiseReport.isDefaultPolicy ? ` · ${t('restaurants.ops.brandHq.franchise.defaultPolicy')}` : ''}
              {franchiseReport.missingCurrencies?.length > 0 && ` · ${t('restaurants.ops.brandHq.franchise.missingRates', { currencies: franchiseReport.missingCurrencies.join(', ') })}`}
            </p>
            <div className="fd-scroll-x">
              <table className="fd-table">
                <thead>
                  <tr>
                    <th scope="col">{t('restaurants.ops.brandHq.franchise.storeCol')}</th>
                    <th scope="col">{t('restaurants.ops.brandHq.franchise.salesCol')}</th>
                    <th scope="col">{t('restaurants.ops.brandHq.franchise.royaltyCol')}</th>
                    <th scope="col">{t('restaurants.ops.brandHq.franchise.marketingCol')}</th>
                    <th scope="col">{t('restaurants.ops.brandHq.franchise.agreementCol')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(franchiseReport.stores || []).map((store) => {
                    const salesCents = (store.sales || []).reduce((sum, s) => sum + (s.netCollectedCents || 0), 0);
                    const royaltyCents = (store.royalty || []).reduce((sum, s) => sum + (s.royaltyCents || 0), 0);
                    const marketingCents = (store.royalty || []).reduce((sum, s) => sum + (s.marketingCents || 0), 0);
                    return (
                      <tr key={`${store.restaurantId}-${store.locationId}`}>
                        <td><strong>{store.locationName}</strong> · {store.restaurantName}</td>
                        <td>{money(salesCents, store.currencyCode)}</td>
                        <td>{store.noAgreement ? '—' : money(royaltyCents, store.currencyCode)}</td>
                        <td>{store.noAgreement ? '—' : money(marketingCents, store.currencyCode)}</td>
                        <td>
                          {store.noAgreement
                            ? t('restaurants.ops.brandHq.franchise.noAgreement')
                            : `${t('restaurants.ops.brandHq.franchise.royaltyBps', { bps: store.agreement.royaltyBps })} · ${t('restaurants.ops.brandHq.franchise.marketingBps', { bps: store.agreement.marketingFeeBps })}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="fd-card-meta">
              {t('restaurants.ops.brandHq.franchise.totalsSales')}: {franchiseReport.totals.salesConvertedCents == null ? '—' : money(franchiseReport.totals.salesConvertedCents, franchiseReport.reportingCurrency)}
              {' · '}{t('restaurants.ops.brandHq.franchise.totalsRoyalty')}: {franchiseReport.totals.royaltyConvertedCents == null ? '—' : money(franchiseReport.totals.royaltyConvertedCents, franchiseReport.reportingCurrency)}
              {' · '}{t('restaurants.ops.brandHq.franchise.totalsMarketing')}: {franchiseReport.totals.marketingFeeConvertedCents == null ? '—' : money(franchiseReport.totals.marketingFeeConvertedCents, franchiseReport.reportingCurrency)}
              {' · '}{t('restaurants.ops.brandHq.franchise.totalsInitial')}: {franchiseReport.totals.initialFeesConvertedCents == null ? '—' : money(franchiseReport.totals.initialFeesConvertedCents, franchiseReport.reportingCurrency)}
            </p>
            {(franchiseReport.ambiguousStores || []).length > 0 && (
              <div className="fd-stack-sm">
                <p role="alert"><strong>{t('restaurants.ops.brandHq.franchise.mappings.ambiguousTitle')}</strong></p>
                <p className="fd-card-meta">{t('restaurants.ops.brandHq.franchise.mappings.ambiguousHint')}</p>
                <ul className="fd-card-meta fd-list-disc-sm">
                  {(franchiseReport.ambiguousStores || []).map((store) => (
                    <li key={store.locationId}>
                      {store.locationName} · {store.restaurantName} · {t('restaurants.ops.brandHq.franchise.mappings.ambiguousCount', { count: store.ambiguousCandidateCount })}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
        {franchiseMappings && (
          <div className="fd-stack-sm">
            <h5 className="fd-settings-subhead fd-settings-subhead--flush">{t('restaurants.ops.brandHq.franchise.mappings.title')}</h5>
            <p className="fd-card-meta">{t('restaurants.ops.brandHq.franchise.mappings.hint')}</p>
            {(franchiseMappings.unmappedStores || []).length > 0 && (
              <div className="fd-stack-sm">
                <p><strong>{t('restaurants.ops.brandHq.franchise.mappings.unmappedTitle')}</strong></p>
                <ul className="fd-card-meta fd-list-disc-sm">
                  {(franchiseMappings.unmappedStores || []).map((store) => (
                    <li key={store.locationId}>
                      {store.locationName} · {store.restaurantName}
                      <span className="fd-row">
                        <select
                          aria-label={t('restaurants.ops.brandHq.franchise.mappings.selectAgreement')}
                          value={mappingSelection[store.locationId] || ''}
                          onChange={(event) => setMappingSelection((current) => ({ ...current, [store.locationId]: event.target.value }))}
                        >
                          <option value="">{t('restaurants.ops.brandHq.franchise.mappings.selectAgreement')}</option>
                          {(franchiseMappings.agreements || []).map((agreement) => (
                            <option key={agreement.agreementId} value={agreement.agreementId}>{agreementLabel(agreement)}</option>
                          ))}
                        </select>
                        <button type="button" className="fd-btn fd-btn-sm" disabled={publishing || !mappingSelection[store.locationId]} onClick={() => assignMapping(store.locationId)} data-track="ui.eb078cc8b5.21">
                          {t('restaurants.ops.brandHq.franchise.mappings.assign')}
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(franchiseMappings.mappings || []).length > 0 && (
              <ul className="fd-card-meta fd-list-disc-sm">
                {(franchiseMappings.mappings || []).map((mapping) => (
                  <li key={mapping.locationId}>
                    {mapping.locationName} · {mapping.restaurantName} · {agreementLabel(mapping.agreement)}
                    {mapping.agreement.mappingAmbiguous && ` · ${t('restaurants.ops.brandHq.franchise.mappings.ambiguousTitle')}`}
                    <span className="fd-row">
                      <select
                        aria-label={t('restaurants.ops.brandHq.franchise.mappings.selectAgreement')}
                        value={mappingSelection[mapping.locationId] ?? mapping.agreement.agreementId}
                        onChange={(event) => setMappingSelection((current) => ({ ...current, [mapping.locationId]: event.target.value }))}
                      >
                        {(franchiseMappings.agreements || []).map((agreement) => (
                          <option key={agreement.agreementId} value={agreement.agreementId}>{agreementLabel(agreement)}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="fd-btn fd-btn-sm"
                        disabled={publishing || (mappingSelection[mapping.locationId] ?? mapping.agreement.agreementId) === mapping.agreement.agreementId}
                        onClick={() => assignMapping(mapping.locationId)}
                        data-track="ui.eb078cc8b5.22"
                      >
                        {t('restaurants.ops.brandHq.franchise.mappings.change')}
                      </button>
                      <button type="button" className="fd-btn fd-btn-sm" disabled={publishing} onClick={() => removeMapping(mapping.locationId)} data-track="ui.eb078cc8b5.23">
                        {t('restaurants.ops.brandHq.franchise.mappings.unassign')}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {(franchiseMappings.unmappedStores || []).length === 0 && (franchiseMappings.mappings || []).length === 0 && (
              <p className="fd-card-meta">{t('restaurants.ops.brandHq.franchise.mappings.noStores')}</p>
            )}
          </div>
        )}
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
