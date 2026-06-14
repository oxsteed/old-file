// OxSteed Restaurants — Operations panels (Phase 2): Checklists + SOP library.
// Mounted inside FoodMerchantPage's Operations tab. Talks to /api/restaurants.
//
// Management actions (create/edit templates, author SOPs) are owner/manager
// only; the backend enforces this and returns 403, which we surface as a toast.
// Running a checklist + checking off tasks is open to any active staff member.

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  listChecklists, createChecklist, deleteChecklist,
  addChecklistTask, deleteChecklistTask,
  startChecklistRun, listChecklistRuns, getChecklistRun, toggleRunItem, completeChecklistRun,
  listSops, createSop, updateSop, deleteSop,
} from '../../api/restaurants';

function apiErr(err, fallback) {
  const m = err?.response?.data?.error?.message || err?.response?.data?.message;
  return typeof m === 'string' ? m : fallback;
}

const CHECKLIST_TYPES = ['opening', 'closing', 'cleaning', 'food_safety', 'custom'];
const SOP_CATEGORIES = ['general', 'kitchen', 'front_of_house', 'cleaning', 'food_safety', 'opening', 'closing', 'safety'];

// Sensible starter tasks so a new checklist isn't empty (owner edits after).
const SEED_TASKS = {
  opening: ['Unlock and disarm', 'Turn on equipment', 'Check fridge/freezer temps', 'Stock stations', 'Count opening cash'],
  closing: ['Clean all surfaces', 'Store food properly', 'Turn off equipment', 'Count closing cash', 'Lock up and arm'],
  cleaning: ['Wipe prep surfaces', 'Sweep and mop floors', 'Empty trash', 'Sanitize high-touch areas', 'Clean restrooms'],
  food_safety: ['Log fridge temps', 'Log freezer temps', 'Check use-by dates', 'Verify handwashing supplies', 'Sanitizer concentration check'],
  custom: [],
};

