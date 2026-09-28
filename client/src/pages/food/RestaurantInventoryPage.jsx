// RestaurantInventoryPage — web inventory management for restaurant operators.
// Mirrors the OxSteed Inventory iOS app: stock dashboard, items, adjustments,
// purchase requests, supplier issues, and waste tracking.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import { getFoodRestaurant } from '../../api/food';
import { FoodBrand } from './foodShared';
import PageShell from '../../components/PageShell';
import '../../styles/FoodPages.css';

const TABS = ['items', 'requests', 'issues', 'waste'];

function AdjustModal({ item, onSave, onClose }) {
  const { t } = useTranslation();
  const [type, setType] = useState('restock');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const handle = async () => {
    if (!qty) return;
    setSaving(true);
    await onSave({ itemId: item.id, type, quantity: parseFloat(qty), note });
    setSaving(false);
  };

  return (
    <div className="fd-modal-overlay" onClick={onClose}>
      <div className="fd-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{item.name}</h3>
        <div className="fd-field">
          <label>{t('food.inv.adjustType')}</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {['restock', 'waste', 'adjustment', 'usage'].map((at) => (
              <option key={at} value={at}>{t(`food.inv.adjType_${at}`)}</option>
            ))}
          </select>
        </div>
        <div className="fd-field">
          <label>{t('food.inv.quantity')} ({item.unit || 'units'})</label>
          <input type="number" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" />
        </div>
        <div className="fd-field">
          <label>{t('food.inv.note')}</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('food.inv.notePlaceholder')} />
        </div>
        <div className="fd-pos-modal-actions">
          <button className="fd-btn-secondary" onClick={onClose}>{t('food.common.cancel')}</button>
          <button className="fd-btn" onClick={handle} disabled={saving || !qty}>
            {saving ? t('food.common.saving') : t('food.inv.adjust')}
          </button>
        </div>
      </div>
    </div>
  );
}

