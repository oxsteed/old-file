/**
 * Map a dispute resolution type to the resulting escrow status action.
 * Used to determine what happens to disputed payments when a dispute is resolved.
 *
 * P3-2-F12: 'split_resolution' used to park escrow in 'split_refund', which
 * zero code read, leaving the helper's remainder unreconciled forever. A
 * split only proceeds on a captured payment (see the 409 in resolveDispute),
 * so the remainder is already with the helper; the hold is over and escrow
 * releases. The split itself is recorded on the dispute row (resolution +
 * refund_amount) and in a platform_ledger memo written by resolveDispute.
 *
 * @param {string} resolution - One of: refund_customer, customer_wins, split_resolution, helper_wins
 * @returns {string} Escrow status: released, refunded
 */
function mapResolutionToEscrowStatus(resolution) {
  const ESCROW_MAPPING = Object.freeze({
    'refund_customer': 'refunded',
    'customer_wins': 'refunded',
    'split_resolution': 'released',
    'helper_wins': 'released',
    'dismissed': 'released',
    // default for any other value
  });

  return ESCROW_MAPPING[resolution] || 'released';
}

module.exports = { mapResolutionToEscrowStatus };
