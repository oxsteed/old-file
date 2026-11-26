import api from './axios';

export async function createBookingRequest(payload) {
  const { data } = await api.post('/bookings', payload);
  return data?.data ?? data;
}

export async function getPublicBookingStatus(token) {
  const { data } = await api.get(`/bookings/status/${encodeURIComponent(token)}`);
  return data?.data ?? data;
}

// G-6: recipient accept/decline via their invite token (public link).
export async function respondToRecipientInvite(token, decision) {
  const { data } = await api.post(`/bookings/status/${encodeURIComponent(token)}/respond`, { decision });
  return data?.data ?? data;
}

// G-6: account-linked recipient accept/decline.
export async function respondAsRecipient(bookingId, decision) {
  const { data } = await api.post(`/bookings/${bookingId}/recipient/respond`, { decision });
  return data?.data ?? data;
}

// G-6/G-7: booker revokes the invite/status links before acceptance.
export async function revokeBookingStatusLink(bookingId) {
  const { data } = await api.post(`/bookings/${bookingId}/status-link/revoke`);
  return data?.data ?? data;
}

export async function getBookingRequest(bookingId) {
  const { data } = await api.get(`/bookings/${bookingId}`);
  return data;
}

export async function cancelBookingRequest(bookingId) {
  const { data } = await api.post(`/bookings/${bookingId}/cancel`);
  return data;
}

// G-37: hand an accepted booking to another eligible provider. The
// booking, its deposit, and its appointment are preserved.
export async function transferBookingRequest(bookingId, { newHelperId, reason } = {}) {
  const { data } = await api.post(`/bookings/${bookingId}/transfer`, {
    newHelperId,
    ...(reason ? { reason } : {}),
  });
  return data?.data ?? data;
}

export async function fetchBookingPrefillForJob(bookingId) {
  const { data } = await api.post(`/bookings/${bookingId}/convert-to-job`);
  return data?.data ?? data;
}

// ─── Group 3: recipient / sponsor participant surfaces ────────────────────
// Account endpoints (booker, recipient, site contact, sponsor by role).
export async function getBookingParticipantSummary(bookingId) {
  const { data } = await api.get(`/bookings/${bookingId}/participant-summary`);
  return data?.data ?? data;
}

export async function getBookingSharingPreview(bookingId) {
  const { data } = await api.get(`/bookings/${bookingId}/sharing-preview`);
  return data?.data ?? data;
}

export async function getBookingChecklist(bookingId) {
  const { data } = await api.get(`/bookings/${bookingId}/checklist`);
  return data?.data ?? data;
}

export async function listBookingSiteActions(bookingId) {
  const { data } = await api.get(`/bookings/${bookingId}/site-actions`);
  return data?.data ?? data;
}

export async function recordBookingSiteAction(bookingId, payload) {
  const { data } = await api.post(`/bookings/${bookingId}/site-actions`, payload);
  return data?.data ?? data;
}

export async function markBookingProviderArrived(bookingId) {
  const { data } = await api.post(`/bookings/${bookingId}/arrive`);
  return data?.data ?? data;
}

export async function setBookingCareInstructions(bookingId, careInstructions) {
  const { data } = await api.post(`/bookings/${bookingId}/care-instructions`, { careInstructions });
  return data?.data ?? data;
}

export async function getBookingReceipt(bookingId) {
  const { data } = await api.get(`/bookings/${bookingId}/receipt`);
  return data?.data ?? data;
}

export async function shareBookingReceipt(bookingId) {
  const { data } = await api.post(`/bookings/${bookingId}/receipt/share`);
  return data?.data ?? data;
}

export async function replaceBookingContact(bookingId, payload) {
  const { data } = await api.post(`/bookings/${bookingId}/contacts/replace`, payload);
  return data?.data ?? data;
}

export async function removeBookingGuestAccess(bookingId, payload) {
  const { data } = await api.post(`/bookings/${bookingId}/guest-access/remove`, payload);
  return data?.data ?? data;
}

export async function requestBookingLinkRenewal(bookingId, payload) {
  const { data } = await api.post(`/bookings/${bookingId}/link-renewal/request`, payload);
  return data?.data ?? data;
}

export async function renewBookingStatusLink(bookingId, payload) {
  const { data } = await api.post(`/bookings/${bookingId}/status-link/renew`, payload);
  return data?.data ?? data;
}

