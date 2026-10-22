// Local Food Directory — Operations panels (Phase 4): Staff training.
// Mounted inside FoodMerchantPage's Operations tab. Talks to /api/restaurants.
//
// Module authoring, staff assignment, and completion reports are owner/manager
// only; the backend enforces this and returns 403, which we surface as a toast.
// Taking lessons and quizzes is open to any assigned staff member.

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { GraduationCap } from 'lucide-react';
import EmptyState from '../../components/EmptyState';
import {
  listTrainingModules, createTrainingModule, updateTrainingModule, deleteTrainingModule,
  listRestaurantStaff, assignTrainingModule,
  listTrainingAssignments, startTrainingAssignment,
  listTrainingCompletions,
  listTrainingAutoAssignRules, createTrainingAutoAssignRule, deleteTrainingAutoAssignRule,
  listSops,
  listStaffDocuments, uploadStaffDocument, verifyStaffDocument, deleteStaffDocument,
  acknowledgeSop, listSopAcknowledgements,
} from '../../api/restaurants';
import { submitTrainingQuizOffline } from '../../api/restaurantsOffline';
import { ConfirmDialog } from './foodShared';
import SignaturePad from '../../components/SignaturePad';

function apiErr(err, fallback) {
  const m = err?.response?.data?.error?.message || err?.response?.data?.message;
  return typeof m === 'string' ? m : fallback;
}

const TRAINING_CATEGORIES = ['general', 'kitchen', 'front_of_house', 'cleaning', 'food_safety', 'customer_service', 'safety'];

// Starter module so a new training program is not empty (owner edits after).
const SEED_TRAINING = {
  title: 'Food safety basics',
  description: 'The food safety essentials every team member must know before handling food.',
  content: [
    'Wash your hands with warm water and soap for at least 20 seconds before touching food, after handling raw meat, and after using the restroom. Handwashing is the single most effective way to prevent foodborne illness.',
    'Keep cold food at or below 41F and hot food at or above 135F. The danger zone between 41F and 135F lets bacteria double every 20 minutes, so never leave perishable food out for more than 2 hours.',
    'Prevent cross-contamination: store raw meat below ready-to-eat food in the fridge, use separate cutting boards and knives for raw and cooked items, and sanitize surfaces between tasks.',
  ].join('\n\n'),
  category: 'food_safety',
  passScorePct: 80,
  questions: [
    {
      question: 'How long should you wash your hands before handling food?',
      options: ['5 seconds', 'At least 20 seconds', '1 minute', 'Only when they look dirty'],
      correct_index: 1,
    },
    {
      question: 'What is the temperature danger zone for food?',
      options: ['32F to 41F', '41F to 135F', '135F to 165F', 'Above 165F'],
      correct_index: 1,
    },
    {
      question: 'Where should raw meat be stored in the fridge?',
      options: ['On the top shelf', 'Next to ready-to-eat food', 'Below ready-to-eat food', 'In the door'],
      correct_index: 2,
    },
  ],
};

function fmtDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString();
}

function staffName(row) {
  const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
  return name || row.user_id;
}

