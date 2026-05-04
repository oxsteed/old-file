import { useState, useEffect, useCallback } from 'react';
import api from '../api/axios';
import { withTokenValidation } from '../api/tokenValidator';

export default function useJobs() {
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
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get(`/jobs/${id}`);
      setJob(data);
      return data;
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to fetch job');
    } finally {
      setLoading(false);
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

  const updateJob = async (id, jobData) => {
    const { data } = await api.put(`/jobs/${id}`, jobData);
    return data;
  };

  const cancelJob = async (id, reason) => {
    return withTokenValidation(() => api.post(`/jobs/${id}/cancel`, { reason }).then(r => r.data));
  };

  const assignHelper = async (bidId, scheduledStart = null, scheduledEnd = null) => {
    const body = { bid_id: bidId };
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
    createJob, updateJob, cancelJob, assignHelper, startJob, completeJob,
    createBid, getJobBids, getMyBids, withdrawBid,
  };
}