export async function deliverBookingLinkAlternate(bookingId, payload) {
  const { data } = await api.post(`/bookings/${bookingId}/link-delivery`, payload);
  return data?.data ?? data;
}

export async function registerBookingUpdateEmail(bookingId, email) {
  const { data } = await api.post(`/bookings/${bookingId}/update-email`, { email });
  return data?.data ?? data;
}

export async function removeBookingUpdateEmail(bookingId, email) {
  const { data } = await api.post(`/bookings/${bookingId}/update-email/remove`, { email });
  return data?.data ?? data;
}

export async function optOutBookingNotifications(bookingId, payload) {
  const { data } = await api.post(`/bookings/${bookingId}/notifications/opt-out`, payload);
  return data?.data ?? data;
}

export async function optInBookingNotifications(bookingId, payload) {
  const { data } = await api.post(`/bookings/${bookingId}/notifications/opt-in`, payload);
  return data?.data ?? data;
}

export async function archiveBookingVisit(bookingId) {
  const { data } = await api.post(`/bookings/${bookingId}/archive-visit`);
  return data?.data ?? data;
}

export async function unarchiveBookingVisit(bookingId) {
  const { data } = await api.post(`/bookings/${bookingId}/archive-visit/remove`);
  return data?.data ?? data;
}

export async function correctBookingContact(bookingId, payload) {
  const { data } = await api.post(`/bookings/${bookingId}/contact-correction`, payload);
  return data?.data ?? data;
}

export async function sendBookingRelayMessage(bookingId, payload) {
  const { data } = await api.post(`/bookings/${bookingId}/relay-message`, payload);
  return data?.data ?? data;
}

export async function submitBookingSupport(bookingId, payload) {
  const { data } = await api.post(`/bookings/${bookingId}/support`, payload);
  return data?.data ?? data;
}

export async function listBookingSupport(bookingId) {
  const { data } = await api.get(`/bookings/${bookingId}/support`);
  return data?.data ?? data;
}

export async function listBookingCallbacks(bookingId) {
  const { data } = await api.get(`/bookings/${bookingId}/callbacks`);
  return data?.data ?? data;
}

export async function submitBookingFeedback(bookingId, payload) {
  const { data } = await api.post(`/bookings/${bookingId}/feedback`, payload);
  return data?.data ?? data;
}

export async function listBookingFeedback(bookingId) {
  const { data } = await api.get(`/bookings/${bookingId}/feedback`);
  return data?.data ?? data;
}

export async function uploadBookingSitePhoto(bookingId, file) {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post(`/bookings/${bookingId}/photos`, form);
  return data?.data ?? data;
}

export async function listBookingSitePhotos(bookingId) {
  const { data } = await api.get(`/bookings/${bookingId}/photos`);
  return data?.data ?? data;
}

export async function getBookingPaymentBreakdown(bookingId) {
  const { data } = await api.get(`/bookings/${bookingId}/payment-breakdown`);
  return data?.data ?? data;
}

export async function createBookingSponsorship(bookingId, payload) {
  const { data } = await api.post(`/bookings/${bookingId}/sponsorships`, payload);
  return data?.data ?? data;
}

export async function listBookingSponsorships(bookingId) {
  const { data } = await api.get(`/bookings/${bookingId}/sponsorships`);
  return data?.data ?? data;
}

export async function respondBookingSponsorship(bookingId, sponsorshipId, decision) {
  const { data } = await api.post(`/bookings/${bookingId}/sponsorships/${sponsorshipId}/respond`, { decision });
  return data?.data ?? data;
}

export async function createSponsorPaymentIntent(bookingId, sponsorshipId) {
  const { data } = await api.post(`/bookings/${bookingId}/sponsorships/${sponsorshipId}/payment-intent`);
  return data?.data ?? data;
}

export async function confirmSponsorPayment(bookingId, sponsorshipId, paymentIntentId) {
  const { data } = await api.post(`/bookings/${bookingId}/sponsorships/${sponsorshipId}/confirm-payment`, { paymentIntentId });
  return data?.data ?? data;
}