// ── Training panel ────────────────────────────────────────────────────────────
export function TrainingPanel({ t, restaurant, bare, onStats, isManager }) {
  const restaurantId = restaurant.id;
  const [modules, setModules] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [completions, setCompletions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | 'new' | module
  const [taking, setTaking] = useState(null); // { assignment, module, step: 'lesson'|'quiz'|'result', result }
  const [confirmDelete, setConfirmDelete] = useState(null); // module pending delete confirmation

  const load = useCallback(() => {
    setLoading(true);
    const fetches = [
      listTrainingModules(restaurantId),
      listTrainingAssignments(restaurantId, isManager ? {} : { mine: '1' }),
    ];
    if (isManager) fetches.push(listTrainingCompletions(restaurantId));
    Promise.all(fetches)
      .then(([mods, asg, comp]) => {
        setModules(mods);
        setAssignments(asg);
        setCompletions(comp || []);
        const completed = isManager
          ? (comp || []).length
          : asg.filter((a) => a.status === 'completed').length;
        onStats?.({ trainingModules: mods.length, trainingAssigned: asg.length, trainingCompleted: completed });
      })
      .catch((err) => toast.error(apiErr(err, t('restaurants.ops.training.loadError', 'Could not load training'))))
      .finally(() => setLoading(false));
  }, [restaurantId, t, onStats, isManager]);
  useEffect(() => { load(); }, [load]);

  const save = async (payload, moduleId) => {
    try {
      if (moduleId) await updateTrainingModule(restaurantId, moduleId, payload);
      else await createTrainingModule(restaurantId, payload);
      setEditing(null);
      load();
    } catch (err) {
      toast.error(apiErr(err, t('restaurants.ops.training.saveError', 'Could not save module')));
    }
  };

  const remove = async (moduleId) => {
    try {
      await deleteTrainingModule(restaurantId, moduleId);
      setConfirmDelete(null);
      load();
    } catch (err) {
      toast.error(apiErr(err, t('common.failedToDelete', 'Failed to delete')));
    }
  };

  const beginTraining = async (assignment) => {
    const module = modules.find((m) => m.id === assignment.module_id);
    if (!module || (module.questions || []).length === 0) {
      toast.error(t('restaurants.ops.training.noContent', 'This module has no lesson content yet.'));
      return;
    }
    try {
      const updated = await startTrainingAssignment(restaurantId, assignment.id);
      setTaking({ assignment: updated || assignment, module, step: 'lesson', result: null });
    } catch (err) {
      toast.error(apiErr(err, t('restaurants.ops.training.startError', 'Could not start training')));
    }
  };

  if (loading) return <div className="fd-empty">{t('food.common.loading', 'Loading…')}</div>;

  if (!isManager && taking) {
    return (
      <TrainingFlow
        t={t}
        restaurantId={restaurantId}
        taking={taking}
        setTaking={setTaking}
        onDone={load}
      />
    );
  }

  if (isManager && editing) {
    return <ModuleForm t={t} module={editing === 'new' ? null : editing} onCancel={() => setEditing(null)} onSave={save} />;
  }

  return (
    <div>
      <div className={`fd-ops-toolbar${bare ? ' fd-ops-toolbar--end' : ''}`}>
        {!bare && <h3 className="fd-ops-panel-title">{t('restaurants.ops.training.title', 'Staff training')}</h3>}
        {isManager && (
          <button type="button" className="fd-btn fd-btn-sm" onClick={() => setEditing('new')} data-track="ui.2265f208ce.1">
            {t('restaurants.ops.training.newModule', 'New module')}
          </button>
        )}
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={t('restaurants.ops.training.confirmDelete')}
          confirmLabel={t('common.delete')}
          cancelLabel={t('food.common.cancel')}
          onConfirm={() => remove(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {isManager ? (
        <ManagerTraining
          t={t}
          restaurantId={restaurantId}
          modules={modules}
          assignments={assignments}
          completions={completions}
          onEdit={setEditing}
          onDelete={(moduleId) => setConfirmDelete(modules.find((m) => m.id === moduleId) || { id: moduleId })}
          onAssigned={load}
        />
      ) : (
        <StaffTraining t={t} assignments={assignments} onStart={beginTraining} />
      )}

      <ComplianceSection t={t} restaurantId={restaurantId} isManager={isManager} />
    </div>
  );
}

// ── Manager view ──────────────────────────────────────────────────────────────
function ManagerTraining({ t, restaurantId, modules, assignments, completions, onEdit, onDelete, onAssigned }) {
  return (
    <div>
      {modules.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title={t('restaurants.ops.training.empty', 'No training modules yet. Create your first module to onboard staff.')}
          actions={(
            <button type="button" className="fd-btn" onClick={() => onEdit('new')} data-track="ui.2265f208ce.2">
              {t('restaurants.ops.training.newModule', 'New module')}
            </button>
          )}
        />
      ) : (
        <div className="fd-ops-checklists-grid">
          {modules.map((m) => (
            <ModuleCard
              key={m.id}
              t={t}
              restaurantId={restaurantId}
              module={m}
              assignments={assignments}
              onEdit={onEdit}
              onDelete={onDelete}
              onAssigned={onAssigned}
            />
          ))}
        </div>
      )}

      <h3 className="fd-ops-subhead">{t('restaurants.ops.training.assignmentsTitle', 'Assignments')}</h3>
      {assignments.length === 0 ? (
        <p className="fd-card-meta">{t('restaurants.ops.training.assignmentsEmpty', 'No assignments yet. Assign a module to a staff member from a module card.')}</p>
      ) : (
        <div className="fd-ops-run-list">
          {assignments.map((a) => (
            <div key={a.id} className="fd-ops-run-row">
              <span>{staffName(a)} · {a.module_title}</span>
              <span className="fd-card-meta">
                <span className="fd-tag">{t(`restaurants.ops.training.status.${a.status}`, a.status)}</span>
                {' '}
                {fmtDate(a.due_at)
                  ? t('restaurants.ops.training.dueOn', 'Due {{date}}', { date: fmtDate(a.due_at) })
                  : t('restaurants.ops.training.dueNone', 'No due date')}
                {a.score_pct != null && ` · ${a.score_pct}%`}
                {a.max_attempts != null && ` · ${t('restaurants.ops.training.attemptsUsed', { used: a.attempts_used || 0, max: a.max_attempts })}`}
                {a.completion_expires_at && ` · ${t('restaurants.ops.training.validUntil', { date: fmtDate(a.completion_expires_at) })}`}
              </span>
            </div>
          ))}
        </div>
      )}

      <h3 className="fd-ops-subhead">{t('restaurants.ops.training.completionsTitle', 'Completions')}</h3>
      {completions.length === 0 ? (
        <p className="fd-card-meta">{t('restaurants.ops.training.completionsEmpty', 'No completions yet.')}</p>
      ) : (
        <div className="fd-ops-run-list">
          {completions.map((c) => (
            <div key={c.id} className="fd-ops-run-row">
              <span>{staffName(c)} · {c.module_title}</span>
              <span className="fd-card-meta">
                <span className="fd-tag">{c.passed ? t('restaurants.ops.training.passed', 'Passed') : t('restaurants.ops.training.failed', 'Failed')}</span>
                {c.score_pct != null && ` ${c.score_pct}%`}
                {` · ${fmtDate(c.completed_at) || ''}`}
                {c.attempt_number != null && ` · ${t('restaurants.ops.training.attemptNumber', { n: c.attempt_number })}`}
                {c.module_version != null && ` · ${t('restaurants.ops.training.moduleVersion', { n: c.module_version })}`}
                {c.expires_at && ` · ${t('restaurants.ops.training.validUntil', { date: fmtDate(c.expires_at) })}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ModuleCard({ t, restaurantId, module: m, assignments, onEdit, onDelete, onAssigned }) {
  const [assignOpen, setAssignOpen] = useState(false);
  const [staff, setStaff] = useState([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [userId, setUserId] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [busy, setBusy] = useState(false);

  const questionCount = (m.questions || []).length;
  const activeCount = assignments.filter((a) => a.module_id === m.id && a.status !== 'completed').length;

  const toggleAssign = () => {
    setAssignOpen((open) => {
      if (!open) {
        setStaffLoading(true);
        listRestaurantStaff(restaurantId)
          .then(setStaff)
          .catch((err) => toast.error(apiErr(err, t('restaurants.ops.training.staffLoadError', 'Could not load staff'))))
          .finally(() => setStaffLoading(false));
      }
      return !open;
    });
  };

  const assign = async (e) => {
    e.preventDefault();
    if (!userId) return;
    setBusy(true);
    try {
      await assignTrainingModule(restaurantId, m.id, { userId, dueAt: dueAt || undefined });
      toast.success(t('restaurants.ops.training.assigned', 'Module assigned'));
      setAssignOpen(false);
      setUserId('');
      setDueAt('');
      onAssigned();
    } catch (err) {
      toast.error(apiErr(err, t('restaurants.ops.training.assignError', 'Could not assign module')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fd-ops-checklist-card">
      <div className="fd-ops-checklist-top">
        <h4>{m.title}</h4>
        <span className="fd-tag">{t(`restaurants.ops.training.category.${m.category}`, m.category)}</span>
      </div>
      <p className="fd-card-meta">
        {t('restaurants.ops.training.questionCount', '{{count}} questions', { count: questionCount })}
        {' · '}
        {t('restaurants.ops.training.passScore', 'Pass {{pct}}%', { pct: m.pass_score_pct })}
        {' · '}
        {t('restaurants.ops.training.activeCount', '{{count}} active', { count: activeCount })}
        {m.current_version != null && ` · ${t('restaurants.ops.training.moduleVersion', { n: m.current_version })}`}
        {m.valid_for_days != null && ` · ${t('restaurants.ops.training.validForDays', { days: m.valid_for_days })}`}
        {m.max_attempts != null && ` · ${t('restaurants.ops.training.maxAttempts', { count: m.max_attempts })}`}
      </p>
      {!m.is_active && (
        <p className="fd-card-meta"><span className="fd-tag">{t('restaurants.ops.training.inactive', 'Inactive')}</span></p>
      )}
      {m.description && <p className="fd-card-meta">{m.description}</p>}
      <div className="fd-ops-checklist-actions">
        <button type="button" className="fd-btn fd-btn-sm" onClick={() => onEdit(m)} data-track="ui.2265f208ce.3">{t('common.edit', 'Edit')}</button>
        <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={toggleAssign} data-track="ui.2265f208ce.4">
          {assignOpen ? t('food.common.back', 'Back') : t('restaurants.ops.training.assign', 'Assign')}
        </button>
        <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => onDelete(m.id)} data-track="ui.2265f208ce.5">{t('common.delete', 'Delete')}</button>
      </div>
      {assignOpen && (
        <form onSubmit={assign} className="fd-ops-form" data-track="ui.2265f208ce.6">
          <h3 className="fd-ops-form-title">{t('restaurants.ops.training.assignTitle', 'Assign module')}</h3>
          <div className="fd-field">
            <label htmlFor={`tm-assign-staff-${m.id}`}>{t('restaurants.ops.training.staffLabel', 'Staff member')}</label>
            <select id={`tm-assign-staff-${m.id}`} value={userId} onChange={(e) => setUserId(e.target.value)} disabled={staffLoading}>
              <option value="">{t('restaurants.ops.training.staffPlaceholder', 'Select staff…')}</option>
              {staff.map((s) => (
                <option key={s.user_id} value={s.user_id}>
                  {[s.first_name, s.last_name].filter(Boolean).join(' ') || s.user_id} ({s.role})
                </option>
              ))}
            </select>
          </div>
          <div className="fd-field">
            <label htmlFor={`tm-assign-due-${m.id}`}>{t('restaurants.ops.training.dueLabel', 'Due date (optional)')}</label>
            <input id={`tm-assign-due-${m.id}`} type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </div>
          <div className="fd-settings-actions">
            <button type="submit" className="fd-btn fd-btn-sm" disabled={busy || !userId} data-track="ui.2265f208ce.7">
              {t('restaurants.ops.training.assignCta', 'Assign')}
            </button>
            <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => setAssignOpen(false)} data-track="ui.2265f208ce.8">
              {t('food.common.back', 'Back')}
            </button>
          </div>
        </form>
      )}
      <AutoAssignRules t={t} restaurantId={restaurantId} module={m} onChanged={onAssigned} />
    </div>
  );
}

// Automatic assignment rules for one module (S-12): new hires and staff in
// the chosen role receive the module without a manual assign step.
const MEMBER_ROLE_KEYS = ['manager', 'representative', 'employee', 'support_agent'];

function AutoAssignRules({ t, restaurantId, module: m, onChanged }) {
  const [rules, setRules] = useState(null);
  const [role, setRole] = useState('');
  const [dueDays, setDueDays] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listTrainingAutoAssignRules(restaurantId)
      .then((all) => setRules(all.filter((r) => Number(r.module_id) === Number(m.id))))
      .catch(() => setRules([]));
  }, [restaurantId, m.id]);
  useEffect(() => { load(); }, [load]);

  if (rules === null) return null;

  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const data = await createTrainingAutoAssignRule(restaurantId, m.id, {
        targetRole: role || null,
        dueDays: dueDays ? Number(dueDays) : undefined,
      });
      toast.success(t('restaurants.ops.training.autoAssignAdded', { count: data?.assignedCount || 0 }));
      setRole('');
      setDueDays('');
      load();
      onChanged();
    } catch (err) {
      toast.error(apiErr(err, t('restaurants.ops.training.autoAssignError')));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (ruleId) => {
    try {
      await deleteTrainingAutoAssignRule(restaurantId, ruleId);
      load();
    } catch (err) {
      toast.error(apiErr(err, t('restaurants.ops.training.autoAssignError')));
    }
  };

  return (
    <div className="fd-ops-form">
      <h4 className="fd-ops-panel-title">{t('restaurants.ops.training.autoAssignTitle')}</h4>
      <p className="fd-card-meta">{t('restaurants.ops.training.autoAssignHint')}</p>
      {rules.map((r) => (
        <div key={r.id} className="fd-ops-run-row">
          <span>
            {r.target_role
              ? t('restaurants.ops.training.autoAssignRole', { role: r.target_role })
              : t('restaurants.ops.training.autoAssignAll')}
            {r.due_days ? ` · ${t('restaurants.ops.training.autoAssignDue', { days: r.due_days })}` : ''}
            {!r.is_active && ` · ${t('restaurants.ops.training.inactive', 'Inactive')}`}
          </span>
          <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => remove(r.id)} data-track="ui.2265f208ce.28">
            {t('common.delete', 'Delete')}
          </button>
        </div>
      ))}
      <form onSubmit={add} data-track="ui.2265f208ce.29">
        <div className="fd-field">
          <label htmlFor={`tm-rule-role-${m.id}`}>{t('restaurants.ops.training.autoAssignRoleLabel')}</label>
          <select id={`tm-rule-role-${m.id}`} value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">{t('restaurants.ops.training.autoAssignAll')}</option>
            {MEMBER_ROLE_KEYS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        <div className="fd-field">
          <label htmlFor={`tm-rule-due-${m.id}`}>{t('restaurants.ops.training.autoAssignDueLabel')}</label>
          <input id={`tm-rule-due-${m.id}`} type="number" min="1" max="365" value={dueDays} onChange={(e) => setDueDays(e.target.value)} />
        </div>
        <div className="fd-settings-actions">
          <button type="submit" className="fd-btn fd-btn-sm" disabled={busy} data-track="ui.2265f208ce.30">
            {t('restaurants.ops.training.autoAssignAdd')}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Module authoring form ─────────────────────────────────────────────────────
function ModuleForm({ t, module, onSave, onCancel }) {
  const [title, setTitle] = useState(module?.title || '');
  const [category, setCategory] = useState(module?.category || 'general');
  const [description, setDescription] = useState(module?.description || '');
  const [content, setContent] = useState(module?.content || '');
  const [passScorePct, setPassScorePct] = useState(module?.pass_score_pct ?? 80);
  const [validForDays, setValidForDays] = useState(module?.valid_for_days ?? '');
  const [maxAttempts, setMaxAttempts] = useState(module?.max_attempts ?? 3);
  const [questions, setQuestions] = useState(
    (module?.questions || []).map((q) => ({
      question: q.question || '',
      options: (q.options || []).map(String),
      correct_index: Number.isInteger(q.correct_index) ? q.correct_index : 0,
    })),
  );
  const [saving, setSaving] = useState(false);

  const useStarter = () => {
    setTitle(SEED_TRAINING.title);
    setDescription(SEED_TRAINING.description);
    setContent(SEED_TRAINING.content);
    setCategory(SEED_TRAINING.category);
    setPassScorePct(SEED_TRAINING.passScorePct);
    setQuestions(SEED_TRAINING.questions.map((q) => ({ ...q, options: [...q.options] })));
  };

  const setQ = (i, patch) => setQuestions((qs) => qs.map((q, qi) => (qi === i ? { ...q, ...patch } : q)));
  const addQuestion = () => setQuestions((qs) => [...qs, { question: '', options: ['', ''], correct_index: 0 }]);
  const removeQuestion = (i) => setQuestions((qs) => qs.filter((_, qi) => qi !== i));
  const setOption = (i, oi, value) => setQuestions((qs) => qs.map((q, qi) => (
    qi === i ? { ...q, options: q.options.map((o, oidx) => (oidx === oi ? value : o)) } : q
  )));
  const addOption = (i) => setQuestions((qs) => qs.map((q, qi) => (
    qi === i ? { ...q, options: [...q.options, ''] } : q
  )));
  const removeOption = (i, oi) => setQuestions((qs) => qs.map((q, qi) => {
    if (qi !== i) return q;
    const options = q.options.filter((_, oidx) => oidx !== oi);
    return { ...q, options, correct_index: Math.min(q.correct_index, Math.max(0, options.length - 1)) };
  }));

  const valid = title.trim().length > 0
    && questions.length > 0
    && questions.every((q) => (
      q.question.trim().length > 0
      && q.options.length >= 2
      && q.options.every((o) => o.trim().length > 0)
      && q.correct_index >= 0
      && q.correct_index < q.options.length
    ));

  const submit = async (e) => {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    await onSave({
      title: title.trim(),
      description: description.trim(),
      content,
      category,
      passScorePct: Math.max(0, Math.min(100, Number(passScorePct) || 0)),
      validForDays: validForDays === '' ? null : Math.max(1, Number(validForDays) || 1),
      maxAttempts: Math.max(1, Math.min(20, Number(maxAttempts) || 3)),
      questions: questions.map((q) => ({
        question: q.question.trim(),
        options: q.options.map((o) => o.trim()),
        correct_index: q.correct_index,
      })),
    }, module?.id);
    setSaving(false);
  };

  return (
    <form onSubmit={submit} className="fd-ops-form" data-track="ui.2265f208ce.9">
      <div className="fd-ops-toolbar">
        <h3 className="fd-ops-form-title">
          {module ? t('restaurants.ops.training.editTitle', 'Edit module') : t('restaurants.ops.training.newTitle', 'New module')}
        </h3>
        <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={useStarter} data-track="ui.2265f208ce.10">
          {t('restaurants.ops.training.useStarter', 'Use starter: Food safety basics')}
        </button>
      </div>
      <div className="fd-settings-field-grid">
        <div className="fd-field">
          <label htmlFor="tm-title">{t('restaurants.ops.training.titleLabel', 'Title')}</label>
          <input id="tm-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('restaurants.ops.training.titlePlaceholder', 'e.g. Opening procedures')} />
        </div>
        <div className="fd-field">
          <label htmlFor="tm-cat">{t('restaurants.ops.training.categoryLabel', 'Category')}</label>
          <select id="tm-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
            {TRAINING_CATEGORIES.map((c) => (
              <option key={c} value={c}>{t(`restaurants.ops.training.category.${c}`, c)}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="fd-field">
        <label htmlFor="tm-desc">{t('restaurants.ops.training.descriptionLabel', 'Description')}</label>
        <input id="tm-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('restaurants.ops.training.descriptionPlaceholder', 'One line about what this module covers.')} />
      </div>
      <div className="fd-field">
        <label htmlFor="tm-content">{t('restaurants.ops.training.contentLabel', 'Lesson content')}</label>
        <textarea id="tm-content" rows={8} value={content} onChange={(e) => setContent(e.target.value)} placeholder={t('restaurants.ops.training.contentPlaceholder', 'Write the lesson. Separate paragraphs with a blank line.')} />
      </div>
      <div className="fd-settings-field-grid">
        <div className="fd-field">
          <label htmlFor="tm-pass">{t('restaurants.ops.training.passScoreLabel', 'Pass score (%)')}</label>
          <input id="tm-pass" type="number" min="0" max="100" value={passScorePct} onChange={(e) => setPassScorePct(e.target.value)} />
        </div>
        <div className="fd-field">
          <label htmlFor="tm-attempts">{t('restaurants.ops.training.maxAttemptsLabel')}</label>
          <input id="tm-attempts" type="number" min="1" max="20" value={maxAttempts} onChange={(e) => setMaxAttempts(e.target.value)} />
        </div>
        <div className="fd-field">
          <label htmlFor="tm-valid">{t('restaurants.ops.training.validForDaysLabel')}</label>
          <input id="tm-valid" type="number" min="1" max="3650" value={validForDays} onChange={(e) => setValidForDays(e.target.value)} placeholder="365" />
        </div>
      </div>
      {module && (
        <p className="fd-card-meta">
          {t('restaurants.ops.training.versionNote', { n: (module.current_version || 1) + 1 })}
        </p>
      )}

      <h3 className="fd-ops-subhead">{t('restaurants.ops.training.questionsTitle', 'Quiz questions')}</h3>
      {questions.map((q, i) => (
        <div key={i} className="fd-ops-form">
          <div className="fd-ops-toolbar">
            <h4 className="fd-ops-panel-title">{t('restaurants.ops.training.questionLabel', 'Question {{n}}', { n: i + 1 })}</h4>
            <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => removeQuestion(i)} aria-label={t('restaurants.ops.training.removeQuestion', 'Remove question')} data-track="ui.2265f208ce.11">
              {t('common.delete', 'Delete')}
            </button>
          </div>
          <div className="fd-field">
            <label htmlFor={`tm-q-${i}`}>{t('restaurants.ops.training.questionTextLabel', 'Question')}</label>
            <input id={`tm-q-${i}`} value={q.question} onChange={(e) => setQ(i, { question: e.target.value })} />
          </div>
          <p className="fd-card-meta">{t('restaurants.ops.training.correctHint', 'Tick the correct answer:')}</p>
          {q.options.map((opt, oi) => (
            <div key={oi} className="fd-ops-task-add">
              <label className="fd-ops-check" aria-label={t('restaurants.ops.training.correctLabel', 'Mark as correct answer')}>
                <input
                  type="radio"
                  name={`tm-correct-${i}`}
                  checked={q.correct_index === oi}
                  onChange={() => setQ(i, { correct_index: oi })} data-track="ui.2265f208ce.12"
                />
              </label>
              <input
                id={`tm-q-${i}-opt-${oi}`}
                value={opt}
                onChange={(e) => setOption(i, oi, e.target.value)}
                placeholder={t('restaurants.ops.training.optionPlaceholder', 'Option {{n}}', { n: oi + 1 })}
                aria-label={t('restaurants.ops.training.optionLabel', 'Option {{n}}', { n: oi + 1 })}
              />
              <button
                type="button"
                className="fd-btn fd-btn-secondary fd-btn-sm"
                onClick={() => removeOption(i, oi)}
                disabled={q.options.length <= 2}
                aria-label={t('restaurants.ops.training.removeOption', 'Remove option')} data-track="ui.2265f208ce.13"
              >
                ×
              </button>
            </div>
          ))}
          <div className="fd-settings-actions">
            <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => addOption(i)} data-track="ui.2265f208ce.14">
              {t('restaurants.ops.training.addOption', 'Add option')}
            </button>
          </div>
        </div>
      ))}
      <div className="fd-settings-actions">
        <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={addQuestion} data-track="ui.2265f208ce.15">
          {t('restaurants.ops.training.addQuestion', 'Add question')}
        </button>
      </div>
      <div className="fd-settings-actions">
        <button type="submit" className="fd-btn fd-btn-sm" disabled={saving || !valid} data-track="ui.2265f208ce.16">
          {t('food.common.save', 'Save')}
        </button>
        <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={onCancel} data-track="ui.2265f208ce.17">
          {t('food.common.back', 'Back')}
        </button>
      </div>
    </form>
  );
}

// ── Compliance: document vault + SOP sign-off (S-14) ─────────────────────────
const DOC_TYPE_KEYS = [
  'certificate_food_handler', 'certificate_allergen', 'certificate_manager',
  'certificate_other', 'id_document', 'policy_handbook', 'sop_document', 'other',
];

function ComplianceSection({ t, restaurantId, isManager }) {
  const [documents, setDocuments] = useState([]);
  const [sops, setSops] = useState([]);
  const [acks, setAcks] = useState([]);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [docType, setDocType] = useState('certificate_food_handler');
  const [docTitle, setDocTitle] = useState('');
  const [docUserId, setDocUserId] = useState('');
  const [docExpires, setDocExpires] = useState('');
  const [docFile, setDocFile] = useState(null);
  const [busy, setBusy] = useState(false);
  // S-14: SOP sign-off requires a drawn e-signature. signingSop is the SOP
  // awaiting a signature; signatureDataUrl is the pad's PNG output.
  const [signingSop, setSigningSop] = useState(null);
  const [signatureDataUrl, setSignatureDataUrl] = useState(null);
  const [signing, setSigning] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const fetches = [
      listStaffDocuments(restaurantId),
      listSops(restaurantId),
      listSopAcknowledgements(restaurantId),
    ];
    if (isManager) fetches.push(listRestaurantStaff(restaurantId));
    Promise.all(fetches)
      .then(([docs, sopList, ackList, staffList]) => {
        setDocuments(docs);
        setSops((sopList || []).filter((s) => s.is_published !== false));
        setAcks(ackList || []);
        setStaff(staffList || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [restaurantId, isManager]);
  useEffect(() => { load(); }, [load]);

  const upload = async (e) => {
    e.preventDefault();
    if (!docFile || !docTitle.trim()) return;
    setBusy(true);
    try {
      await uploadStaffDocument(restaurantId, {
        docType,
        title: docTitle.trim(),
        userId: isManager && docUserId ? docUserId : undefined,
        expiresOn: docExpires || undefined,
      }, docFile);
      toast.success(t('restaurants.ops.documents.uploaded'));
      setDocTitle('');
      setDocExpires('');
      setDocFile(null);
      load();
    } catch (err) {
      toast.error(apiErr(err, t('restaurants.ops.documents.uploadError')));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (doc, status) => {
    try {
      await verifyStaffDocument(restaurantId, doc.id, { verificationStatus: status });
      load();
    } catch (err) {
      toast.error(apiErr(err, t('restaurants.ops.documents.verifyError')));
    }
  };

  const removeDoc = async (doc) => {
    if (!window.confirm(t('restaurants.ops.documents.confirmDelete'))) return;
    try {
      await deleteStaffDocument(restaurantId, doc.id);
      load();
    } catch (err) {
      toast.error(apiErr(err, t('common.failedToDelete', 'Failed to delete')));
    }
  };

  // S-14: drawn e-signature required. Opens the signature modal; the
  // submit posts the drawn PNG as a multipart signature field.
  const sign = (sop) => {
    setSigningSop(sop);
    setSignatureDataUrl(null);
  };

  const submitSignature = async () => {
    if (!signingSop || !signatureDataUrl || signing) return;
    setSigning(true);
    try {
      const blob = await (await fetch(signatureDataUrl)).blob();
      await acknowledgeSop(restaurantId, signingSop.id, blob);
      toast.success(t('restaurants.ops.documents.signed'));
      setSigningSop(null);
      setSignatureDataUrl(null);
      load();
    } catch (err) {
      toast.error(apiErr(err, t('restaurants.ops.documents.signError')));
    } finally {
      setSigning(false);
    }
  };

  if (loading) return null;

  const now = Date.now();
  const expiryState = (doc) => {
    if (!doc.expires_on) return null;
    const days = Math.ceil((new Date(doc.expires_on).getTime() - now) / 86400000);
    if (days < 0) return { label: t('restaurants.ops.documents.expired', { date: fmtDate(doc.expires_on) }), warn: true };
    if (days <= 30) return { label: t('restaurants.ops.documents.expiresSoon', { date: fmtDate(doc.expires_on) }), warn: true };
    return { label: t('restaurants.ops.documents.expiresOn', { date: fmtDate(doc.expires_on) }), warn: false };
  };
  const myAckFor = (sop) => acks.find((a) => Number(a.sop_id) === Number(sop.id) && a.is_current);

  return (
    <div>
      <h3 className="fd-ops-subhead">{t('restaurants.ops.documents.title')}</h3>
      <p className="fd-card-meta">{t('restaurants.ops.documents.noTaxData')}</p>

      {documents.length === 0 ? (
        <p className="fd-card-meta">{t('restaurants.ops.documents.empty')}</p>
      ) : (
        <div className="fd-ops-run-list">
          {documents.map((doc) => {
            const expiry = expiryState(doc);
            return (
              <div key={doc.id} className="fd-ops-run-row">
                <div>
                  <strong>{doc.title}</strong>
                  <div className="fd-card-meta">
                    {isManager && `${staffName(doc)} · `}
                    {t(`restaurants.ops.documents.type.${doc.doc_type}`)}
                    {' · '}
                    <span className="fd-tag">{t(`restaurants.ops.documents.status.${doc.verification_status}`)}</span>
                    {expiry && <span className={expiry.warn ? ' fd-ops-notice--warn' : ''}>{` · ${expiry.label}`}</span>}
                  </div>
                </div>
                <div className="fd-ops-checklist-actions">
                  {doc.download_url && (
                    <a className="fd-btn fd-btn-secondary fd-btn-sm" href={doc.download_url} target="_blank" rel="noreferrer" data-track="ui.2265f208ce.31">
                      {t('restaurants.ops.documents.download')}
                    </a>
                  )}
                  {isManager && doc.verification_status !== 'verified' && (
                    <button type="button" className="fd-btn fd-btn-sm" onClick={() => verify(doc, 'verified')} data-track="ui.2265f208ce.32">
                      {t('restaurants.ops.documents.verify')}
                    </button>
                  )}
                  {isManager && doc.verification_status !== 'rejected' && (
                    <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => verify(doc, 'rejected')} data-track="ui.2265f208ce.33">
                      {t('restaurants.ops.documents.reject')}
                    </button>
                  )}
                  {isManager && (
                    <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => removeDoc(doc)} data-track="ui.2265f208ce.34">
                      {t('common.delete', 'Delete')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <form onSubmit={upload} className="fd-ops-form" data-track="ui.2265f208ce.35">
        <h4 className="fd-ops-panel-title">{t('restaurants.ops.documents.uploadTitle')}</h4>
        <div className="fd-settings-field-grid">
          <div className="fd-field">
            <label htmlFor="sd-type">{t('restaurants.ops.documents.typeLabel')}</label>
            <select id="sd-type" value={docType} onChange={(e) => setDocType(e.target.value)}>
              {DOC_TYPE_KEYS.map((k) => (
                <option key={k} value={k}>{t(`restaurants.ops.documents.type.${k}`)}</option>
              ))}
            </select>
          </div>
          <div className="fd-field">
            <label htmlFor="sd-title">{t('restaurants.ops.documents.titleLabel')}</label>
            <input id="sd-title" value={docTitle} onChange={(e) => setDocTitle(e.target.value)} placeholder={t('restaurants.ops.documents.titlePlaceholder')} />
          </div>
          {isManager && (
            <div className="fd-field">
              <label htmlFor="sd-staff">{t('restaurants.ops.documents.staffLabel')}</label>
              <select id="sd-staff" value={docUserId} onChange={(e) => setDocUserId(e.target.value)}>
                <option value="">{t('restaurants.ops.documents.staffSelf')}</option>
                {staff.map((s) => (
                  <option key={s.user_id} value={s.user_id}>
                    {[s.first_name, s.last_name].filter(Boolean).join(' ') || s.user_id} ({s.role})
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="fd-field">
            <label htmlFor="sd-expires">{t('restaurants.ops.documents.expiresLabel')}</label>
            <input id="sd-expires" type="date" value={docExpires} onChange={(e) => setDocExpires(e.target.value)} />
          </div>
          <div className="fd-field">
            <label htmlFor="sd-file">{t('restaurants.ops.documents.fileLabel')}</label>
            <input id="sd-file" type="file" onChange={(e) => setDocFile(e.target.files?.[0] || null)} />
          </div>
        </div>
        <div className="fd-settings-actions">
          <button type="submit" className="fd-btn fd-btn-sm" disabled={busy || !docFile || !docTitle.trim()} data-track="ui.2265f208ce.36">
            {t('restaurants.ops.documents.upload')}
          </button>
        </div>
      </form>

      <h3 className="fd-ops-subhead">{t('restaurants.ops.documents.sopTitle')}</h3>
      {sops.length === 0 ? (
        <p className="fd-card-meta">{t('restaurants.ops.documents.sopEmpty')}</p>
      ) : (
        <div className="fd-ops-run-list">
          {sops.map((sop) => {
            // For staff the ack list is their own; managers get every
            // sign-off, so their personal state is not derived from it.
            const signed = isManager ? null : myAckFor(sop);
            const signedCount = isManager ? acks.filter((a) => Number(a.sop_id) === Number(sop.id) && a.is_current).length : null;
            return (
              <div key={sop.id} className="fd-ops-run-row">
                <div>
                  <strong>{sop.title}</strong>
                  <div className="fd-card-meta">
                    {t('restaurants.ops.training.moduleVersion', { n: sop.version || 1 })}
                    {signed && ` · ${t('restaurants.ops.documents.signedOn', { date: fmtDate(signed.acknowledged_at) })}`}
                    {isManager && ` · ${t('restaurants.ops.documents.signatures', { count: signedCount })}`}
                  </div>
                </div>
                {!signed && (
                  <button type="button" className="fd-btn fd-btn-sm" onClick={() => sign(sop)} data-track="ui.2265f208ce.37">
                    {t('restaurants.ops.documents.signCta')}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* S-14: drawn e-signature modal for SOP sign-off. */}
      {signingSop && (
        <div className="fd-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="sop-sign-title">
          <div className="fd-modal">
            <h4 id="sop-sign-title" className="fd-ops-panel-title">
              {t('restaurants.ops.documents.signModalTitle', { title: signingSop.title })}
            </h4>
            <p className="fd-card-meta">{t('restaurants.ops.documents.signModalHint')}</p>
            <SignaturePad onChange={setSignatureDataUrl} disabled={signing} />
            <div className="fd-settings-actions">
              <button
                type="button"
                className="fd-btn fd-btn-secondary fd-btn-sm"
                onClick={() => { setSigningSop(null); setSignatureDataUrl(null); }}
                disabled={signing} data-track="ui.2265f208ce.38"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="fd-btn fd-btn-sm"
                onClick={submitSignature}
                disabled={signing || !signatureDataUrl} data-track="ui.2265f208ce.39"
              >
                {signing ? t('restaurants.ops.documents.signing') : t('restaurants.ops.documents.signAndSubmit')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Staff view ────────────────────────────────────────────────────────────────
function StaffTraining({ t, assignments, onStart }) {
  if (assignments.length === 0) {
    return (
      <EmptyState
        icon={GraduationCap}
        title={t('restaurants.ops.training.myEmpty', 'No training assigned to you yet.')}
      />
    );
  }
  return (
    <div className="fd-ops-run-list">
      {assignments.map((a) => (
        <div key={a.id} className="fd-ops-run-row">
          <div>
            <strong>{a.module_title}</strong>
            <div className="fd-card-meta">
              <span className="fd-tag">{t(`restaurants.ops.training.status.${a.status}`, a.status)}</span>
              {' '}
              {fmtDate(a.due_at)
                ? t('restaurants.ops.training.dueOn', 'Due {{date}}', { date: fmtDate(a.due_at) })
                : t('restaurants.ops.training.dueNone', 'No due date')}
              {a.score_pct != null && ` · ${a.score_pct}%`}
              {a.max_attempts != null && (a.attempts_used || 0) > 0 && ` · ${t('restaurants.ops.training.attemptsUsed', { used: a.attempts_used || 0, max: a.max_attempts })}`}
              {a.completion_expires_at && ` · ${t('restaurants.ops.training.validUntil', { date: fmtDate(a.completion_expires_at) })}`}
            </div>
          </div>
          <button
            type="button"
            className="fd-btn fd-btn-sm"
            onClick={() => onStart(a)}
            disabled={a.status === 'completed' && a.passed} data-track="ui.2265f208ce.18"
          >
            {t('restaurants.ops.training.start', 'Start')}
          </button>
        </div>
      ))}
    </div>
  );
}

function TrainingFlow({ t, restaurantId, taking, setTaking, onDone }) {
  const { assignment, module } = taking;
  const [answers, setAnswers] = useState({});
  const [busy, setBusy] = useState(false);

  const close = () => { setTaking(null); onDone(); };

  const submit = async (e) => {
    e.preventDefault();
    const questions = module?.questions || [];
    const answerArr = questions.map((_, i) => (Number.isInteger(answers[i]) ? answers[i] : -1));
    setBusy(true);
    try {
      const data = await submitTrainingQuizOffline(restaurantId, assignment.id, { answers: answerArr });
      if (data && data.queued) {
        setTaking((prev) => ({ ...prev, step: 'result', result: { queued: true } }));
      } else {
        setTaking((prev) => ({
          ...prev,
          step: 'result',
          result: {
            passed: data?.passed,
            scorePct: data?.scorePct ?? data?.completion?.score_pct,
            attemptsRemaining: data?.attemptsRemaining,
            expiresAt: data?.completion?.expires_at,
          },
        }));
      }
      onDone();
    } catch (err) {
      toast.error(apiErr(err, t('restaurants.ops.training.submitError', 'Could not submit quiz')));
    } finally {
      setBusy(false);
    }
  };

  if (taking.step === 'result') {
    const queued = taking.result?.queued;
    const passed = taking.result?.passed;
    const scorePct = taking.result?.scorePct;
    const threshold = module?.pass_score_pct ?? assignment.pass_score_pct;
    if (queued) {
      return (
        <div>
          <h3 className="fd-ops-form-title">{t('restaurants.ops.training.resultTitle', 'Quiz result')}</h3>
          <p className="fd-ops-notice" role="status" aria-live="polite">
            {t('restaurants.ops.offline.queued', 'Saved offline. Will sync when back online.')}
          </p>
          <div className="fd-settings-actions">
            <button type="button" className="fd-btn fd-btn-sm" onClick={close} data-track="ui.2265f208ce.19">
              {t('restaurants.ops.training.done', 'Done')}
            </button>
          </div>
        </div>
      );
    }
    return (
      <div>
        <h3 className="fd-ops-form-title">{t('restaurants.ops.training.resultTitle', 'Quiz result')}</h3>
<div role="status" aria-live="polite">
          <p className={`fd-ops-notice${passed ? '' : ' fd-ops-notice--warn'}`}>
            {passed
              ? t('restaurants.ops.training.resultPassed', 'You passed. Nice work.')
              : t('restaurants.ops.training.resultFailed', 'Not quite. Review the lesson and try again.')}
          </p>
          <p className="fd-card-meta">
            {t('restaurants.ops.training.yourScore', 'Your score: {{score}}%', { score: scorePct ?? 0 })}
            {' · '}
            {t('restaurants.ops.training.passNeeded', 'Pass mark: {{pct}}%', { pct: threshold ?? 0 })}
            {!passed && taking.result?.attemptsRemaining != null && ` · ${t('restaurants.ops.training.attemptsRemaining', { count: taking.result.attemptsRemaining })}`}
            {passed && taking.result?.expiresAt && ` · ${t('restaurants.ops.training.validUntil', { date: fmtDate(taking.result.expiresAt) })}`}
          </p>
        </div>
        <div className="fd-settings-actions">
          <button type="button" className="fd-btn fd-btn-sm" onClick={close} data-track="ui.2265f208ce.20">
            {t('restaurants.ops.training.done', 'Done')}
          </button>
        </div>
      </div>
    );
  }

  if (taking.step === 'quiz') {
    const questions = module?.questions || [];
    const answered = questions.filter((_, i) => Number.isInteger(answers[i])).length;
    return (
      <form onSubmit={submit} data-track="ui.2265f208ce.21">
        <div className="fd-ops-toolbar">
          <h3 className="fd-ops-panel-title">
            {t('restaurants.ops.training.quizTitle', 'Quiz')}: {module?.title || assignment.module_title}
          </h3>
          <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => setTaking((prev) => ({ ...prev, step: 'lesson' }))} data-track="ui.2265f208ce.22">
            {t('food.common.back', 'Back')}
          </button>
        </div>
        {questions.map((q, i) => (
          <div key={q.id || i} className="fd-ops-form">
            <p><strong>{`${i + 1}. ${q.question}`}</strong></p>
            <div role="radiogroup" aria-label={q.question}>
              {(q.options || []).map((opt, oi) => (
                <label key={oi} className="fd-ops-check">
                  <input
                    type="radio"
                    name={`tm-quiz-${assignment.id}-${i}`}
                    checked={answers[i] === oi}
                    onChange={() => setAnswers((a) => ({ ...a, [i]: oi }))} data-track="ui.2265f208ce.23"
                  />
                  {opt}
                </label>
              ))}
            </div>
          </div>
        ))}
        <p className="fd-card-meta">
          {t('restaurants.ops.training.answeredCount', '{{done}} of {{total}} answered', { done: answered, total: questions.length })}
        </p>
        <div className="fd-settings-actions">
          <button type="submit" className="fd-btn fd-btn-sm" disabled={busy || questions.length === 0} data-track="ui.2265f208ce.24">
            {busy
              ? t('restaurants.ops.training.submittingQuiz', 'Submitting...')
              : t('restaurants.ops.training.submitQuiz', 'Submit quiz')}
          </button>
          <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={close} data-track="ui.2265f208ce.25">
            {t('food.common.back', 'Back')}
          </button>
        </div>
      </form>
    );
  }

  // Lesson step.
  const paragraphs = (module?.content || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return (
    <div>
      <div className="fd-ops-toolbar">
        <h3 className="fd-ops-panel-title">{module?.title || assignment.module_title}</h3>
        <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={close} data-track="ui.2265f208ce.26">
          {t('food.common.back', 'Back')}
        </button>
      </div>
      {module?.description && <p className="fd-card-meta">{module.description}</p>}
      {paragraphs.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
      <div className="fd-settings-actions">
        <button type="button" className="fd-btn fd-btn-sm" onClick={() => setTaking((prev) => ({ ...prev, step: 'quiz' }))} data-track="ui.2265f208ce.27">
          {t('restaurants.ops.training.takeQuiz', 'Take quiz')}
        </button>
      </div>
    </div>
  );
}
