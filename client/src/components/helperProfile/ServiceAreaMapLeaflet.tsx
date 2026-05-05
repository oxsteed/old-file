import React, { useMemo } from 'react';
import L from 'leaflet';
import { MapContainer, TileLayer, Circle, CircleMarker, useMap } from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';
import 'leaflet/dist/leaflet.css';

function FitBounds({
  center,
  radiusMeters,
}: {
  center: LatLngExpression;
  radiusMeters: number;
}) {
  const map = useMap();
  React.useEffect(() => {
    const bounds = L.circle(center, { radius: radiusMeters }).getBounds();
    map.fitBounds(bounds, { padding: [16, 16], maxZoom: 11 });
  }, [map, center, radiusMeters]);
  return null;
}

export interface ServiceAreaMapLeafletProps {
  center: LatLngExpression;
  radiusMiles: number;
}

/**
 * Interactive OSM map with approximate service radius (react-leaflet).
 */
const ServiceAreaMapLeaflet: React.FC<ServiceAreaMapLeafletProps> = ({
  center,
  radiusMiles,
}) => {
  const radiusMeters = useMemo(() => Math.max(400, radiusMiles * 1609.34), [radiusMiles]);

  return (
    <MapContainer
      center={center}
      zoom={11}
      className="h-full w-full min-h-[11rem] z-0"
      scrollWheelZoom
      attributionControl
    >
      <FitBounds center={center} radiusMeters={radiusMeters} />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Circle
        center={center}
        radius={radiusMeters}
        pathOptions={{
          color: '#f97316',
          fillColor: '#f97316',
          fillOpacity: 0.12,
          weight: 2,
        }}
      />
      <CircleMarker
        center={center}
        radius={7}
        pathOptions={{
          color: '#fff',
          fillColor: '#f97316',
          fillOpacity: 1,
          weight: 2,
        }}
      />
    </MapContainer>
  );
};

export default ServiceAreaMapLeaflet;
