import axios from './axios';

export async function submitQuoteRequest(data) {
  const response = await axios.post('/quote-requests', data);
  return response.data;
}

export async function getMyQuoteRequests() {
  const response = await axios.get('/quote-requests/my');
  return response.data;
}

export async function getQuoteRequest(id) {
  const response = await axios.get(`/quote-requests/${id}`);
  return response.data;
}
