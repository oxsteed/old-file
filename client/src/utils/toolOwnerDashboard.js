export function withinNextDays(value, days, now = Date.now()) {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp)
    && timestamp >= now
    && timestamp <= now + days * 24 * 60 * 60 * 1000;
}

export function deriveToolOwnerStats(listings = [], bookings = [], now = Date.now()) {
  const activeListings = listings.filter((listing) => (
    listing.is_available !== false && listing.moderation_hold !== true
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
  const rated = listings.filter((listing) => listing.avg_rating != null && listing.review_count > 0);
  const reviewCount = rated.reduce((sum, listing) => sum + (Number(listing.review_count) || 0), 0);
  const avgRating = reviewCount === 0
    ? null
    : rated.reduce((sum, listing) => sum + (Number(listing.avg_rating) || 0) * (Number(listing.review_count) || 0), 0) / reviewCount;

  return { activeListings, pending, upcomingPickups, upcomingReturns, earnings30, avgRating };
}

export function upcomingToolOwnerHandoffs(bookings = [], now = Date.now()) {
  return bookings
    .filter((booking) => (
      (booking.status === 'payment_confirmed' && withinNextDays(booking.start_date || booking.start_at, 7, now))
      || (booking.status === 'payment_confirmed' && withinNextDays(booking.end_date || booking.end_at, 7, now))
    ))
    .sort((a, b) => new Date(a.start_date || a.start_at) - new Date(b.start_date || b.start_at))
    .slice(0, 6);
}
