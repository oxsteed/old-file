import React from 'react';
import AwsLocationMap from '../AwsLocationMap';

export interface ServiceAreaMapAwsProps {
  center: [number, number];
  radiusMiles: number;
}

const ServiceAreaMapAws: React.FC<ServiceAreaMapAwsProps> = ({ center, radiusMiles }) => (
  <AwsLocationMap
    center={center}
    zoom={11}
    radiusMiles={radiusMiles}
    className="helper-service-area-map"
    places={[{ lat: center[0], lng: center[1], display_name: 'Service area' }]}
  />
);

export default ServiceAreaMapAws;
