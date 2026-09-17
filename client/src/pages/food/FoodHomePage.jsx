// OxSteed Restaurants — customer discovery: search, browse, and order from restaurants worldwide.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { listFoodRestaurantsPage, listMyFoodOrders } from '../../api/food';
import { useAuth } from '../../context/AuthContext';
import { FoodBrand } from './foodShared';
import PageShell from '../../components/PageShell';
import PageMeta from '../../components/PageMeta';
import ThemeToggle from '../../components/ThemeToggle';
import LanguageSelector from '../../components/LanguageSelector';
import { ArrowDown, ArrowRight, ArrowUpRight, Search, MapPin, Map, Store, Utensils, SlidersHorizontal, X } from 'lucide-react';
import {
  DISCOVERY_PAGE_SIZE,
  buildRestaurantDiscoveryParams,
  mergeUniqueRestaurants,
} from './restaurantDiscovery';
import '../../styles/FoodPages.css';
import '../../styles/RestaurantDiscovery.css';

const DEFAULT_CENTER = [25.0, -40.0];
const DEFAULT_ZOOM = 2;

// Icon lookup for cuisine tags coming from the live restaurant data. The
// strip is data-driven: only cuisines that actually exist in the current
// market are rendered, so the page never advertises categories with zero
// restaurants behind them.
const CUISINE_ICON_RULES = [
  [/pizza|italian|pasta/i, '🍕'],
  [/burger|fast/i, '🍔'],
  [/asian|noodle|ramen|thai|chinese|vietnamese|pho/i, '🍜'],
  [/mexican|taco|burrito/i, '🌮'],
  [/sushi|japanese/i, '🍱'],
  [/chicken|wings/i, '🍗'],
  [/seafood|fish|lobster|crab/i, '🦞'],
  [/vegan|vegetarian|salad|healthy/i, '🥗'],
  [/dessert|ice cream|sweet|pastry|bakery/i, '🍦'],
  [/breakfast|brunch|pancake/i, '🥞'],
  [/indian|curry/i, '🍛'],
  [/haitian|caribbean|creole|jerk/i, '🍲'],
  [/coffee|cafe|café|espresso/i, '☕'],
  [/bbq|grill|smoke/i, '🍖'],
];

function iconForCuisine(tag) {
  const hit = CUISINE_ICON_RULES.find(([re]) => re.test(String(tag || '')));
  return hit ? hit[1] : '🍽️';
}

/** Skeleton card — shows while loading. */
function SkeletonCard() {
  return (
    <div className="fd-card fd-skeleton-card" aria-hidden="true">
      <div className="fd-skeleton-cover" />
      <div className="fd-card-body">
        <div className="fd-skeleton-line fd-skeleton-title" />
        <div className="fd-skeleton-line fd-skeleton-short" />
        <div className="fd-skeleton-line fd-skeleton-shorter" />
      </div>
    </div>
  );
}

/** Restaurant card — used in grid and horizontal scroll sections. */
function RestaurantCard({ r, t }) {
  const cover = r.cover_photo_url || r.image_url;
  const cityLine = [r.address_city, r.address_state, r.address_country].filter(Boolean).join(', ');

  return (
    <Link to={`/restaurants/r/${r.id}`} className="fd-card">
      {cover ? (
        <img src={cover} alt="" className="fd-card-cover" loading="lazy" />
      ) : (
        <div className="fd-card-cover fd-card-cover-placeholder">
          <span>🍽️</span>
        </div>
      )}
      <div className="fd-card-body">
        <h3>
          {r.display_name}
          {r.is_verified && (
            <span className="fd-tag fd-tag-verified" style={{ marginLeft: '0.4rem' }}>
              {t('food.home.verified')}
            </span>
          )}
        </h3>
        {(r.cuisine_tags || []).length > 0 && (
          <div className="fd-card-chips">
            {(r.cuisine_tags || []).slice(0, 3).map((tag) => (
              <span key={tag} className="fd-tag">{tag}</span>
            ))}
          </div>
        )}
        <div className="fd-card-meta-row">
          {Number(r.review_count) > 0 && (
            <span className="fd-card-rating">
              ★ {Number(r.avg_rating || 0).toFixed(1)}
              <span className="fd-card-rating-count"> ({Number(r.review_count)})</span>
            </span>
          )}
          {typeof r.is_open === 'boolean' && <span className={`fd-tag ${r.is_open === false ? 'fd-tag-closed' : 'fd-tag-open'}`}>
            {r.is_open === false ? t('food.home.closed') : t('food.home.open')}
          </span>}
        </div>
        {cityLine && <span className="fd-card-meta">{cityLine}</span>}
        {r.distance_km != null && (
          <span className="fd-card-meta">
            {t('food.home.kmAway', { km: Number(r.distance_km).toFixed(1) })}
          </span>
        )}
      </div>
    </Link>
  );
}

