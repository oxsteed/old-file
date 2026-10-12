import axios from './axios';

const getPackages = () => axios.get('/consulting/packages');

const createPaymentIntent = (sessionId, packageId) =>
  axios.post('/consulting/payment-intent', {
    sessionId,
    packageId,
  });

// Review P3-1067: the server resolves the PaymentIntent from the payment id;
// the intent id is sent when known so a mismatch is rejected.
const confirmPayment = (paymentId, stripePaymentIntentId) =>
  axios.post(`/consulting/confirm-payment`, {
    paymentId,
    ...(stripePaymentIntentId ? { stripePaymentIntentId } : {}),
  });

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
