// RestaurantRunnerPage — web runner/delivery management for restaurant operators.
// Mirrors the OxSteed Runner iOS app: delivery dashboard, task claiming,
// status updates, proof of delivery, issue reporting.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import { getFoodRestaurant } from '../../api/food';
import { FoodBrand } from './foodShared';
import PageShell from '../../components/PageShell';
import '../../styles/FoodPages.css';

const TASK_STATUSES = ['assigned', 'en_route', 'delivered', 'failed'];

function ProofModal({ task, restaurantId, onSaved, onClose }) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const handle = async () => {
    setSaving(true);
    try {
      await api.post(`/restaurants/${restaurantId}/runner/tasks/${task.id}/proofs`, { note, proof_type: 'delivery' });
      toast.success(t('food.runner.proofSaved'));
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
        <h3>{t('food.runner.logProof')}</h3>
        <p className="fd-card-meta">{t('food.runner.proofFor')}: {task.order_number || task.id}</p>
        <div className="fd-field">
          <label>{t('food.runner.proofNote')}</label>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('food.runner.proofPlaceholder')} />
        </div>
        <div className="fd-pos-modal-actions">
          <button className="fd-btn-secondary" onClick={onClose}>{t('food.common.cancel')}</button>
          <button className="fd-btn" onClick={handle} disabled={saving}>
            {saving ? t('food.common.saving') : t('food.runner.saveProof')}
          </button>
        </div>
      </div>
    </div>
  );
}

function IssueModal({ task, restaurantId, onSaved, onClose }) {
  const { t } = useTranslation();
  const [description, setDescription] = useState('');
  const [type, setType] = useState('delivery_failure');
  const [saving, setSaving] = useState(false);

  const handle = async () => {
    if (!description.trim()) return;
    setSaving(true);
    try {
      await api.post(`/restaurants/${restaurantId}/runner/tasks/${task.id}/issues`, { description, issue_type: type });
      toast.success(t('food.runner.issueSent'));
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
        <h3>{t('food.runner.reportIssue')}</h3>
        <div className="fd-field">
          <label>{t('food.runner.issueType')}</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {['delivery_failure', 'wrong_address', 'customer_absent', 'damaged', 'other'].map((it) => (
              <option key={it} value={it}>{t(`food.runner.issueType_${it}`)}</option>
            ))}
          </select>
        </div>
        <div className="fd-field">
          <label>{t('food.runner.issueDesc')}</label>
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} required />
        </div>
        <div className="fd-pos-modal-actions">
          <button className="fd-btn-secondary" onClick={onClose}>{t('food.common.cancel')}</button>
          <button className="fd-btn" onClick={handle} disabled={saving || !description.trim()}>
            {saving ? t('food.common.saving') : t('food.runner.submit')}
          </button>
        </div>
      </div>
    </div>
  );
}

function TaskCard({ task, restaurantId, onRefresh }) {
  const { t } = useTranslation();
  const [showProof, setShowProof] = useState(false);
  const [showIssue, setShowIssue] = useState(false);
  const [busy, setBusy] = useState(false);

  const advance = async (newStatus) => {
    setBusy(true);
    try {
      await api.patch(`/restaurants/${restaurantId}/runner/tasks/${task.id}/status`, { status: newStatus });
      onRefresh();
    } catch {
      toast.error(t('food.common.loadError'));
    } finally {
      setBusy(false);
    }
  };

  const statusColor = {
    assigned: '#f97316',
    en_route: '#3b82f6',
    delivered: '#22c55e',
    failed: '#ef4444',
  }[task.status] || '#888';

  return (
    <div className="fd-runner-card">
      <div className="fd-runner-card-head">
        <div>
          <strong>#{task.order_number || task.id}</strong>
          {task.customer_name && <span className="fd-card-meta"> · {task.customer_name}</span>}
        </div>
        <span className="fd-tag" style={{ background: statusColor, color: '#fff' }}>{task.status}</span>
      </div>

      {task.delivery_address && (
        <div className="fd-runner-address">
          📍 {task.delivery_address}
        </div>
      )}

      {task.items_summary && (
        <div className="fd-card-meta">{task.items_summary}</div>
      )}

      <div className="fd-runner-actions">
        {task.status === 'assigned' && (
          <button className="fd-btn fd-btn-sm" disabled={busy} onClick={() => advance('en_route')}>
            {t('food.runner.startDelivery')}
          </button>
        )}
        {task.status === 'en_route' && (
          <button className="fd-btn fd-btn-sm" disabled={busy} onClick={() => advance('delivered')}>
            {t('food.runner.markDelivered')}
          </button>
        )}
        <button className="fd-btn-secondary fd-btn-sm" onClick={() => setShowProof(true)}>
          {t('food.runner.logProof')}
        </button>
        <button className="fd-btn-danger fd-btn-sm" onClick={() => setShowIssue(true)}>
          {t('food.runner.reportIssue')}
        </button>
      </div>

      {showProof && (
        <ProofModal task={task} restaurantId={restaurantId} onSaved={onRefresh} onClose={() => setShowProof(false)} />
      )}
      {showIssue && (
        <IssueModal task={task} restaurantId={restaurantId} onSaved={onRefresh} onClose={() => setShowIssue(false)} />
      )}
    </div>
  );
}

