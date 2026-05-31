/**
 * useRecommendations.js
 *
 * Fetches personalised flywheel recommendations from /api/recommendations.
 * Caches per session (sessionStorage) to avoid redundant calls across
 * dashboard tab switches. Cache is invalidated after 5 minutes or on
 * explicit refresh.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api/axios';

const CACHE_KEY  = 'ox_recs_cache';
const CACHE_TTL  = 5 * 60 * 1000; // 5 minutes

function readCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) return null;
    return data;
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
  } catch { /* storage full — skip */ }
}

export default function useRecommendations() {
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const fetchedRef = useRef(false);

  const fetch = useCallback(async (force = false) => {
    if (!force) {
      const cached = readCache();
      if (cached) {
        setRecommendations(cached);
        return;
      }
    }

    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get('/recommendations');
      const recs = data.recommendations || [];
      setRecommendations(recs);
      writeCache(recs);
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load recommendations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    fetch();
  }, [fetch]);

  /** Call this after a user takes an action (e.g. completes a guide) */
  const refresh = useCallback(() => {
    sessionStorage.removeItem(CACHE_KEY);
    fetch(true);
  }, [fetch]);

  /** Dismiss a recommendation by id (client-side only for now) */
  const dismiss = useCallback((id) => {
    setRecommendations((prev) => {
      const updated = prev.filter((r) => r.id !== id);
      writeCache(updated);
      return updated;
    });
  }, []);

  return { recommendations, loading, error, refresh, dismiss };
}
