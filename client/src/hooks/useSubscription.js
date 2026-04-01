import { useState, useEffect, useCallback } from 'react';
import api from '../api/axios';

export default function useSubscription() {
  const [subscription, setSubscription] = useState(null);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchSubscription = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/subscription/current');
      setSubscription(data?.subscription ?? null);
    } catch (err) {
      if (err.response?.status !== 404) {
        setError(err.response?.data?.error || 'Failed to fetch subscription');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPlans = useCallback(async () => {
    try {
      const { data } = await api.get('/subscription/plans');
      setPlans(data?.plans || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to fetch plans');
    }
  }, []);

  const createCheckout = useCallback(async (planSlug) => {
    try {
      if (!planSlug) {
        setError('Please select a plan');
        return;
      }
      const { data } = await api.post('/subscription/checkout', { planSlug });
      window.location.href = data.url;
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create checkout');
    }
  }, []);

  const cancelSubscription = useCallback(async () => {
    try {
      await api.post('/subscription/cancel');
      await fetchSubscription();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to cancel subscription');
    }
  }, [fetchSubscription]);

  const openPortal = useCallback(async () => {
    try {
      const { data } = await api.post('/subscription/portal');
      window.location.href = data.url;
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to open portal');
    }
  }, []);

  useEffect(() => {
    fetchSubscription();
    fetchPlans();
  }, [fetchSubscription, fetchPlans]);

  return {
    subscription,
    plans,
    loading,
    error,
    createCheckout,
    cancelSubscription,
    openPortal,
    refresh: fetchSubscription,
  };
}
