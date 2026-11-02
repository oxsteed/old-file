// RestaurantInventoryPage — web inventory management for restaurant operators.
// Stock dashboard, items, adjustments, purchase requests, supplier issues,
// and waste tracking. All writes go through the canonical api/restaurants.js
// helpers, which match the server's current field names: adjustments use the
// server types (receive/waste/usage/count/correction) with a signed-amount
// `delta` (or `quantity` for an absolute count), purchase requests use
// itemName/requestedQuantity/supplierName, and supplier issues use
// supplierName/issue. Reads render the server's fields (quantity,
// requested_quantity, supplier_name, issue), never the legacy names this
// page used to read. Poll failures keep the last-good data and surface a
// banner instead of blanking the page.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Package, FileText, AlertTriangle } from 'lucide-react';
import EmptyState from '../../components/EmptyState';
import { getFoodRestaurant } from '../../api/food';
import {
  adjustInventoryItem,
  createInventoryPurchaseRequest,
  createInventorySupplierIssue,
  getInventoryDashboard,
  listInventoryItems,
  listInventoryPurchaseRequestPage,
  listInventorySupplierIssuePage,
} from '../../api/restaurants';
import { useDisplayPoller } from '../../hooks/useDisplayPoller';
import { FoodBrand, apiErrorMessage } from './foodShared';
import PageShell from '../../components/PageShell';
import '../../styles/FoodPages.css';

const TABS = ['items', 'requests', 'issues', 'waste'];
const ADJ_TYPES = ['receive', 'waste', 'usage', 'count', 'correction'];
const PAGE_SIZE = 25;

function onHand(item) {
  const available = item.available_quantity ?? item.quantity;
  return available == null ? null : Number(available);
}

function isLow(item) {
  if (item.is_low === true) return true;
  const stock = onHand(item);
  if (stock == null) return false;
  if (item.reorder_point > 0) return stock <= item.reorder_point;
  return false;
}

function AdjustModal({ item, initialType, onSave, onClose }) {
  const { t } = useTranslation();
  const [type, setType] = useState(initialType || 'receive');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const handle = async () => {
    if (!qty) return;
    setSaving(true);
    // The server signs waste/usage itself; the client always sends a
    // positive amount. Counts are absolute, everything else is a delta.
    const payload = type === 'count'
      ? { type, quantity: parseFloat(qty), note }
      : { type, delta: parseFloat(qty), note };
    await onSave({ itemId: item.id, ...payload });
    setSaving(false);
  };

  return (
    <div className="fd-modal-overlay" role="presentation" onClick={onClose} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="fd-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>{item.name}</h3>
        <div className="fd-field">
          <label>{t('food.inv.adjustType')}</label>
          <select aria-label={t('food.inv.adjustType')} value={type} onChange={(e) => setType(e.target.value)}>
            {ADJ_TYPES.map((at) => (
              <option key={at} value={at}>{t(`food.inv.adjType_${at}`)}</option>
            ))}
          </select>
        </div>
        <div className="fd-field">
          <label>{t('food.inv.quantity')} ({item.unit || 'units'})</label>
          <input aria-label={t('food.inv.quantity')} type="number" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" />
        </div>
        <div className="fd-field">
          <label>{t('food.inv.note')}</label>
          <input aria-label={t('food.inv.note')} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('food.inv.notePlaceholder')} />
        </div>
        <div className="fd-pos-modal-actions">
          <button className="fd-btn-secondary" onClick={onClose} data-track="ui.a4070f708e.1">{t('food.common.cancel')}</button>
          <button className="fd-btn" onClick={handle} disabled={saving || !qty} data-track="ui.a4070f708e.2">
            {saving ? t('food.common.saving') : t('food.inv.adjust')}
          </button>
        </div>
      </div>
    </div>
  );
}

