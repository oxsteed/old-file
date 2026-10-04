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
} from '../../api/restaurants';
import { submitTrainingQuizOffline } from '../../api/restaurantsOffline';

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
    if (!window.confirm(t('restaurants.ops.training.confirmDelete', 'Delete this training module?'))) return;
    try {
      await deleteTrainingModule(restaurantId, moduleId);
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
          <button type="button" className="fd-btn fd-btn-sm" onClick={() => setEditing('new')}>
            {t('restaurants.ops.training.newModule', 'New module')}
          </button>
        )}
      </div>

      {isManager ? (
        <ManagerTraining
          t={t}
          restaurantId={restaurantId}
          modules={modules}
          assignments={assignments}
          completions={completions}
          onEdit={setEditing}
          onDelete={remove}
          onAssigned={load}
        />
      ) : (
        <StaffTraining t={t} assignments={assignments} onStart={beginTraining} />
      )}
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
            <button type="button" className="fd-btn" onClick={() => onEdit('new')}>
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
      </p>
      {!m.is_active && (
        <p className="fd-card-meta"><span className="fd-tag">{t('restaurants.ops.training.inactive', 'Inactive')}</span></p>
      )}
      {m.description && <p className="fd-card-meta">{m.description}</p>}
      <div className="fd-ops-checklist-actions">
        <button type="button" className="fd-btn fd-btn-sm" onClick={() => onEdit(m)}>{t('common.edit', 'Edit')}</button>
        <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={toggleAssign}>
          {assignOpen ? t('food.common.back', 'Back') : t('restaurants.ops.training.assign', 'Assign')}
        </button>
        <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => onDelete(m.id)}>{t('common.delete', 'Delete')}</button>
      </div>
      {assignOpen && (
        <form onSubmit={assign} className="fd-ops-form">
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
            <button type="submit" className="fd-btn fd-btn-sm" disabled={busy || !userId}>
              {t('restaurants.ops.training.assignCta', 'Assign')}
            </button>
            <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => setAssignOpen(false)}>
              {t('food.common.back', 'Back')}
            </button>
          </div>
        </form>
      )}
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
      questions: questions.map((q) => ({
        question: q.question.trim(),
        options: q.options.map((o) => o.trim()),
        correct_index: q.correct_index,
      })),
    }, module?.id);
    setSaving(false);
  };

  return (
    <form onSubmit={submit} className="fd-ops-form">
      <div className="fd-ops-toolbar">
        <h3 className="fd-ops-form-title">
          {module ? t('restaurants.ops.training.editTitle', 'Edit module') : t('restaurants.ops.training.newTitle', 'New module')}
        </h3>
        <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={useStarter}>
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
      </div>

      <h3 className="fd-ops-subhead">{t('restaurants.ops.training.questionsTitle', 'Quiz questions')}</h3>
      {questions.map((q, i) => (
        <div key={i} className="fd-ops-form">
          <div className="fd-ops-toolbar">
            <h4 className="fd-ops-panel-title">{t('restaurants.ops.training.questionLabel', 'Question {{n}}', { n: i + 1 })}</h4>
            <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => removeQuestion(i)} aria-label={t('restaurants.ops.training.removeQuestion', 'Remove question')}>
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
                  onChange={() => setQ(i, { correct_index: oi })}
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
                aria-label={t('restaurants.ops.training.removeOption', 'Remove option')}
              >
                ×
              </button>
            </div>
          ))}
          <div className="fd-settings-actions">
            <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => addOption(i)}>
              {t('restaurants.ops.training.addOption', 'Add option')}
            </button>
          </div>
        </div>
      ))}
      <div className="fd-settings-actions">
        <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={addQuestion}>
          {t('restaurants.ops.training.addQuestion', 'Add question')}
        </button>
      </div>
      <div className="fd-settings-actions">
        <button type="submit" className="fd-btn fd-btn-sm" disabled={saving || !valid}>
          {t('food.common.save', 'Save')}
        </button>
        <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={onCancel}>
          {t('food.common.back', 'Back')}
        </button>
      </div>
    </form>
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
            </div>
          </div>
          <button
            type="button"
            className="fd-btn fd-btn-sm"
            onClick={() => onStart(a)}
            disabled={a.status === 'completed' && a.passed}
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
          result: { passed: data?.passed, scorePct: data?.scorePct ?? data?.completion?.score_pct },
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
          <p className="fd-ops-notice">
            {t('restaurants.ops.offline.queued', 'Saved offline. Will sync when back online.')}
          </p>
          <div className="fd-settings-actions">
            <button type="button" className="fd-btn fd-btn-sm" onClick={close}>
              {t('restaurants.ops.training.done', 'Done')}
            </button>
          </div>
        </div>
      );
    }
    return (
      <div>
        <h3 className="fd-ops-form-title">{t('restaurants.ops.training.resultTitle', 'Quiz result')}</h3>
        <p className={`fd-ops-notice${passed ? '' : ' fd-ops-notice--warn'}`}>
          {passed
            ? t('restaurants.ops.training.resultPassed', 'You passed. Nice work.')
            : t('restaurants.ops.training.resultFailed', 'Not quite. Review the lesson and try again.')}
        </p>
        <p className="fd-card-meta">
          {t('restaurants.ops.training.yourScore', 'Your score: {{score}}%', { score: scorePct ?? 0 })}
          {' · '}
          {t('restaurants.ops.training.passNeeded', 'Pass mark: {{pct}}%', { pct: threshold ?? 0 })}
        </p>
        <div className="fd-settings-actions">
          <button type="button" className="fd-btn fd-btn-sm" onClick={close}>
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
      <form onSubmit={submit}>
        <div className="fd-ops-toolbar">
          <h3 className="fd-ops-panel-title">
            {t('restaurants.ops.training.quizTitle', 'Quiz')}: {module?.title || assignment.module_title}
          </h3>
          <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => setTaking((prev) => ({ ...prev, step: 'lesson' }))}>
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
                    onChange={() => setAnswers((a) => ({ ...a, [i]: oi }))}
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
          <button type="submit" className="fd-btn fd-btn-sm" disabled={busy || questions.length === 0}>
            {busy
              ? t('restaurants.ops.training.submittingQuiz', 'Submitting...')
              : t('restaurants.ops.training.submitQuiz', 'Submit quiz')}
          </button>
          <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={close}>
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
        <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={close}>
          {t('food.common.back', 'Back')}
        </button>
      </div>
      {module?.description && <p className="fd-card-meta">{module.description}</p>}
      {paragraphs.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
      <div className="fd-settings-actions">
        <button type="button" className="fd-btn fd-btn-sm" onClick={() => setTaking((prev) => ({ ...prev, step: 'quiz' }))}>
          {t('restaurants.ops.training.takeQuiz', 'Take quiz')}
        </button>
      </div>
    </div>
  );
}
