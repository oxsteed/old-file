import { useState, useCallback } from 'react';
import api from '../api/axios';

export default function usePayments() {
  const [payments, setPayments] = useState([]);
  const [connectStatus, setConnectStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchConnectStatus = useCallback(async () => {
    try {
      const { data } = await api.get('/payments/connect/status');
      setConnectStatus(data);
      return data;
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to get connect status');
    }
  }, []);

  const createConnectAccount = async () => {
    const { data } = await api.post('/payments/connect');
    if (data.url) window.location.href = data.url;
    return data;
  };

  const createPaymentIntent = async (jobId) => {
    const { data } = await api.post('/payments/intent', { job_id: jobId });
    return data;
  };

  const capturePayment = async (jobId) => {
    const { data } = await api.post('/payments/capture', { job_id: jobId });
    return data;
  };

  const refundPayment = async (paymentId, reason, amount) => {
    const { data } = await api.post('/payments/refund', { payment_id: paymentId, reason, amount });
    return data;
  };

  const getJobPayment = async (jobId) => {
    const { data } = await api.get(`/payments/job/${jobId}`);
    return data;
  };

  const fetchMyPayments = useCallback(async (role = 'payer') => {
    setLoading(true);
    try {
      const { data } = await api.get(`/payments/me?role=${role}`);
      setPayments(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to fetch payments');
    } finally {
      setLoading(false);
    }
  }, []);

  // Disputes
  const createDispute = async (disputeData) => {
    const { data } = await api.post('/disputes', disputeData);
    return data;
  };

  const getDispute = async (id) => {
    const { data } = await api.get(`/disputes/${id}`);
    return data;
  };

  const addDisputeMessage = async (disputeId, message, attachments) => {
    const { data } = await api.post(`/disputes/${disputeId}/message`, { message, attachments });
    return data;
  };

  const getMyDisputes = async () => {
    const { data } = await api.get('/disputes/me');
    return data;
  };

  return {
    payments, connectStatus, loading, error,
    fetchConnectStatus, createConnectAccount,
    createPaymentIntent, capturePayment, refundPayment,
    getJobPayment, fetchMyPayments,
    createDispute, getDispute, addDisputeMessage, getMyDisputes,
  };
}
