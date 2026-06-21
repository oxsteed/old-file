// OxSteed Food - customer discovery: map + search for restaurants worldwide.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { listFoodRestaurants, listMyFoodOrders } from '../../api/food';
import { useAuth } from '../../context/AuthContext';
import { FoodBrand } from './foodShared';
import '../../styles/FoodPages.css';

const DEFAULT_CENTER = [25.0, -40.0]; // Mid-Atlantic world view until we know better.
const DEFAULT_ZOOM = 2;

/** Reusable restaurant card used in both grid and horizontal scroll sections. */
function RestaurantCard({ r, t }) {
  const cover = r.cover_photo_url || r.image_url;
  const cityLine = [r.address_city, r.address_state, r.address_country].filter(Boolean).join(', ');

  return (
    <Link to={`/restaurants/r/${r.id}`} className="fd-card">
      {cover && (
        <img src={cover} alt="" className="fd-card-cover" loading="lazy" />
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
  const [geo, setGeo] = useState(null); // { lat, lng }
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState(false);
  const [activeCuisine, setActiveCuisine] = useState(null);
  const [showMap, setShowMap] = useState(false);
  const [recentOrders, setRecentOrders] = useState([]);

  // Featured = top-rated restaurants captured on first load; never overwritten by search.
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

  useEffect(() => {
    load({});
  }, [load]);

  // Reorder shortcuts — fetch once after auth is known.
  useEffect(() => {
    if (!user) return;
    listMyFoodOrders()
      .then((data) => {
        const orders = data?.orders || [];
        const seen = new Set();
        const deduped = orders
          .filter((o) => {
            if (!o.restaurant_id) return false;
            if (seen.has(o.restaurant_id)) return false;
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
    const withCoords = restaurants.find((r) => r.latitude != null && r.longitude != null);
    if (withCoords) return [Number(withCoords.latitude), Number(withCoords.longitude)];
    return DEFAULT_CENTER;
  }, [geo, restaurants]);

  // Unique cuisine tags across all loaded + featured restaurants.
  const cuisines = useMemo(() => {
    const all = [...restaurants, ...featuredRef.current];
    const tags = new Set();
    all.forEach((r) => (r.cuisine_tags || []).forEach((t) => tags.add(t)));
    return Array.from(tags).slice(0, 14);
  }, [restaurants]);

  // Grid filtered by active cuisine chip.
  const displayedRestaurants = useMemo(() => {
    if (!activeCuisine) return restaurants;
    return restaurants.filter((r) => (r.cuisine_tags || []).includes(activeCuisine));
  }, [restaurants, activeCuisine]);

  // Nearby: only when geo active, sorted by distance.
  const nearbyRestaurants = useMemo(() => {
    if (!geo) return [];
    return [...restaurants]
      .filter((r) => r.distance_km != null)
      .sort((a, b) => Number(a.distance_km) - Number(b.distance_km))
      .slice(0, 8);
  }, [geo, restaurants]);

  // Match recent order restaurant_id to full restaurant data when available.
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

  return (
    <div className="fd-page">
      <div className="fd-hero">
        <FoodBrand size={44} />
        <div>
          <h1 className="fd-hero-title">{t('food.home.title')}</h1>
          <p className="fd-hero-sub">{t('food.home.subtitle')}</p>
        </div>
      </div>

      <form className="fd-searchbar" onSubmit={search}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('food.home.searchPlaceholder')}
          aria-label={t('food.home.searchPlaceholder')}
        />
        <button type="submit" className="fd-btn">{t('food.home.searchBtn')}</button>
        <button
          type="button"
          className="fd-btn fd-btn-secondary"
          onClick={useMyLocation}
          disabled={locating}
        >
          {locating ? t('food.home.locating') : t('food.home.nearMe')}
        </button>
      </form>

      {/* Map toggle */}
      <div className="fd-map-toggle-row">
        <button
          type="button"
          className="fd-btn fd-btn-secondary fd-btn-sm"
          onClick={() => setShowMap((v) => !v)}
        >
          {showMap ? t('food.home.hideMap') : t('food.home.showMap')}
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
                    <strong>{r.display_name}</strong>
                    <br />
                    <Link to={`/restaurants/r/${r.id}`}>{t('food.home.viewMenu')}</Link>
                  </Popup>
                </CircleMarker>
              ))}
          </MapContainer>
        </div>
      )}

      {loading ? (
        <div className="fd-empty">{t('food.common.loading')}</div>
      ) : error ? (
        <div className="fd-empty">
          {t('food.common.loadError')}{' '}
          <button type="button" className="fd-btn fd-btn-sm" onClick={search}>
            {t('food.common.retry')}
          </button>
        </div>
      ) : restaurants.length === 0 ? (
        <div className="fd-empty">
          <p>{t('food.home.empty')}</p>
          <Link to="/restaurants/merchant" className="fd-btn">{t('food.home.addYourRestaurant')}</Link>
        </div>
      ) : (
        <>
          {/* Order again section — auth-only */}
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

          {/* Featured — top-rated restaurants (hidden during search) */}
          {hasFeatured && (
            <div className="fd-section">
              <h2 className="fd-section-label">{t('food.home.featuredTitle')}</h2>
              <div className="fd-h-scroll">
                <div className="fd-h-scroll-inner">
                  {featured.map((r) => <RestaurantCard key={r.id} r={r} t={t} />)}
                </div>
              </div>
            </div>
          )}

          {/* Nearby — geo-conditional (hidden during search) */}
          {hasNearby && (
            <div className="fd-section">
              <h2 className="fd-section-label">{t('food.home.nearbyTitle')}</h2>
              <div className="fd-h-scroll">
                <div className="fd-h-scroll-inner">
                  {nearbyRestaurants.map((r) => <RestaurantCard key={r.id} r={r} t={t} />)}
                </div>
              </div>
            </div>
          )}

          {/* Cuisine filter chips */}
          {cuisines.length > 1 && (
            <div
              className="fd-cuisine-chips"
              role="group"
              aria-label={t('food.home.filterByCuisine')}
            >
              <button
                type="button"
                className={`fd-cuisine-chip${activeCuisine === null ? ' fd-cuisine-chip--active' : ''}`}
                onClick={() => setActiveCuisine(null)}
              >
                {t('food.home.allTitle')}
              </button>
              {cuisines.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`fd-cuisine-chip${activeCuisine === c ? ' fd-cuisine-chip--active' : ''}`}
                  onClick={() => setActiveCuisine(activeCuisine === c ? null : c)}
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          {/* Main restaurant grid */}
          <div className="fd-section">
            <h2 className="fd-section-label">
              {isSearching ? t('food.home.resultsTitle') : t('food.home.allTitle')}
            </h2>
            <div className="fd-grid">
              {displayedRestaurants.map((r) => (
                <RestaurantCard key={r.id} r={r} t={t} />
              ))}
            </div>
          </div>

          <div style={{ marginTop: '0.5rem', textAlign: 'center' }}>
            <Link to="/restaurants/merchant" className="fd-btn fd-btn-secondary">
              {t('food.home.addYourRestaurant')}
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