export default function RestaurantRunnerPage() {
  const { restaurantId } = useParams();
  const { t } = useTranslation();

  const [restaurant, setRestaurant] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');

  const timerRef = useRef(null);
  const POLL_MS = 8000;

  const loadData = useCallback(async () => {
    try {
      const [dashRes, offersRes] = await Promise.all([
        api.get(`/restaurants/${restaurantId}/runner/dashboard`).catch(() => ({ data: {} })),
        api.get(`/restaurants/${restaurantId}/runner/offers`).catch(() => ({ data: { offers: [] } })),
      ]);
      const dash = dashRes.data?.dashboard || dashRes.data || {};
      setDashboard(dash);
      setTasks(dash.active_tasks || dash.tasks || []);
      setOffers(offersRes.data?.offers || []);
    } catch {
      toast.error(t('food.common.loadError'));
    }
  }, [restaurantId, t]);

  useEffect(() => {
    getFoodRestaurant(restaurantId).then((r) => setRestaurant(r?.restaurant || r)).catch(() => {});
    loadData().finally(() => setLoading(false));
    timerRef.current = setInterval(loadData, POLL_MS);
    return () => clearInterval(timerRef.current);
  }, [loadData, restaurantId]);

  const claimOffer = async (offerId) => {
    try {
      await api.post(`/restaurants/${restaurantId}/runner/tasks/${offerId}/claim`);
      toast.success(t('food.runner.claimed'));
      loadData();
    } catch {
      toast.error(t('food.common.loadError'));
    }
  };

  const declineOffer = async (offerId) => {
    try {
      await api.post(`/restaurants/${restaurantId}/runner/tasks/${offerId}/decline`);
      loadData();
    } catch {
      toast.error(t('food.common.loadError'));
    }
  };

  const filteredTasks = statusFilter === 'all'
    ? tasks
    : tasks.filter((t) => t.status === statusFilter);

  const activeCount = tasks.filter((t) => ['assigned', 'en_route'].includes(t.status)).length;
  const deliveredCount = tasks.filter((t) => t.status === 'delivered').length;

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
          <h1 className="fd-hero-title">{restaurant?.name}: {t('food.runner.title')}</h1>
          <Link className="fd-btn-secondary fd-btn-sm" to="/restaurants/merchant">{t('food.common.back')}</Link>
        </div>

        {/* KPI strip */}
        <div className="fd-inv-kpis">
          <div className={`fd-inv-kpi${activeCount > 0 ? ' fd-inv-kpi--warn' : ''}`}>
            <div className="fd-inv-kpi-val">{activeCount}</div>
            <div className="fd-inv-kpi-label">{t('food.runner.kpi_active')}</div>
          </div>
          <div className="fd-inv-kpi">
            <div className="fd-inv-kpi-val">{deliveredCount}</div>
            <div className="fd-inv-kpi-label">{t('food.runner.kpi_delivered')}</div>
          </div>
          <div className="fd-inv-kpi">
            <div className="fd-inv-kpi-val">{offers.length}</div>
            <div className="fd-inv-kpi-label">{t('food.runner.kpi_offers')}</div>
          </div>
          <div className="fd-inv-kpi">
            <div className="fd-inv-kpi-val">{tasks.filter((t) => t.status === 'failed').length}</div>
            <div className="fd-inv-kpi-label">{t('food.runner.kpi_failed')}</div>
          </div>
        </div>

        {/* Open offers */}
        {offers.length > 0 && (
          <div style={{ marginBottom: '1.5rem' }}>
            <h2 className="fd-runner-section-title">{t('food.runner.newOffers')}</h2>
            {offers.map((offer) => (
              <div key={offer.id} className="fd-runner-offer">
                <div className="fd-runner-card-head">
                  <strong>#{offer.order_number || offer.id}</strong>
                  {offer.delivery_address && <span className="fd-card-meta"> · {offer.delivery_address}</span>}
                </div>
                <div className="fd-runner-offer-actions">
                  <button className="fd-btn fd-btn-sm" onClick={() => claimOffer(offer.id)}>{t('food.runner.claim')}</button>
                  <button className="fd-btn-secondary fd-btn-sm" onClick={() => declineOffer(offer.id)}>{t('food.runner.decline')}</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Status filter */}
        <div className="fd-inv-tabs" style={{ marginBottom: '1rem' }}>
          <button className={`fd-inv-tab${statusFilter === 'all' ? ' fd-active' : ''}`} onClick={() => setStatusFilter('all')}>
            {t('food.runner.filterAll')}
          </button>
          {TASK_STATUSES.map((s) => (
            <button key={s} className={`fd-inv-tab${statusFilter === s ? ' fd-active' : ''}`} onClick={() => setStatusFilter(s)}>
              {t(`food.runner.status_${s}`)}
            </button>
          ))}
        </div>

        {/* Task list */}
        <div className="fd-runner-list">
          {filteredTasks.length === 0 && <div className="fd-empty">{t('food.runner.noTasks')}</div>}
          {filteredTasks.map((task) => (
            <TaskCard key={task.id} task={task} restaurantId={restaurantId} onRefresh={loadData} />
          ))}
        </div>
      </div>
    </PageShell>
  );
}
