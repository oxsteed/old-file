import React from 'react';
import { MapPin, Navigation, Wifi } from 'lucide-react';
import type { LocationInfo } from '../../types/helperProfile';
import SectionCard from './ui/SectionCard';

interface LocationSectionProps {
  location: LocationInfo;
}

const LocationSection: React.FC<LocationSectionProps> = ({ location }) => (
  <SectionCard id="location" title="Service Area">
    <div className="space-y-4">
      {/* Map placeholder */}
      <div
        className="relative h-36 rounded-xl overflow-hidden bg-gray-800 border border-gray-700 flex items-center justify-center"
        role="img"
        aria-label={`Service area map centered on ${location.city}, ${location.state}`}
      >
        {/* Decorative map grid */}
        <svg
          className="absolute inset-0 w-full h-full opacity-10"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
              <path d="M 24 0 L 0 0 0 24" fill="none" stroke="white" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
        {/* Radius circle visual */}
        <div className="relative flex flex-col items-center gap-1">
          <div className="w-20 h-20 rounded-full border-2 border-brand-500/40 flex items-center justify-center">
            <div className="w-12 h-12 rounded-full border-2 border-brand-500/60 flex items-center justify-center">
              <div className="w-4 h-4 rounded-full bg-brand-500" />
            </div>
          </div>
          <p className="text-xs text-gray-400 absolute -bottom-6">
            {location.city}, {location.state}
          </p>
        </div>
      </div>

      {/* Details */}
      <div className="space-y-3 pt-2">
        <div className="flex items-start gap-3">
          <MapPin className="w-4 h-4 text-brand-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <div>
            <p className="text-sm text-white font-medium">
              {location.city}, {location.state} {location.zip}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">Based in</p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Navigation className="w-4 h-4 text-brand-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <div>
            <p className="text-sm text-white font-medium">
              Serves up to {location.serviceRadius} {location.radiusUnit}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              Austin metro area — Cedar Park, Round Rock, Pflugerville, Buda & Kyle
            </p>
          </div>
        </div>

        {location.servesRemotely && (
          <div className="flex items-start gap-3">
            <Wifi className="w-4 h-4 text-brand-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <div>
              <p className="text-sm text-white font-medium">Remote services available</p>
              {location.remoteNote && (
                <p className="text-xs text-gray-500 mt-0.5">{location.remoteNote}</p>
              )}
            </div>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-600 border-t border-gray-800 pt-3">
        Outside the service area? Message the helper to ask about exceptions.
      </p>
    </div>
  </SectionCard>
);

export default LocationSection;