function RequestModal({ restaurantId, onSaved, onClose }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ item_name: '', supplier: '', quantity: '', unit: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const handle = async () => {
    if (!form.item_name) return;
    setSaving(true);
    try {
      await api.post(`/restaurants/${restaurantId}/inventory/purchase-requests`, form);
      toast.success(t('food.inv.requestSent'));
      onSaved();
      onClose();
    } catch {
      toast.error(t('food.common.loadError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fd-modal-overlay" onClick={onClose}>
      <div className="fd-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t('food.inv.newRequest')}</h3>
        {['item_name', 'supplier', 'unit'].map((k) => (
          <div className="fd-field" key={k}>
            <label>{t(`food.inv.req_${k}`)}</label>
            <input value={form[k]} onChange={(e) => set(k, e.target.value)} />
          </div>
        ))}
        <div className="fd-field">
          <label>{t('food.inv.quantity')}</label>
          <input type="number" step="0.01" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} />
        </div>
        <div className="fd-field">
          <label>{t('food.inv.note')}</label>
          <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} />
        </div>
        <div className="fd-pos-modal-actions">
          <button className="fd-btn-secondary" onClick={onClose}>{t('food.common.cancel')}</button>
          <button className="fd-btn" onClick={handle} disabled={saving || !form.item_name}>
            {saving ? t('food.common.saving') : t('food.inv.submit')}
          </button>
        </div>
      </div>
    </div>
  );
}

function IssueModal({ restaurantId, onSaved, onClose }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ supplier: '', description: '', severity: 'medium' });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const handle = async () => {
    if (!form.description) return;
    setSaving(true);
    try {
      await api.post(`/restaurants/${restaurantId}/inventory/supplier-issues`, form);
      toast.success(t('food.inv.issueSent'));
      onSaved();
      onClose();
    } catch {
      toast.error(t('food.common.loadError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fd-modal-overlay" onClick={onClose}>
      <div className="fd-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t('food.inv.newIssue')}</h3>
        <div className="fd-field">
          <label>{t('food.inv.req_supplier')}</label>
          <input value={form.supplier} onChange={(e) => set('supplier', e.target.value)} />
        </div>
        <div className="fd-field">
          <label>{t('food.inv.description')}</label>
          <textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={3} required />
        </div>
        <div className="fd-field">
          <label>{t('food.inv.severity')}</label>
          <select value={form.severity} onChange={(e) => set('severity', e.target.value)}>
            {['low', 'medium', 'high'].map((s) => (
              <option key={s} value={s}>{t(`food.inv.severity_${s}`)}</option>
            ))}
          </select>
        </div>
        <div className="fd-pos-modal-actions">
          <button className="fd-btn-secondary" onClick={onClose}>{t('food.common.cancel')}</button>
          <button className="fd-btn" onClick={handle} disabled={saving || !form.description}>
            {saving ? t('food.common.saving') : t('food.inv.submit')}
          </button>
        </div>
      </div>
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
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('items');

  const [adjustItem, setAdjustItem] = useState(null);
  const [showRequest, setShowRequest] = useState(false);
  const [showIssue, setShowIssue] = useState(false);
  const [search, setSearch] = useState('');

  const timerRef = useRef(null);
  const POLL_MS = 10000;

  const loadDash = useCallback(async () => {
    try {
      const [dashRes, itemsRes] = await Promise.all([
        api.get(`/restaurants/${restaurantId}/inventory/dashboard`).catch(() => ({ data: {} })),
        api.get(`/restaurants/${restaurantId}/inventory/items`).catch(() => ({ data: { items: [] } })),
      ]);
      setDashboard(dashRes.data?.dashboard || dashRes.data || null);
      setItems(itemsRes.data?.items || []);
    } catch {
      toast.error(t('food.common.loadError'));
    }
  }, [restaurantId, t]);

  const loadRequests = useCallback(async () => {
    const res = await api.get(`/restaurants/${restaurantId}/inventory/purchase-requests`).catch(() => ({ data: { requests: [] } }));
    setRequests(res.data?.requests || []);
  }, [restaurantId]);

  const loadIssues = useCallback(async () => {
    const res = await api.get(`/restaurants/${restaurantId}/inventory/supplier-issues`).catch(() => ({ data: { issues: [] } }));
    setIssues(res.data?.issues || []);
  }, [restaurantId]);

  useEffect(() => {
    getFoodRestaurant(restaurantId).then((r) => setRestaurant(r?.restaurant || r)).catch(() => {});
    Promise.all([loadDash(), loadRequests(), loadIssues()]).finally(() => setLoading(false));
    timerRef.current = setInterval(loadDash, POLL_MS);
    return () => clearInterval(timerRef.current);
  }, [loadDash, loadRequests, loadIssues, restaurantId]);

  const handleAdjust = async ({ itemId, type, quantity, note }) => {
    try {
      await api.post(`/restaurants/${restaurantId}/inventory/items/${itemId}/adjust`, { type, quantity, note });
      toast.success(t('food.inv.adjusted'));
      setAdjustItem(null);
      loadDash();
    } catch {
      toast.error(t('food.common.loadError'));
    }
  };

  const filteredItems = items.filter((i) =>
    !search || i.name?.toLowerCase().includes(search.toLowerCase())
  );

  const lowItems = items.filter((i) => i.current_stock <= (i.par_level || 0));

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

        {/* KPI strip */}
        {dashboard && (
          <div className="fd-inv-kpis">
            <div className="fd-inv-kpi">
              <div className="fd-inv-kpi-val">{dashboard.total_items ?? items.length}</div>
              <div className="fd-inv-kpi-label">{t('food.inv.kpi_items')}</div>
            </div>
            <div className={`fd-inv-kpi${lowItems.length > 0 ? ' fd-inv-kpi--warn' : ''}`}>
              <div className="fd-inv-kpi-val">{lowItems.length}</div>
              <div className="fd-inv-kpi-label">{t('food.inv.kpi_low')}</div>
            </div>
            <div className="fd-inv-kpi">
              <div className="fd-inv-kpi-val">{requests.filter((r) => r.status === 'pending').length}</div>
              <div className="fd-inv-kpi-label">{t('food.inv.kpi_pending')}</div>
            </div>
            <div className="fd-inv-kpi">
              <div className="fd-inv-kpi-val">{issues.filter((i) => i.status === 'open').length}</div>
              <div className="fd-inv-kpi-label">{t('food.inv.kpi_issues')}</div>
            </div>
          </div>
        )}

        {/* Tab nav */}
        <div className="fd-inv-tabs">
          {TABS.map((tb) => (
            <button key={tb} className={`fd-inv-tab${tab === tb ? ' fd-active' : ''}`} onClick={() => setTab(tb)}>
              {t(`food.inv.tab_${tb}`)}
            </button>
          ))}
        </div>

        {/* Items tab */}
        {tab === 'items' && (
          <div>
            <div className="fd-inv-bar">
              <input className="fd-searchbar" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('food.inv.searchItems')} />
            </div>
            {lowItems.length > 0 && (
              <div className="fd-inv-alert">
                ⚠ {t('food.inv.lowAlert', { n: lowItems.length })}
              </div>
            )}
            <div className="fd-inv-list">
              {filteredItems.length === 0 && <div className="fd-empty">{t('food.inv.noItems')}</div>}
              {filteredItems.map((item) => {
                const isLow = item.current_stock <= (item.par_level || 0);
                return (
                  <div key={item.id} className={`fd-inv-item${isLow ? ' fd-inv-item--low' : ''}`}>
                    <div className="fd-inv-item-main">
                      <strong>{item.name}</strong>
                      <span className="fd-tag">{item.category || t('food.inv.uncategorized')}</span>
                    </div>
                    <div className="fd-inv-item-stock">
                      <span className={isLow ? 'fd-inv-low-text' : ''}>{item.current_stock ?? '—'} {item.unit}</span>
                      {item.par_level != null && <span className="fd-inv-par"> / par {item.par_level}</span>}
                    </div>
                    <button className="fd-btn-sm fd-btn-secondary" onClick={() => setAdjustItem(item)}>
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
              <button className="fd-btn" onClick={() => setShowRequest(true)}>{t('food.inv.newRequest')}</button>
            </div>
            <div className="fd-inv-list">
              {requests.length === 0 && <div className="fd-empty">{t('food.inv.noRequests')}</div>}
              {requests.map((r) => (
                <div key={r.id} className="fd-inv-item">
                  <div className="fd-inv-item-main">
                    <strong>{r.item_name}</strong>
                    {r.supplier && <span className="fd-card-meta">{r.supplier}</span>}
                  </div>
                  <div className="fd-inv-item-stock">{r.quantity} {r.unit}</div>
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
              <button className="fd-btn" onClick={() => setShowIssue(true)}>{t('food.inv.newIssue')}</button>
            </div>
            <div className="fd-inv-list">
              {issues.length === 0 && <div className="fd-empty">{t('food.inv.noIssues')}</div>}
              {issues.map((iss) => (
                <div key={iss.id} className="fd-inv-item">
                  <div className="fd-inv-item-main">
                    <strong>{iss.supplier || t('food.inv.unknownSupplier')}</strong>
                    <span className="fd-card-meta">{iss.description}</span>
                  </div>
                  <span className={`fd-tag fd-inv-sev-${iss.severity || 'medium'}`}>{t(`food.inv.severity_${iss.severity || 'medium'}`)}</span>
                  <span className={`fd-tag fd-inv-status-${iss.status || 'open'}`}>{iss.status || 'open'}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Waste log tab */}
        {tab === 'waste' && (
          <div>
            <div className="fd-inv-bar">
              <span className="fd-card-meta">{t('food.inv.wasteHint')}</span>
            </div>
            <div className="fd-inv-list">
              {filteredItems.length === 0 && <div className="fd-empty">{t('food.inv.noItems')}</div>}
              {items.map((item) => (
                <div key={item.id} className="fd-inv-item">
                  <div className="fd-inv-item-main">
                    <strong>{item.name}</strong>
                  </div>
                  <button
                    className="fd-btn-sm fd-btn-danger"
                    onClick={() => { setAdjustItem({ ...item, _forceType: 'waste' }); }}
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
          item={adjustItem}
          onSave={handleAdjust}
          onClose={() => setAdjustItem(null)}
        />
      )}
      {showRequest && (
        <RequestModal
          restaurantId={restaurantId}
          onSaved={loadRequests}
          onClose={() => setShowRequest(false)}
        />
      )}
      {showIssue && (
        <IssueModal
          restaurantId={restaurantId}
          onSaved={loadIssues}
          onClose={() => setShowIssue(false)}
        />
      )}
    </PageShell>
  );
}
