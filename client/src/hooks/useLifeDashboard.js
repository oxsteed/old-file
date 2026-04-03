import { useState, useCallback } from 'react';
import api from '../api/axios';

export default function useLifeDashboard() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // ── Dashboard summary (one call to load top-level stats) ────────────
  const [summary, setSummary] = useState(null);

  const fetchSummary = useCallback(async () => {
    try {
      const { data } = await api.get('/life/summary');
      setSummary(data);
      return data;
    } catch (err) {
      console.error('fetchSummary error:', err);
    }
  }, []);

  // ── Expenses ────────────────────────────────────────────────────────
  const [expenses, setExpenses] = useState([]);
  const [expenseSummary, setExpenseSummary] = useState(null);

  const fetchExpenses = useCallback(async (params = {}) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams(params).toString();
      const { data } = await api.get(`/life/expenses?${qs}`);
      setExpenses(data.expenses || []);
      setExpenseSummary(data.summary || null);
      return data;
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to fetch expenses');
    } finally {
      setLoading(false);
    }
  }, []);

  const createExpense = useCallback(async (expenseData) => {
    const { data } = await api.post('/life/expenses', expenseData);
    setExpenses(prev => [data, ...prev]);
    return data;
  }, []);

  const updateExpense = useCallback(async (id, updates) => {
    const { data } = await api.put(`/life/expenses/${id}`, updates);
    setExpenses(prev => prev.map(e => e.id === id ? data : e));
    return data;
  }, []);

  const deleteExpense = useCallback(async (id) => {
    await api.delete(`/life/expenses/${id}`);
    setExpenses(prev => prev.filter(e => e.id !== id));
  }, []);

  const fetchExpenseBreakdown = useCallback(async (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    const { data } = await api.get(`/life/expenses/summary?${qs}`);
    return data;
  }, []);

  // ── Budgets ─────────────────────────────────────────────────────────
  const [budgets, setBudgets] = useState([]);

  const fetchBudgets = useCallback(async (params = {}) => {
    try {
      const qs = new URLSearchParams(params).toString();
      const { data } = await api.get(`/life/budgets?${qs}`);
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
    return data;
  }, []);

  const deleteBudget = useCallback(async (id) => {
    await api.delete(`/life/budgets/${id}`);
    setBudgets(prev => prev.filter(b => b.id !== id));
  }, []);

  // ── Goals ───────────────────────────────────────────────────────────
  const [goals, setGoals] = useState([]);

  const fetchGoals = useCallback(async (params = {}) => {
    try {
      const qs = new URLSearchParams(params).toString();
      const { data } = await api.get(`/life/goals?${qs}`);
      setGoals(data.goals || []);
      return data;
    } catch (err) {
      console.error('fetchGoals error:', err);
    }
  }, []);

  const createGoal = useCallback(async (goalData) => {
    const { data } = await api.post('/life/goals', goalData);
    setGoals(prev => [data, ...prev]);
    return data;
  }, []);

  const updateGoal = useCallback(async (id, updates) => {
    const { data } = await api.put(`/life/goals/${id}`, updates);
    setGoals(prev => prev.map(g => g.id === id ? data : g));
    return data;
  }, []);

  const deleteGoal = useCallback(async (id) => {
    await api.delete(`/life/goals/${id}`);
    setGoals(prev => prev.filter(g => g.id !== id));
  }, []);

  // ── Saved Helpers ───────────────────────────────────────────────────
  const [savedHelpers, setSavedHelpers] = useState([]);

  const fetchSavedHelpers = useCallback(async () => {
    try {
      const { data } = await api.get('/life/saved-helpers');
      setSavedHelpers(data.saved_helpers || []);
      return data;
    } catch (err) {
      console.error('fetchSavedHelpers error:', err);
    }
  }, []);

  const saveHelper = useCallback(async (helperData) => {
    const { data } = await api.post('/life/saved-helpers', helperData);
    setSavedHelpers(prev => [data, ...prev]);
    return data;
  }, []);

  const removeSavedHelper = useCallback(async (id) => {
    await api.delete(`/life/saved-helpers/${id}`);
    setSavedHelpers(prev => prev.filter(h => h.id !== id));
  }, []);

  // ── Home Tasks ──────────────────────────────────────────────────────
  const [homeTasks, setHomeTasks] = useState([]);

  const fetchHomeTasks = useCallback(async (params = {}) => {
    try {
      const qs = new URLSearchParams(params).toString();
      const { data } = await api.get(`/life/home-tasks?${qs}`);
      setHomeTasks(data.home_tasks || []);
      return data;
    } catch (err) {
      console.error('fetchHomeTasks error:', err);
    }
  }, []);

  const createHomeTask = useCallback(async (taskData) => {
    const { data } = await api.post('/life/home-tasks', taskData);
    setHomeTasks(prev => [data, ...prev]);
    return data;
  }, []);

  const updateHomeTask = useCallback(async (id, updates) => {
    const { data } = await api.put(`/life/home-tasks/${id}`, updates);
    setHomeTasks(prev => prev.map(t => t.id === id ? data : t));
    return data;
  }, []);

  const deleteHomeTask = useCallback(async (id) => {
    await api.delete(`/life/home-tasks/${id}`);
    setHomeTasks(prev => prev.filter(t => t.id !== id));
  }, []);

  // ── Checklist ───────────────────────────────────────────────────────
  const [checklist, setChecklist] = useState([]);

  const fetchChecklist = useCallback(async () => {
    try {
      const { data } = await api.get('/life/checklist');
      setChecklist(data.items || []);
      return data;
    } catch (err) {
      console.error('fetchChecklist error:', err);
    }
  }, []);

  const createChecklistItem = useCallback(async (itemData) => {
    const { data } = await api.post('/life/checklist', itemData);
    setChecklist(prev => [data, ...prev]);
    return data;
  }, []);

  const updateChecklistItem = useCallback(async (id, updates) => {
    const { data } = await api.put(`/life/checklist/${id}`, updates);
    setChecklist(prev => prev.map(i => i.id === id ? data : i));
    return data;
  }, []);

  const deleteChecklistItem = useCallback(async (id) => {
    await api.delete(`/life/checklist/${id}`);
    setChecklist(prev => prev.filter(i => i.id !== id));
  }, []);

  return {
    loading, error,

    // Summary
    summary, fetchSummary,

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
