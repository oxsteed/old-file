import axios from './axios';

const getPackages = () => axios.get('/consulting/packages');

const createPaymentIntent = (sessionId, packageId) =>
  axios.post('/consulting/payment-intent', {
    sessionId,
    packageId,
  });

const confirmPayment = (paymentId) =>
  axios.post(`/consulting/confirm-payment`, { paymentId });

const getPaymentStatus = (paymentId) =>
  axios.get(`/consulting/payment/${paymentId}/status`);

const refundPayment = (paymentId, reason) =>
  axios.post(`/consulting/refund`, { paymentId, reason });

export default {
  getPackages,
  createPaymentIntent,
  confirmPayment,
  getPaymentStatus,
  refundPayment,
};