export default function FoodHomePage() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [locationError, setLocationError] = useState(false);
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [geo, setGeo] = useState(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState(false);
  const [activeCuisine, setActiveCuisine] = useState(null);
  const [showMap, setShowMap] = useState(false);
  const [recentOrders, setRecentOrders] = useState([]);
  const [sort, setSort] = useState('recommended');
  const [pagination, setPagination] = useState({
    limit: DISCOVERY_PAGE_SIZE,
    offset: 0,
    total: 0,
    hasMore: false,
    nextOffset: null,
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);

  const featuredRef = useRef([]);
  const isFirstLoad = useRef(true);
  const requestSequence = useRef(0);

  const load = useCallback(async (params = {}, options = {}) => {
    const reset = options.reset !== false;
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    if (reset) {
      setLoading(true);
      setLoadingMore(false);
      setError(false);
      setLoadMoreError(false);
    } else {
      setLoadingMore(true);
      setLoadMoreError(false);
    }
    try {
      const page = await listFoodRestaurantsPage({ limit: DISCOVERY_PAGE_SIZE, ...params });
      if (sequence !== requestSequence.current) return;
      const rows = Array.isArray(page.restaurants) ? page.restaurants : [];
      setRestaurants((current) => {
        if (reset) return rows;
        return mergeUniqueRestaurants(current, rows);
      });
      setPagination(page.pagination || {
        limit: DISCOVERY_PAGE_SIZE,
        offset: Number(params.offset || 0),
        total: rows.length,
        hasMore: false,
        nextOffset: null,
      });
      if (reset && isFirstLoad.current && !params.q && !params.cuisine && !params.lat && !params.lng && rows.length > 0) {
        featuredRef.current = [...rows]
          .sort((a, b) => Number(b.avg_rating || 0) - Number(a.avg_rating || 0))
          .slice(0, 8);
        isFirstLoad.current = false;
      }
    } catch {
      if (sequence !== requestSequence.current) return;
      if (reset) setError(true);
      else setLoadMoreError(true);
    } finally {
      if (sequence !== requestSequence.current) return;
      if (reset) setLoading(false);
      else setLoadingMore(false);
    }
  }, []);

  useEffect(() => { load({ sort: 'recommended' }, { reset: true }); }, [load]);

  useEffect(() => {
    if (!user) return;
    listMyFoodOrders()
      .then((data) => {
        const orders = data?.orders || [];
        const seen = new Set();
        const deduped = orders
          .filter((o) => {
            if (!o.restaurant_id || seen.has(o.restaurant_id)) return false;
            seen.add(o.restaurant_id);
            return true;
          })
          .slice(0, 5);
        setRecentOrders(deduped);
      })
      .catch(() => {});
  }, [user]);

  const search = (e) => {
    e?.preventDefault?.();
    setSubmittedQuery(query.trim());
    const params = buildRestaurantDiscoveryParams({ query, cuisine: activeCuisine, geo, sort });
    load(params, { reset: true });
  };

  const selectCuisine = (cuisine) => {
    const nextCuisine = activeCuisine === cuisine ? null : cuisine;
    setActiveCuisine(nextCuisine);
    const params = buildRestaurantDiscoveryParams({ query: submittedQuery, cuisine: nextCuisine, geo, sort });
    load(params, { reset: true });
  };

  const loadMore = () => {
    if (loadingMore || !pagination.hasMore) return;
    const params = buildRestaurantDiscoveryParams({
      query: submittedQuery,
      cuisine: activeCuisine,
      geo,
      sort,
      offset: pagination.nextOffset ?? pagination.offset + DISCOVERY_PAGE_SIZE,
    });
    load(params, { reset: false });
  };

  const selectSort = (nextSort) => {
    setSort(nextSort);
    const params = buildRestaurantDiscoveryParams({ query: submittedQuery, cuisine: activeCuisine, geo, sort: nextSort });
    load(params, { reset: true });
  };

  const useMyLocation = () => {
    setLocationError(false);
    if (!navigator.geolocation) { setLocationError(true); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setGeo(next);
        setLocating(false);
        const params = buildRestaurantDiscoveryParams({ query: submittedQuery, cuisine: activeCuisine, geo: next, sort });
        load(params, { reset: true });
      },
      () => { setLocating(false); setLocationError(true); },
      { timeout: 10000 }
    );
  };

  const mapCenter = useMemo(() => {
    if (geo) return [geo.lat, geo.lng];
    const w = restaurants.find((r) => r.latitude != null);
    if (w) return [Number(w.latitude), Number(w.longitude)];
    return DEFAULT_CENTER;
  }, [geo, restaurants]);

  const cuisinesFromData = useMemo(() => {
    const all = [...restaurants, ...featuredRef.current];
    const tags = new Set();
    all.forEach((r) => (r.cuisine_tags || []).forEach((tag) => tags.add(tag)));
    return Array.from(tags).slice(0, 14);
  }, [restaurants]);

  const displayedRestaurants = useMemo(() => {
    return restaurants;
  }, [restaurants]);

  const nearbyRestaurants = useMemo(() => {
    if (!geo) return [];
    return [...restaurants]
      .filter((r) => r.distance_km != null)
      .sort((a, b) => Number(a.distance_km) - Number(b.distance_km))
      .slice(0, 8);
  }, [geo, restaurants]);

  const reorderRestaurants = useMemo(() => {
    if (!user || !recentOrders.length) return [];
    return recentOrders.map((order) => {
      const full = restaurants.find((r) => String(r.id) === String(order.restaurant_id));
      return full || {
        id: order.restaurant_id,
        display_name: order.restaurant_name || t('food.home.restaurant'),
        logo_url: order.restaurant_logo || null,
      };
    });
  }, [recentOrders, restaurants, user, t]);

  const featured = featuredRef.current;
  const isSearching = !!submittedQuery;
  const hasReorder = reorderRestaurants.length > 0;
  const hasFeatured = !isSearching && !activeCuisine && featured.length > 0;
  const hasNearby = !isSearching && nearbyRestaurants.length > 0;
  const hasData = restaurants.length > 0;
  const hasDiscoveryFilter = isSearching || !!activeCuisine || !!geo;

  const clearFilters = () => {
    setQuery('');
    setSubmittedQuery('');
    setActiveCuisine(null);
    setGeo(null);
    setLocationError(false);
    setSort('recommended');
    load({ sort: 'recommended' }, { reset: true });
  };

  // Cuisine strip is driven by live restaurant data only — no hardcoded
  // market assumptions. When the current market has no restaurants (or only
  // one cuisine), the strip is hidden instead of advertising empty categories.
  const cuisineStrip = cuisinesFromData.map((tag) => ({ key: tag, icon: iconForCuisine(tag) }));

  return (
    <PageShell hideNav>
    <PageMeta
      title={t('food.home.title')}
      description={t('food.home.subtitle')}
      url="https://oxsteed.com/restaurants"
    />
    <div className="fd-home-page rd-page">
      <nav className="rd-nav" aria-label={t('food.home.redesign.navigation')}>
        <Link to="/restaurants" className="rd-brand" aria-current="page"><FoodBrand size={36} /></Link>
        <div className="rd-nav-links">
          <Link to="/" className="rd-network">{t('food.home.redesign.network')}<ArrowUpRight size={15} aria-hidden="true" /></Link>
          <Link to={user ? '/dashboard' : '/login'}>{t(user ? 'food.home.redesign.account' : 'food.home.redesign.signIn')}</Link>
          <LanguageSelector />
          <ThemeToggle />
        </div>
      </nav>

      {/* ── Hero banner ── */}
      <div className="fd-home-hero">
        <div className="fd-home-hero-inner">
          <div className="rd-hero-copy">
          <span className="rd-eyebrow"><Utensils size={16} aria-hidden="true" />{t('food.home.redesign.eyebrow')}</span>
          <h1 className="fd-home-hero-title">{t('food.home.redesign.headline')} <em>{t('food.home.redesign.headlineAccent')}</em></h1>
          <p className="fd-home-hero-sub">{t('food.home.redesign.subtitle')}</p>
          <p className="rd-platform-note"><Store size={18} aria-hidden="true" />{t('food.home.redesign.independent')}</p>

          {/* Search bar lives inside the hero */}
          <form className="fd-home-searchbar" onSubmit={search}>
            <div className="fd-home-search-input-wrap">
              <Search className="fd-home-search-icon" size={20} aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('food.home.searchPlaceholder')}
                aria-label={t('food.home.searchPlaceholder')}
              />
            </div>
            <button type="submit" className="fd-btn fd-home-search-btn">
              {t('food.home.searchBtn')}<ArrowRight size={18} aria-hidden="true" />
            </button>
          </form>
          <div className="rd-location-row">
            <button
              type="button"
              className="fd-btn fd-btn-secondary fd-home-near-btn"
              onClick={useMyLocation}
              disabled={locating}
            >
              <MapPin size={16} aria-hidden="true" />{locating ? t('food.home.locating') : t('food.home.nearMe')}
            </button>
            <span role="status">{t(geo ? 'food.home.redesign.locationOn' : 'food.home.redesign.locationHint')}</span>
          </div>
          {locationError && <p className="rd-location-error" role="alert">{t('food.home.redesign.locationError')}</p>}
          </div>
          <div className="rd-table-art" aria-hidden="true">
            <div className="rd-table-orbit" />
            <div className="rd-napkin" />
            <div className="rd-plate"><div className="rd-plate-well"><i /><i /><i /><i /><i /><b /><b /><b /></div></div>
            <Utensils className="rd-cutlery" strokeWidth={1} />
          </div>
        </div>
      </div>

      <div className="rd-browse-heading">
        <div><span className="rd-eyebrow">{t('food.home.redesign.explore')}</span><h2>{t('food.home.redesign.browseTitle')}</h2></div>
        <a href="#restaurant-owners" className="rd-owner-shortcut"><Store size={17} aria-hidden="true" />{t('food.home.redesign.forOwners')}<ArrowDown size={15} aria-hidden="true" /></a>
      </div>
      {hasDiscoveryFilter && <div className="rd-active-filters" aria-live="polite">
        <SlidersHorizontal size={16} aria-hidden="true" />
        {submittedQuery && <span>{submittedQuery}</span>}{activeCuisine && <span>{activeCuisine}</span>}{geo && <span>{t('food.home.nearMe')}</span>}
        <button type="button" onClick={clearFilters}>{t('food.home.clearFilter')}<X size={14} aria-hidden="true" /></button>
      </div>}

      {/* ── Cuisine category strip — built from live restaurant data ── */}
      {cuisineStrip.length > 1 && (
        <div className="fd-home-categories">
          {cuisineStrip.map(({ key, icon }) => {
            const isActive = activeCuisine === key;
            return (
              <button
                key={key}
                type="button"
                className={`fd-home-cat-btn${isActive ? ' fd-home-cat-btn--active' : ''}`}
                aria-pressed={isActive}
                onClick={() => selectCuisine(key)}
              >
                <span className="fd-home-cat-icon">{icon}</span>
                <span className="fd-home-cat-label">{key}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Map toggle ── */}
      {hasData && <div className="fd-map-toggle-row">
        <button
          type="button"
          className="fd-btn fd-btn-secondary fd-btn-sm"
          onClick={() => setShowMap((v) => !v)}
          aria-expanded={showMap}
          aria-controls="restaurant-discovery-map"
        >
          <Map size={16} aria-hidden="true" />{t(showMap ? 'food.home.hideMap' : 'food.home.showMap')}
        </button>
      </div>}

      {showMap && hasData && (
        <div className="fd-map-wrap" id="restaurant-discovery-map">
          <MapContainer
            key={`${mapCenter[0].toFixed(2)}|${mapCenter[1].toFixed(2)}`}
            center={mapCenter}
            zoom={geo ? 12 : DEFAULT_ZOOM}
            scrollWheelZoom={false}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {restaurants
              .filter((r) => r.latitude != null && r.longitude != null)
              .map((r) => (
                <CircleMarker
                  key={r.id}
                  center={[Number(r.latitude), Number(r.longitude)]}
                  radius={9}
                  pathOptions={{ color: '#f97316', fillColor: '#f97316', fillOpacity: 0.85 }}
                >
                  <Popup>
                    <strong>{r.display_name}</strong><br />
                    <Link to={`/restaurants/r/${r.id}`}>{t('food.home.viewMenu')}</Link>
                  </Popup>
                </CircleMarker>
              ))}
          </MapContainer>
        </div>
      )}

      {/* ── Content area ── */}
      {loading ? (
        /* Skeleton loading state */
        <div className="fd-home-content">
          <div className="fd-section">
            <div className="fd-skeleton-label" />
            <div className="fd-grid">
              {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          </div>
        </div>
      ) : error ? (
        <div className="fd-home-empty">
          <p role="alert">{t('food.home.redesign.errorHint')}</p>
          <h2>{t('food.common.loadError')}</h2>
          <button type="button" className="fd-btn" onClick={search}>
            {t('food.common.retry')}
          </button>
        </div>
      ) : !hasData && !hasDiscoveryFilter ? (
        /* Rich empty state */
        <div className="fd-home-empty rd-empty">
          <div className="rd-empty-symbol"><Store size={32} strokeWidth={1.3} aria-hidden="true" /></div>
          <div className="rd-empty-copy">
          <span className="rd-eyebrow">{t('food.home.redesign.availability')}</span>
          <h2 className="fd-home-empty-title">{t('food.home.redesign.emptyTitle')}</h2>
          <p className="fd-home-empty-sub">{t('food.home.redesign.emptyBody')}</p>
          <div className="fd-home-empty-actions">
            <a
              href="mailto:restaurants@oxsteed.com"
              className="fd-btn fd-btn-secondary"
            >
              {t('food.home.suggestRestaurant')}
            </a>
          </div>
          </div>
        </div>
      ) : (
        <div className="fd-home-content">
          <div className="fd-discovery-toolbar" aria-label={t('food.home.discoveryControls')}>
            <div className="fd-discovery-summary" aria-live="polite">
              <span className="fd-discovery-live-dot" aria-hidden="true" />
              <strong>{t('food.home.showingCount', { shown: restaurants.length, total: pagination.total })}</strong>
            </div>
            <label className="fd-discovery-sort">
              <span>{t('food.home.sortBy')}</span>
              <select value={sort} onChange={(e) => selectSort(e.target.value)}>
                <option value="recommended">{t('food.home.sortRecommended')}</option>
                <option value="rating">{t('food.home.sortRating')}</option>
                <option value="fastest">{t('food.home.sortFastest')}</option>
                {geo && <option value="distance">{t('food.home.sortDistance')}</option>}
              </select>
            </label>
          </div>

          {/* Order again */}
          {hasReorder && (
            <div className="fd-section">
              <h2 className="fd-section-label">{t('food.home.orderAgainTitle')}</h2>
              <div className="fd-h-scroll">
                <div className="fd-h-scroll-inner" style={{ gap: '0.75rem' }}>
                  {reorderRestaurants.map((r) => (
                    <Link key={r.id} to={`/restaurants/r/${r.id}`} className="fd-reorder-card">
                      {r.logo_url ? (
                        <img src={r.logo_url} alt="" className="fd-reorder-logo" />
                      ) : (
                        <div className="fd-reorder-logo-placeholder">🍽️</div>
                      )}
                      <span className="fd-reorder-name">{r.display_name}</span>
                      <span className="fd-reorder-hint">{t('food.home.reorderHint')}</span>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Featured */}
          {hasFeatured && (
            <div className="fd-section">
              <h2 className="fd-section-label">⭐ {t('food.home.featuredTitle')}</h2>
              <div className="fd-h-scroll">
                <div className="fd-h-scroll-inner">
                  {featured.map((r) => <RestaurantCard key={r.id} r={r} t={t} />)}
                </div>
              </div>
            </div>
          )}

          {/* Nearby */}
          {hasNearby && (
            <div className="fd-section">
              <h2 className="fd-section-label">📍 {t('food.home.nearbyTitle')}</h2>
              <div className="fd-h-scroll">
                <div className="fd-h-scroll-inner">
                  {nearbyRestaurants.map((r) => <RestaurantCard key={r.id} r={r} t={t} />)}
                </div>
              </div>
            </div>
          )}

          {/* Main grid */}
          <div className="fd-section">
            <h2 className="fd-section-label">
              {isSearching ? t('food.home.resultsTitle') : t('food.home.allTitle')}
            </h2>
            {displayedRestaurants.length > 0 ? (
              <div className="fd-grid">
                {displayedRestaurants.map((r) => <RestaurantCard key={r.id} r={r} t={t} />)}
              </div>
            ) : (
              <div className="fd-empty-filter">
                <p>{t('food.home.noResultsForFilter', { cuisine: activeCuisine || query })}</p>
                <button
                  type="button"
                  className="fd-btn fd-btn-secondary fd-btn-sm"
                  onClick={clearFilters}
                >
                  {t('food.home.clearFilter')}
                </button>
              </div>
            )}
            {displayedRestaurants.length > 0 && (
              <div className="fd-discovery-pagination">
                {loadMoreError && (
                  <p className="fd-discovery-load-error" role="alert">{t('food.common.loadError')}</p>
                )}
                {pagination.hasMore ? (
                  <button type="button" className="fd-btn fd-btn-secondary" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? t('food.home.loadingMore') : t('food.home.loadMore')}
                  </button>
                ) : (
                  <span className="fd-discovery-end" aria-live="polite">{t('food.home.allLoaded')}</span>
                )}
              </div>
            )}
          </div>

        </div>
      )}
      <section className="rd-how" aria-labelledby="restaurant-how-title">
        <h2 id="restaurant-how-title">{t('food.home.redesign.howTitle')}</h2>
        <div className="rd-how-grid">{['discover', 'choose', 'order'].map((step, index) => <div className="rd-step" key={step}>
          <span className="rd-step-number" aria-hidden="true">0{index + 1}</span><div><h3>{t(`food.home.redesign.${step}Title`)}</h3><p>{t(`food.home.redesign.${step}Body`)}</p></div>
        </div>)}</div>
      </section>
      <section className="rd-owner-panel" id="restaurant-owners" aria-labelledby="restaurant-owner-title">
        <Store size={30} strokeWidth={1.3} aria-hidden="true" />
        <div><span className="rd-eyebrow">{t('food.home.redesign.forOwners')}</span><h2 id="restaurant-owner-title">{t('food.home.redesign.ownerTitle')}</h2><p>{t('food.home.redesign.ownerBody')}</p></div>
        <Link to="/restaurants/merchant" className="fd-btn">{t('food.home.redesign.ownerAction')}<ArrowUpRight size={18} aria-hidden="true" /></Link>
      </section>
    </div>
    </PageShell>
  );
}
