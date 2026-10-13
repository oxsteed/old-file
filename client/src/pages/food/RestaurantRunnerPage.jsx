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

const TASK_STATUSES = ['Assigned', 'En route', 'Completed', 'Issue'];

// F14: surface the proof-required 409 as a specific message instead of the
// generic loadError toast.
function runnerActionErrorKey(err) {
  return err?.response?.data?.code || err?.response?.data?.error_code || null;
}

function LocationShareToggle({ task, restaurantId }) {
  const { t } = useTranslation();
  const [sharing, setSharing] = useState(false);
  const watchRef = useRef(null);
  const lastPingRef = useRef(0);

  const stop = useCallback(() => {
    if (watchRef.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchRef.current);
    }
    watchRef.current = null;
    setSharing(false);
  }, []);

  useEffect(() => () => stop(), [stop]);
  useEffect(() => {
    // Stop sharing once the task is no longer en route.
    if (sharing && task.status !== 'En route') stop();
  }, [task.status, sharing, stop]);

  const start = () => {
    if (!navigator.geolocation) {
      toast.error(t('food.runner.geoUnsupported'));
      return;
    }
    const post = (coords) => {
      const now = Date.now();
      if (now - lastPingRef.current < 15000) return;
      lastPingRef.current = now;
      api.post(`/restaurants/${restaurantId}/runner/tasks/${task.id}/location`, {
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracyMeters: coords.accuracy,
      }).catch(() => {});
    };
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => post(pos.coords),
      () => {
        toast.error(t('food.runner.geoDenied'));
        stop();
      },
      { enableHighAccuracy: false, maximumAge: 10000, timeout: 15000 }
    );
    setSharing(true);
  };

  if (task.status !== 'En route') return null;
  return (
    <button
      className={`fd-btn-secondary fd-btn-sm${sharing ? ' fd-active' : ''}`}
      onClick={() => (sharing ? stop() : start())}
    >
      {sharing ? t('food.runner.stopSharing') : t('food.runner.shareLocation')}
    </button>
  );
}

