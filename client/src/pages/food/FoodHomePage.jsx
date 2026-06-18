// OxSteed Food - customer discovery: map + search for restaurants worldwide.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { listFoodRestaurants } from '../../api/food';
import { FoodBrand } from './foodShared';
import '../../styles/FoodPages.css';

const DEFAULT_CENTER = [25.0, -40.0]; // Mid-Atlantic: world view until we know better.
const DEFAULT_ZOOM = 2;

export default function FoodHomePage() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [geo, setGeo] = useState(null); // { lat, lng }
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async (params) => {
    setLoading(true);
    setError(false);
    try {
      const rows = await listFoodRestaurants(params);
      setRestaurants(rows);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load({});
  }, [load]);

  const search = (e) => {
    e?.preventDefault?.();
    const params = {};
    if (query.trim()) params.q = query.trim();
    if (geo) {
      params.lat = geo.lat;
      params.lng = geo.lng;
    }
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
        <button type="button" className="fd-btn fd-btn-secondary" onClick={useMyLocation} disabled={locating}>
          {locating ? t('food.home.locating') : t('food.home.nearMe')}
        </button>
      </form>

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
          <div className="fd-grid">
            {restaurants.map((r) => (
              <Link key={r.id} to={`/restaurants/r/${r.id}`} className="fd-card">
                <h3>
                  {r.display_name}
                  {r.is_verified && <span className="fd-tag fd-tag-verified">Verified</span>}
                  {Number(r.review_count) > 0 && (
                    <span className="fd-card-rating">
                      ★ {Number(r.avg_rating || 0).toFixed(1)} ({Number(r.review_count)})
                    </span>
                  )}
                </h3>
                <div>
                  {(r.cuisine_tags || []).slice(0, 3).map((tag) => (
                    <span key={tag} className="fd-tag">{tag}</span>
                  ))}
                </div>
                <span className="fd-card-meta">
                  {[r.address_city, r.address_state, r.address_country].filter(Boolean).join(', ')}
                </span>
                {r.hours_message && (
                  <span className="fd-card-meta">
                    {r.is_open === false ? 'Closed' : 'Open'} · {r.hours_message}
                  </span>
                )}
                {r.distance_km != null && (
                  <span className="fd-card-meta">
                    {t('food.home.kmAway', { km: Number(r.distance_km).toFixed(1) })}
                  </span>
                )}
              </Link>
            ))}
          </div>
          <div style={{ marginTop: '1.6rem', textAlign: 'center' }}>
            <Link to="/restaurants/merchant" className="fd-btn fd-btn-secondary">
              {t('food.home.addYourRestaurant')}
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
