// RestaurantCrewPage — web crew/training management for restaurant operators.
// Mirrors the OxSteed Crew iOS app: shifts, tasks, checklists, SOPs, training.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import { getFoodRestaurant } from '../../api/food';
import { FoodBrand } from './foodShared';
import PageShell from '../../components/PageShell';
import '../../styles/FoodPages.css';

const TABS = ['shifts', 'tasks', 'checklists', 'sops'];

function ChecklistModal({ restaurantId, onSaved, onClose }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [type, setType] = useState('opening');
  const [saving, setSaving] = useState(false);

  const handle = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await api.post(`/restaurants/${restaurantId}/checklists`, { title, type });
      toast.success(t('food.crew.checklistCreated'));
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
        <h3>{t('food.crew.newChecklist')}</h3>
        <div className="fd-field">
          <label>{t('food.crew.checklistTitle')}</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="fd-field">
          <label>{t('food.crew.checklistType')}</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {['opening', 'closing', 'prep', 'cleaning'].map((ct) => (
              <option key={ct} value={ct}>{t(`food.crew.chkType_${ct}`)}</option>
            ))}
          </select>
        </div>
        <div className="fd-pos-modal-actions">
          <button className="fd-btn-secondary" onClick={onClose}>{t('food.common.cancel')}</button>
          <button className="fd-btn" onClick={handle} disabled={saving || !title.trim()}>
            {saving ? t('food.common.saving') : t('food.crew.create')}
          </button>
        </div>
      </div>
    </div>
  );
}

