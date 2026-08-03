// OxSteed Restaurants — customer discovery: search, browse, and order from restaurants worldwide.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { listFoodRestaurants, listMyFoodOrders } from '../../api/food';
import { useAuth } from '../../context/AuthContext';
import { FoodBrand } from './foodShared';
import PageShell from '../../components/PageShell';
import { LAUNCH_VISIBILITY } from '../../utils/launchScope';
import '../../styles/FoodPages.css';

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
          <span className={`fd-tag ${r.is_open === false ? 'fd-tag-closed' : 'fd-tag-open'}`}>
            {r.is_open === false ? t('food.home.closed') : t('food.home.open')}
          </span>
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
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [geo, setGeo] = useState(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState(false);
  const [activeCuisine, setActiveCuisine] = useState(null);
  const [showMap, setShowMap] = useState(false);
  const [recentOrders, setRecentOrders] = useState([]);

  const featuredRef = useRef([]);
  const isFirstLoad = useRef(true);

  const load = useCallback(async (params) => {
    setLoading(true);
    setError(false);
    try {
      const rows = await listFoodRestaurants(params);
      setRestaurants(rows);
      if (isFirstLoad.current && rows.length > 0) {
        featuredRef.current = [...rows]
          .sort((a, b) => Number(b.avg_rating || 0) - Number(a.avg_rating || 0))
          .slice(0, 8);
        isFirstLoad.current = false;
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load({}); }, [load]);

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
    const params = {};
    if (query.trim()) params.q = query.trim();
    if (geo) { params.lat = geo.lat; params.lng = geo.lng; }
    load(params);
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setGeo(next);
        setLocating(false);
        const params = { lat: next.lat, lng: next.lng };
        if (query.trim()) params.q = query.trim();
        load(params);
      },
      () => setLocating(false),
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
    if (!activeCuisine) return restaurants;
    return restaurants.filter((r) => (r.cuisine_tags || []).includes(activeCuisine));
  }, [restaurants, activeCuisine]);

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
  const isSearching = !!query.trim();
  const hasReorder = reorderRestaurants.length > 0;
  const hasFeatured = !isSearching && featured.length > 0;
  const hasNearby = !isSearching && nearbyRestaurants.length > 0;
  const hasData = restaurants.length > 0;

  // Cuisine strip is driven by live restaurant data only — no hardcoded
  // market assumptions. When the current market has no restaurants (or only
  // one cuisine), the strip is hidden instead of advertising empty categories.
  const cuisineStrip = cuisinesFromData.map((tag) => ({ key: tag, icon: iconForCuisine(tag) }));

  return (
    <PageShell>
    <div className="fd-home-page">

      {/* ── Hero banner ── */}
      <div className="fd-home-hero">
        <div className="fd-home-hero-inner">
          <div className="fd-home-hero-brand">
            <FoodBrand size={52} />
          </div>
          <h1 className="fd-home-hero-title">{t('food.home.title')}</h1>
          <p className="fd-home-hero-sub">{t('food.home.subtitle')}</p>

          {/* Search bar lives inside the hero */}
          <form className="fd-home-searchbar" onSubmit={search}>
            <div className="fd-home-search-input-wrap">
              <span className="fd-home-search-icon" aria-hidden="true">🔍</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('food.home.searchPlaceholder')}
                aria-label={t('food.home.searchPlaceholder')}
              />
            </div>
            <button type="submit" className="fd-btn fd-home-search-btn">
              {t('food.home.searchBtn')}
            </button>
            <button
              type="button"
              className="fd-btn fd-btn-secondary fd-home-near-btn"
              onClick={useMyLocation}
              disabled={locating}
            >
              {locating ? t('food.home.locating') : `📍 ${t('food.home.nearMe')}`}
            </button>
          </form>
        </div>
      </div>

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
                onClick={() => setActiveCuisine(isActive ? null : key)}
              >
                <span className="fd-home-cat-icon">{icon}</span>
                <span className="fd-home-cat-label">{key}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Map toggle ── */}
      <div className="fd-map-toggle-row">
        <button
          type="button"
          className="fd-btn fd-btn-secondary fd-btn-sm"
          onClick={() => setShowMap((v) => !v)}
        >
          {showMap ? `🗺️ ${t('food.home.hideMap')}` : `🗺️ ${t('food.home.showMap')}`}
        </button>
      </div>

      {showMap && (
        <div className="fd-map-wrap">
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
          <div className="fd-home-empty-icon">⚠️</div>
          <h2>{t('food.common.loadError')}</h2>
          <button type="button" className="fd-btn" onClick={search}>
            {t('food.common.retry')}
          </button>
        </div>
      ) : !hasData ? (
        /* Rich empty state */
        <div className="fd-home-empty">
          <div className="fd-home-empty-art">
            <div className="fd-home-empty-plate">🍽️</div>
            <div className="fd-home-empty-ring" />
          </div>
          <h2 className="fd-home-empty-title">{t('food.home.empty')}</h2>
          <p className="fd-home-empty-sub">{t('food.home.emptySub')}</p>
          <div className="fd-home-empty-actions">
            {LAUNCH_VISIBILITY.restaurantMerchantPublicEntry && (
              <Link to="/restaurants/merchant" className="fd-btn">
                {t('food.home.addYourRestaurant')}
              </Link>
            )}
            <a
              href="mailto:restaurants@oxsteed.com"
              className="fd-btn fd-btn-secondary"
            >
              {t('food.home.suggestRestaurant')}
            </a>
          </div>
          <div className="fd-home-empty-soon">
            <span className="fd-home-empty-soon-dot" />
            {t('food.home.launchingSoon')}
          </div>
        </div>
      ) : (
        <div className="fd-home-content">
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
                  onClick={() => { setActiveCuisine(null); setQuery(''); load({}); }}
                >
                  {t('food.home.clearFilter')}
                </button>
              </div>
            )}
          </div>

          {LAUNCH_VISIBILITY.restaurantMerchantPublicEntry && (
            <div className="fd-home-footer-cta">
              <Link to="/restaurants/merchant" className="fd-btn fd-btn-secondary">
                {t('food.home.addYourRestaurant')}
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
    </PageShell>
  );
}
