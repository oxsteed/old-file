import { useState, useCallback, useRef } from 'react';
import api from '../api/axios';
import { createMessageRequestId } from '../lib/messageRequestId';

export default function useDisputes() {
  const [disputes, setDisputes] = useState([]);
  const [dispute, setDispute] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const pendingDisputeRef = useRef(new Map());
  const pendingEvidenceRef = useRef(new Map());

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
    const payload = { ...(disputeData || {}) };
    const suppliedRequestId = payload.clientRequestId || null;
    delete payload.clientRequestId;
    const fingerprint = JSON.stringify(payload);
    const pending = pendingDisputeRef.current.get(String(jobId));
    const clientRequestId = suppliedRequestId
      || (pending?.fingerprint === fingerprint ? pending.clientRequestId : createMessageRequestId());
    pendingDisputeRef.current.set(String(jobId), { clientRequestId, fingerprint });
    try {
      const { data } = await api.post(`/disputes/jobs/${jobId}`, {
        ...payload,
        clientRequestId,
      }, {
        headers: { 'Idempotency-Key': clientRequestId },
      });
      pendingDisputeRef.current.delete(String(jobId));
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
    const safeFiles = Array.isArray(files) ? files : [];
    const fingerprint = JSON.stringify({
      description: String(description || '').trim(),
      files: safeFiles.map(file => ({ name: file?.name, size: file?.size, lastModified: file?.lastModified })),
    });
    const pending = pendingEvidenceRef.current.get(String(disputeId));
    const clientRequestId = pending?.fingerprint === fingerprint
      ? pending.clientRequestId
      : createMessageRequestId();
    pendingEvidenceRef.current.set(String(disputeId), { clientRequestId, fingerprint });
    try {
      const formData = new FormData();
      if (description) formData.append('content', description);
      safeFiles.forEach(file => formData.append('files', file));
      const { data } = await api.post(`/disputes/${disputeId}/evidence`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          'Idempotency-Key': clientRequestId,
        },
      });
      pendingEvidenceRef.current.delete(String(disputeId));
      return data;
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to submit evidence');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Send a message in a dispute thread
  const sendDisputeMessage = useCallback(async (disputeId, message, clientMessageId = null) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post(`/disputes/${disputeId}/messages`, {
        message,
        ...(clientMessageId ? { clientMessageId } : {}),
      });
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