function SOPModal({ restaurantId, onSaved, onClose }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ title: '', category: 'general', content: '' });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const handle = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      await api.post(`/restaurants/${restaurantId}/sops`, form);
      toast.success(t('food.crew.sopCreated'));
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
        <h3>{t('food.crew.newSOP')}</h3>
        <div className="fd-field">
          <label>{t('food.crew.sopTitle')}</label>
          <input value={form.title} onChange={(e) => set('title', e.target.value)} />
        </div>
        <div className="fd-field">
          <label>{t('food.crew.sopCategory')}</label>
          <select value={form.category} onChange={(e) => set('category', e.target.value)}>
            {['general', 'food_safety', 'cleaning', 'service', 'emergency'].map((c) => (
              <option key={c} value={c}>{t(`food.crew.sopCat_${c}`)}</option>
            ))}
          </select>
        </div>
        <div className="fd-field">
          <label>{t('food.crew.sopContent')}</label>
          <textarea rows={5} value={form.content} onChange={(e) => set('content', e.target.value)} />
        </div>
        <div className="fd-pos-modal-actions">
          <button className="fd-btn-secondary" onClick={onClose}>{t('food.common.cancel')}</button>
          <button className="fd-btn" onClick={handle} disabled={saving || !form.title.trim()}>
            {saving ? t('food.common.saving') : t('food.crew.create')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RestaurantCrewPage() {
  const { restaurantId } = useParams();
  const { t } = useTranslation();

  const [restaurant, setRestaurant] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [shifts, setShifts] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [checklists, setChecklists] = useState([]);
  const [sops, setSops] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('shifts');

  const [showChecklist, setShowChecklist] = useState(false);
  const [showSOP, setShowSOP] = useState(false);

  const timerRef = useRef(null);
  const POLL_MS = 15000;

  const loadDash = useCallback(async () => {
    try {
      const [dashRes, shiftsRes, tasksRes] = await Promise.all([
        api.get(`/restaurants/${restaurantId}/crew/dashboard`).catch(() => ({ data: {} })),
        api.get(`/restaurants/${restaurantId}/crew/shifts`).catch(() => ({ data: { shifts: [] } })),
        api.get(`/restaurants/${restaurantId}/crew/tasks`).catch(() => ({ data: { tasks: [] } })),
      ]);
      setDashboard(dashRes.data?.dashboard || dashRes.data || null);
      setShifts(shiftsRes.data?.shifts || []);
      setTasks(tasksRes.data?.tasks || []);
    } catch {
      toast.error(t('food.common.loadError'));
    }
  }, [restaurantId, t]);

  const loadChecklists = useCallback(async () => {
    const res = await api.get(`/restaurants/${restaurantId}/checklists`).catch(() => ({ data: { checklists: [] } }));
    setChecklists(res.data?.checklists || res.data || []);
  }, [restaurantId]);

  const loadSOPs = useCallback(async () => {
    const res = await api.get(`/restaurants/${restaurantId}/sops`).catch(() => ({ data: { sops: [] } }));
    setSops(res.data?.sops || res.data || []);
  }, [restaurantId]);

  useEffect(() => {
    getFoodRestaurant(restaurantId).then((r) => setRestaurant(r?.restaurant || r)).catch(() => {});
    Promise.all([loadDash(), loadChecklists(), loadSOPs()]).finally(() => setLoading(false));
    timerRef.current = setInterval(loadDash, POLL_MS);
    return () => clearInterval(timerRef.current);
  }, [loadDash, loadChecklists, loadSOPs, restaurantId]);

  const completeTask = async (taskId) => {
    try {
      await api.patch(`/restaurants/${restaurantId}/crew/tasks`, { taskId, status: 'completed' });
      setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, status: 'completed' } : t));
    } catch {
      toast.error(t('food.common.loadError'));
    }
  };

  const openTasks = tasks.filter((t) => t.status !== 'completed');
  const completedTasks = tasks.filter((t) => t.status === 'completed');

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
          <h1 className="fd-hero-title">{restaurant?.name} — {t('food.crew.title')}</h1>
          <Link className="fd-btn-secondary fd-btn-sm" to="/restaurants/merchant">{t('food.common.back')}</Link>
        </div>

        {/* KPI strip */}
        <div className="fd-inv-kpis">
          <div className="fd-inv-kpi">
            <div className="fd-inv-kpi-val">{shifts.length}</div>
            <div className="fd-inv-kpi-label">{t('food.crew.kpi_shifts')}</div>
          </div>
          <div className={`fd-inv-kpi${openTasks.length > 0 ? ' fd-inv-kpi--warn' : ''}`}>
            <div className="fd-inv-kpi-val">{openTasks.length}</div>
            <div className="fd-inv-kpi-label">{t('food.crew.kpi_tasks')}</div>
          </div>
          <div className="fd-inv-kpi">
            <div className="fd-inv-kpi-val">{checklists.length}</div>
            <div className="fd-inv-kpi-label">{t('food.crew.kpi_checklists')}</div>
          </div>
          <div className="fd-inv-kpi">
            <div className="fd-inv-kpi-val">{sops.length}</div>
            <div className="fd-inv-kpi-label">{t('food.crew.kpi_sops')}</div>
          </div>
        </div>

        {/* Tab nav */}
        <div className="fd-inv-tabs">
          {TABS.map((tb) => (
            <button key={tb} className={`fd-inv-tab${tab === tb ? ' fd-active' : ''}`} onClick={() => setTab(tb)}>
              {t(`food.crew.tab_${tb}`)}
            </button>
          ))}
        </div>

        {/* Shifts tab */}
        {tab === 'shifts' && (
          <div className="fd-crew-section">
            {shifts.length === 0 && <div className="fd-empty">{t('food.crew.noShifts')}</div>}
            {shifts.map((sh) => (
              <div key={sh.id} className="fd-crew-shift">
                <div className="fd-crew-shift-main">
                  <strong>{sh.employee_name || sh.role || t('food.crew.unnamedShift')}</strong>
                  <span className="fd-tag">{sh.role}</span>
                </div>
                <div className="fd-crew-shift-time">
                  {sh.start_time && <span>{sh.start_time}</span>}
                  {sh.end_time && <span> – {sh.end_time}</span>}
                </div>
                <span className={`fd-tag fd-inv-status-${sh.status || 'scheduled'}`}>{sh.status || 'scheduled'}</span>
              </div>
            ))}
          </div>
        )}

        {/* Tasks tab */}
        {tab === 'tasks' && (
          <div className="fd-crew-section">
            {tasks.length === 0 && <div className="fd-empty">{t('food.crew.noTasks')}</div>}

            {openTasks.length > 0 && (
              <>
                <div className="fd-crew-subsection-label">{t('food.crew.openTasks')}</div>
                {openTasks.map((task) => (
                  <div key={task.id} className="fd-crew-task">
                    <div className="fd-crew-task-main">
                      <strong>{task.title || task.name}</strong>
                      {task.assigned_to && <span className="fd-card-meta">{task.assigned_to}</span>}
                    </div>
                    {task.priority && <span className={`fd-tag fd-crew-prio-${task.priority}`}>{task.priority}</span>}
                    <button className="fd-btn-sm fd-btn" onClick={() => completeTask(task.id)}>
                      ✓
                    </button>
                  </div>
                ))}
              </>
            )}

            {completedTasks.length > 0 && (
              <>
                <div className="fd-crew-subsection-label" style={{ marginTop: '1rem' }}>{t('food.crew.completedTasks')}</div>
                {completedTasks.map((task) => (
                  <div key={task.id} className="fd-crew-task fd-crew-task--done">
                    <div className="fd-crew-task-main">
                      <strong>{task.title || task.name}</strong>
                    </div>
                    <span className="fd-tag">{t('food.crew.done')}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* Checklists tab */}
        {tab === 'checklists' && (
          <div className="fd-crew-section">
            <div className="fd-inv-bar">
              <button className="fd-btn" onClick={() => setShowChecklist(true)}>{t('food.crew.newChecklist')}</button>
            </div>
            {checklists.length === 0 && <div className="fd-empty">{t('food.crew.noChecklists')}</div>}
            {checklists.map((cl) => (
              <div key={cl.id} className="fd-crew-checklist">
                <div className="fd-crew-shift-main">
                  <strong>{cl.title}</strong>
                  <span className="fd-tag">{cl.type}</span>
                </div>
                {cl.items_count != null && (
                  <span className="fd-card-meta">{cl.items_count} {t('food.crew.items')}</span>
                )}
                <span className={`fd-tag fd-inv-status-${cl.status || 'active'}`}>{cl.status || 'active'}</span>
              </div>
            ))}
          </div>
        )}

        {/* SOPs tab */}
        {tab === 'sops' && (
          <div className="fd-crew-section">
            <div className="fd-inv-bar">
              <button className="fd-btn" onClick={() => setShowSOP(true)}>{t('food.crew.newSOP')}</button>
            </div>
            {sops.length === 0 && <div className="fd-empty">{t('food.crew.noSOPs')}</div>}
            {sops.map((sop) => (
              <div key={sop.id} className="fd-crew-sop">
                <div className="fd-crew-shift-main">
                  <strong>{sop.title}</strong>
                  <span className="fd-tag">{sop.category}</span>
                </div>
                {sop.content && (
                  <p className="fd-crew-sop-preview">{sop.content.substring(0, 120)}{sop.content.length > 120 ? '…' : ''}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {showChecklist && (
        <ChecklistModal
          restaurantId={restaurantId}
          onSaved={loadChecklists}
          onClose={() => setShowChecklist(false)}
        />
      )}
      {showSOP && (
        <SOPModal
          restaurantId={restaurantId}
          onSaved={loadSOPs}
          onClose={() => setShowSOP(false)}
        />
      )}
    </PageShell>
  );
}
