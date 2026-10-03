// Local Food Directory — Operations panels (Phase 2): Checklists + SOP library.
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
  startChecklistRun, listChecklistRuns, getChecklistRun,
  listSops, createSop, updateSop, deleteSop,
  listInventoryItems, createInventoryItem, deleteInventoryItem,
} from '../../api/restaurants';
import {
  toggleRunItemOffline, completeChecklistRunOffline, adjustInventoryItemOffline,
} from '../../api/restaurantsOffline';

function apiErr(err, fallback) {
  const m = err?.response?.data?.error?.message || err?.response?.data?.message;
  return typeof m === 'string' ? m : fallback;
}

const CHECKLIST_TYPES = ['opening', 'closing', 'cleaning', 'food_safety', 'custom'];
const SOP_CATEGORIES = ['general', 'kitchen', 'front_of_house', 'cleaning', 'food_safety', 'opening', 'closing', 'safety'];
const INVENTORY_CATEGORIES = ['general', 'produce', 'meat', 'dairy', 'dry_goods', 'frozen', 'beverage', 'packaging', 'cleaning'];

function fmtQty(q) {
  const n = Number(q);
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

// Sensible starter tasks so a new checklist isn't empty (owner edits after).
const SEED_TASKS = {
  opening: ['Unlock and disarm', 'Turn on equipment', 'Check fridge/freezer temps', 'Stock stations', 'Count opening cash'],
  closing: ['Clean all surfaces', 'Store food properly', 'Turn off equipment', 'Count closing cash', 'Lock up and arm'],
  cleaning: ['Wipe prep surfaces', 'Sweep and mop floors', 'Empty trash', 'Sanitize high-touch areas', 'Clean restrooms'],
  food_safety: ['Log fridge temps', 'Log freezer temps', 'Check use-by dates', 'Verify handwashing supplies', 'Sanitizer concentration check'],
  custom: [],
};

// ── Checklists ────────────────────────────────────────────────────────────────
export function ChecklistsPanel({ t, restaurant, bare, onStats }) {
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
      .then(([cl, rn]) => {
        setChecklists(cl);
        setRuns(rn);
        onStats?.({ checklists: cl.length, runs: rn.length });
      })
      .catch((err) => toast.error(apiErr(err, t('restaurants.ops.checklists.loadError', 'Could not load checklists'))))
      .finally(() => setLoading(false));
  }, [restaurantId, t, onStats]);
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

      <div className={`fd-ops-toolbar${bare ? ' fd-ops-toolbar--end' : ''}`}>
        {!bare && <h3 className="fd-ops-panel-title">{t('restaurants.ops.checklists.title', 'Checklists')}</h3>}
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

      <div className="fd-ops-checklists-grid">
        {checklists.map((c) => (
          <div key={c.id} className="fd-ops-checklist-card">
            <div className="fd-ops-checklist-top">
              <h4>{c.name}</h4>
              <span className="fd-tag">{t(`restaurants.ops.checklists.type.${c.checklist_type}`, c.checklist_type)}</span>
            </div>
            <p className="fd-card-meta">
              {t('restaurants.ops.checklists.taskCount', '{{count}} tasks', { count: (c.tasks || []).length })}
            </p>
            <div className="fd-ops-checklist-actions">
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

      <h3 className="fd-ops-subhead">{t('restaurants.ops.checklists.history', 'Recent runs')}</h3>
      {runs.length === 0 ? (
        <p className="fd-card-meta">{t('restaurants.ops.checklists.noRuns', 'No completed runs yet.')}</p>
      ) : (
        <div className="fd-ops-run-list">
          {runs.map((r) => (
            <div key={r.id} className="fd-ops-run-row">
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
    <form onSubmit={submit} className="fd-ops-form">
      <div className="fd-settings-field-grid">
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
      </div>
      <label className="fd-ops-check">
        <input type="checkbox" checked={seed} onChange={(e) => setSeed(e.target.checked)} />
        {t('restaurants.ops.checklists.seedTasks', 'Add suggested starter tasks')}
      </label>
      <div className="fd-settings-actions">
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
    <div className="fd-ops-tasks">
      <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => setOpen((o) => !o)}>
        {open ? t('food.common.back', 'Hide') : t('restaurants.ops.checklists.manageTasks', 'Tasks')}
      </button>
      {open && (
        <div className="fd-ops-tasks-open">
          <ul className="fd-ops-task-list">
            {(checklist.tasks || []).map((tk) => (
              <li key={tk.id} className="fd-ops-task-row">
                <span>{tk.label}</span>
                <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => removeTask(tk.id)} aria-label={t('common.delete', 'Delete')}>×</button>
              </li>
            ))}
          </ul>
          <div className="fd-ops-task-add">
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
      const updated = await toggleRunItemOffline(restaurantId, run.id, item.id, { isDone: !item.is_done });
      if (updated && updated.queued) {
        // Offline: flip locally so the floor keeps moving; the change syncs
        // when connectivity returns.
        setRun((prev) => ({
          ...prev,
          items: (prev.items || []).map((i) =>
            i.id === item.id ? { ...i, is_done: !item.is_done, pendingSync: true } : i
          ),
        }));
        toast.success(t('restaurants.ops.offline.queued', 'Saved offline. Will sync when back online.'));
      } else {
        setRun(updated);
      }
    } catch (err) {
      toast.error(apiErr(err, t('common.failedToUpdate', 'Failed to update')));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    try {
      const result = await completeChecklistRunOffline(restaurantId, run.id);
      if (result && result.queued) {
        toast.success(t('restaurants.ops.offline.queued', 'Saved offline. Will sync when back online.'));
      } else {
        toast.success(t('restaurants.ops.checklists.runCompleted', 'Checklist completed'));
      }
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
      role="dialog" aria-modal="true"
      className="fd-ops-modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="fd-ops-modal">
        <div className="fd-ops-modal-head">
          <h3>{t('restaurants.ops.checklists.runningTitle', 'Running checklist')}</h3>
          <span className="fd-tag">{done}/{total}</span>
        </div>
        <ul className="fd-ops-run-items">
          {(run.items || []).map((item) => (
            <li key={item.id} className="fd-ops-run-item">
              <label>
                <input type="checkbox" checked={item.is_done} disabled={busy} onChange={() => toggle(item)} />
                <span className={item.is_done ? 'fd-ops-run-item--done' : ''}>{item.label}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="fd-ops-modal-actions">
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
export function SopsPanel({ t, restaurant, bare, onStats }) {
  const restaurantId = restaurant.id;
  const [sops, setSops] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | 'new' | sop object

  const load = useCallback(() => {
    setLoading(true);
    listSops(restaurantId)
      .then((sops) => { setSops(sops); onStats?.({ sops: sops.length }); })
      .catch((err) => toast.error(apiErr(err, t('restaurants.ops.sops.loadError', 'Could not load SOPs'))))
      .finally(() => setLoading(false));
  }, [restaurantId, t, onStats]);
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
      <div className={`fd-ops-toolbar${bare ? ' fd-ops-toolbar--end' : ''}`}>
        {!bare && <h3 className="fd-ops-panel-title">{t('restaurants.ops.sops.title', 'SOP library')}</h3>}
        <button type="button" className="fd-btn fd-btn-sm" onClick={() => setEditing('new')}>
          {t('restaurants.ops.sops.newSop', 'New SOP')}
        </button>
      </div>
      {sops.length === 0 ? (
        <div className="fd-empty">{t('restaurants.ops.sops.empty', 'No SOPs yet. Document how your team does things.')}</div>
      ) : (
        <div className="fd-ops-sop-list">
          {sops.map((s) => (
            <div key={s.id} className="fd-ops-sop-card">
              <div className="fd-ops-sop-top">
                <div>
                  <strong>{s.title}</strong>
                  <span className="fd-tag fd-ops-sop-tag">{t(`restaurants.ops.sops.category.${s.category}`, s.category)}</span>
                </div>
                <div className="fd-ops-sop-actions">
                  <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => setEditing(s)}>{t('common.edit', 'Edit')}</button>
                  <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => remove(s.id)}>{t('common.delete', 'Delete')}</button>
                </div>
              </div>
              {s.body && <p className="fd-card-meta fd-ops-sop-body">{s.body}</p>}
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
    <form onSubmit={submit} className="fd-ops-form">
      <h3 className="fd-ops-form-title">{sop ? t('restaurants.ops.sops.editTitle', 'Edit SOP') : t('restaurants.ops.sops.newSop', 'New SOP')}</h3>
      <div className="fd-settings-field-grid">
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
      </div>
      <div className="fd-field">
        <label htmlFor="sop-body">{t('restaurants.ops.sops.bodyLabel', 'Procedure')}</label>
        <textarea id="sop-body" rows={8} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('restaurants.ops.sops.bodyPlaceholder', 'Step-by-step instructions…')} />
      </div>
      <div className="fd-settings-actions">
        <button type="submit" className="fd-btn fd-btn-sm" disabled={saving || !title.trim()}>{t('food.common.save', 'Save')}</button>
        <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={onCancel}>{t('food.common.back', 'Back')}</button>
      </div>
    </form>
  );
}

// ── Inventory ─────────────────────────────────────────────────────────────────
export function InventoryPanel({ t, restaurant, bare, onStats }) {
  const restaurantId = restaurant.id;
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [adjusting, setAdjusting] = useState(null); // item being adjusted

  const load = useCallback(() => {
    setLoading(true);
    listInventoryItems(restaurantId)
      .then((items) => {
        setItems(items);
        onStats?.({ items: items.length, lowStock: items.filter((i) => i.is_low).length });
      })
      .catch((err) => toast.error(apiErr(err, t('restaurants.ops.inventory.loadError', 'Could not load inventory'))))
      .finally(() => setLoading(false));
  }, [restaurantId, t, onStats]);
  useEffect(() => { load(); }, [load]);

  const create = async (payload) => {
    try {
      await createInventoryItem(restaurantId, payload);
      setShowCreate(false);
      load();
    } catch (err) {
      toast.error(apiErr(err, t('restaurants.ops.inventory.saveError', 'Could not save item')));
    }
  };
  const remove = async (itemId) => {
    if (!window.confirm(t('restaurants.ops.inventory.confirmDelete', 'Delete this item?'))) return;
    try {
      await deleteInventoryItem(restaurantId, itemId);
      load();
    } catch (err) {
      toast.error(apiErr(err, t('common.failedToDelete', 'Failed to delete')));
    }
  };
  const applyAdjust = async (itemId, payload) => {
    try {
      const result = await adjustInventoryItemOffline(restaurantId, itemId, payload);
      setAdjusting(null);
      if (result && result.queued) {
        toast.success(t('restaurants.ops.offline.queued', 'Saved offline. Will sync when back online.'));
      }
      load();
    } catch (err) {
      toast.error(apiErr(err, t('common.failedToUpdate', 'Failed to update')));
    }
  };

  if (loading) return <div className="fd-empty">{t('food.common.loading', 'Loading…')}</div>;

  const lowCount = items.filter((i) => i.is_low).length;

  return (
    <div>
      {adjusting && (
        <AdjustModal t={t} item={adjusting} onClose={() => setAdjusting(null)} onApply={applyAdjust} />
      )}

      <div className={`fd-ops-toolbar${bare ? ' fd-ops-toolbar--end' : ''}`}>
        {!bare && <h3 className="fd-ops-panel-title">{t('restaurants.ops.inventory.title', 'Inventory')}</h3>}
        <button type="button" className="fd-btn fd-btn-sm" onClick={() => setShowCreate((s) => !s)}>
          {showCreate ? t('food.common.back', 'Back') : t('restaurants.ops.inventory.newItem', 'New item')}
        </button>
      </div>

      {lowCount > 0 && (
        <p className="fd-ops-notice fd-ops-notice--warn">
          {t('restaurants.ops.inventory.lowStockAlert', '{{count}} item(s) at or below their low-stock threshold.', { count: lowCount })}
        </p>
      )}

      {showCreate && <NewItemForm t={t} onCancel={() => setShowCreate(false)} onCreate={create} />}

      {items.length === 0 && !showCreate ? (
        <div className="fd-empty">{t('restaurants.ops.inventory.empty', 'No inventory items yet. Add your key ingredients and supplies.')}</div>
      ) : (
        <div className="fd-ops-inventory-list">
          {items.map((it) => (
            <div
              key={it.id}
              className={`fd-ops-inventory-row${it.is_low ? ' fd-ops-inventory-row--low' : ''}`}
            >
              <div className="fd-ops-inventory-main">
                <strong>{it.name}</strong>{' '}
                <span className="fd-tag">{t(`restaurants.ops.inventory.category.${it.category}`, it.category)}</span>
                {it.is_low && <span className="fd-tag fd-ops-low-tag">{t('restaurants.ops.inventory.low', 'Low')}</span>}
              </div>
              <div className="fd-ops-inventory-actions">
                <span className="fd-card-meta">{fmtQty(it.quantity)} {it.unit}</span>
                <button type="button" className="fd-btn fd-btn-sm" onClick={() => setAdjusting(it)}>{t('restaurants.ops.inventory.adjust', 'Adjust')}</button>
                <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => remove(it.id)} aria-label={t('common.delete', 'Delete')}>×</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NewItemForm({ t, onCreate, onCancel }) {
  const [form, setForm] = useState({ name: '', category: 'general', unit: 'ea', quantity: '0', lowStockThreshold: '0' });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    await onCreate({
      name: form.name.trim(), category: form.category, unit: form.unit.trim() || 'ea',
      quantity: Number(form.quantity) || 0, lowStockThreshold: Number(form.lowStockThreshold) || 0,
    });
    setSaving(false);
  };

  return (
    <form onSubmit={submit} className="fd-ops-form">
      <div className="fd-settings-field-grid">
        <div className="fd-field">
          <label htmlFor="inv-name">{t('restaurants.ops.inventory.nameLabel', 'Item name')}</label>
          <input id="inv-name" value={form.name} onChange={set('name')} placeholder={t('restaurants.ops.inventory.namePlaceholder', 'e.g. Tomatoes')} />
        </div>
        <div className="fd-field">
          <label htmlFor="inv-cat">{t('restaurants.ops.inventory.categoryLabel', 'Category')}</label>
          <select id="inv-cat" value={form.category} onChange={set('category')}>
            {INVENTORY_CATEGORIES.map((c) => <option key={c} value={c}>{t(`restaurants.ops.inventory.category.${c}`, c)}</option>)}
          </select>
        </div>
      </div>
      <div className="fd-settings-field-grid">
        <div className="fd-field">
          <label htmlFor="inv-unit">{t('restaurants.ops.inventory.unitLabel', 'Unit')}</label>
          <input id="inv-unit" value={form.unit} onChange={set('unit')} placeholder="ea" />
        </div>
        <div className="fd-field">
          <label htmlFor="inv-qty">{t('restaurants.ops.inventory.quantityLabel', 'On hand')}</label>
          <input id="inv-qty" type="number" step="any" value={form.quantity} onChange={set('quantity')} />
        </div>
        <div className="fd-field">
          <label htmlFor="inv-low">{t('restaurants.ops.inventory.thresholdLabel', 'Low-stock at')}</label>
          <input id="inv-low" type="number" step="any" value={form.lowStockThreshold} onChange={set('lowStockThreshold')} />
        </div>
      </div>
      <div className="fd-settings-actions">
        <button type="submit" className="fd-btn fd-btn-sm" disabled={saving || !form.name.trim()}>{t('food.common.save', 'Save')}</button>
        <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={onCancel}>{t('food.common.back', 'Back')}</button>
      </div>
    </form>
  );
}

function AdjustModal({ t, item, onClose, onApply }) {
  const [type, setType] = useState('receive');
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const payload = { type, note };
    if (type === 'count') payload.quantity = Number(value) || 0;
    else payload.delta = Number(value) || 0;
    await onApply(item.id, payload);
    setBusy(false);
  };

  return (
    <div
      role="dialog" aria-modal="true"
      className="fd-ops-modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form onSubmit={submit} className="fd-ops-modal fd-ops-modal--narrow">
        <h3 className="fd-ops-form-title">{t('restaurants.ops.inventory.adjustTitle', 'Adjust stock')}: {item.name}</h3>
        <p className="fd-card-meta">{t('restaurants.ops.inventory.onHand', 'On hand')}: {fmtQty(item.quantity)} {item.unit}</p>
        <div className="fd-field">
          <label htmlFor="adj-type">{t('restaurants.ops.inventory.adjustType', 'Type')}</label>
          <select id="adj-type" value={type} onChange={(e) => setType(e.target.value)}>
            {['receive', 'waste', 'usage', 'count', 'correction'].map((ty) => (
              <option key={ty} value={ty}>{t(`restaurants.ops.inventory.adjType.${ty}`, ty)}</option>
            ))}
          </select>
        </div>
        <div className="fd-field">
          <label htmlFor="adj-val">{type === 'count' ? t('restaurants.ops.inventory.countedLabel', 'Counted quantity') : t('restaurants.ops.inventory.amountLabel', 'Amount')}</label>
          <input id="adj-val" type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        </div>
        <div className="fd-field">
          <label htmlFor="adj-note">{t('restaurants.ops.inventory.noteLabel', 'Note (optional)')}</label>
          <input id="adj-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="fd-ops-modal-actions">
          <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={onClose}>{t('food.common.back', 'Cancel')}</button>
          <button type="submit" className="fd-btn fd-btn-sm" disabled={busy}>{t('restaurants.ops.inventory.apply', 'Apply')}</button>
        </div>
      </form>
    </div>
  );
}
