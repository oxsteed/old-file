/**
 * Map a dispute resolution type to the resulting escrow status action.
 * Used to determine what happens to disputed payments when a dispute is resolved.
 *
 * @param {string} resolution - One of: refund_customer, customer_wins, split_resolution, helper_wins
 * @returns {string} Escrow status: released, refunded, split_refund
 */
function mapResolutionToEscrowStatus(resolution) {
  const ESCROW_MAPPING = Object.freeze({
    'refund_customer': 'refunded',
    'customer_wins': 'refunded',
    'split_resolution': 'split_refund',
    'helper_wins': 'released',
    // default for any other value
  });

  return ESCROW_MAPPING[resolution] || 'released';
}

module.exports = { mapResolutionToEscrowStatus };
