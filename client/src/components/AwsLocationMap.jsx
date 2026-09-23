import React, { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../styles/AwsLocationMap.css';

const API_KEY = import.meta.env.VITE_AWS_LOCATION_API_KEY;
const REGION = import.meta.env.VITE_AWS_LOCATION_REGION || 'us-east-1';

function markerElement(external) {
  const element = document.createElement('div');
  element.className = external ? 'aws-location-marker aws-location-marker-external' : 'aws-location-marker';
  element.setAttribute('aria-hidden', 'true');
  return element;
}

function addLocationApiKey(url) {
  if (!url.startsWith('https://maps.geo.') && !url.startsWith('https://tiles.geo.')) {
    return url;
  }
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}key=${encodeURIComponent(API_KEY)}`;
}

function popupContent(place) {
  const wrapper = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = place.display_name || place.title || place.display || 'Location';
  wrapper.appendChild(title);
  if (place.external) {
    const note = document.createElement('p');
    note.textContent = 'External place - not orderable on OxSteed.';
    note.className = 'aws-location-popup-note';
    wrapper.appendChild(note);
  } else if (place.href) {
    const link = document.createElement('a');
    link.href = place.href;
    link.textContent = 'View menu';
    link.className = 'aws-location-popup-link';
    wrapper.appendChild(link);
  }
  return wrapper;
}

function circlePolygon(center, radiusMiles) {
  const [lat, lng] = center.map(Number);
  const radiusMeters = Number(radiusMiles) * 1609.34;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radiusMeters)) return null;
  const earthRadius = 6371000;
  const latRadians = lat * Math.PI / 180;
  const angularDistance = radiusMeters / earthRadius;
  const coordinates = [];
  for (let index = 0; index <= 64; index += 1) {
    const bearing = index / 64 * Math.PI * 2;
    const pointLat = Math.asin(
      Math.sin(latRadians) * Math.cos(angularDistance)
        + Math.cos(latRadians) * Math.sin(angularDistance) * Math.cos(bearing),
    );
    const pointLng = lng * Math.PI / 180 + Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latRadians),
      Math.cos(angularDistance) - Math.sin(latRadians) * Math.sin(pointLat),
    );
    coordinates.push([pointLng * 180 / Math.PI, pointLat * 180 / Math.PI]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coordinates] } };
}

export default function AwsLocationMap({ places = [], center = [25, -40], zoom = 2, radiusMiles, className = '' }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme') || 'dark');

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(document.documentElement.getAttribute('data-theme') || 'dark');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!containerRef.current || !API_KEY) return undefined;
    const map = new maplibregl.Map({
      container: containerRef.current,
      center: [Number(center[1]), Number(center[0])],
      zoom,
      style: `https://maps.geo.${REGION}.amazonaws.com/v2/styles/Standard/descriptor?color-scheme=${theme === 'light' ? 'Light' : 'Dark'}`,
      transformRequest: (url) => ({ url: addLocationApiKey(url) }),
      attributionControl: true,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    mapRef.current = map;
    return () => {
      markersRef.current.forEach(({ marker }) => marker.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, [theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setCenter([Number(center[1]), Number(center[0])]);
    map.setZoom(zoom);
  }, [center, zoom]);

  useEffect(() => {
    const map = mapRef.current;
    const polygon = radiusMiles == null ? null : circlePolygon(center, radiusMiles);
    if (!map || !polygon) return undefined;

    const sourceId = 'aws-location-radius';
    const layerId = 'aws-location-radius-fill';
    const lineId = 'aws-location-radius-line';
    const drawRadius = () => {
      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, { type: 'geojson', data: polygon });
      } else {
        map.getSource(sourceId).setData(polygon);
      }
      if (!map.getLayer(layerId)) {
        map.addLayer({
          id: layerId,
          type: 'fill',
          source: sourceId,
          paint: { 'fill-color': '#f97316', 'fill-opacity': 0.12 },
        });
      }
      if (!map.getLayer(lineId)) {
        map.addLayer({
          id: lineId,
          type: 'line',
          source: sourceId,
          paint: { 'line-color': '#f97316', 'line-opacity': 0.75, 'line-width': 2 },
        });
      }
    };

    if (map.isStyleLoaded()) drawRadius();
    else map.once('load', drawRadius);
    return () => map.off('load', drawRadius);
  }, [center, radiusMiles, theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach(({ marker }) => marker.remove());
    markersRef.current = places
      .filter((place) => place.lat != null && place.lng != null)
      .map((place) => {
        const marker = new maplibregl.Marker(markerElement(place.external))
          .setLngLat([Number(place.lng), Number(place.lat)])
          .setPopup(new maplibregl.Popup({ offset: 18 }).setDOMContent(popupContent(place)))
          .addTo(map);
        return { marker, place };
      });
  }, [places]);

  if (!API_KEY) {
    return (
      <div className={`aws-location-map aws-location-map-disabled ${className}`} role="status">
        Add a restricted Amazon Location Maps API key to display the map.
      </div>
    );
  }
  return <div ref={containerRef} className={`aws-location-map ${className}`} aria-label="Location map" />;
}
