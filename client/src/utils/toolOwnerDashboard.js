export function withinNextDays(value, days, now = Date.now()) {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp)
    && timestamp >= now
    && timestamp <= now + days * 24 * 60 * 60 * 1000;
}

export function deriveToolOwnerStats(listings = [], bookings = [], now = Date.now()) {
  // G11-A10/B1 (D-622): a listing whose owner access was revoked is
  // blocked, not active, even though it is still available.
  const activeListings = listings.filter((listing) => (
    listing.is_available !== false && listing.moderation_hold !== true && listing.publication_blocked !== true
  )).length;
  const pending = bookings.filter((booking) => (
    booking.status === 'pending' || booking.status === 'requested'
  )).length;
  const paidBookings = bookings.filter((booking) => booking.status === 'payment_confirmed');
  const upcomingPickups = paidBookings.filter((booking) => (
    withinNextDays(booking.start_date || booking.start_at, 7, now)
  )).length;
  const upcomingReturns = paidBookings.filter((booking) => (
    withinNextDays(booking.end_date || booking.end_at, 7, now)
  )).length;
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  const earnings30 = bookings
    .filter((booking) => (
      (booking.status === 'completed' || booking.status === 'paid')
      && new Date(booking.completed_at || booking.end_date || booking.created_at).getTime() >= thirtyDaysAgo
    ))
    .reduce((sum, booking) => sum + Math.round((Number(booking.total_price) || 0) * 100), 0);
  // G11-B14 (D-633): invoices sent but not paid are invoiced, not
  // earnings. The 30-day tile already counts only completed/paid; the
  // invoiced total (cents, like earnings30) is surfaced as a hint on
  // the earnings tile. The server counts the same way (D-574); the
  // dashboard never read its `invoiced` figure.
  const invoiced = bookings
    .filter((booking) => booking.status === 'invoice_sent')
    .reduce((sum, booking) => sum + Math.round((Number(booking.total_price) || 0) * 100), 0);
  const rated = listings.filter((listing) => listing.avg_rating != null && listing.review_count > 0);
  const reviewCount = rated.reduce((sum, listing) => sum + (Number(listing.review_count) || 0), 0);
  const avgRating = reviewCount === 0
    ? null
    : rated.reduce((sum, listing) => sum + (Number(listing.avg_rating) || 0) * (Number(listing.review_count) || 0), 0) / reviewCount;

  return { activeListings, pending, upcomingPickups, upcomingReturns, earnings30, invoiced, avgRating };
}

export function upcomingToolOwnerHandoffs(bookings = [], now = Date.now()) {
  // G11-A10/B1 (D-622): return-ness comes from the dates, not the
  // status. The booking status set has no 'in_progress', so the old
  // render test `status === 'in_progress'` was dead and every handoff
  // showed as a pickup. A booking whose rental already started and
  // whose end falls inside the window is a return; a booking whose
  // start falls inside the window is a pickup. One entry per booking,
  // tagged with its kind and its handoff date, sorted by that date.
  return bookings
    .filter((booking) => (
      (booking.status === 'payment_confirmed' && withinNextDays(booking.start_date || booking.start_at, 7, now))
      || (booking.status === 'payment_confirmed' && withinNextDays(booking.end_date || booking.end_at, 7, now))
    ))
    .map((booking) => {
      const startTs = new Date(booking.start_date || booking.start_at).getTime();
      const isReturn = Number.isFinite(startTs) && startTs < now
        && withinNextDays(booking.end_date || booking.end_at, 7, now);
      return {
        ...booking,
        _handoffKind: isReturn ? 'return' : 'pickup',
        _handoffWhen: isReturn ? (booking.end_date || booking.end_at) : (booking.start_date || booking.start_at),
      };
    })
    .sort((a, b) => new Date(a._handoffWhen) - new Date(b._handoffWhen))
    .slice(0, 6);
}
