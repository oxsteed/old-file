import { useState, useEffect, useCallback } from 'react';
import api from '../api/axios';

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
      setJobs(data.jobs);
      setPagination({ total: data.total, page: data.page, limit: data.limit });
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
    const isFormData = jobData instanceof FormData;
    const { data } = await api.post('/jobs', jobData, isFormData ? {
      headers: { 'Content-Type': 'multipart/form-data' }
    } : {});
    return data;
  };

  const updateJob = async (id, jobData) => {
    const { data } = await api.put(`/jobs/${id}`, jobData);
    return data;
  };

  const cancelJob = async (id, reason) => {
    const { data } = await api.post(`/jobs/${id}/cancel`, { reason });
    return data;
  };

  const assignHelper = async (bidId) => {
    const { data } = await api.post('/jobs/assign', { bid_id: bidId });
    return data;
  };

  const startJob = async (id) => {
    const { data } = await api.post(`/jobs/${id}/start`);
    return data;
  };

  const completeJob = async (id) => {
    const { data } = await api.post(`/jobs/${id}/complete`);
    return data;
  };

  // Bids
  const createBid = async (bidData) => {
    const { data } = await api.post('/bids', bidData);
    return data;
  };

  const getJobBids = async (jobId) => {
    const { data } = await api.get(`/bids/job/${jobId}`);
    return data;
  };

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
