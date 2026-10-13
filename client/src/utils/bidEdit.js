// Review P2-480: edit a pending bid in place (PUT /api/bids/:id) instead of
// withdrawing and re-bidding.
export function validateBidEdit({ amount, etaHours, message }) {
  const errors = {};
  const amt = Number(amount);
  if (amount === '' || !Number.isFinite(amt) || amt <= 0) errors.amount = 'myBids.editAmountInvalid';
  else if (amt > 10_000_000) errors.amount = 'myBids.editAmountTooLarge';
  if (etaHours !== '' && etaHours != null) {
    const eta = Number(etaHours);
    if (!Number.isFinite(eta) || eta <= 0 || eta > 10_000) errors.etaHours = 'myBids.editEtaInvalid';
  }
  if (typeof message === 'string' && message.length > 2000) errors.message = 'myBids.editMessageTooLong';
  return errors;
}

