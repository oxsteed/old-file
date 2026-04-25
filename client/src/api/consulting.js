import axios from './axios';

export async function submitConsultingRequest(data) {
  const response = await axios.post('/consulting/submit', data);
  return response.data;
}

export async function getAreasOfHelp() {
  const response = await axios.get('/consulting/areas');
  return response.data;
}

export async function getServiceTiers() {
  const response = await axios.get('/consulting/tiers');
  return response.data;
}

export async function getUserConsultingSessions() {
  const response = await axios.get('/consulting/my-sessions');
  return response.data;
}

export async function getConsultingSession(id) {
  const response = await axios.get(`/consulting/${id}`);
  return response.data;
}
