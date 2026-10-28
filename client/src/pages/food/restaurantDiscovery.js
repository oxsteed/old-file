export const DISCOVERY_PAGE_SIZE = 24;

export function buildRestaurantDiscoveryParams({
  query = '',
  cuisine = null,
  geo = null,
  sort = 'recommended',
  offset = 0,
} = {}) {
  const params = {
    limit: DISCOVERY_PAGE_SIZE,
    offset: Math.max(Number(offset) || 0, 0),
    sort,
  };
  if (String(query || '').trim()) params.q = String(query).trim();
  if (cuisine) params.cuisine = cuisine;
  const coordinate = (value, bound) => value != null && value !== ''
    && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= bound;
  if (geo && coordinate(geo.lat, 90) && coordinate(geo.lng, 180)) {
    params.lat = Number(geo.lat);
    params.lng = Number(geo.lng);
  }
  return params;
}

export function isFeaturedRestaurant(restaurant, now = Date.now()) {
  return Boolean(restaurant?.is_featured)
    && (!restaurant.featured_until || new Date(restaurant.featured_until).getTime() > now);
}

const DAY_NAMES = { sun: 'sunday', mon: 'monday', tue: 'tuesday', wed: 'wednesday', thu: 'thursday', fri: 'friday', sat: 'saturday' };

function localClock(value, locale) {
  const match = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(value || '');
  if (!match) return null;
  const hour = Number(match[1]), minute = Number(match[2]);
  if (hour < 1 || hour > 12 || minute > 59) return null;
  // These are restaurant wall-clock times already evaluated by the server.
  // Translate their display without converting them to the visitor's zone.
  return new Intl.DateTimeFormat(locale || 'en', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })
    .format(new Date(Date.UTC(2000, 0, 1, hour % 12 + (match[3] === 'PM' ? 12 : 0), minute)));
}

export function restaurantHoursLabel(restaurant, t, locale = 'en') {
  const code = restaurant?.hours_message_code;
  if (code === 'temporarily_closed') return t('food.hours.temporarilyClosed');
  if (restaurant?.is_accepting_orders_now === false) return t('food.home.discovery.ordersPaused');
  const params = restaurant?.hours_message_params || {};
  const opens = localClock(params.opensAt, locale), closes = localClock(params.closesAt, locale);
  switch (code) {
    case 'open_until': if (closes) return t('food.hours.openUntil', { time: closes }); break;
    case 'opens_at': if (opens) return t('food.hours.opensAt', { time: opens }); break;
    case 'opens_tomorrow_at': if (opens) return t('food.hours.opensTomorrowAt', { time: opens }); break;
    case 'opens_day_at': if (opens && DAY_NAMES[params.opensDay]) return t('food.hours.opensDayAt', { day: t(`food.restaurant.days.${DAY_NAMES[params.opensDay]}`), time: opens }); break;
    case 'closed': return t('food.hours.closed');
    default: break;
  }
  // Empty hours evaluate as open on the server to allow ordering. That is
  // not evidence of published opening hours, so don't invent a schedule.
  return t('food.home.discovery.hoursNotListed');
}

export function restaurantFulfillmentLabels(restaurant, t) {
  const keys = { pickup: 'food.restaurant.takeout', delivery: 'food.fulfillment.delivery', dine_in: 'food.order.dineIn' };
  const modes = Array.isArray(restaurant?.fulfillment_modes) ? restaurant.fulfillment_modes : [];
  return [...new Set(modes)].filter(mode => Object.hasOwn(keys, mode)).map(mode => t(keys[mode]));
}

export function mergeUniqueRestaurants(current, incoming) {
  const existing = Array.isArray(current) ? current : [];
  const seen = new Set(existing.map((restaurant) => String(restaurant?.id)));
  const next = Array.isArray(incoming)
    ? incoming.filter((restaurant) => {
      const id = String(restaurant?.id);
      if (!restaurant || !id || id === 'undefined' || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    : [];
  return [...existing, ...next];
}
