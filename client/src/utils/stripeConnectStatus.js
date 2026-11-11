export function isStripeConnectReady(status) {
  return Boolean(status?.connected && status?.charges_enabled && status?.payouts_enabled);
}

export function needsStripeConnectContinue(status) {
  return Boolean(status?.connected && !isStripeConnectReady(status));
}