// Wave 4 (G3-15): a sponsor voids an invited/accepted sponsorship they no
// longer stand behind; a paid sponsorship cannot be voided (refund instead).
export async function voidBookingSponsorship(bookingId, sponsorshipId) {
  const { data } = await api.post(`/bookings/${bookingId}/sponsorships/${sponsorshipId}/void`);
  return data?.data ?? data;
}

// D-601: the caller's own sponsorships, for the My sponsorships tab.
export async function listMySponsorships() {
  const { data } = await api.get('/bookings/sponsorships/mine');
  return data?.data ?? data;
}

export async function getSponsorReceipt(bookingId, sponsorshipId) {
  const { data } = await api.get(`/bookings/${bookingId}/sponsorships/${sponsorshipId}/receipt`);
  return data?.data ?? data;
}

export async function requestSponsorshipCharge(bookingId, sponsorshipId, payload) {
  const { data } = await api.post(`/bookings/${bookingId}/sponsorships/${sponsorshipId}/charges`, payload);
  return data?.data ?? data;
}

export async function listSponsorshipCharges(bookingId, sponsorshipId) {
  const { data } = await api.get(`/bookings/${bookingId}/sponsorships/${sponsorshipId}/charges`);
  return data?.data ?? data;
}

export async function respondSponsorshipCharge(bookingId, sponsorshipId, chargeId, decision) {
  const { data } = await api.post(`/bookings/${bookingId}/sponsorships/${sponsorshipId}/charges/${chargeId}/respond`, { decision });
  return data?.data ?? data;
}

export async function createChargePaymentIntent(bookingId, sponsorshipId, chargeId) {
  const { data } = await api.post(`/bookings/${bookingId}/sponsorships/${sponsorshipId}/charges/${chargeId}/payment-intent`);
  return data?.data ?? data;
}

export async function confirmChargePayment(bookingId, sponsorshipId, chargeId, paymentIntentId) {
  const { data } = await api.post(`/bookings/${bookingId}/sponsorships/${sponsorshipId}/charges/${chargeId}/confirm-payment`, { paymentIntentId });
  return data?.data ?? data;
}

// Token endpoints (no sign-in: the status/invite token is the credential).
export async function getTokenParticipantSummary(token) {
  const { data } = await api.get(`/bookings/status/${encodeURIComponent(token)}/summary`);
  return data?.data ?? data;
}

export async function getTokenChecklist(token) {
  const { data } = await api.get(`/bookings/status/${encodeURIComponent(token)}/checklist`);
  return data?.data ?? data;
}

export async function getTokenReceipt(token) {
  const { data } = await api.get(`/bookings/status/${encodeURIComponent(token)}/receipt`);
  return data?.data ?? data;
}

export async function listTokenSupport(token) {
  const { data } = await api.get(`/bookings/status/${encodeURIComponent(token)}/support`);
  return data?.data ?? data;
}

// D-593: the callbacks the token party requested (their own only).
export async function listTokenCallbacks(token) {
  const { data } = await api.get(`/bookings/status/${encodeURIComponent(token)}/callbacks`);
  return data?.data ?? data;
}

export async function listTokenSiteActions(token) {
  const { data } = await api.get(`/bookings/status/${encodeURIComponent(token)}/site-actions`);
  return data?.data ?? data;
}

export async function recordTokenSiteAction(token, payload) {
  const { data } = await api.post(`/bookings/status/${encodeURIComponent(token)}/site-actions`, payload);
  return data?.data ?? data;
}

export async function requestTokenLinkRenewal(token, payload) {
  const { data } = await api.post(`/bookings/status/${encodeURIComponent(token)}/renewal-request`, payload);
  return data?.data ?? data;
}

export async function registerTokenUpdateEmail(token, email) {
  const { data } = await api.post(`/bookings/status/${encodeURIComponent(token)}/update-email`, { email });
  return data?.data ?? data;
}

export async function removeTokenUpdateEmail(token, email) {
  const { data } = await api.post(`/bookings/status/${encodeURIComponent(token)}/update-email/remove`, { email });
  return data?.data ?? data;
}

export async function optOutTokenNotifications(token, payload) {
  const { data } = await api.post(`/bookings/status/${encodeURIComponent(token)}/notifications/opt-out`, payload);
  return data?.data ?? data;
}

export async function archiveTokenVisit(token) {
  const { data } = await api.post(`/bookings/status/${encodeURIComponent(token)}/archive`);
  return data?.data ?? data;
}