function RequestModal({ restaurantId, onSaved, onClose }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ itemName: '', supplierName: '', requestedQuantity: '', unit: '', note: '' });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const handle = async () => {
    if (!form.itemName) return;
    setSaving(true);
    try {
      await createInventoryPurchaseRequest(restaurantId, {
        itemName: form.itemName,
        supplierName: form.supplierName || undefined,
        requestedQuantity: Number(form.requestedQuantity),
        unit: form.unit || undefined,
        note: form.note || undefined,
      });
      toast.success(t('food.inv.requestSent'));
      onSaved();
      onClose();
    } catch (err) {
      toast.error(apiErrorMessage(err, t('food.common.loadError')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fd-modal-overlay" role="presentation" onClick={onClose} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="fd-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>{t('food.inv.newRequest')}</h3>
        <div className="fd-field">
          <label>{t('food.inv.req_item_name')}</label>
          <input aria-label={t('food.inv.req_item_name')} value={form.itemName} onChange={(e) => set('itemName', e.target.value)} />
        </div>
        <div className="fd-field">
          <label>{t('food.inv.req_supplier')}</label>
          <input aria-label={t('food.inv.req_supplier')} value={form.supplierName} onChange={(e) => set('supplierName', e.target.value)} />
        </div>
        <div className="fd-field">
          <label>{t('food.inv.req_unit')}</label>
          <input aria-label={t('food.inv.req_unit')} value={form.unit} onChange={(e) => set('unit', e.target.value)} />
        </div>
        <div className="fd-field">
          <label>{t('food.inv.quantity')}</label>
          <input aria-label={t('food.inv.quantity')} type="number" step="0.01" value={form.requestedQuantity} onChange={(e) => set('requestedQuantity', e.target.value)} />
        </div>
        <div className="fd-field">
          <label>{t('food.inv.note')}</label>
          <textarea aria-label={t('food.inv.note')} value={form.note} onChange={(e) => set('note', e.target.value)} rows={2} />
        </div>
        <div className="fd-pos-modal-actions">
          <button className="fd-btn-secondary" onClick={onClose} data-track="ui.a4070f708e.3">{t('food.common.cancel')}</button>
          <button className="fd-btn" onClick={handle} disabled={saving || !form.itemName} data-track="ui.a4070f708e.4">
            {saving ? t('food.common.saving') : t('food.inv.submit')}
          </button>
        </div>
      </div>
    </div>
  );
}

function IssueModal({ restaurantId, onSaved, onClose }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ supplierName: '', issue: '' });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const handle = async () => {
    if (!form.issue) return;
    setSaving(true);
    try {
      await createInventorySupplierIssue(restaurantId, {
        supplierName: form.supplierName,
        issue: form.issue,
      });
      toast.success(t('food.inv.issueSent'));
      onSaved();
      onClose();
    } catch (err) {
      toast.error(apiErrorMessage(err, t('food.common.loadError')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fd-modal-overlay" role="presentation" onClick={onClose} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="fd-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>{t('food.inv.newIssue')}</h3>
        <div className="fd-field">
          <label>{t('food.inv.req_supplier')}</label>
          <input aria-label={t('food.inv.req_supplier')} value={form.supplierName} onChange={(e) => set('supplierName', e.target.value)} />
        </div>
        <div className="fd-field">
          <label>{t('food.inv.description')}</label>
          <textarea aria-label={t('food.inv.description')} value={form.issue} onChange={(e) => set('issue', e.target.value)} rows={3} required />
        </div>
        <div className="fd-pos-modal-actions">
          <button className="fd-btn-secondary" onClick={onClose} data-track="ui.a4070f708e.5">{t('food.common.cancel')}</button>
          <button className="fd-btn" onClick={handle} disabled={saving || !form.issue} data-track="ui.a4070f708e.6">
            {saving ? t('food.common.saving') : t('food.inv.submit')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Pager({ offset, total, onChange }) {
  const { t } = useTranslation();
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(total, offset + PAGE_SIZE);
  return (
    <div className="fd-inv-bar">
      <span className="fd-card-meta">{t('food.inv.showing', { from, to, total })}</span>
      <button type="button" className="fd-btn-secondary fd-btn-sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - PAGE_SIZE))}>{t('food.inv.previous')}</button>
      <button type="button" className="fd-btn-secondary fd-btn-sm" disabled={offset + PAGE_SIZE >= total} onClick={() => onChange(offset + PAGE_SIZE)}>{t('food.inv.next')}</button>
    </div>
  );
}

export default function RestaurantInventoryPage() {
  const { restaurantId } = useParams();
  const { t } = useTranslation();

  const [restaurant, setRestaurant] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [items, setItems] = useState([]);
  const [requests, setRequests] = useState([]);
  const [requestsTotal, setRequestsTotal] = useState(0);
  const [requestsOffset, setRequestsOffset] = useState(0);
  const [requestsError, setRequestsError] = useState(false);
  const [issues, setIssues] = useState([]);
  const [issuesTotal, setIssuesTotal] = useState(0);
  const [issuesOffset, setIssuesOffset] = useState(0);
  const [issuesError, setIssuesError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dashError, setDashError] = useState(false);
  const [tab, setTab] = useState('items');

  const [adjustItem, setAdjustItem] = useState(null);
  const [showRequest, setShowRequest] = useState(false);
  const [showIssue, setShowIssue] = useState(false);
  const [search, setSearch] = useState('');
  const settledRef = useRef(false);

  // Dashboard + items poll with the Kitchen/Queue board pattern: a failed
  // poll keeps the last-good data and raises the offline banner; it never
  // blanks the page mid-service.
  const loadDash = useCallback(async () => {
    try {
      const [dash, list] = await Promise.all([
        getInventoryDashboard(restaurantId),
        listInventoryItems(restaurantId),
      ]);
      setDashboard(dash);
      setItems(list);
      setDashError(false);
    } catch (err) {
      // Keep the last-good data; the banner below says the load failed
      // instead of rendering an empty stock list.
      setDashError(true);
      throw err;
    } finally {
      if (!settledRef.current) {
        settledRef.current = true;
        setLoading(false);
      }
    }
  }, [restaurantId]);

  const { offline: pollOffline, retryNow } = useDisplayPoller(loadDash, { intervalMs: 10000 });

  const loadRequests = useCallback(async (offset = requestsOffset) => {
    try {
      const page = await listInventoryPurchaseRequestPage(restaurantId, { limit: PAGE_SIZE, offset });
      setRequests(page?.requests || []);
      setRequestsTotal(page?.total ?? (page?.requests || []).length);
      setRequestsError(false);
    } catch {
      // Keep the last-good page; never render false-empty on failure.
      setRequestsError(true);
    }
  }, [restaurantId, requestsOffset]);

  const loadIssues = useCallback(async (offset = issuesOffset) => {
    try {
      const page = await listInventorySupplierIssuePage(restaurantId, { limit: PAGE_SIZE, offset });
      setIssues(page?.issues || []);
      setIssuesTotal(page?.total ?? (page?.issues || []).length);
      setIssuesError(false);
    } catch {
      setIssuesError(true);
    }
  }, [restaurantId, issuesOffset]);

  useEffect(() => {
    getFoodRestaurant(restaurantId).then((r) => setRestaurant(r?.restaurant || r)).catch(() => {});
  }, [restaurantId]);

  useEffect(() => { loadRequests(); }, [loadRequests]);
  useEffect(() => { loadIssues(); }, [loadIssues]);

  const handleAdjust = async ({ itemId, ...payload }) => {
    try {
      await adjustInventoryItem(restaurantId, itemId, payload);
      toast.success(t('food.inv.adjusted'));
      setAdjustItem(null);
      retryNow();
    } catch (err) {
      toast.error(apiErrorMessage(err, t('food.common.loadError')));
    }
  };

  const filteredItems = items.filter((i) =>
    !search || i.name?.toLowerCase().includes(search.toLowerCase())
  );

  const lowItems = items.filter(isLow);
  const risk = dashboard?.risk || {};

  if (loading) {
    return (
      <PageShell>
        <div className="fd-page fd-empty">{t('food.common.loading')}</div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="fd-page">
        <div className="fd-hero" style={{ marginBottom: '1.5rem' }}>
          <FoodBrand />
          <h1 className="fd-hero-title">{restaurant?.name}: {t('food.inv.title')}</h1>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <Link className="fd-btn-secondary fd-btn-sm" to="/restaurants/merchant">{t('food.common.back')}</Link>
          </div>
        </div>

        {pollOffline && (
          <div className="fd-inv-alert" role="alert">
            {t('food.inv.pollError')} <button type="button" className="fd-btn fd-btn-sm" onClick={retryNow}>{t('food.common.retry')}</button>
          </div>
        )}
        {dashError && items.length === 0 && (
          <div className="fd-inv-alert" role="alert">
            {t('food.common.loadError')} <button type="button" className="fd-btn fd-btn-sm" onClick={retryNow}>{t('food.common.retry')}</button>
          </div>
        )}

        {/* KPI strip: server aggregates, not page-local counts, so the
            numbers stay true when the request/issue lists are paged. */}
        <div className="fd-inv-kpis">
          <div className="fd-inv-kpi">
            <div className="fd-inv-kpi-val">{items.length}</div>
            <div className="fd-inv-kpi-label">{t('food.inv.kpi_items')}</div>
          </div>
          <div className={`fd-inv-kpi${(risk.low_stock ?? lowItems.length) > 0 ? ' fd-inv-kpi--warn' : ''}`}>
            <div className="fd-inv-kpi-val">{risk.low_stock ?? lowItems.length}</div>
            <div className="fd-inv-kpi-label">{t('food.inv.kpi_low')}</div>
          </div>
          <div className="fd-inv-kpi">
            <div className="fd-inv-kpi-val">{risk.pending_requests ?? requests.filter((r) => r.status === 'pending').length}</div>
            <div className="fd-inv-kpi-label">{t('food.inv.kpi_pending')}</div>
          </div>
          <div className="fd-inv-kpi">
            <div className="fd-inv-kpi-val">{risk.supplier_issues ?? issues.filter((i) => i.status === 'open').length}</div>
            <div className="fd-inv-kpi-label">{t('food.inv.kpi_issues')}</div>
          </div>
        </div>

        {/* Tab nav */}
        <div className="fd-inv-tabs">
          {TABS.map((tb) => (
            <button key={tb} className={`fd-inv-tab${tab === tb ? ' fd-active' : ''}`} onClick={() => setTab(tb)} data-track="ui.a4070f708e.7">
              {t(`food.inv.tab_${tb}`)}
            </button>
          ))}
        </div>

        {/* Items tab */}
        {tab === 'items' && (
          <div>
            <div className="fd-inv-bar">
              <input aria-label={t('food.inv.searchItems')} className="fd-searchbar" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('food.inv.searchItems')} />
            </div>
            {lowItems.length > 0 && (
              <div className="fd-inv-alert">
                ⚠ {t('food.inv.lowAlert', { n: lowItems.length })}
              </div>
            )}
            <div className="fd-inv-list">
              {filteredItems.length === 0 && !dashError && (
                <EmptyState icon={Package} title={t('food.inv.noItems')} />
              )}
              {filteredItems.map((item) => {
                const low = isLow(item);
                const stock = onHand(item);
                return (
                  <div key={item.id} className={`fd-inv-item${low ? ' fd-inv-item--low' : ''}`}>
                    <div className="fd-inv-item-main">
                      <strong>{item.name}</strong>
                      <span className="fd-tag">{item.category || t('food.inv.uncategorized')}</span>
                    </div>
                    <div className="fd-inv-item-stock">
                      <span className={low ? 'fd-inv-low-text' : ''}>{stock ?? '—'} {item.unit}</span>
                      {item.par_level != null && <span className="fd-inv-par"> / par {item.par_level}</span>}
                    </div>
                    <button className="fd-btn-sm fd-btn-secondary" onClick={() => setAdjustItem({ item, initialType: 'receive' })} data-track="ui.a4070f708e.8">
                      {t('food.inv.adjust')}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Purchase requests tab */}
        {tab === 'requests' && (
          <div>
            <div className="fd-inv-bar">
              <button className="fd-btn" onClick={() => setShowRequest(true)} data-track="ui.a4070f708e.9">{t('food.inv.newRequest')}</button>
            </div>
            {requestsError && (
              <div className="fd-inv-alert" role="alert">
                {t('food.common.loadError')} <button type="button" className="fd-btn fd-btn-sm" onClick={() => loadRequests()}>{t('food.common.retry')}</button>
              </div>
            )}
            <Pager offset={requestsOffset} total={requestsTotal} onChange={(next) => { setRequestsOffset(next); loadRequests(next); }} />
            <div className="fd-inv-list">
              {requests.length === 0 && !requestsError && (
                <EmptyState
                  icon={FileText}
                  title={t('food.inv.noRequests')}
                  actions={(
                    <button type="button" className="fd-btn" onClick={() => setShowRequest(true)} data-track="ui.a4070f708e.10">
                      {t('food.inv.newRequest')}
                    </button>
                  )}
                />
              )}
              {requests.map((r) => (
                <div key={r.id} className="fd-inv-item">
                  <div className="fd-inv-item-main">
                    <strong>{r.item_name}</strong>
                    {r.supplier_name && <span className="fd-card-meta">{r.supplier_name}</span>}
                  </div>
                  <div className="fd-inv-item-stock">{r.requested_quantity} {r.unit}</div>
                  <span className={`fd-tag fd-inv-status-${r.status || 'pending'}`}>{r.status || 'pending'}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Supplier issues tab */}
        {tab === 'issues' && (
          <div>
            <div className="fd-inv-bar">
              <button className="fd-btn" onClick={() => setShowIssue(true)} data-track="ui.a4070f708e.11">{t('food.inv.newIssue')}</button>
            </div>
            {issuesError && (
              <div className="fd-inv-alert" role="alert">
                {t('food.common.loadError')} <button type="button" className="fd-btn fd-btn-sm" onClick={() => loadIssues()}>{t('food.common.retry')}</button>
              </div>
            )}
            <Pager offset={issuesOffset} total={issuesTotal} onChange={(next) => { setIssuesOffset(next); loadIssues(next); }} />
            <div className="fd-inv-list">
              {issues.length === 0 && !issuesError && (
                <EmptyState
                  icon={AlertTriangle}
                  title={t('food.inv.noIssues')}
                  actions={(
                    <button type="button" className="fd-btn" onClick={() => setShowIssue(true)} data-track="ui.a4070f708e.12">
                      {t('food.inv.newIssue')}
                    </button>
                  )}
                />
              )}
              {issues.map((iss) => (
                <div key={iss.id} className="fd-inv-item">
                  <div className="fd-inv-item-main">
                    <strong>{iss.supplier_name || t('food.inv.unknownSupplier')}</strong>
                    <span className="fd-card-meta">{iss.issue}</span>
                  </div>
                  <span className={`fd-tag fd-inv-status-${iss.status || 'open'}`}>{iss.status || 'open'}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Waste log tab: "Log waste" opens the adjust modal pre-set to
            waste, so the entry is recorded as waste, not as a restock. */}
        {tab === 'waste' && (
          <div>
            <div className="fd-inv-bar">
              <span className="fd-card-meta">{t('food.inv.wasteHint')}</span>
            </div>
            <div className="fd-inv-list">
              {filteredItems.length === 0 && !dashError && (
                <EmptyState icon={Package} title={t('food.inv.noItems')} />
              )}
              {items.map((item) => (
                <div key={item.id} className="fd-inv-item">
                  <div className="fd-inv-item-main">
                    <strong>{item.name}</strong>
                  </div>
                  <button
                    className="fd-btn-sm fd-btn-danger"
                    onClick={() => { setAdjustItem({ item, initialType: 'waste' }); }} data-track="ui.a4070f708e.13"
                  >
                    {t('food.inv.logWaste')}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {adjustItem && (
        <AdjustModal
          item={adjustItem.item}
          initialType={adjustItem.initialType}
          onSave={handleAdjust}
          onClose={() => setAdjustItem(null)}
        />
      )}
      {showRequest && (
        <RequestModal
          restaurantId={restaurantId}
          onSaved={() => { setRequestsOffset(0); loadRequests(0); }}
          onClose={() => setShowRequest(false)}
        />
      )}
      {showIssue && (
        <IssueModal
          restaurantId={restaurantId}
          onSaved={() => { setIssuesOffset(0); loadIssues(0); }}
          onClose={() => setShowIssue(false)}
        />
      )}
    </PageShell>
  );
}
