import { useState, useCallback } from 'react';
import api from '../api/axios';

export default function useDisputes() {
  const [disputes, setDisputes] = useState([]);
  const [dispute, setDispute] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Get all disputes for the current user
  const fetchMyDisputes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get('/disputes/my');
      setDisputes(data.disputes || data);
      return data;
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to fetch disputes');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Get a single dispute by ID
  const fetchDispute = useCallback(async (disputeId) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get(`/disputes/${disputeId}`);
      setDispute(data.dispute || data);
      return data;
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to fetch dispute');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Open a dispute on a job
  const openDispute = useCallback(async (jobId, disputeData) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post(`/disputes/jobs/${jobId}`, disputeData);
      return data;
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to open dispute');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Submit evidence for a dispute (supports file uploads)
  const submitEvidence = useCallback(async (disputeId, files, description) => {
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      if (description) formData.append('description', description);
      files.forEach(file => formData.append('files', file));
      const { data } = await api.post(`/disputes/${disputeId}/evidence`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return data;
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to submit evidence');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Send a message in a dispute thread
  const sendDisputeMessage = useCallback(async (disputeId, message) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post(`/disputes/${disputeId}/messages`, { message });
      return data;
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send message');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    disputes,
    dispute,
    loading,
    error,
    fetchMyDisputes,
    fetchDispute,
    openDispute,
    submitEvidence,
    sendDisputeMessage,
  };
}
