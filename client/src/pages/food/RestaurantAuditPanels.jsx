// Local Food Directory — Quality audits panel (franchise ops).
// Mounted inside FoodMerchantPage's Operations tab. Talks to /api/restaurants.
//
// Template management (create/edit/delete) and corrective-action verification
// are owner/manager only; the backend enforces this and returns 403, which we
// surface as a toast. Starting an audit, scoring items, and logging findings
// are open to any active staff member.

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ClipboardList, CheckCircle2 } from 'lucide-react';
import EmptyState from '../../components/EmptyState';
import {
  listAuditTemplates, createAuditTemplate, updateAuditTemplate, deleteAuditTemplate,
  startAuditRun, listAuditRuns, getAuditRun, completeAuditRun,
  listRestaurantStaff, createCorrectiveAction, listCorrectiveActions,
  updateCorrectiveAction,
} from '../../api/restaurants';
import { scoreAuditItemOffline, addAuditFindingOffline } from '../../api/restaurantsOffline';

function apiErr(err, fallback) {
  const m = err?.response?.data?.error?.message || err?.response?.data?.message;
  return typeof m === 'string' ? m : fallback;
}

const AUDIT_CATEGORIES = ['general', 'kitchen', 'front_of_house', 'cleaning', 'food_safety', 'safety'];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];

// Starter templates so a new audit program isn't empty (manager edits after).
const STARTER_TEMPLATES = {
  kitchen: {
    name: 'Kitchen inspection',
    category: 'kitchen',
    description: 'Weekly walkthrough of kitchen cleanliness and order.',
    items: [
      { label: 'Floors clean and dry', instructions: 'Check for spills, debris, and slip hazards.', maxScore: 5, weight: 1 },
      { label: 'Food storage and labeling', instructions: 'FIFO in use; all containers dated and labeled.', maxScore: 5, weight: 2 },
      { label: 'Equipment cleanliness', instructions: 'Grills, fryers, and prep surfaces wiped down.', maxScore: 5, weight: 1 },
      { label: 'Handwashing stations stocked', instructions: 'Soap, paper towels, and hot water available.', maxScore: 5, weight: 2 },
      { label: 'Waste area tidy', instructions: 'Bins closed, area swept, no overflow.', maxScore: 5, weight: 1 },
    ],
  },
  foodSafety: {
    name: 'Food safety check',
    category: 'food_safety',
    description: 'Daily food-safety critical checks.',
    items: [
      { label: 'Fridge temps logged', instructions: 'All units at or below 40\u00B0F / 4\u00B0C.', maxScore: 5, weight: 2 },
      { label: 'Sanitizer concentration', instructions: 'Test strips in range for all buckets and sinks.', maxScore: 5, weight: 2 },
      { label: 'Use-by dates', instructions: 'No expired product on shelves or in walk-in.', maxScore: 5, weight: 2 },
      { label: 'Allergen procedures', instructions: 'Allergen station clean; staff can state the protocol.', maxScore: 5, weight: 1 },
    ],
  },
};

function scorePct(total, max) {
  const t = Number(total);
  const m = Number(max);
  if (!Number.isFinite(t) || !Number.isFinite(m) || m <= 0) return null;
  return Math.round((t / m) * 100);
}

