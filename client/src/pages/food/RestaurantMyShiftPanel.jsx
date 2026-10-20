// RestaurantMyShiftPanel — the staff "My shift" home (staff review S-02),
// mounted as a tab in FoodMerchantPage for every restaurant member, not
// just managers. It reuses the existing operations surfaces in staff mode:
//   announcements (S-17) with acknowledgement,
//   my schedule (crew shifts on the board),
//   my crew tasks with photo proof,
//   checklists to run (ChecklistsPanel, staffMode),
//   my training (TrainingPanel staff mode),
//   SOPs read-only (SopsPanel, staffMode),
//   the manager log book (read for all, write for managers).
// All strings use t() keys from the food.myShift namespace; dates are
// formatted with the active app locale (S-19).

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import { apiErrorMessage } from './foodShared';
import { ChecklistsPanel, SopsPanel } from './RestaurantOpsPanels';
import { TrainingPanel } from './RestaurantTrainingPanels';

export default function RestaurantMyShiftPanel({ restaurant, canManageRestaurant }) {
  const { t, i18n } = useTranslation();
  const restaurantId = restaurant.id;

  const fmtDateTime = useCallback((value) => {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat(i18n.language, {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    }).format(d);
  }, [i18n.language]);

  const fmtDate = useCallback((value) => {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat(i18n.language, { month: 'short', day: 'numeric' }).format(d);
  }, [i18n.language]);

  // ── Announcements ──────────────────────────────────────────────────────
  const [announcements, setAnnouncements] = useState([]);
  const [annTitle, setAnnTitle] = useState('');
  const [annBody, setAnnBody] = useState('');
  const [annBusy, setAnnBusy] = useState(false);

  const loadAnnouncements = useCallback(async () => {
    try {
      const res = await api.get(`/restaurants/${restaurantId}/announcements`);
      setAnnouncements(res.data?.announcements || []);
    } catch (err) {
      toast.error(apiErrorMessage(err, t('food.common.loadError')));
    }
  }, [restaurantId, t]);
  useEffect(() => { loadAnnouncements(); }, [loadAnnouncements]);

  const postAnnouncement = async (e) => {
    e.preventDefault();
    if (!annTitle.trim()) return;
    setAnnBusy(true);
    try {
      const res = await api.post(`/restaurants/${restaurantId}/announcements`, {
        title: annTitle.trim(),
        body: annBody.trim(),
      });
      setAnnouncements((prev) => [res.data.announcement, ...prev]);
      setAnnTitle('');
      setAnnBody('');
      toast.success(t('food.myShift.announcementPosted'));
    } catch (err) {
      toast.error(apiErrorMessage(err, t('food.common.loadError')));
    } finally {
      setAnnBusy(false);
    }
  };

  const acknowledge = async (announcement) => {
    try {
      const res = await api.post(
        `/restaurants/${restaurantId}/announcements/${announcement.id}/acknowledge`
      );
      setAnnouncements((prev) => prev.map((a) => (a.id === announcement.id
        ? { ...a, acknowledged_by_me: true, ack_count: res.data.ack_count }
        : a)));
    } catch (err) {
      toast.error(apiErrorMessage(err, t('food.common.loadError')));
    }
  };

  // ── My schedule ────────────────────────────────────────────────────────
  const [shifts, setShifts] = useState([]);
  useEffect(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    api.get(`/restaurants/${restaurantId}/crew/shifts`, {
      params: { from: startOfToday.toISOString() },
    })
      .then((res) => {
        const rows = (res.data?.shifts || [])
          .slice()
          .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
        setShifts(rows.slice(0, 10));
      })
      .catch(() => {});
  }, [restaurantId]);

  // ── My tasks ───────────────────────────────────────────────────────────
  const [tasks, setTasks] = useState([]);
  const [proofByTask, setProofByTask] = useState({});
  const [busyTaskId, setBusyTaskId] = useState(null);

  const loadTasks = useCallback(async () => {
    try {
      const res = await api.get(`/restaurants/${restaurantId}/crew/tasks`, { params: { mine: '1' } });
      const rows = res.data?.tasks || [];
      setTasks(rows);
      const photoTasks = rows.filter((task) => task.requires_photo && !['completed', 'cancelled'].includes(task.status));
      if (photoTasks.length) {
        const results = await Promise.all(photoTasks.map((task) =>
          api.get(`/restaurants/${restaurantId}/crew/tasks/${task.id}/proofs`)
            .then((r) => [task.id, (r.data?.proofs || []).some((p) => p.proof_type === 'photo')])
            .catch(() => [task.id, false])
        ));
        setProofByTask(Object.fromEntries(results));
      }
    } catch (err) {
      toast.error(apiErrorMessage(err, t('food.common.loadError')));
    }
  }, [restaurantId, t]);
  useEffect(() => { loadTasks(); }, [loadTasks]);

  const setTaskStatus = async (task, status) => {
    setBusyTaskId(task.id);
    try {
      const res = await api.patch(`/restaurants/${restaurantId}/crew/tasks/${task.id}`, { status });
      setTasks((prev) => prev.map((x) => (x.id === task.id ? res.data.task : x)));
    } catch (err) {
      const code = err?.response?.data?.error?.code || err?.response?.data?.code;
      toast.error(code === 'crew_photo_required'
        ? t('food.myShift.proofRequired')
        : apiErrorMessage(err, t('food.common.loadError')));
    } finally {
      setBusyTaskId(null);
    }
  };

  const uploadProof = async (task, file) => {
    if (!file) return;
    setBusyTaskId(task.id);
    try {
      const form = new FormData();
      form.append('file', file);
      await api.post(`/restaurants/${restaurantId}/crew/tasks/${task.id}/proofs/upload`, form);
      setProofByTask((prev) => ({ ...prev, [task.id]: true }));
      toast.success(t('food.myShift.proofUploaded'));
    } catch (err) {
      toast.error(apiErrorMessage(err, t('food.common.loadError')));
    } finally {
      setBusyTaskId(null);
    }
  };

  const openTasks = tasks.filter((task) => !['completed', 'cancelled'].includes(task.status));
  const doneTasks = tasks.filter((task) => task.status === 'completed');

  // ── Log book ───────────────────────────────────────────────────────────
  const [logEntries, setLogEntries] = useState([]);
  const [logBody, setLogBody] = useState('');
  const [logBusy, setLogBusy] = useState(false);

  const loadLogbook = useCallback(async () => {
    try {
      const res = await api.get(`/restaurants/${restaurantId}/logbook`);
      setLogEntries(res.data?.entries || []);
    } catch (err) {
      toast.error(apiErrorMessage(err, t('food.common.loadError')));
    }
  }, [restaurantId, t]);
  useEffect(() => { loadLogbook(); }, [loadLogbook]);

  const addLogEntry = async (e) => {
    e.preventDefault();
    if (!logBody.trim()) return;
    setLogBusy(true);
    try {
      const res = await api.post(`/restaurants/${restaurantId}/logbook`, { body: logBody.trim() });
      setLogEntries((prev) => [res.data.entry, ...prev]);
      setLogBody('');
      toast.success(t('food.myShift.logbookAdded'));
    } catch (err) {
      toast.error(apiErrorMessage(err, t('food.common.loadError')));
    } finally {
      setLogBusy(false);
    }
  };

  const authorName = (row) => [row.author_first_name, row.author_last_name].filter(Boolean).join(' ');

  return (
    <div className="fd-section">
      <h2>{t('food.myShift.title')}</h2>
      <p className="fd-card-meta">{t('food.myShift.subtitle')}</p>

      {/* Announcements (S-17) */}
      <section className="fd-card fd-myshift-section" aria-label={t('food.myShift.announcements')}>
        <h3>{t('food.myShift.announcements')}</h3>
        {canManageRestaurant && (
          <form onSubmit={postAnnouncement} className="fd-ops-form" data-track="ui.44c3bc07ea.1">
            <div className="fd-field">
              <label htmlFor="myshift-ann-title">{t('food.myShift.announcementTitleLabel')}</label>
              <input
                id="myshift-ann-title"
                value={annTitle}
                onChange={(e) => setAnnTitle(e.target.value)}
                maxLength={200}
              />
            </div>
            <div className="fd-field">
              <label htmlFor="myshift-ann-body">{t('food.myShift.announcementBodyLabel')}</label>
              <textarea
                id="myshift-ann-body"
                rows={3}
                value={annBody}
                onChange={(e) => setAnnBody(e.target.value)}
                maxLength={4000}
              />
            </div>
            <div className="fd-settings-actions">
              <button type="submit" className="fd-btn fd-btn-sm" disabled={annBusy || !annTitle.trim()} data-track="ui.44c3bc07ea.2">
                {t('food.myShift.postAnnouncement')}
              </button>
            </div>
          </form>
        )}
        {announcements.length === 0 ? (
          <p className="fd-card-meta">{t('food.myShift.announcementsEmpty')}</p>
        ) : (
          <div className="fd-ops-run-list">
            {announcements.map((a) => (
              <div key={a.id} className="fd-ops-run-row">
                <span>
                  <strong>{a.title}</strong>
                  {a.body && <span className="fd-card-meta"> · {a.body}</span>}
                  <span className="fd-card-meta">
                    {' '}
                    · {authorName(a)} · {fmtDate(a.created_at)}
                    {' '}· {t('food.myShift.ackCount', { count: a.ack_count })}
                  </span>
                </span>
                {a.acknowledged_by_me ? (
                  <span className="fd-tag">{t('food.myShift.acknowledged')}</span>
                ) : (
                  <button
                    type="button"
                    className="fd-btn fd-btn-sm"
                    onClick={() => acknowledge(a)} data-track="ui.44c3bc07ea.3"
                  >
                    {t('food.myShift.acknowledge')}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* My schedule */}
      <section className="fd-card fd-myshift-section" aria-label={t('food.myShift.schedule')}>
        <h3>{t('food.myShift.schedule')}</h3>
        {shifts.length === 0 ? (
          <p className="fd-card-meta">{t('food.myShift.scheduleEmpty')}</p>
        ) : (
          <div className="fd-ops-run-list">
            {shifts.map((shift) => (
              <div key={shift.id} className="fd-ops-run-row">
                <span>{shift.label}</span>
                <span className="fd-card-meta">
                  {fmtDateTime(shift.starts_at)} – {fmtDateTime(shift.ends_at)}
                  {' '}
                  <span className="fd-tag">{t(`food.myShift.shiftStatus.${shift.status}`)}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* My tasks */}
      <section className="fd-card fd-myshift-section" aria-label={t('food.myShift.tasks')}>
        <h3>{t('food.myShift.tasks')}</h3>
        {openTasks.length === 0 && doneTasks.length === 0 ? (
          <p className="fd-card-meta">{t('food.myShift.tasksEmpty')}</p>
        ) : (
          <div className="fd-ops-run-list">
            {openTasks.map((task) => (
              <div key={task.id} className="fd-ops-run-row">
                <span>
                  <strong>{task.title}</strong>
                  {task.detail && <span className="fd-card-meta"> · {task.detail}</span>}
                  <span className="fd-card-meta">
                    {' '}· <span className="fd-tag">{t(`food.myShift.taskPriority.${task.priority}`)}</span>
                    {' '}<span className="fd-tag">{t(`food.myShift.taskStatus.${task.status}`)}</span>
                    {task.due_at && ` · ${t('food.myShift.dueAt', { date: fmtDate(task.due_at) })}`}
                    {task.requires_photo && ` · ${t('food.myShift.photoProof')}`}
                  </span>
                </span>
                <span className="fd-myshift-actions">
                  {task.requires_photo && (
                    <>
                      <label className="fd-btn fd-btn-secondary fd-btn-sm" htmlFor={`myshift-proof-${task.id}`}>
                        {t('food.myShift.addProof')}
                      </label>
                      <input
                        id={`myshift-proof-${task.id}`}
                        type="file"
                        accept="image/*"
                        className="fd-visually-hidden"
                        onChange={(e) => { uploadProof(task, e.target.files?.[0]); e.target.value = ''; }}
                      />
                    </>
                  )}
                  {task.status === 'not_started' && (
                    <button
                      type="button"
                      className="fd-btn fd-btn-sm"
                      disabled={busyTaskId === task.id}
                      onClick={() => setTaskStatus(task, 'in_progress')} data-track="ui.44c3bc07ea.4"
                    >
                      {t('food.myShift.startTask')}
                    </button>
                  )}
                  {task.status === 'in_progress' && task.requires_approval && (
                    <button
                      type="button"
                      className="fd-btn fd-btn-sm"
                      disabled={busyTaskId === task.id || (task.requires_photo && !proofByTask[task.id])}
                      onClick={() => setTaskStatus(task, 'needs_approval')} data-track="ui.44c3bc07ea.5"
                    >
                      {t('food.myShift.submitForApproval')}
                    </button>
                  )}
                  {task.status === 'in_progress' && !task.requires_approval && (
                    <button
                      type="button"
                      className="fd-btn fd-btn-sm"
                      disabled={busyTaskId === task.id || (task.requires_photo && !proofByTask[task.id])}
                      onClick={() => setTaskStatus(task, 'completed')} data-track="ui.44c3bc07ea.6"
                    >
                      {t('food.myShift.completeTask')}
                    </button>
                  )}
                  {task.status === 'needs_approval' && (
                    <span className="fd-tag">{t('food.myShift.waitingApproval')}</span>
                  )}
                </span>
              </div>
            ))}
            {doneTasks.map((task) => (
              <div key={task.id} className="fd-ops-run-row">
                <span>{task.title}</span>
                <span className="fd-tag">{t('food.myShift.taskStatus.completed')}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Checklists to run (staff mode: no template management) */}
      <section className="fd-card fd-myshift-section" aria-label={t('food.myShift.checklists')}>
        <h3>{t('food.myShift.checklists')}</h3>
        <ChecklistsPanel t={t} restaurant={restaurant} bare staffMode />
      </section>

      {/* My training (existing staff mode) */}
      <section className="fd-card fd-myshift-section" aria-label={t('food.myShift.training')}>
        <h3>{t('food.myShift.training')}</h3>
        <TrainingPanel t={t} restaurant={restaurant} bare isManager={false} />
      </section>

      {/* SOPs, read-only for staff */}
      <section className="fd-card fd-myshift-section" aria-label={t('food.myShift.sops')}>
        <h3>{t('food.myShift.sops')}</h3>
        <SopsPanel t={t} restaurant={restaurant} bare staffMode />
      </section>

      {/* Manager log book (S-17) */}
      <section className="fd-card fd-myshift-section" aria-label={t('food.myShift.logbook')}>
        <h3>{t('food.myShift.logbook')}</h3>
        {canManageRestaurant && (
          <form onSubmit={addLogEntry} className="fd-ops-form" data-track="ui.44c3bc07ea.7">
            <div className="fd-field">
              <label htmlFor="myshift-log-body">{t('food.myShift.logbookLabel')}</label>
              <textarea
                id="myshift-log-body"
                rows={3}
                value={logBody}
                onChange={(e) => setLogBody(e.target.value)}
                placeholder={t('food.myShift.logbookPlaceholder')}
                maxLength={4000}
              />
            </div>
            <div className="fd-settings-actions">
              <button type="submit" className="fd-btn fd-btn-sm" disabled={logBusy || !logBody.trim()} data-track="ui.44c3bc07ea.8">
                {t('food.myShift.addLogbookEntry')}
              </button>
            </div>
          </form>
        )}
        {logEntries.length === 0 ? (
          <p className="fd-card-meta">{t('food.myShift.logbookEmpty')}</p>
        ) : (
          <div className="fd-ops-run-list">
            {logEntries.map((entry) => (
              <div key={entry.id} className="fd-ops-run-row">
                <span>
                  {entry.body}
                  {entry.shift_label && <span className="fd-card-meta"> · {entry.shift_label}</span>}
                </span>
                <span className="fd-card-meta">
                  {authorName(entry)} · {fmtDateTime(entry.created_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
