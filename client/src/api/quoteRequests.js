import axios from './axios';

export async function getMyQuoteRequests() {
  const response = await axios.get('/quote-requests/my');
  return response.data;
}

export async function getQuoteRequest(id) {
  const response = await axios.get(`/quote-requests/${id}`);
  return response.data;
}
