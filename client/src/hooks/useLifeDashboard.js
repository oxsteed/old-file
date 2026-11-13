import { useState, useCallback, useRef } from 'react';
import api from '../api/axios';
import { getLifeSnapshot, invalidateLifeSnapshots } from '../api/lifeSnapshot';
import { useAuth } from './useAuth';

export default function useLifeDashboard() {
  const { user } = useAuth();
  // Cost audit 2026-11-13 item 3: life GETs are coalesced through the
  // shared lifeSnapshot cache (5s window, like getAccountSnapshot), so a
  // Dashboard mount plus a rapid re-mount or Dashboard -> LifeDashboard
  // hop pays once per endpoint. The ref keeps the fetch callbacks stable
  // (callers list them in effect deps) while the cache key always carries
  // the currently signed-in user. Mutations invalidate the cache so the
  // refetch after a write reads fresh data.
  const userIdRef = useRef(user?.id);
  userIdRef.current = user?.id;
  const invalidate = useCallback(() => invalidateLifeSnapshots(userIdRef.current), []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // ── Dashboard summary (one call to load top-level stats) ────────────
  const [summary, setSummary] = useState(null);

  const fetchSummary = useCallback(async () => {
    try {
      const { data } = await getLifeSnapshot(userIdRef.current, '/life/summary');
      setSummary(data);
      return data;
    } catch (err) {
      console.error('fetchSummary error:', err);
    }
  }, []);

  // ── Unified Life Pulse engine ─────────────────────────────────────────
  // window: '1w'|'2w'|'1m'|'3m'|'6m'|'1y'|'5y'|'10y'
  const [financialPulse, setFinancialPulse] = useState(null);

  const fetchFinancialPulse = useCallback(async (window = '1m') => {
    try {
      const { data } = await getLifeSnapshot(userIdRef.current, `/life/pulse?window=${window}`);
      setFinancialPulse(data ?? null);
      return data ?? {};
    } catch (err) {
      console.error('fetchFinancialPulse error:', err);
      setFinancialPulse(null);
      return null;
    }
  }, []);

  // Pulse score settings - what sources are active
  const [pulseSettings, setPulseSettings] = useState(null);

  const fetchPulseSettings = useCallback(async () => {
    try {
      const { data } = await getLifeSnapshot(userIdRef.current, '/life/pulse/settings');
      setPulseSettings(data);
      return data;
    } catch (err) {
      console.error('fetchPulseSettings error:', err);
    }
  }, []);

  const savePulseSettings = useCallback(async (updates) => {
    try {
      const { data } = await api.put('/life/pulse/settings', updates);
      setPulseSettings(data);
      invalidate();
      return data;
    } catch (err) {
      console.error('savePulseSettings error:', err);
    }
  }, [invalidate]);

  // ── Community stats ─────────────────────────────────────────────────
  const [community, setCommunity] = useState(null);

  const fetchCommunity = useCallback(async (zip, view) => {
    try {
      const params = new URLSearchParams();
      if (zip) params.set('zip', zip);
      if (view) params.set('view', view);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const { data } = await getLifeSnapshot(userIdRef.current, `/life/community${qs}`);
      setCommunity(data);
      return data;
    } catch (err) {
      console.error('fetchCommunity error:', err);
    }
  }, []);

  // ── Expenses ────────────────────────────────────────────────────────
  const [expenses, setExpenses] = useState([]);
  const [expenseSummary, setExpenseSummary] = useState(null);

  const fetchExpenses = useCallback(async (params = {}) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams(params).toString();
      const { data } = await getLifeSnapshot(userIdRef.current, `/life/expenses?${qs}`);
      setExpenses(data?.expenses ?? []);
      setExpenseSummary(data?.summary ?? null);
      return data;
    } catch (err) {
      setExpenses([]);
      setError(err?.response?.data?.error || 'Failed to fetch expenses');
    } finally {
      setLoading(false);
    }
  }, []);

  const createExpense = useCallback(async (expenseData) => {
    const { data } = await api.post('/life/expenses', expenseData);
    setExpenses(prev => [data, ...prev]);
    invalidate();
    return data;
  }, [invalidate]);

  const updateExpense = useCallback(async (id, updates) => {
    const { data } = await api.put(`/life/expenses/${id}`, updates);
    setExpenses(prev => prev.map(e => e.id === id ? data : e));
    invalidate();
    return data;
  }, [invalidate]);

  const deleteExpense = useCallback(async (id) => {
    await api.delete(`/life/expenses/${id}`);
    setExpenses(prev => prev.filter(e => e.id !== id));
    invalidate();
  }, [invalidate]);

  const fetchExpenseBreakdown = useCallback(async (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    const { data } = await getLifeSnapshot(userIdRef.current, `/life/expenses/summary?${qs}`);
    return data;
  }, []);

  // ── Budgets ─────────────────────────────────────────────────────────
  const [budgets, setBudgets] = useState([]);

  const fetchBudgets = useCallback(async (params = {}) => {
    try {
      const qs = new URLSearchParams(params).toString();
      const { data } = await getLifeSnapshot(userIdRef.current, `/life/budgets?${qs}`);
      setBudgets(data.budgets || []);
      return data;
    } catch (err) {
      console.error('fetchBudgets error:', err);
    }
  }, []);

  const upsertBudget = useCallback(async (budgetData) => {
    const { data } = await api.post('/life/budgets', budgetData);
    setBudgets(prev => {
      const idx = prev.findIndex(b => b.category === data.category);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], ...data };
        return updated;
      }
      return [...prev, data];
    });
    invalidate();
    return data;
  }, [invalidate]);

  const deleteBudget = useCallback(async (id) => {
    await api.delete(`/life/budgets/${id}`);
    setBudgets(prev => prev.filter(b => b.id !== id));
    invalidate();
  }, [invalidate]);

  // ── Goals ───────────────────────────────────────────────────────────
  const [goals, setGoals] = useState([]);

  const fetchGoals = useCallback(async (params = {}) => {
    try {
      const qs = new URLSearchParams(params).toString();
      const { data } = await getLifeSnapshot(userIdRef.current, `/life/goals?${qs}`);
      setGoals(data.goals || []);
      return data;
    } catch (err) {
      console.error('fetchGoals error:', err);
    }
  }, []);

  const createGoal = useCallback(async (goalData) => {
    const { data } = await api.post('/life/goals', goalData);
    setGoals(prev => [data, ...prev]);
    invalidate();
    return data;
  }, [invalidate]);

  const updateGoal = useCallback(async (id, updates) => {
    const { data } = await api.put(`/life/goals/${id}`, updates);
    setGoals(prev => prev.map(g => g.id === id ? data : g));
    invalidate();
    return data;
  }, [invalidate]);

  const deleteGoal = useCallback(async (id) => {
    await api.delete(`/life/goals/${id}`);
    setGoals(prev => prev.filter(g => g.id !== id));
    invalidate();
  }, [invalidate]);

  // ── Saved Helpers ───────────────────────────────────────────────────
  const [savedHelpers, setSavedHelpers] = useState([]);

  const fetchSavedHelpers = useCallback(async () => {
    try {
      const { data } = await getLifeSnapshot(userIdRef.current, '/life/saved-helpers');
      setSavedHelpers(data.saved_helpers || []);
      return data;
    } catch (err) {
      console.error('fetchSavedHelpers error:', err);
    }
  }, []);

  const saveHelper = useCallback(async (helperData) => {
    const { data } = await api.post('/life/saved-helpers', helperData);
    setSavedHelpers(prev => [data, ...prev]);
    invalidate();
    return data;
  }, [invalidate]);

  const removeSavedHelper = useCallback(async (id) => {
    await api.delete(`/life/saved-helpers/${id}`);
    setSavedHelpers(prev => prev.filter(h => h.id !== id));
    invalidate();
  }, [invalidate]);

  // ── Home Tasks ──────────────────────────────────────────────────────
  const [homeTasks, setHomeTasks] = useState([]);

  const fetchHomeTasks = useCallback(async (params = {}) => {
    try {
      const qs = new URLSearchParams(params).toString();
      const { data } = await getLifeSnapshot(userIdRef.current, `/life/home-tasks?${qs}`);
      setHomeTasks(data.home_tasks || []);
      return data;
    } catch (err) {
      console.error('fetchHomeTasks error:', err);
    }
  }, []);

  const createHomeTask = useCallback(async (taskData) => {
    const { data } = await api.post('/life/home-tasks', taskData);
    setHomeTasks(prev => [data, ...prev]);
    invalidate();
    return data;
  }, [invalidate]);

  const updateHomeTask = useCallback(async (id, updates) => {
    const { data } = await api.put(`/life/home-tasks/${id}`, updates);
    setHomeTasks(prev => prev.map(t => t.id === id ? data : t));
    invalidate();
    return data;
  }, [invalidate]);

  const deleteHomeTask = useCallback(async (id) => {
    await api.delete(`/life/home-tasks/${id}`);
    setHomeTasks(prev => prev.filter(t => t.id !== id));
    invalidate();
  }, [invalidate]);

  // ── Checklist ───────────────────────────────────────────────────────
  const [checklist, setChecklist] = useState([]);

  const fetchChecklist = useCallback(async () => {
    try {
      const { data } = await getLifeSnapshot(userIdRef.current, '/life/checklist');
      setChecklist(data.items || []);
      return data;
    } catch (err) {
      console.error('fetchChecklist error:', err);
    }
  }, []);

  const createChecklistItem = useCallback(async (itemData) => {
    const { data } = await api.post('/life/checklist', itemData);
    setChecklist(prev => [data, ...prev]);
    invalidate();
    return data;
  }, [invalidate]);

  const updateChecklistItem = useCallback(async (id, updates) => {
    const { data } = await api.put(`/life/checklist/${id}`, updates);
    setChecklist(prev => prev.map(i => i.id === id ? data : i));
    invalidate();
    return data;
  }, [invalidate]);

  const deleteChecklistItem = useCallback(async (id) => {
    await api.delete(`/life/checklist/${id}`);
    setChecklist(prev => prev.filter(i => i.id !== id));
    invalidate();
  }, [invalidate]);

  return {
    loading, error,

    // Summary
    summary, fetchSummary,

    // Financial Pulse (unified engine)
    financialPulse, fetchFinancialPulse,
    pulseSettings, fetchPulseSettings, savePulseSettings,

    // Community
    community, fetchCommunity,

    // Expenses
    expenses, expenseSummary, fetchExpenses, createExpense, updateExpense, deleteExpense, fetchExpenseBreakdown,

    // Budgets
    budgets, fetchBudgets, upsertBudget, deleteBudget,

    // Goals
    goals, fetchGoals, createGoal, updateGoal, deleteGoal,

    // Saved Helpers
    savedHelpers, fetchSavedHelpers, saveHelper, removeSavedHelper,

    // Home Tasks
    homeTasks, fetchHomeTasks, createHomeTask, updateHomeTask, deleteHomeTask,

    // Checklist
    checklist, fetchChecklist, createChecklistItem, updateChecklistItem, deleteChecklistItem,
  };
}
