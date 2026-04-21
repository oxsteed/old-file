import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Star, CheckCircle2, Zap } from 'lucide-react';
import { useHelpersInfiniteScroll } from '../hooks/useHelpersInfiniteScroll';
import type { Helper } from '../hooks/useHelpersInfiniteScroll';

const FALLBACK_LAT = 39.921923;
const FALLBACK_LNG = -82.998619;

export default function LiveHelpersHeroCard() {
  const { t } = useTranslation();
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [displayedHelpers, setDisplayedHelpers] = useState<Helper[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  const { helpers, isLoading } = useHelpersInfiniteScroll({
    latitude: userLocation?.lat,
    longitude: userLocation?.lng,
    limit: 10,
    radius: 60,
    enabled: !!userLocation,
  });

  // Get user's geolocation on mount
  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
        () => {
          setUserLocation({ lat: FALLBACK_LAT, lng: FALLBACK_LNG });
        },
        { timeout: 5000, enableHighAccuracy: false }
      );
    } else {
      setUserLocation({ lat: FALLBACK_LAT, lng: FALLBACK_LNG });
    }
  }, []);

  // Update displayed helpers and auto-cycle through them
  useEffect(() => {
    if (helpers.length > 0) {
      setDisplayedHelpers(helpers.slice(0, 3));
    }
  }, [helpers]);

  // Auto-cycle through helpers every 5 seconds
  useEffect(() => {
    if (displayedHelpers.length === 0) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % displayedHelpers.length);
    }, 5000);

    return () => clearInterval(interval);
  }, [displayedHelpers.length]);

  const location =
    userLocation && userLocation.lat !== FALLBACK_LAT ? 'Near you' : 'Near you';
  const badgeLabel = helpers.length > 0 ? `${Math.min(helpers.length, 99)}+ online` : 'Loading';
  const isLoading_ = isLoading || !userLocation;

  return (
    <div
      className="hp-hero-card"
      style={{ perspective: '800px' }}
      aria-hidden={isLoading_ ? 'true' : 'false'}
    >
      <div
        className="hp-mock-card"
        style={{
          background: 'var(--hp-surface-2)',
          border: '1px solid var(--hp-divider)',
          borderRadius: 'var(--hp-radius-xl)',
          padding: '1.25rem',
          boxShadow: 'var(--hp-shadow-lg)',
          transform: 'rotateY(-4deg) rotateX(2deg)',
          transition: 'transform .4s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'rotateY(0deg) rotateX(0deg)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'rotateY(-4deg) rotateX(2deg)';
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            marginBottom: '1rem',
            paddingBottom: '0.875rem',
            borderBottom: '1px solid var(--hp-divider)',
          }}
        >
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: isLoading_ ? '#999' : '#22c55e',
              animation: isLoading_ ? 'none' : 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
            }}
          />
          <span style={{ fontSize: '.75rem', fontWeight: 600, color: 'var(--hp-text)' }}>
            {t('liveHelpers.heroCardTitle', 'Live helpers near you')}
          </span>
          <span
            style={{
              marginLeft: 'auto',
              fontSize: '.7rem',
              fontWeight: 600,
              background: 'var(--hp-green-bg)',
              color: 'var(--hp-green)',
              padding: '2px 0.5rem',
              borderRadius: 'var(--hp-radius-full)',
            }}
          >
            {badgeLabel}
          </span>
        </div>

        {/* Location Info */}
        <div style={{ marginBottom: '0.875rem' }}>
          <div
            style={{
              fontFamily: 'var(--hp-font-display)',
              fontSize: '1.1rem',
              color: 'var(--hp-text)',
              marginBottom: '0.25rem',
            }}
          >
            {isLoading_ ? (
              <span style={{ opacity: 0.4 }}>Loading…</span>
            ) : (
              <span>Available now</span>
            )}
          </div>
          {!isLoading_ && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
                fontSize: '.78rem',
                color: 'var(--hp-text-muted)',
              }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              {location}
            </div>
          )}
        </div>

        {/* Helper Cards - Display 3 at a time */}
        {displayedHelpers.length > 0
          ? displayedHelpers.map((helper, i) => (
              <div
                key={helper.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.625rem 0',
                  borderTop: '1px solid var(--hp-divider)',
                  opacity: i === currentIndex ? 1 : 0.5,
                  transition: 'opacity 0.3s ease',
                }}
              >
                {/* Avatar */}
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    background: helper.avatar
                      ? `url(${helper.avatar}) center/cover`
                      : 'var(--hp-primary-bg)',
                    color: 'var(--hp-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '.8rem',
                    fontWeight: 700,
                    flexShrink: 0,
                    overflow: 'hidden',
                  }}
                >
                  {!helper.avatar &&
                    helper.businessName
                      .split(' ')
                      .slice(0, 2)
                      .map((n) => n.charAt(0).toUpperCase())
                      .join('')}
                </div>

                {/* Name & Badge */}
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: '.8rem',
                      fontWeight: 600,
                      color: 'var(--hp-text)',
                      marginBottom: '0.125rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                    }}
                  >
                    {helper.businessName.split(' ')[0]}
                    {(helper.verified || helper.backgroundChecked) && (
                      <CheckCircle2
                        width={12}
                        height={12}
                        style={{
                          color: 'var(--hp-green)',
                          flexShrink: 0,
                        }}
                      />
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: '.7rem',
                      color: 'var(--hp-green)',
                      fontWeight: 500,
                    }}
                  >
                    ✓ Verified
                  </div>
                </div>

                {/* Price & Rating */}
                <div style={{ textAlign: 'right' }}>
                  {helper.startingPrice > 0 && (
                    <div
                      style={{
                        fontSize: '.875rem',
                        fontWeight: 700,
                        color: 'var(--hp-text)',
                        marginBottom: '0.125rem',
                      }}
                    >
                      ${helper.startingPrice}
                      {helper.startingPriceUnit === 'hour' ? '/hr' : ''}
                    </div>
                  )}
                  <div
                    style={{
                      fontSize: '.65rem',
                      color: 'var(--hp-text-muted)',
                      letterSpacing: '0.05em',
                    }}
                  >
                    {'★'.repeat(Math.round(helper.rating || 4.5))}
                  </div>
                </div>
              </div>
            ))
          : !isLoading_ && (
              <div style={{ textAlign: 'center', padding: '1rem 0', color: 'var(--hp-text-muted)' }}>
                <p style={{ fontSize: '.8rem' }}>No helpers nearby</p>
              </div>
            )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
