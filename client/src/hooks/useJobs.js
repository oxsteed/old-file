import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api/axios';
import { withTokenValidation } from '../api/tokenValidator';

export default function useJobs() {
  const jobRequest = useRef(0);
  const jobController = useRef(null);
  useEffect(() => () => { jobRequest.current += 1; jobController.current?.abort(); }, []);
  const [jobs, setJobs] = useState([]);
  const [job, setJob] = useState(null);
  const [myJobs, setMyJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 20 });

  const fetchJobs = useCallback(async (filters = {}) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams(filters).toString();
      const { data } = await api.get(`/jobs?${params}`);
      setJobs(data.jobs || []);
      setPagination({ total: data.total ?? 0, page: data.page ?? 1, limit: data.limit ?? 20 });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to fetch jobs');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchJob = useCallback(async (id) => {
    const sequence = ++jobRequest.current;
    jobController.current?.abort();
    const controller = new AbortController();
    jobController.current = controller;
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get(`/jobs/${id}`, { signal: controller.signal });
      if (sequence !== jobRequest.current) return;
      setJob(data);
      return data;
    } catch (err) {
      if (sequence === jobRequest.current && !controller.signal.aborted) {
        setError(err.response?.data?.error || 'Failed to fetch job');
      }
    } finally {
      if (sequence === jobRequest.current) setLoading(false);
    }
  }, []);

  const fetchMyJobs = useCallback(async (role = 'poster', status) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ role });
      if (status) params.append('status', status);
      const { data } = await api.get(`/jobs/me/list?${params}`);
      setMyJobs(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to fetch jobs');
    } finally {
      setLoading(false);
    }
  }, []);

  const createJob = async (jobData) => {
    return withTokenValidation(async () => {
      const { data } = await api.post('/jobs', jobData);
      return data;
    });
  };

  // JSON merge-patch with optimistic concurrency: the server rejects the edit
  // (409/412) if the job changed since `version` was loaded. Pass an
  // idempotencyKey to make retries of the same submit safe.
  const updateJob = async (id, patch, { version, etag, idempotencyKey } = {}) => {
    const headers = {};
    if (etag) headers['If-Match'] = etag;
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const body = { ...patch };
    if (!etag && version !== undefined && version !== null) body.expected_version = version;
    const response = await withTokenValidation(() => api.patch(`/jobs/${id}`, body, { headers }));
    const data = response.data;
    if (data?.job && String(data.job.id) === String(job?.id)) setJob((current) => ({ ...current, ...data.job }));
    return { ...data, etag: response.headers?.etag || null };
  };

  const getJobRevisions = useCallback(async (jobId, { before } = {}) => {
    const params = before ? `?before=${encodeURIComponent(before)}` : '';
    const { data } = await api.get(`/jobs/${jobId}/revisions${params}`);
    return data;
  }, []);

  const reconfirmBid = async (bidId, body = {}) => {
    return withTokenValidation(() => api.post(`/bids/${bidId}/reconfirm`, body).then(r => r.data));
  };

  const cancelJob = async (id, reason) => {
    return withTokenValidation(() => api.post(`/jobs/${id}/cancel`, { reason }).then(r => r.data));
  };

  const assignHelper = async (bidId, paymentMethod, scheduledStart = null, scheduledEnd = null, expectedJobVersion = null) => {
    // paymentMethod is the legacy string, or the rail-engine selection object
    // ({ payment_rail, offline_ack, fx_quote_id, credit_quote_id, payment_method }).
    const selection = paymentMethod && typeof paymentMethod === 'object' ? paymentMethod : { payment_method: paymentMethod };
    const body = { bid_id: bidId, ...selection };
    if (expectedJobVersion !== null && expectedJobVersion !== undefined) body.expected_job_version = expectedJobVersion;
    if (scheduledStart) body.scheduled_start = scheduledStart;
    if (scheduledEnd)   body.scheduled_end   = scheduledEnd;
    return withTokenValidation(() => api.post('/jobs/assign', body).then(r => r.data));
  };

  const startJob = async (id) => {
    return withTokenValidation(() => api.post(`/jobs/${id}/start`).then(r => r.data));
  };

  const completeJob = async (id) => {
    return withTokenValidation(() => api.post(`/jobs/${id}/complete`).then(r => r.data));
  };

  // Bids
  const createBid = async (bidData) => {
    const { data } = await api.post('/bids', bidData);
    return data;
  };

  const getJobBids = useCallback(async (jobId) => {
    const { data } = await api.get(`/bids/job/${jobId}`);
    return data;
  }, []);

  const getMyBids = async (status) => {
    const params = status ? `?status=${status}` : '';
    const { data } = await api.get(`/bids/me${params}`);
    return data;
  };

  const withdrawBid = async (bidId) => {
    const { data } = await api.post(`/bids/${bidId}/withdraw`);
    return data;
  };

  return {
    jobs, job, myJobs, loading, error, pagination,
    fetchJobs, fetchJob, fetchMyJobs,
    createJob, updateJob, getJobRevisions, cancelJob, assignHelper, startJob, completeJob,
    createBid, getJobBids, getMyBids, withdrawBid, reconfirmBid,
  };
}
