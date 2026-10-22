import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Ban, Play, RefreshCw, RotateCcw, Router, WifiOff } from 'lucide-react';
import {
  listFoodLocations,
  listHubOfflineSales,
  listStoreHubs,
  registerStoreHub,
  replayHubSales,
  resolveHubOfflineSale,
} from '../../api/food';
import { apiErrorMessage } from './foodShared';

function money(cents, currency = 'USD') {
  if (cents == null) return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

function timeAgo(value, t) {
  if (!value) return t('restaurants.ops.storeHub.never');
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return t('restaurants.ops.storeHub.justNow');
  if (seconds < 3600) return t('restaurants.ops.storeHub.minutesAgo', { count: Math.floor(seconds / 60) });
  if (seconds < 86400) return t('restaurants.ops.storeHub.hoursAgo', { count: Math.floor(seconds / 3600) });
  return t('restaurants.ops.storeHub.daysAgo', { count: Math.floor(seconds / 86400) });
}

const SALE_STATUSES = ['queued', 'held', 'failed', 'replayed', 'voided'];

export default function StoreHubPanel({ t, restaurant }) {
  const restaurantId = restaurant?.id;
  const [hubs, setHubs] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedHubId, setSelectedHubId] = useState('');
  const [sales, setSales] = useState([]);
  const [salesLoading, setSalesLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('held');
  const [registering, setRegistering] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [resolvingId, setResolvingId] = useState(null);
  const [hubName, setHubName] = useState('');
  const [hubLocationId, setHubLocationId] = useState('');
  const [voidNote, setVoidNote] = useState('');
  const [voidingId, setVoidingId] = useState(null);

  const load = useCallback(async () => {
    if (!restaurantId) return;
    setLoading(true);
    setError('');
    try {
      const [hubRows, locationRows] = await Promise.all([
        listStoreHubs(restaurantId),
        listFoodLocations(restaurantId),
      ]);
      setHubs(hubRows);
      setLocations(locationRows);
      setSelectedHubId((current) => current || (hubRows[0] ? String(hubRows[0].id) : ''));
      setHubLocationId((current) => current || (locationRows[0] ? String(locationRows[0].id) : ''));
    } catch (err) {
      setError(apiErrorMessage(err, t('restaurants.ops.storeHub.loadError')));
    } finally {
      setLoading(false);
    }
  }, [restaurantId, t]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!restaurantId) return;
      setLoading(true);
      try {
        const [hubRows, locationRows] = await Promise.all([
          listStoreHubs(restaurantId),
          listFoodLocations(restaurantId),
        ]);
        if (cancelled) return;
        setHubs(hubRows);
        setLocations(locationRows);
        setSelectedHubId((current) => current || (hubRows[0] ? String(hubRows[0].id) : ''));
        setHubLocationId((current) => current || (locationRows[0] ? String(locationRows[0].id) : ''));
      } catch (err) {
        if (!cancelled) setError(apiErrorMessage(err, t('restaurants.ops.storeHub.loadError')));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [restaurantId, t]);

  const loadSales = useCallback(async (hubId, status) => {
    if (!restaurantId || !hubId) {
      setSales([]);
      return;
    }
    setSalesLoading(true);
    try {
      const rows = await listHubOfflineSales(restaurantId, hubId, status ? { status } : {});
      setSales(rows);
    } catch (err) {
      toast.error(apiErrorMessage(err, t('restaurants.ops.storeHub.salesLoadError')));
    } finally {
      setSalesLoading(false);
    }
  }, [restaurantId, t]);

  useEffect(() => {
    loadSales(selectedHubId, statusFilter === 'all' ? null : statusFilter);
  }, [selectedHubId, statusFilter, loadSales]);

  const register = async (event) => {
    event.preventDefault();
    if (!hubName.trim() || !hubLocationId) return;
    setRegistering(true);
    try {
      await registerStoreHub(restaurantId, { name: hubName.trim(), locationId: Number(hubLocationId) });
      toast.success(t('restaurants.ops.storeHub.registerSuccess'));
      setHubName('');
      await load();
    } catch (err) {
      toast.error(apiErrorMessage(err, t('restaurants.ops.storeHub.registerError')));
    } finally {
      setRegistering(false);
    }
  };

  const replay = async (hubId) => {
    if (!hubId) return;
    setReplaying(true);
    try {
      const result = await replayHubSales(restaurantId, hubId);
      const held = (result.results || []).filter((r) => r.status === 'held').length;
      const failed = (result.results || []).filter((r) => r.status === 'failed').length;
      const shortfalls = (result.results || []).filter((r) => r.inventoryShortfall).length;
      toast.success(t('restaurants.ops.storeHub.replaySuccess', { count: result.processed }));
      if (held > 0) toast.error(t('restaurants.ops.storeHub.replayHeld', { count: held }));
      if (failed > 0) toast.error(t('restaurants.ops.storeHub.replayFailed', { count: failed }));
      if (shortfalls > 0) toast.error(t('restaurants.ops.storeHub.replayShortfall', { count: shortfalls }));
      await load();
      await loadSales(hubId, statusFilter === 'all' ? null : statusFilter);
    } catch (err) {
      toast.error(apiErrorMessage(err, t('restaurants.ops.storeHub.replayError')));
    } finally {
      setReplaying(false);
    }
  };

  const requeue = async (sale) => {
    setResolvingId(sale.id);
    try {
      await resolveHubOfflineSale(restaurantId, selectedHubId, sale.id, { action: 'requeue' });
      toast.success(t('restaurants.ops.storeHub.requeueSuccess'));
      await loadSales(selectedHubId, statusFilter === 'all' ? null : statusFilter);
      await load();
    } catch (err) {
      toast.error(apiErrorMessage(err, t('restaurants.ops.storeHub.resolveError')));
    } finally {
      setResolvingId(null);
    }
  };

  const voidSale = async (sale) => {
    setResolvingId(sale.id);
    try {
      await resolveHubOfflineSale(restaurantId, selectedHubId, sale.id, { action: 'void', note: voidNote.trim() || null });
      toast.success(t('restaurants.ops.storeHub.voidSuccess'));
      setVoidNote('');
      setVoidingId(null);
      await loadSales(selectedHubId, statusFilter === 'all' ? null : statusFilter);
      await load();
    } catch (err) {
      toast.error(apiErrorMessage(err, t('restaurants.ops.storeHub.resolveError')));
    } finally {
      setResolvingId(null);
    }
  };

  if (loading) return <div className="fd-empty" role="status">{t('restaurants.ops.storeHub.loading')}</div>;
  if (error) return <div className="fd-empty" role="alert">{error}</div>;

  return (
    <div>
      <div className="fd-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 className="fd-ops-subhead">{t('restaurants.ops.storeHub.title')}</h3>
          <p className="fd-card-meta">{t('restaurants.ops.storeHub.subtitle')}</p>
        </div>
        <button type="button" className="fd-btn fd-btn-sm" onClick={load} data-track="ui.a36306f4d3.1">
          <RefreshCw size={14} /> {t('restaurants.ops.storeHub.refresh')}
        </button>
      </div>

      {hubs.length === 0 ? (
        <div className="fd-empty" style={{ marginTop: '1rem' }}>
          <WifiOff size={20} />
          <p>{t('restaurants.ops.storeHub.noHubs')}</p>
        </div>
      ) : (
        <div className="fd-table-wrap" style={{ marginTop: '1rem' }}>
          <table className="fd-table">
            <thead>
              <tr>
                <th>{t('restaurants.ops.storeHub.hub')}</th>
                <th>{t('restaurants.ops.storeHub.store')}</th>
                <th>{t('restaurants.ops.storeHub.lastHeartbeat')}</th>
                <th>{t('restaurants.ops.storeHub.queued')}</th>
                <th>{t('restaurants.ops.storeHub.held')}</th>
                <th>{t('restaurants.ops.storeHub.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {hubs.map((hub) => (
                <tr key={hub.id} className={String(hub.id) === selectedHubId ? 'fd-active' : ''}>
                  <td><Router size={14} /> {hub.name}</td>
                  <td>{hub.location_name || '—'}</td>
                  <td>{timeAgo(hub.last_heartbeat_at, t)}</td>
                  <td>{hub.queued_sales}</td>
                  <td>{hub.held_sales}</td>
                  <td>
                    <div className="fd-row" style={{ gap: '0.5rem' }}>
                      <button
                        type="button"
                        className="fd-btn fd-btn-sm"
                        onClick={() => setSelectedHubId(String(hub.id))} data-track="ui.a36306f4d3.2"
                       
                      >
                        {t('restaurants.ops.storeHub.viewSales')}
                      </button>
                      <button
                        type="button"
                        className="fd-btn fd-btn-sm fd-btn-primary"
                        disabled={replaying || hub.queued_sales === 0}
                        onClick={() => { setSelectedHubId(String(hub.id)); replay(String(hub.id)); }}
                       
                        title={t('restaurants.ops.storeHub.replayHint')} data-track="ui.a36306f4d3.3"
                      >
                        <Play size={14} /> {t('restaurants.ops.storeHub.replay')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form onSubmit={register} className="fd-row" style={{ marginTop: '1rem', gap: '0.75rem', alignItems: 'flex-end' }} data-track="ui.a36306f4d3.4">
        <div className="fd-field" style={{ minWidth: '12rem' }}>
          <label htmlFor="store-hub-name">{t('restaurants.ops.storeHub.hubName')}</label>
          <input
            id="store-hub-name"
            value={hubName}
            onChange={(event) => setHubName(event.target.value)}
            placeholder={t('restaurants.ops.storeHub.hubNamePlaceholder')}
            maxLength={160}
          />
        </div>
        <div className="fd-field" style={{ minWidth: '12rem' }}>
          <label htmlFor="store-hub-store">{t('restaurants.ops.storeHub.store')}</label>
          <select id="store-hub-store" value={hubLocationId} onChange={(event) => setHubLocationId(event.target.value)}>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>{location.name}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="fd-btn fd-btn-sm" disabled={registering || !hubName.trim()} data-track="ui.a36306f4d3.5">
          {t('restaurants.ops.storeHub.register')}
        </button>
      </form>

      {selectedHubId && (
        <div style={{ marginTop: '1.5rem' }}>
          <div className="fd-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 className="fd-settings-subhead fd-settings-subhead--flush">
              {t('restaurants.ops.storeHub.offlineSalesTitle')}
            </h4>
            <div className="fd-field" style={{ minWidth: '10rem', marginBottom: 0 }}>
              <select
                aria-label={t('restaurants.ops.storeHub.statusFilter')}
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
               
              >
                <option value="all">{t('restaurants.ops.storeHub.allStatuses')}</option>
                {SALE_STATUSES.map((status) => (
                  <option key={status} value={status}>{t(`restaurants.ops.storeHub.status.${status}`)}</option>
                ))}
              </select>
            </div>
          </div>

          {salesLoading ? (
            <div className="fd-empty" role="status">{t('restaurants.ops.storeHub.loading')}</div>
          ) : sales.length === 0 ? (
            <div className="fd-empty"><p>{t('restaurants.ops.storeHub.noSales')}</p></div>
          ) : (
            <div className="fd-table-wrap" style={{ marginTop: '0.75rem' }}>
              <table className="fd-table">
                <thead>
                  <tr>
                    <th>{t('restaurants.ops.storeHub.total')}</th>
                    <th>{t('restaurants.ops.storeHub.tendered')}</th>
                    <th>{t('restaurants.ops.storeHub.statusLabel')}</th>
                    <th>{t('restaurants.ops.storeHub.note')}</th>
                    <th>{t('restaurants.ops.storeHub.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((sale) => (
                    <tr key={sale.id}>
                      <td>{money(sale.total_cents, sale.currency_code)}</td>
                      <td>{money(sale.cash_tendered_cents, sale.currency_code)}</td>
                      <td>{t(`restaurants.ops.storeHub.status.${sale.status}`)}</td>
                      <td className="fd-card-meta">
                        {sale.replay_error || sale.replay_metadata?.inventory_shortfall || sale.replay_metadata?.void_note || '—'}
                      </td>
                      <td>
                        {(sale.status === 'held' || sale.status === 'failed') && (
                          <div className="fd-row" style={{ gap: '0.5rem' }}>
                            <button
                              type="button"
                              className="fd-btn fd-btn-sm"
                              disabled={resolvingId === sale.id}
                              onClick={() => requeue(sale)}
                             
                              title={t('restaurants.ops.storeHub.requeueHint')} data-track="ui.a36306f4d3.6"
                            >
                              <RotateCcw size={14} /> {t('restaurants.ops.storeHub.requeue')}
                            </button>
                            {voidingId === sale.id ? (
                              <span className="fd-row" style={{ gap: '0.5rem' }}>
                                <input
                                  value={voidNote}
                                  onChange={(event) => setVoidNote(event.target.value)}
                                  placeholder={t('restaurants.ops.storeHub.voidNotePlaceholder')}
                                  maxLength={500}
                                  style={{ minWidth: '10rem' }}
                                />
                                <button
                                  type="button"
                                  className="fd-btn fd-btn-sm fd-btn-danger"
                                  disabled={resolvingId === sale.id}
                                  onClick={() => voidSale(sale)} data-track="ui.a36306f4d3.7"
                                 
                                >
                                  <Ban size={14} /> {t('restaurants.ops.storeHub.confirmVoid')}
                                </button>
                                <button
                                  type="button"
                                  className="fd-btn fd-btn-sm"
                                  onClick={() => { setVoidingId(null); setVoidNote(''); }} data-track="ui.a36306f4d3.8"
                                >
                                  {t('restaurants.ops.storeHub.cancel')}
                                </button>
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="fd-btn fd-btn-sm fd-btn-danger"
                                onClick={() => setVoidingId(sale.id)}
                               
                                title={t('restaurants.ops.storeHub.voidHint')} data-track="ui.a36306f4d3.9"
                              >
                                <Ban size={14} /> {t('restaurants.ops.storeHub.void')}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
