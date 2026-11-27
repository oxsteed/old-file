import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import './LifeGoalsPage.css';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

const EMPTY_FORM = { title: '', goal_type: 'financial', target_value: '', current_value: '', due_date: '' };

export default function LifeGoalsPage() {
  const { t } = useTranslation();
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Group 1, item 30: the web page used to be GET-only while the server
  // already had full goal CRUD. Create, edit, and delete live here now.
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    api.get('/life/goals')
      .then((r) => {
        if (!cancelled) setGoals(Array.isArray(r.data?.goals) ? r.data.goals : []);
      })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [attempt]);

  const startCreate = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setFormError('');
    setShowForm(true);
  };

  const startEdit = (g) => {
    setForm({
      title: g.title || '',
      goal_type: g.goal_type || 'financial',
      target_value: g.target_value ?? '',
      current_value: g.current_value ?? '',
      due_date: g.due_date ? String(g.due_date).slice(0, 10) : '',
    });
    setEditingId(g.id);
    setFormError('');
    setShowForm(true);
  };

  const submitForm = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) {
      setFormError(t('lifePages.goals.titleRequired'));
      return;
    }
    setSaving(true);
    setFormError('');
    const payload = {
      title: form.title.trim(),
      goal_type: form.goal_type,
      target_value: form.target_value === '' ? null : Number(form.target_value),
      current_value: form.current_value === '' ? 0 : Number(form.current_value),
      due_date: form.due_date || null,
    };
    try {
      if (editingId) {
        const { data } = await api.put(`/life/goals/${editingId}`, payload);
        setGoals((prev) => prev.map((g) => (g.id === editingId ? data : g)));
      } else {
        const { data } = await api.post('/life/goals', payload);
        setGoals((prev) => [data, ...prev]);
      }
      setShowForm(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
    } catch {
      setFormError(t('lifePages.goals.goalSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const deleteGoal = async (id) => {
    try {
      await api.delete(`/life/goals/${id}`);
      setGoals((prev) => prev.filter((g) => g.id !== id));
      setConfirmingDeleteId(null);
    } catch {
      setFormError(t('lifePages.goals.goalSaveFailed'));
    }
  };

  return (
    <div className="min-h-screen flex flex-col life-goals-page">
      <Navbar />
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-8 flex flex-col gap-6">
        <div>
          <Link to="/dashboard" className="text-sm text-orange-400 underline">{t('lifePages.backToDashboard')}</Link>
          <h1 className="text-3xl font-bold tracking-tight mt-2">{t('lifePages.goals.title')}</h1>
          <p className="text-sm mt-1 life-goals-muted">{t('lifePages.goals.subtitle')}</p>
        </div>

        <div>
          {!showForm && (
            <button type="button" onClick={startCreate} className="text-sm font-semibold text-white bg-orange-500 hover:bg-orange-600 rounded-xl px-4 py-2" data-track="ui.life.goals.create">{t('lifePages.goals.createGoal')}</button>
          )}
          {showForm && (
            <form onSubmit={submitForm} className="rounded-xl border p-5 flex flex-col gap-4 life-goals-bordered">
              <h2 className="text-base font-medium">{editingId ? t('lifePages.goals.editGoal') : t('lifePages.goals.createGoal')}</h2>
              <div>
                <label htmlFor="goal-title" className="text-sm font-medium">{t('lifePages.goals.titleLabel')}</label>
                <input
                  id="goal-title"
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm bg-transparent life-goals-bordered"
                  value={form.title}
                  maxLength={200}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder={t('lifePages.goals.goalTitlePlaceholder')}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="goal-type" className="text-sm font-medium">{t('lifePages.goals.typeLabel')}</label>
                  <select
                    id="goal-type"
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm bg-transparent life-goals-bordered"
                    value={form.goal_type}
                    onChange={(e) => setForm((f) => ({ ...f, goal_type: e.target.value }))}
                  >
                    <option value="financial">{t('lifePages.goals.goalTypeFinancial')}</option>
                    <option value="task">{t('lifePages.goals.goalTypeTask')}</option>
                    <option value="career">{t('lifePages.goals.goalTypeCareer')}</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="goal-due" className="text-sm font-medium">{t('lifePages.goals.dueLabel')}</label>
                  <input
                    id="goal-due"
                    type="date"
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm bg-transparent life-goals-bordered"
                    value={form.due_date}
                    onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
                  />
                </div>
                <div>
                  <label htmlFor="goal-target" className="text-sm font-medium">{t('lifePages.goals.targetLabel')}</label>
                  <input
                    id="goal-target"
                    type="number"
                    min="0"
                    step="any"
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm bg-transparent life-goals-bordered"
                    value={form.target_value}
                    onChange={(e) => setForm((f) => ({ ...f, target_value: e.target.value }))}
                  />
                </div>
                <div>
                  <label htmlFor="goal-current" className="text-sm font-medium">{t('lifePages.goals.currentLabel')}</label>
                  <input
                    id="goal-current"
                    type="number"
                    min="0"
                    step="any"
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm bg-transparent life-goals-bordered"
                    value={form.current_value}
                    onChange={(e) => setForm((f) => ({ ...f, current_value: e.target.value }))}
                  />
                </div>
              </div>
              {formError && <p role="alert" className="text-sm life-goals-error-text">{formError}</p>}
              <div className="flex gap-3">
                <button type="submit" disabled={saving} className="text-sm font-semibold text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-50 rounded-xl px-4 py-2" data-track="ui.life.goals.save">{saving ? t('common.saving') : t('common.save')}</button>
                <button type="button" onClick={() => { setShowForm(false); setEditingId(null); setForm(EMPTY_FORM); setFormError(''); }} className="text-sm font-medium rounded-xl px-4 py-2 border life-goals-bordered" data-track="ui.life.goals.cancel">{t('common.cancel')}</button>
              </div>
            </form>
          )}
        </div>

        {loading ? (
          <p className="text-sm life-goals-muted">{t('lifePages.loading')}</p>
        ) : failed ? (
          <div role="alert" className="rounded-xl p-4 flex items-center justify-between gap-3 life-goals-error-box">
            <span className="text-sm life-goals-error-text">{t('lifePages.loadFailed')}</span>
            <button type="button" onClick={() => setAttempt((a) => a + 1)} className="shrink-0 text-sm font-semibold text-red-300 underline">{t('common.retry')}</button>
          </div>
        ) : goals.length === 0 ? (
          <p className="text-sm life-goals-muted">{t('lifePages.goals.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {goals.map((g) => {
              const target = Number(g.target_value || 0);
              const current = Number(g.current_value || 0);
              const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
              return (
                <li key={g.id} className="rounded-xl border p-5 life-goals-bordered">
                  <div className="flex justify-between items-baseline gap-3">
                    <span className="text-base font-medium">{g.title}</span>
                    <span className="text-sm whitespace-nowrap life-goals-muted">
                      {g.is_completed ? t('lifePages.goals.completed') : `${pct}%`}
                    </span>
                  </div>
                  <div className="mt-2 h-2 rounded-full overflow-hidden life-goals-progress-track">
                    <div className="h-full life-goals-progress-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-2 text-xs life-goals-muted">
                    {t('lifePages.goals.progress', { current, target })}
                    {g.due_date ? ` · ${new Date(g.due_date).toLocaleDateString()}` : ''}
                    {g.goal_type ? ` · ${g.goal_type}` : ''}
                  </div>
                  <div className="mt-3 flex gap-4">
                    <button type="button" onClick={() => startEdit(g)} className="text-sm font-medium text-orange-400 hover:underline" data-track="ui.life.goals.edit">{t('common.edit')}</button>
                    {confirmingDeleteId === g.id ? (
                      <button type="button" onClick={() => deleteGoal(g.id)} className="text-sm font-semibold text-red-400 hover:underline" data-track="ui.life.goals.delete_confirm">{t('lifePages.goals.confirmDelete')}</button>
                    ) : (
                      <button type="button" onClick={() => setConfirmingDeleteId(g.id)} className="text-sm font-medium text-red-400 hover:underline" data-track="ui.life.goals.delete">{t('common.delete')}</button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
      <Footer />
    </div>
  );
}