// ── Audit templates ─────────────────────────────────────────────────────────
export function AuditsPanel({ t, restaurant, bare, onStats, isManager }) {
  const restaurantId = restaurant.id;
  const [templates, setTemplates] = useState([]);
  const [runs, setRuns] = useState([]);
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(null); // template object | null
  const [activeRunId, setActiveRunId] = useState(null);
  const [activeTemplate, setActiveTemplate] = useState(null);
  const [viewingRunId, setViewingRunId] = useState(null);
  const [staff, setStaff] = useState([]);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      listAuditTemplates(restaurantId),
      listAuditRuns(restaurantId, { limit: 15 }),
      listCorrectiveActions(restaurantId, isManager ? {} : { mine: '1' }),
    ])
      .then(([tmpl, rn, acts]) => {
        setTemplates(tmpl);
        setRuns(rn);
        setActions(acts);
        onStats?.({
          auditTemplates: tmpl.length,
          auditsRun: rn.length,
          openActions: acts.filter((a) => !['resolved', 'verified'].includes(a.status)).length,
        });
      })
      .catch((err) => toast.error(apiErr(err, t('restaurants.ops.audits.loadError', 'Could not load audits'))))
      .finally(() => setLoading(false));
  }, [restaurantId, t, onStats, isManager]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!isManager) return;
    listRestaurantStaff(restaurantId).then(setStaff).catch(() => {});
  }, [restaurantId, isManager]);

  const start = async (templateId) => {
    try {
      const { audit } = await startAuditRun(restaurantId, templateId);
      const template = (templates || []).find((x) => x.id === templateId);
      setActiveRunId(audit.id);
      setActiveTemplate(template || null);
    } catch (err) {
      toast.error(apiErr(err, t('restaurants.ops.audits.startError', 'Could not start audit')));
    }
  };

  const remove = async (templateId) => {
    if (!window.confirm(t('restaurants.ops.audits.confirmDelete', 'Delete this audit template?'))) return;
    try {
      await deleteAuditTemplate(restaurantId, templateId);
      load();
    } catch (err) {
      toast.error(apiErr(err, t('common.failedToDelete', 'Failed to delete')));
    }
  };

  const saveTemplate = async (payload, templateId) => {
    try {
      if (templateId) await updateAuditTemplate(restaurantId, templateId, payload);
      else await createAuditTemplate(restaurantId, payload);
      setShowCreate(false);
      setEditing(null);
      load();
    } catch (err) {
      toast.error(apiErr(err, t('restaurants.ops.audits.saveError', 'Could not save template')));
    }
  };

  if (loading) return <div className="fd-empty">{t('food.common.loading', 'Loading…')}</div>;

  if (activeRunId) {
    return (
      <AuditRunView
        t={t}
        restaurantId={restaurantId}
        auditId={activeRunId}
        templateItems={(activeTemplate && activeTemplate.items) || []}
        staff={staff}
        isManager={isManager}
        onClose={() => { setActiveRunId(null); setActiveTemplate(null); load(); }}
      />
    );
  }

  if (viewingRunId) {
    return (
      <AuditRunDetail
        t={t}
        restaurantId={restaurantId}
        auditId={viewingRunId}
        onClose={() => setViewingRunId(null)}
      />
    );
  }

  return (
    <div>
      <div className={`fd-ops-toolbar${bare ? ' fd-ops-toolbar--end' : ''}`}>
        {!bare && <h3 className="fd-ops-panel-title">{t('restaurants.ops.audits.title', 'Quality audits')}</h3>}
        {isManager && (
          <button
            type="button"
            className="fd-btn fd-btn-sm"
            onClick={() => { setEditing(null); setShowCreate((s) => !s); }}
          >
            {showCreate ? t('food.common.back', 'Back') : t('restaurants.ops.audits.newTemplate', 'New template')}
          </button>
        )}
      </div>

      {isManager && showCreate && (
        <AuditTemplateForm
          t={t}
          template={null}
          onCancel={() => setShowCreate(false)}
          onSave={saveTemplate}
        />
      )}
      {isManager && editing && (
        <AuditTemplateForm
          t={t}
          template={editing}
          onCancel={() => setEditing(null)}
          onSave={saveTemplate}
        />
      )}

      {templates.length === 0 && !showCreate && !editing ? (
        <EmptyState
          icon={ClipboardList}
          title={t('restaurants.ops.audits.templatesEmpty', 'No audit templates yet. Create one or use a starter.')}
          actions={(
            <button type="button" className="fd-btn" onClick={() => { setEditing(null); setShowCreate(true); }}>
              {t('restaurants.ops.audits.newTemplate', 'New template')}
            </button>
          )}
        />
      ) : (
        <div className="fd-ops-checklists-grid">
          {templates.map((tmpl) => (
            <div key={tmpl.id} className="fd-ops-checklist-card">
              <div className="fd-ops-checklist-top">
                <h4>{tmpl.name}</h4>
                <span className="fd-tag">{t(`restaurants.ops.audits.category.${tmpl.category}`, tmpl.category)}</span>
              </div>
              <p className="fd-card-meta">
                {t('restaurants.ops.audits.itemCount', '{{count}} items', { count: (tmpl.items || []).length })}
              </p>
              <div className="fd-ops-checklist-actions">
                <button type="button" className="fd-btn fd-btn-sm" onClick={() => start(tmpl.id)}>
                  {t('restaurants.ops.audits.start', 'Start audit')}
                </button>
                {isManager && (
                  <button
                    type="button"
                    className="fd-btn fd-btn-secondary fd-btn-sm"
                    onClick={() => { setShowCreate(false); setEditing(tmpl); }}
                  >
                    {t('common.edit', 'Edit')}
                  </button>
                )}
                {isManager && (
                  <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => remove(tmpl.id)}>
                    {t('common.delete', 'Delete')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <h3 className="fd-ops-subhead">{t('restaurants.ops.audits.recentTitle', 'Recent audits')}</h3>
      {runs.length === 0 ? (
        <p className="fd-card-meta">{t('restaurants.ops.audits.noRuns', 'No audits yet.')}</p>
      ) : (
        <div className="fd-ops-run-list">
          {runs.map((r) => (
            <AuditRunRow key={r.id} t={t} run={r} onView={() => setViewingRunId(r.id)} />
          ))}
        </div>
      )}

      <h3 className="fd-ops-subhead">{t('restaurants.ops.audits.actionsTitle', 'Corrective actions')}</h3>
      <CorrectiveActions
        t={t}
        restaurantId={restaurantId}
        actions={actions}
        isManager={isManager}
        onChanged={load}
      />
    </div>
  );
}

// ── Template form (create + edit) ───────────────────────────────────────────
function AuditTemplateForm({ t, template, onCancel, onSave }) {
  const [name, setName] = useState(template?.name || '');
  const [category, setCategory] = useState(template?.category || 'general');
  const [description, setDescription] = useState(template?.description || '');
  const [items, setItems] = useState(
    (template?.items || []).map((i) => ({
      label: i.label || '',
      instructions: i.instructions || '',
      maxScore: i.max_score ?? 5,
      weight: i.weight ?? 1,
    })),
  );
  const [saving, setSaving] = useState(false);

  const addItem = () => setItems((prev) => [...prev, { label: '', instructions: '', maxScore: 5, weight: 1 }]);
  const removeItem = (idx) => setItems((prev) => prev.filter((_, i) => i !== idx));
  const setItem = (idx, key) => (e) => setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [key]: e.target.value } : it)));

  const useStarter = (key) => {
    const s = STARTER_TEMPLATES[key];
    setName(s.name);
    setCategory(s.category);
    setDescription(s.description);
    setItems(s.items.map((i) => ({ ...i })));
  };

  const submit = async (e) => {
    e.preventDefault();
    const cleanItems = items
      .filter((i) => i.label.trim())
      .map((i) => ({
        label: i.label.trim(),
        instructions: i.instructions.trim(),
        maxScore: Number(i.maxScore) || 5,
        weight: Number(i.weight) || 1,
      }));
    if (!name.trim() || cleanItems.length === 0) return;
    setSaving(true);
    await onSave(
      { name: name.trim(), description: description.trim(), category, items: cleanItems },
      template?.id,
    );
    setSaving(false);
  };

  return (
    <form onSubmit={submit} className="fd-ops-form">
      <h3 className="fd-ops-form-title">
        {template
          ? t('restaurants.ops.audits.editTitle', 'Edit template')
          : t('restaurants.ops.audits.newTitle', 'New audit template')}
      </h3>
      <div className="fd-settings-actions">
        <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => useStarter('kitchen')}>
          {t('restaurants.ops.audits.useStarterKitchen', 'Use starter: Kitchen inspection')}
        </button>
        <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => useStarter('foodSafety')}>
          {t('restaurants.ops.audits.useStarterFoodSafety', 'Use starter: Food safety check')}
        </button>
      </div>
      <div className="fd-settings-field-grid">
        <div className="fd-field">
          <label htmlFor="audit-tmpl-name">{t('restaurants.ops.audits.nameLabel', 'Template name')}</label>
          <input
            id="audit-tmpl-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('restaurants.ops.audits.namePlaceholder', 'e.g. Kitchen inspection')}
          />
        </div>
        <div className="fd-field">
          <label htmlFor="audit-tmpl-cat">{t('restaurants.ops.audits.categoryLabel', 'Category')}</label>
          <select id="audit-tmpl-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
            {AUDIT_CATEGORIES.map((c) => (
              <option key={c} value={c}>{t(`restaurants.ops.audits.category.${c}`, c)}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="fd-field">
        <label htmlFor="audit-tmpl-desc">{t('restaurants.ops.audits.descriptionLabel', 'Description')}</label>
        <textarea
          id="audit-tmpl-desc"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('restaurants.ops.audits.descriptionPlaceholder', 'What this audit covers…')}
        />
      </div>
      <h3 className="fd-ops-subhead">{t('restaurants.ops.audits.itemsLabel', 'Scored items')}</h3>
      <div className="fd-ops-sop-list">
        {items.map((it, idx) => (
          <div key={idx} className="fd-ops-sop-card">
            <div className="fd-settings-field-grid">
              <div className="fd-field">
                <label htmlFor={`audit-item-label-${idx}`}>{t('restaurants.ops.audits.itemLabel', 'Item label')}</label>
                <input
                  id={`audit-item-label-${idx}`}
                  value={it.label}
                  onChange={setItem(idx, 'label')}
                  placeholder={t('restaurants.ops.audits.itemLabelPlaceholder', 'e.g. Floors clean and dry')}
                />
              </div>
              <div className="fd-field">
                <label htmlFor={`audit-item-instr-${idx}`}>{t('restaurants.ops.audits.instructionsLabel', 'Instructions')}</label>
                <input
                  id={`audit-item-instr-${idx}`}
                  value={it.instructions}
                  onChange={setItem(idx, 'instructions')}
                  placeholder={t('restaurants.ops.audits.instructionsPlaceholder', 'What the auditor checks…')}
                />
              </div>
            </div>
            <div className="fd-settings-field-grid">
              <div className="fd-field">
                <label htmlFor={`audit-item-max-${idx}`}>{t('restaurants.ops.audits.maxScoreLabel', 'Max score')}</label>
                <input
                  id={`audit-item-max-${idx}`}
                  type="number"
                  min={1}
                  value={it.maxScore}
                  onChange={setItem(idx, 'maxScore')}
                />
              </div>
              <div className="fd-field">
                <label htmlFor={`audit-item-weight-${idx}`}>{t('restaurants.ops.audits.weightLabel', 'Weight')}</label>
                <input
                  id={`audit-item-weight-${idx}`}
                  type="number"
                  min={1}
                  step="any"
                  value={it.weight}
                  onChange={setItem(idx, 'weight')}
                />
              </div>
            </div>
            <div className="fd-settings-actions">
              <button
                type="button"
                className="fd-btn fd-btn-secondary fd-btn-sm"
                onClick={() => removeItem(idx)}
                aria-label={t('restaurants.ops.audits.removeItem', 'Remove item')}
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="fd-settings-actions">
        <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={addItem}>
          {t('restaurants.ops.audits.addItem', 'Add item')}
        </button>
      </div>
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

// ── Recent audit row ────────────────────────────────────────────────────────
function AuditRunRow({ t, run, onView }) {
  const completed = run.status === 'completed';
  const pct = completed ? scorePct(run.total_score, run.max_score) : null;
  const auditor = [run.auditor_first_name, run.auditor_last_name].filter(Boolean).join(' ');
  return (
    <div className="fd-ops-run-row">
      <span>{run.template_name}</span>
      <span className="fd-card-meta">
        {new Date(run.started_at).toLocaleDateString()}
        {auditor ? ` · ${t('restaurants.ops.audits.byAuditor', 'by {{name}}', { name: auditor })}` : ''}
        {pct != null
          ? ` · ${t('restaurants.ops.audits.scoreSummary', '{{pct}}% · {{total}}/{{max}}', { pct, total: run.total_score, max: run.max_score })}`
          : ''}
        {` · ${t(`restaurants.ops.audits.runStatus.${run.status}`, run.status)}`}
        {` · ${t('restaurants.ops.audits.findingsCount', '{{count}} findings', { count: run.finding_count || 0 })}`}
        {` · ${t('restaurants.ops.audits.openActionsCount', '{{count}} open actions', { count: run.open_action_count || 0 })}`}
      </span>
      <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={onView}>
        {t('restaurants.ops.audits.view', 'View')}
      </button>
    </div>
  );
}

// ── Conducting an audit (staff scoring + findings) ──────────────────────────
function AuditRunView({ t, restaurantId, auditId, templateItems, staff, isManager, onClose }) {
  const [audit, setAudit] = useState(null);
  const [loading, setLoading] = useState(true);
  const [entry, setEntry] = useState({}); // item_id -> { score, note }
  const [savingId, setSavingId] = useState(null);
  const [notes, setNotes] = useState('');
  const [completing, setCompleting] = useState(false);
  const [showFinding, setShowFinding] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    getAuditRun(restaurantId, auditId)
      .then(({ audit: a }) => {
        setAudit(a);
        const e = {};
        (a.scores || []).forEach((sc) => {
          e[sc.item_id] = { score: sc.score ?? 0, note: sc.note || '' };
        });
        setEntry(e);
      })
      .catch((err) => toast.error(apiErr(err, t('restaurants.ops.audits.runLoadError', 'Could not load audit'))))
      .finally(() => setLoading(false));
  }, [restaurantId, auditId, t]);
  useEffect(() => { load(); }, [load]);

  const setScore = (itemId, value, maxScore) => {
    const n = Math.max(0, Math.min(maxScore, Number(value) || 0));
    setEntry((prev) => ({ ...prev, [itemId]: { score: n, note: prev[itemId]?.note || '' } }));
  };
  const setNote = (itemId, value) => {
    setEntry((prev) => ({ ...prev, [itemId]: { score: prev[itemId]?.score ?? 0, note: value } }));
  };

  const saveScore = async (item) => {
    const e = entry[item.item_id] || { score: 0, note: '' };
    setSavingId(item.item_id);
    try {
      const res = await scoreAuditItemOffline(restaurantId, auditId, { itemId: item.item_id, score: e.score, note: e.note });
      setEntry((prev) => ({ ...prev, [item.item_id]: { score: res.score ?? e.score, note: e.note, pendingSync: !!res.queued } }));
      toast.success(res && res.queued
        ? t('restaurants.ops.offline.queued', 'Saved offline. Will sync when back online.')
        : t('restaurants.ops.audits.scoreSaved', 'Score saved'));
    } catch (err) {
      toast.error(apiErr(err, t('restaurants.ops.audits.scoreSaveError', 'Could not save score')));
    } finally {
      setSavingId(null);
    }
  };

  const complete = async () => {
    setCompleting(true);
    try {
      const { audit: a } = await completeAuditRun(restaurantId, auditId, { notes });
      setAudit(a);
      toast.success(t('restaurants.ops.audits.auditCompleted', 'Audit completed'));
    } catch (err) {
      toast.error(apiErr(err, t('restaurants.ops.audits.completeError', 'Could not complete audit')));
    } finally {
      setCompleting(false);
    }
  };

  if (loading) return <div className="fd-empty">{t('food.common.loading', 'Loading…')}</div>;
  if (!audit) return null;

  const completed = audit.status === 'completed';
  const pct = completed ? scorePct(audit.total_score, audit.max_score) : null;

  // Score rows: every template item, merged with any saved score by item_id.
  // A fresh audit has no scores yet, so the template drives the list.
  const scoreByItem = {};
  (audit.scores || []).forEach((sc) => { scoreByItem[sc.item_id] = sc; });
  const scoreRows = (templateItems || []).map((ti) => ({
    label: ti.label,
    instructions: ti.instructions,
    max_score: ti.max_score,
    weight: ti.weight,
    ...(scoreByItem[ti.id] || {}),
    item_id: ti.id,
  }));

  return (
    <div>
      <div className="fd-ops-toolbar">
        <h3 className="fd-ops-panel-title">
          {t('restaurants.ops.audits.conductingTitle', 'Conducting audit')}: {audit.template_name}
        </h3>
        <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={onClose}>
          {t('food.common.back', 'Back')}
        </button>
      </div>

      {completed && pct != null && (
        <p className="fd-card-meta">
          <strong>
            {t('restaurants.ops.audits.resultHeader', 'Final score: {{pct}}% ({{total}} of {{max}})', {
              pct, total: audit.total_score, max: audit.max_score,
            })}
          </strong>
        </p>
      )}

      <h3 className="fd-ops-subhead">{t('restaurants.ops.audits.scoresTitle', 'Scores')}</h3>
      <div className="fd-ops-sop-list">
        {scoreRows.map((item) => {
          const e = entry[item.item_id] || { score: 0, note: '' };
          const max = Number(item.max_score) || 5;
          return (
            <div key={item.item_id} className="fd-ops-sop-card">
              <div className="fd-ops-sop-top">
                <div>
                  <strong>{item.label}</strong>
                  <span className="fd-tag fd-ops-sop-tag">
                    {t('restaurants.ops.audits.maxScoreTag', 'Max {{max}}', { max })}
                  </span>
                </div>
                <span className="fd-tag">
                  {t('restaurants.ops.audits.weightTag', 'Weight {{weight}}', { weight: item.weight ?? 1 })}
                </span>
              </div>
              {!completed ? (
                <>
                  <div className="fd-ops-task-add">
                    <button
                      type="button"
                      className="fd-btn fd-btn-secondary fd-btn-sm"
                      onClick={() => setScore(item.item_id, e.score - 1, max)}
                      disabled={e.score <= 0}
                      aria-label={t('restaurants.ops.audits.decreaseScore', 'Decrease score')}
                    >
                      −
                    </button>
                    <input
                      id={`audit-score-${item.item_id}`}
                      type="number"
                      min={0}
                      max={max}
                      value={e.score}
                      onChange={(ev) => setScore(item.item_id, ev.target.value, max)}
                      aria-label={t('restaurants.ops.audits.scoreLabel', 'Score')}
                    />
                    <button
                      type="button"
                      className="fd-btn fd-btn-secondary fd-btn-sm"
                      onClick={() => setScore(item.item_id, e.score + 1, max)}
                      disabled={e.score >= max}
                      aria-label={t('restaurants.ops.audits.increaseScore', 'Increase score')}
                    >
                      +
                    </button>
                  </div>
                  <div className="fd-field">
                    <label htmlFor={`audit-note-${item.item_id}`}>{t('restaurants.ops.audits.noteLabel', 'Note')}</label>
                    <input
                      id={`audit-note-${item.item_id}`}
                      value={e.note}
                      onChange={(ev) => setNote(item.item_id, ev.target.value)}
                      placeholder={t('restaurants.ops.audits.notePlaceholder', 'Optional note…')}
                    />
                  </div>
                  <div className="fd-settings-actions">
                    <button
                      type="button"
                      className="fd-btn fd-btn-sm"
                      disabled={savingId === item.item_id}
                      onClick={() => saveScore(item)}
                    >
                      {t('food.common.save', 'Save')}
                    </button>
                  </div>
                </>
              ) : (
                <p className="fd-card-meta fd-ops-sop-body">
                  {t('restaurants.ops.audits.scoredValue', 'Score: {{score}} of {{max}}', { score: item.score ?? 0, max })}
                  {item.note ? ` · ${item.note}` : ''}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <h3 className="fd-ops-subhead">{t('restaurants.ops.audits.findingsTitle', 'Findings')}</h3>
      {!completed && (
        <div className="fd-settings-actions">
          <button type="button" className="fd-btn fd-btn-sm" onClick={() => setShowFinding((s) => !s)}>
            {showFinding ? t('food.common.back', 'Back') : t('restaurants.ops.audits.addFinding', 'Add finding')}
          </button>
        </div>
      )}
      {!completed && showFinding && (
        <FindingForm
          t={t}
          items={audit.scores || []}
          onCancel={() => setShowFinding(false)}
          onAdd={async (payload) => {
            try {
              const res = await addAuditFindingOffline(restaurantId, auditId, payload);
              setShowFinding(false);
              if (res && res.queued) {
                toast.success(t('restaurants.ops.offline.queued', 'Saved offline. Will sync when back online.'));
              }
              load();
            } catch (err) {
              toast.error(apiErr(err, t('restaurants.ops.audits.findingAddError', 'Could not add finding')));
            }
          }}
        />
      )}
      {(audit.findings || []).length === 0 ? (
        <p className="fd-card-meta">{t('restaurants.ops.audits.noFindings', 'No findings recorded.')}</p>
      ) : (
        <div className="fd-ops-sop-list">
          {(audit.findings || []).map((f) => (
            <FindingCard
              key={f.id}
              t={t}
              restaurantId={restaurantId}
              finding={f}
              items={audit.scores || []}
              staff={staff}
              isManager={isManager}
              onActionCreated={load}
            />
          ))}
        </div>
      )}

      {!completed && (
        <div className="fd-ops-form">
          <h3 className="fd-ops-form-title">{t('restaurants.ops.audits.completeTitle', 'Complete audit')}</h3>
          <div className="fd-field">
            <label htmlFor="audit-complete-notes">{t('restaurants.ops.audits.completionNotesLabel', 'Completion notes')}</label>
            <textarea
              id="audit-complete-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('restaurants.ops.audits.completionNotesPlaceholder', 'Summary notes…')}
            />
          </div>
          <div className="fd-settings-actions">
            <button type="button" className="fd-btn fd-btn-sm" disabled={completing} onClick={complete}>
              {t('restaurants.ops.audits.completeAudit', 'Complete audit')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Finding form + card ─────────────────────────────────────────────────────
function FindingForm({ t, items, onCancel, onAdd }) {
  const [itemId, setItemId] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [note, setNote] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!note.trim()) return;
    setSaving(true);
    await onAdd({
      itemId: itemId || null,
      severity,
      note: note.trim(),
      photoUrl: photoUrl.trim() || null,
    });
    setSaving(false);
  };

  return (
    <form onSubmit={submit} className="fd-ops-form">
      <div className="fd-settings-field-grid">
        <div className="fd-field">
          <label htmlFor="finding-item">{t('restaurants.ops.audits.findingItemLabel', 'Related item')}</label>
          <select id="finding-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">{t('restaurants.ops.audits.findingItemNone', 'General (no item)')}</option>
            {items.map((it) => (
              <option key={it.item_id} value={it.item_id}>{it.label}</option>
            ))}
          </select>
        </div>
        <div className="fd-field">
          <label htmlFor="finding-severity">{t('restaurants.ops.audits.severityLabel', 'Severity')}</label>
          <select id="finding-severity" value={severity} onChange={(e) => setSeverity(e.target.value)}>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>{t(`restaurants.ops.audits.severity.${s}`, s)}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="fd-field">
        <label htmlFor="finding-note">{t('restaurants.ops.audits.findingNoteLabel', 'Finding note')}</label>
        <textarea
          id="finding-note"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('restaurants.ops.audits.findingNotePlaceholder', 'Describe the issue…')}
        />
      </div>
      <div className="fd-field">
        <label htmlFor="finding-photo">{t('restaurants.ops.audits.photoUrlLabel', 'Photo URL (optional)')}</label>
        <input
          id="finding-photo"
          value={photoUrl}
          onChange={(e) => setPhotoUrl(e.target.value)}
          placeholder={t('restaurants.ops.audits.photoUrlPlaceholder', 'https://')}
        />
      </div>
      <div className="fd-settings-actions">
        <button type="submit" className="fd-btn fd-btn-sm" disabled={saving || !note.trim()}>
          {t('common.add', 'Add')}
        </button>
        <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={onCancel}>
          {t('food.common.back', 'Back')}
        </button>
      </div>
    </form>
  );
}

function FindingCard({ t, restaurantId, finding, items, staff, isManager, onActionCreated }) {
  const [showAction, setShowAction] = useState(false);
  const hot = finding.severity === 'high' || finding.severity === 'critical';
  const reporter = [finding.first_name, finding.last_name].filter(Boolean).join(' ');
  const itemLabel = finding.item_id
    ? (items.find((it) => String(it.item_id) === String(finding.item_id))?.label || null)
    : null;

  return (
    <div className={`fd-ops-sop-card${hot ? ' fd-ops-notice--warn' : ''}`}>
      <div className="fd-ops-sop-top">
        <div>
          <strong>{finding.note}</strong>
          <span className="fd-tag fd-ops-sop-tag">
            {t(`restaurants.ops.audits.severity.${finding.severity}`, finding.severity)}
          </span>
        </div>
        <span className="fd-card-meta">{new Date(finding.created_at).toLocaleDateString()}</span>
      </div>
      {(itemLabel || reporter) && (
        <p className="fd-card-meta fd-ops-sop-body">
          {itemLabel || ''}
          {itemLabel && reporter ? ' · ' : ''}
          {reporter ? t('restaurants.ops.audits.reportedBy', 'Reported by {{name}}', { name: reporter }) : ''}
        </p>
      )}
      {finding.photo_url && (
        <p className="fd-card-meta fd-ops-sop-body">
          <a href={finding.photo_url} target="_blank" rel="noreferrer">
            {t('restaurants.ops.audits.viewPhoto', 'View photo')}
          </a>
        </p>
      )}
      {isManager && (
        <div className="fd-settings-actions">
          <button
            type="button"
            className="fd-btn fd-btn-secondary fd-btn-sm"
            onClick={() => setShowAction((s) => !s)}
          >
            {showAction ? t('food.common.back', 'Back') : t('restaurants.ops.audits.actionFromFinding', 'Create action')}
          </button>
        </div>
      )}
      {isManager && showAction && (
        <CorrectiveActionForm
          t={t}
          staff={staff}
          onCancel={() => setShowAction(false)}
          onCreate={async (payload) => {
            try {
              await createCorrectiveAction(restaurantId, finding.id, payload);
              setShowAction(false);
              onActionCreated();
            } catch (err) {
              toast.error(apiErr(err, t('restaurants.ops.audits.actionCreateError', 'Could not create corrective action')));
            }
          }}
        />
      )}
    </div>
  );
}

// ── Corrective actions ──────────────────────────────────────────────────────
function CorrectiveActionForm({ t, staff, onCancel, onCreate }) {
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!description.trim()) return;
    setSaving(true);
    await onCreate({
      description: description.trim(),
      assigneeId: assigneeId || null,
      dueAt: dueAt || null,
    });
    setSaving(false);
  };

  return (
    <form onSubmit={submit} className="fd-ops-form">
      <div className="fd-field">
        <label htmlFor="action-desc">{t('restaurants.ops.audits.actionDescriptionLabel', 'Action description')}</label>
        <input
          id="action-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('restaurants.ops.audits.actionDescriptionPlaceholder', 'What needs to be done…')}
        />
      </div>
      <div className="fd-settings-field-grid">
        <div className="fd-field">
          <label htmlFor="action-assignee">{t('restaurants.ops.audits.assigneeLabel', 'Assignee')}</label>
          <select id="action-assignee" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">{t('restaurants.ops.audits.unassigned', 'Unassigned')}</option>
            {staff.map((s) => (
              <option key={s.user_id} value={s.user_id}>
                {[s.first_name, s.last_name].filter(Boolean).join(' ') || s.user_id}
              </option>
            ))}
          </select>
        </div>
        <div className="fd-field">
          <label htmlFor="action-due">{t('restaurants.ops.audits.dueAtLabel', 'Due date')}</label>
          <input id="action-due" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        </div>
      </div>
      <div className="fd-settings-actions">
        <button type="submit" className="fd-btn fd-btn-sm" disabled={saving || !description.trim()}>
          {t('common.add', 'Add')}
        </button>
        <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={onCancel}>
          {t('food.common.back', 'Back')}
        </button>
      </div>
    </form>
  );
}

function CorrectiveActions({ t, restaurantId, actions, isManager, onChanged }) {
  const advance = async (action, status) => {
    try {
      await updateCorrectiveAction(restaurantId, action.id, { status });
      onChanged();
    } catch (err) {
      toast.error(apiErr(err, t('common.failedToUpdate', 'Failed to update')));
    }
  };

  if (actions.length === 0) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title={t('restaurants.ops.audits.noActions', 'No corrective actions.')}
      />
    );
  }

  return (
    <div className="fd-ops-sop-list">
      {actions.map((a) => {
        const assignee = [a.assignee_first_name, a.assignee_last_name].filter(Boolean).join(' ');
        const next = a.status === 'open' ? 'in_progress' : a.status === 'in_progress' ? 'resolved' : null;
        return (
          <div key={a.id} className="fd-ops-sop-card">
            <div className="fd-ops-sop-top">
              <div>
                <strong>{a.description}</strong>
                <span className="fd-tag fd-ops-sop-tag">
                  {t(`restaurants.ops.audits.actionStatus.${a.status}`, a.status)}
                </span>
                <span className="fd-tag fd-ops-sop-tag">
                  {t(`restaurants.ops.audits.severity.${a.severity}`, a.severity)}
                </span>
              </div>
            </div>
            <p className="fd-card-meta fd-ops-sop-body">
              {a.finding_note ? `${t('restaurants.ops.audits.linkedFinding', 'Finding')}: ${a.finding_note}` : ''}
              {a.finding_note ? ' · ' : ''}
              {assignee || t('restaurants.ops.audits.unassigned', 'Unassigned')}
              {a.due_at ? ` · ${t('restaurants.ops.audits.dueLabel', 'Due')} ${new Date(a.due_at).toLocaleDateString()}` : ''}
            </p>
            <div className="fd-ops-sop-actions">
              {next && (
                <button type="button" className="fd-btn fd-btn-sm" onClick={() => advance(a, next)}>
                  {next === 'in_progress'
                    ? t('restaurants.ops.audits.startWork', 'Start')
                    : t('restaurants.ops.audits.resolveAction', 'Resolve')}
                </button>
              )}
              {isManager && a.status === 'resolved' && (
                <button type="button" className="fd-btn fd-btn-sm" onClick={() => advance(a, 'verified')}>
                  {t('restaurants.ops.audits.verifyAction', 'Verify')}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Read-only audit detail ──────────────────────────────────────────────────
function AuditRunDetail({ t, restaurantId, auditId, onClose }) {
  const [audit, setAudit] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getAuditRun(restaurantId, auditId)
      .then(({ audit: a }) => setAudit(a))
      .catch((err) => toast.error(apiErr(err, t('restaurants.ops.audits.runLoadError', 'Could not load audit'))))
      .finally(() => setLoading(false));
  }, [restaurantId, auditId, t]);

  if (loading) return <div className="fd-empty">{t('food.common.loading', 'Loading…')}</div>;
  if (!audit) return null;

  const pct = audit.status === 'completed' ? scorePct(audit.total_score, audit.max_score) : null;

  return (
    <div>
      <div className="fd-ops-toolbar">
        <h3 className="fd-ops-panel-title">
          {t('restaurants.ops.audits.runDetailTitle', 'Audit')}: {audit.template_name}
          {' · '}
          {new Date(audit.started_at).toLocaleDateString()}
        </h3>
        <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={onClose}>
          {t('food.common.back', 'Back')}
        </button>
      </div>
      {pct != null && (
        <p className="fd-card-meta">
          <strong>
            {t('restaurants.ops.audits.resultHeader', 'Final score: {{pct}}% ({{total}} of {{max}})', {
              pct, total: audit.total_score, max: audit.max_score,
            })}
          </strong>
        </p>
      )}
      <h3 className="fd-ops-subhead">{t('restaurants.ops.audits.scoresTitle', 'Scores')}</h3>
      <div className="fd-ops-sop-list">
        {(audit.scores || []).map((sc) => (
          <div key={sc.item_id} className="fd-ops-sop-card">
            <div className="fd-ops-sop-top">
              <div><strong>{sc.label}</strong></div>
              <span className="fd-tag">
                {t('restaurants.ops.audits.scoredValue', 'Score: {{score}} of {{max}}', { score: sc.score ?? 0, max: sc.max_score })}
              </span>
            </div>
            {sc.note && <p className="fd-card-meta fd-ops-sop-body">{sc.note}</p>}
          </div>
        ))}
      </div>
      <h3 className="fd-ops-subhead">{t('restaurants.ops.audits.findingsTitle', 'Findings')}</h3>
      {(audit.findings || []).length === 0 ? (
        <p className="fd-card-meta">{t('restaurants.ops.audits.noFindings', 'No findings recorded.')}</p>
      ) : (
        <div className="fd-ops-sop-list">
          {(audit.findings || []).map((f) => (
            <FindingCard
              key={f.id}
              t={t}
              restaurantId={restaurantId}
              finding={f}
              items={audit.scores || []}
              staff={[]}
              isManager={false}
              onActionCreated={() => {}}
            />
          ))}
        </div>
      )}
    </div>
  );
}