// ── Checklists ────────────────────────────────────────────────────────────────
export function ChecklistsPanel({ t, restaurant }) {
  const restaurantId = restaurant.id;
  const [checklists, setChecklists] = useState([]);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeRun, setActiveRun] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      listChecklists(restaurantId),
      listChecklistRuns(restaurantId, { limit: 15 }),
    ])
      .then(([cl, rn]) => { setChecklists(cl); setRuns(rn); })
      .catch((err) => toast.error(apiErr(err, t('restaurants.ops.checklists.loadError', 'Could not load checklists'))))
      .finally(() => setLoading(false));
  }, [restaurantId, t]);
  useEffect(() => { load(); }, [load]);

  const start = async (checklistId) => {
    try {
      const run = await startChecklistRun(restaurantId, checklistId);
      setActiveRun(run);
    } catch (err) {
      toast.error(apiErr(err, t('restaurants.ops.checklists.startError', 'Could not start checklist')));
    }
  };

  const remove = async (checklistId) => {
    if (!window.confirm(t('restaurants.ops.checklists.confirmDelete', 'Delete this checklist?'))) return;
    try {
      await deleteChecklist(restaurantId, checklistId);
      load();
    } catch (err) {
      toast.error(apiErr(err, t('common.failedToDelete', 'Failed to delete')));
    }
  };

  if (loading) return <div className="fd-empty">{t('food.common.loading', 'Loading…')}</div>;

  return (
    <div>
      {activeRun && (
        <RunModal
          t={t}
          restaurantId={restaurantId}
          run={activeRun}
          onClose={() => { setActiveRun(null); load(); }}
        />
      )}

      <div className="fd-row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h3 style={{ margin: 0 }}>{t('restaurants.ops.checklists.title', 'Checklists')}</h3>
        <button type="button" className="fd-btn fd-btn-sm" onClick={() => setShowCreate((s) => !s)}>
          {showCreate ? t('food.common.back', 'Back') : t('restaurants.ops.checklists.newChecklist', 'New checklist')}
        </button>
      </div>

      {showCreate && (
        <NewChecklistForm
          t={t}
          onCancel={() => setShowCreate(false)}
          onCreate={async (payload) => {
            try {
              await createChecklist(restaurantId, payload);
              setShowCreate(false);
              load();
            } catch (err) {
              toast.error(apiErr(err, t('restaurants.ops.checklists.createError', 'Could not create checklist')));
            }
          }}
        />
      )}

      {checklists.length === 0 && !showCreate && (
        <div className="fd-empty">{t('restaurants.ops.checklists.empty', 'No checklists yet. Create your first opening or closing checklist.')}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '0.75rem' }}>
        {checklists.map((c) => (
          <div key={c.id} className="fd-card" style={{ padding: '1rem' }}>
            <div className="fd-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <h4 style={{ margin: '0 0 0.25rem' }}>{c.name}</h4>
              <span className="fd-tag">{t(`restaurants.ops.checklists.type.${c.checklist_type}`, c.checklist_type)}</span>
            </div>
            <p className="fd-card-meta" style={{ marginTop: 0 }}>
              {t('restaurants.ops.checklists.taskCount', '{{count}} tasks', { count: (c.tasks || []).length })}
            </p>
            <div className="fd-row" style={{ marginTop: '0.5rem' }}>
              <button type="button" className="fd-btn fd-btn-sm" disabled={(c.tasks || []).length === 0} onClick={() => start(c.id)}>
                {t('restaurants.ops.checklists.start', 'Start')}
              </button>
              <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => remove(c.id)}>
                {t('common.delete', 'Delete')}
              </button>
            </div>
            <ManageTasks t={t} restaurantId={restaurantId} checklist={c} onChanged={load} />
          </div>
        ))}
      </div>

      <h3 style={{ marginTop: '1.5rem' }}>{t('restaurants.ops.checklists.history', 'Recent runs')}</h3>
      {runs.length === 0 ? (
        <p className="fd-card-meta">{t('restaurants.ops.checklists.noRuns', 'No completed runs yet.')}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {runs.map((r) => (
            <div key={r.id} className="fd-row" style={{ justifyContent: 'space-between', padding: '0.5rem 0.65rem', border: '1px solid var(--border-color, #e5e7eb)', borderRadius: 8 }}>
              <span>{r.checklist_name}</span>
              <span className="fd-card-meta">
                {r.completed_tasks}/{r.total_tasks} · {t(`restaurants.ops.checklists.runStatus.${r.status}`, r.status)} · {new Date(r.started_at).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NewChecklistForm({ t, onCreate, onCancel }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('opening');
  const [seed, setSeed] = useState(true);
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    const tasks = seed ? (SEED_TASKS[type] || []).map((label) => ({ label })) : [];
    await onCreate({ name: name.trim(), checklistType: type, tasks });
    setSaving(false);
  };

  return (
    <form onSubmit={submit} className="fd-card" style={{ padding: '1rem', marginBottom: '1rem' }}>
      <div className="fd-field">
        <label htmlFor="cl-name">{t('restaurants.ops.checklists.nameLabel', 'Checklist name')}</label>
        <input id="cl-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('restaurants.ops.checklists.namePlaceholder', 'e.g. Morning opening')} />
      </div>
      <div className="fd-field">
        <label htmlFor="cl-type">{t('restaurants.ops.checklists.typeLabel', 'Type')}</label>
        <select id="cl-type" value={type} onChange={(e) => setType(e.target.value)}>
          {CHECKLIST_TYPES.map((ct) => (
            <option key={ct} value={ct}>{t(`restaurants.ops.checklists.type.${ct}`, ct)}</option>
          ))}
        </select>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
        <input type="checkbox" checked={seed} onChange={(e) => setSeed(e.target.checked)} />
        {t('restaurants.ops.checklists.seedTasks', 'Add suggested starter tasks')}
      </label>
      <div className="fd-row" style={{ marginTop: '0.75rem' }}>
        <button type="submit" className="fd-btn fd-btn-sm" disabled={saving || !name.trim()}>
          {t('food.common.save', 'Save')}
        </button>
        <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={onCancel}>
          {t('food.common.back', 'Back')}
        </button>
      </div>
    </form>
  );
}

function ManageTasks({ t, restaurantId, checklist, onChanged }) {
  const [open, setOpen] = useState(false);
  const [newTask, setNewTask] = useState('');

  const add = async () => {
    if (!newTask.trim()) return;
    try {
      await addChecklistTask(restaurantId, checklist.id, { label: newTask.trim() });
      setNewTask('');
      onChanged();
    } catch (err) {
      toast.error(apiErr(err, t('common.failedToUpdate', 'Failed to update')));
    }
  };
  const removeTask = async (taskId) => {
    try {
      await deleteChecklistTask(restaurantId, checklist.id, taskId);
      onChanged();
    } catch (err) {
      toast.error(apiErr(err, t('common.failedToDelete', 'Failed to delete')));
    }
  };

  return (
    <div style={{ marginTop: '0.5rem' }}>
      <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => setOpen((o) => !o)}>
        {open ? t('food.common.back', 'Hide') : t('restaurants.ops.checklists.manageTasks', 'Tasks')}
      </button>
      {open && (
        <div style={{ marginTop: '0.5rem' }}>
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 0.5rem' }}>
            {(checklist.tasks || []).map((tk) => (
              <li key={tk.id} className="fd-row" style={{ justifyContent: 'space-between', fontSize: '0.85rem', padding: '0.2rem 0' }}>
                <span>{tk.label}</span>
                <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => removeTask(tk.id)} aria-label={t('common.delete', 'Delete')}>×</button>
              </li>
            ))}
          </ul>
          <div className="fd-row">
            <input value={newTask} onChange={(e) => setNewTask(e.target.value)} placeholder={t('restaurants.ops.checklists.taskPlaceholder', 'Add a task…')} />
            <button type="button" className="fd-btn fd-btn-sm" onClick={add} disabled={!newTask.trim()}>{t('common.add', 'Add')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function RunModal({ t, restaurantId, run: initialRun, onClose }) {
  const [run, setRun] = useState(initialRun);
  const [busy, setBusy] = useState(false);

  const toggle = async (item) => {
    setBusy(true);
    try {
      const updated = await toggleRunItem(restaurantId, run.id, item.id, { isDone: !item.is_done });
      setRun(updated);
    } catch (err) {
      toast.error(apiErr(err, t('common.failedToUpdate', 'Failed to update')));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    try {
      await completeChecklistRun(restaurantId, run.id);
      toast.success(t('restaurants.ops.checklists.runCompleted', 'Checklist completed'));
      onClose();
    } catch (err) {
      toast.error(apiErr(err, t('common.failedToUpdate', 'Failed to update')));
    } finally {
      setBusy(false);
    }
  };

  const done = (run.items || []).filter((i) => i.is_done).length;
  const total = (run.items || []).length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="fd-card" style={{ width: 'min(32rem, 100%)', maxHeight: '85vh', overflowY: 'auto', padding: '1.25rem' }}>
        <div className="fd-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>{t('restaurants.ops.checklists.runningTitle', 'Running checklist')}</h3>
          <span className="fd-tag">{done}/{total}</span>
        </div>
        <ul style={{ listStyle: 'none', padding: 0, margin: '1rem 0' }}>
          {(run.items || []).map((item) => (
            <li key={item.id} style={{ padding: '0.35rem 0' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={item.is_done} disabled={busy} onChange={() => toggle(item)} />
                <span style={{ textDecoration: item.is_done ? 'line-through' : 'none', opacity: item.is_done ? 0.6 : 1 }}>{item.label}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="fd-row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={onClose}>{t('food.common.back', 'Close')}</button>
          <button type="button" className="fd-btn fd-btn-sm" onClick={finish} disabled={busy}>
            {t('restaurants.ops.checklists.markComplete', 'Mark complete')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── SOP library ─────────────────────────────────────────────────────────────
export function SopsPanel({ t, restaurant }) {
  const restaurantId = restaurant.id;
  const [sops, setSops] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | 'new' | sop object

  const load = useCallback(() => {
    setLoading(true);
    listSops(restaurantId)
      .then(setSops)
      .catch((err) => toast.error(apiErr(err, t('restaurants.ops.sops.loadError', 'Could not load SOPs'))))
      .finally(() => setLoading(false));
  }, [restaurantId, t]);
  useEffect(() => { load(); }, [load]);

  const save = async (payload, sopId) => {
    try {
      if (sopId) await updateSop(restaurantId, sopId, payload);
      else await createSop(restaurantId, payload);
      setEditing(null);
      load();
    } catch (err) {
      toast.error(apiErr(err, t('restaurants.ops.sops.saveError', 'Could not save SOP')));
    }
  };
  const remove = async (sopId) => {
    if (!window.confirm(t('restaurants.ops.sops.confirmDelete', 'Delete this SOP?'))) return;
    try {
      await deleteSop(restaurantId, sopId);
      load();
    } catch (err) {
      toast.error(apiErr(err, t('common.failedToDelete', 'Failed to delete')));
    }
  };

  if (loading) return <div className="fd-empty">{t('food.common.loading', 'Loading…')}</div>;

  if (editing) {
    return <SopForm t={t} sop={editing === 'new' ? null : editing} onCancel={() => setEditing(null)} onSave={save} />;
  }

  return (
    <div>
      <div className="fd-row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h3 style={{ margin: 0 }}>{t('restaurants.ops.sops.title', 'SOP library')}</h3>
        <button type="button" className="fd-btn fd-btn-sm" onClick={() => setEditing('new')}>
          {t('restaurants.ops.sops.newSop', 'New SOP')}
        </button>
      </div>
      {sops.length === 0 ? (
        <div className="fd-empty">{t('restaurants.ops.sops.empty', 'No SOPs yet. Document how your team does things.')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {sops.map((s) => (
            <div key={s.id} className="fd-card" style={{ padding: '0.85rem 1rem' }}>
              <div className="fd-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <strong>{s.title}</strong>
                  <span className="fd-tag" style={{ marginLeft: '0.5rem' }}>{t(`restaurants.ops.sops.category.${s.category}`, s.category)}</span>
                </div>
                <div className="fd-row">
                  <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => setEditing(s)}>{t('common.edit', 'Edit')}</button>
                  <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => remove(s.id)}>{t('common.delete', 'Delete')}</button>
                </div>
              </div>
              {s.body && <p className="fd-card-meta" style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{s.body}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SopForm({ t, sop, onSave, onCancel }) {
  const [title, setTitle] = useState(sop?.title || '');
  const [category, setCategory] = useState(sop?.category || 'general');
  const [body, setBody] = useState(sop?.body || '');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    await onSave({ title: title.trim(), category, body }, sop?.id);
    setSaving(false);
  };

  return (
    <form onSubmit={submit} className="fd-card" style={{ padding: '1rem' }}>
      <h3 style={{ marginTop: 0 }}>{sop ? t('restaurants.ops.sops.editTitle', 'Edit SOP') : t('restaurants.ops.sops.newSop', 'New SOP')}</h3>
      <div className="fd-field">
        <label htmlFor="sop-title">{t('restaurants.ops.sops.titleLabel', 'Title')}</label>
        <input id="sop-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="fd-field">
        <label htmlFor="sop-cat">{t('restaurants.ops.sops.categoryLabel', 'Category')}</label>
        <select id="sop-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
          {SOP_CATEGORIES.map((c) => (
            <option key={c} value={c}>{t(`restaurants.ops.sops.category.${c}`, c)}</option>
          ))}
        </select>
      </div>
      <div className="fd-field">
        <label htmlFor="sop-body">{t('restaurants.ops.sops.bodyLabel', 'Procedure')}</label>
        <textarea id="sop-body" rows={8} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('restaurants.ops.sops.bodyPlaceholder', 'Step-by-step instructions…')} />
      </div>
      <div className="fd-row">
        <button type="submit" className="fd-btn fd-btn-sm" disabled={saving || !title.trim()}>{t('food.common.save', 'Save')}</button>
        <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={onCancel}>{t('food.common.back', 'Back')}</button>
      </div>
    </form>
  );
}
