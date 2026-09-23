import api from './axios';

export const getNearbyPlaces = (params = {}) =>
  api.get('/geo/nearby', { params }).then((response) => ({
    places: response.data?.places || [],
    provider: response.data?.provider || 'disabled',
  }));

export const calculateRoute = (payload) =>
  api.post('/geo/route', payload).then((response) => response.data?.route || null);

export const calculateRouteMatrix = (payload) =>
  api.post('/geo/route-matrix', payload).then((response) => response.data?.matrix || null);

export const suggestLocation = (query) =>
  api.get('/geo/suggest', { params: { q: query } }).then((response) => response.data || []);