function ProofModal({ task, restaurantId, onSaved, onClose }) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const handle = async () => {
    setSaving(true);
    try {
      // F17: the server reads `method` (accepts legacy `proof_type` too).
      await api.post(`/restaurants/${restaurantId}/runner/tasks/${task.id}/proofs`, { note, method: 'delivery' });
      toast.success(t('food.runner.proofSaved'));
      onSaved();
      onClose();
    } catch (err) {
      if (runnerActionErrorKey(err) === 'runner_proof_required') {
        toast.error(t('food.runner.proofRequired'));
      } else {
        toast.error(t('food.common.loadError'));
      }
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
  const [note, setNote] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [saving, setSaving] = useState(false);

  const handle = async () => {
    if (!note.trim()) return;
    setSaving(true);
    try {
      await api.post(`/restaurants/${restaurantId}/runner/tasks/${task.id}/issues`, { note, severity });
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
          <label>{t('food.runner.issueSeverity')}</label>
          <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
            {['low', 'medium', 'high', 'critical'].map((s) => (
              <option key={s} value={s}>{t(`food.runner.severity_${s}`)}</option>
            ))}
          </select>
        </div>
        <div className="fd-field">
          <label>{t('food.runner.issueDesc')}</label>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} required />
        </div>
        <div className="fd-pos-modal-actions">
          <button className="fd-btn-secondary" onClick={onClose}>{t('food.common.cancel')}</button>
          <button className="fd-btn" onClick={handle} disabled={saving || !note.trim()}>
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

  const advance = async (newStatus) => {    setBusy(true);
    try {
      await api.patch(`/restaurants/${restaurantId}/runner/tasks/${task.id}/status`, { status: newStatus });
      onRefresh();
    } catch (err) {
      // F14: the proof-required 409 must not surface as a generic load error.
      if (runnerActionErrorKey(err) === 'runner_proof_required') {
        toast.error(t('food.runner.proofRequired'));
        setShowProof(true);
      } else {
        toast.error(t('food.common.loadError'));
      }
    } finally {
      setBusy(false);
    }
  };

  const statusColor = {
    assigned: '#f97316',
    'En route': '#3b82f6',
    'Completed': '#22c55e',
    'Issue': '#ef4444',
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
        {task.status === 'Assigned' && (
          <button className="fd-btn fd-btn-sm" disabled={busy} onClick={() => advance('En route')}>
            {t('food.runner.startDelivery')}
          </button>
        )}
        {task.status === 'En route' && (
          <button className="fd-btn fd-btn-sm" disabled={busy} onClick={() => advance('Completed')}>
            {t('food.runner.markDelivered')}
          </button>
        )}
        {task.status === 'Completed' && (
          <button
            className="fd-btn-secondary fd-btn-sm"
            disabled={busy}
            onClick={async () => {
              const raw = window.prompt(t('food.runner.cashCollectedPrompt'));
              if (raw === null) return;
              const cents = Math.round(Number(raw) * 100);
              if (!Number.isFinite(cents) || cents < 0) {
                toast.error(t('food.common.loadError'));
                return;
              }
              setBusy(true);
              try {
                await api.post(`/restaurants/${restaurantId}/runner/tasks/${task.id}/settlements`, {
                  status: 'pending',
                  cashCollectedCents: cents,
                });
                toast.success(t('food.runner.settlementCreated'));
                onRefresh();
              } catch (err) {
                toast.error(err?.response?.data?.message || t('food.common.loadError'));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('food.runner.createSettlement')}
          </button>
        )}
        <LocationShareToggle task={task} restaurantId={restaurantId} />
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

function SettlementsSection({ restaurantId, refreshSignal }) {
  const { t } = useTranslation();
  const [settlements, setSettlements] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/restaurants/${restaurantId}/runner/settlements`);
      setSettlements(data?.settlements || []);
    } catch {
      // Settlements are advisory; the runner page works without them.
    }
  }, [restaurantId]);

  useEffect(() => { load(); }, [load, refreshSignal]);

  const mutate = async (taskId, body, successKey) => {
    setBusy(true);
    try {
      await api.post(`/restaurants/${restaurantId}/runner/tasks/${taskId}/settlements`, body);
      toast.success(t(successKey));
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || t('food.common.loadError'));
    } finally {
      setBusy(false);
    }
  };

  const fmt = (cents) => `${(Number(cents || 0) / 100).toFixed(2)}`;

  return (
    <div style={{ marginTop: '2rem' }}>
      <h2 className="fd-runner-section-title">{t('food.runner.settlements')}</h2>
      {settlements.length === 0 && <div className="fd-empty">{t('food.runner.noSettlements')}</div>}
      {settlements.map((s) => (
        <div key={s.id} className="fd-runner-card">
          <div className="fd-runner-card-head">
            <div>
              <strong>#{s.task_id}</strong>
              <span className="fd-card-meta"> · {t(`food.runner.settlement_${s.status}`, s.status)}</span>
            </div>
            <span className="fd-tag">{fmt(Number(s.delivery_fee_cents || 0) + Number(s.tip_cents || 0))}</span>
          </div>
          <div className="fd-card-meta">
            {t('food.runner.cashCollected')}: {fmt(s.cash_collected_cents)} · {t('food.runner.cashRemitted')}: {fmt(s.cash_remitted_cents)}
          </div>
          <div className="fd-runner-actions">
            {s.status === 'pending' && (
              <button className="fd-btn fd-btn-sm" disabled={busy} onClick={() => mutate(s.task_id, { status: 'approved' }, 'food.runner.settlementApproved')}>
                {t('food.runner.approve')}
              </button>
            )}
            {s.status === 'approved' && (
              <button
                className="fd-btn fd-btn-sm"
                disabled={busy}
                onClick={() => {
                  const ref = window.prompt(t('food.runner.paymentReferencePrompt'));
                  if (!ref) return;
                  mutate(s.task_id, { status: 'paid', paymentReference: ref }, 'food.runner.settlementPaid');
                }}
              >
                {t('food.runner.markPaid')}
              </button>
            )}
            {['pending', 'approved'].includes(s.status) && Number(s.cash_collected_cents || 0) > 0 && (
              <button
                className="fd-btn-secondary fd-btn-sm"
                disabled={busy}
                onClick={() => {
                  const raw = window.prompt(t('food.runner.remitPrompt', { amount: fmt(s.cash_collected_cents) }));
                  const cents = Math.round(Number(raw) * 100);
                  if (!Number.isFinite(cents) || cents < 0) return;
                  mutate(s.task_id, { status: s.status, cashRemittedCents: cents }, 'food.runner.remittanceRecorded');
                }}
              >
                {t('food.runner.recordRemittance')}
              </button>
            )}
          </div>
        </div>
      ))}
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
  const [settlementTick, setSettlementTick] = useState(0);

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
      setSettlementTick((n) => n + 1);
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

  const activeCount = tasks.filter((t) => ['Assigned', 'En route'].includes(t.status)).length;
  const deliveredCount = tasks.filter((t) => t.status === 'Completed').length;

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
            <div className="fd-inv-kpi-val">{tasks.filter((t) => t.status === 'Issue').length}</div>
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

        {/* Settlements (F05): approve / mark-paid / remittance UI for the
            settlement endpoints that were previously API-only. */}
        <SettlementsSection restaurantId={restaurantId} refreshSignal={settlementTick} />
      </div>
    </PageShell>
  );
}
