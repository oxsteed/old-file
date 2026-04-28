import { useState, useCallback } from 'react';
import api from '../api/axios';

export default function useBids() {
  const [bids, setBids] = useState([]);
  const [myBids, setMyBids] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Get all bids for a specific job (visible to job poster)
  const fetchJobBids = useCallback(async (jobId) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get(`/bids/job/${jobId}`);
      setBids(data.bids || data);
      return data;
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to fetch bids');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Get the current user's own bids
  const fetchMyBids = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get('/bids/me');
      setMyBids(data.bids || data);
      return data;
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to fetch your bids');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Submit a new bid on a job
  const createBid = useCallback(async (bidData) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post('/bids/', bidData);
      return data;
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to submit bid');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Update an existing bid
  const updateBid = useCallback(async (bidId, bidData) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.put(`/bids/${bidId}`, bidData);
      return data;
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update bid');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Withdraw a bid
  const withdrawBid = useCallback(async (bidId) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post(`/bids/${bidId}/withdraw`);
      setMyBids(prev => prev.filter(b => b.id !== bidId));
      return data;
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to withdraw bid');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    bids,
    myBids,
    loading,
    error,
    fetchJobBids,
    fetchMyBids,
    createBid,
    updateBid,
    withdrawBid,
  };
}