export async function submitTokenSupport(token, payload) {
  const { data } = await api.post(`/bookings/status/${encodeURIComponent(token)}/support`, payload);
  return data?.data ?? data;
}

export async function submitTokenFeedback(token, payload) {
  const { data } = await api.post(`/bookings/status/${encodeURIComponent(token)}/feedback`, payload);
  return data?.data ?? data;
}

export async function listTokenFeedback(token) {
  const { data } = await api.get(`/bookings/status/${encodeURIComponent(token)}/feedback`);
  return data?.data ?? data;
}

export async function uploadTokenSitePhoto(token, file) {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post(`/bookings/status/${encodeURIComponent(token)}/photos`, form);
  return data?.data ?? data;
}

export async function listTokenSitePhotos(token) {
  const { data } = await api.get(`/bookings/status/${encodeURIComponent(token)}/photos`);
  return data?.data ?? data;
}

export async function submitTokenContactCorrection(token, payload) {
  const { data } = await api.post(`/bookings/status/${encodeURIComponent(token)}/contact-correction`, payload);
  return data?.data ?? data;
}

export async function sendTokenRelayMessage(token, payload) {
  const { data } = await api.post(`/bookings/status/${encodeURIComponent(token)}/relay-message`, payload);
  return data?.data ?? data;
}

export async function getTokenSponsorPreview(token) {
  const { data } = await api.get(`/bookings/status/${encodeURIComponent(token)}/sponsor`);
  return data?.data ?? data;
}

export async function respondTokenSponsorship(token, decision) {
  const { data } = await api.post(`/bookings/status/${encodeURIComponent(token)}/sponsor/respond`, { decision });
  return data?.data ?? data;
}

export async function createTokenSponsorPaymentIntent(token) {
  const { data } = await api.post(`/bookings/status/${encodeURIComponent(token)}/sponsor/payment-intent`);
  return data?.data ?? data;
}

export async function confirmTokenSponsorPayment(token, paymentIntentId) {
  const { data } = await api.post(`/bookings/status/${encodeURIComponent(token)}/sponsor/confirm-payment`, { paymentIntentId });
  return data?.data ?? data;
}

// Wave 4 (G3-15): void from the token page, same rule as the account void.
export async function voidTokenSponsorship(token) {
  const { data } = await api.post(`/bookings/status/${encodeURIComponent(token)}/sponsor/void`);
  return data?.data ?? data;
}

export async function getTokenSponsorReceipt(token) {
  const { data } = await api.get(`/bookings/status/${encodeURIComponent(token)}/sponsor/receipt`);
  return data?.data ?? data;
}

export async function listTokenSponsorshipCharges(token) {
  const { data } = await api.get(`/bookings/status/${encodeURIComponent(token)}/sponsor/charges`);
  return data?.data ?? data;
}

export async function respondTokenSponsorshipCharge(token, chargeId, decision) {
  const { data } = await api.post(`/bookings/status/${encodeURIComponent(token)}/sponsor/charges/${chargeId}/respond`, { decision });
  return data?.data ?? data;
}

export async function createTokenChargePaymentIntent(token, chargeId) {
  const { data } = await api.post(`/bookings/status/${encodeURIComponent(token)}/sponsor/charges/${chargeId}/payment-intent`);
  return data?.data ?? data;
}

export async function confirmTokenChargePayment(token, chargeId, paymentIntentId) {
  const { data } = await api.post(`/bookings/status/${encodeURIComponent(token)}/sponsor/charges/${chargeId}/confirm-payment`, { paymentIntentId });
  return data?.data ?? data;
}

export async function getAvailableSlots(helperId, dateStr) {
  const { data } = await api.get(`/bookings/helper/${helperId}/available-slots`, {
    params: { date: dateStr },
  });
  return data;
}

export async function getBusinessAvailableSlots(businessId, dateStr, serviceId, staffId) {
  const { data } = await api.get(`/bookings/business/${businessId}/available-slots`, {
    params: {
      date: dateStr,
      ...(serviceId ? { serviceId } : {}),
      // Review P2-3-F08: when a staff member is chosen, the listing subtracts
      // their personal availability blocks, matching the booking gate.
      ...(staffId ? { staffId } : {}),
    },
  });
  return data;
}
