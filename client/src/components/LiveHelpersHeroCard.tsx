import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2 } from 'lucide-react';
import { useHelpersInfiniteScroll } from '../hooks/useHelpersInfiniteScroll';
import type { Helper } from '../hooks/useHelpersInfiniteScroll';
import { getSharedBrowserLocation } from '../utils/browserLocation';
import { helperProfilePath, businessProfilePath } from '../utils/profileUrls';

const FALLBACK_LAT = 39.921923;
const FALLBACK_LNG = -82.998619;
const MAX_PREVIEW_LABELS = 4;

function initialsFromName(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n.charAt(0).toUpperCase())
    .join('');
}

function profilePath(row: Helper): string {
  if (row.profileUrl) return row.profileUrl;
  const slug = (row as any).profileSlug || (row as any).profile_slug;
  if (row.type === 'business' && row.businessId != null) return businessProfilePath({ businessId: row.businessId, profileSlug: slug });
  return helperProfilePath({ id: row.id, profileSlug: slug });
}

function mergeSkillServiceLabels(row: Helper): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: string | undefined | null) => {
    const t = String(s || '').trim();
    if (!t || seen.has(t.toLowerCase())) return;
    seen.add(t.toLowerCase());
    out.push(t);
  };
  for (const s of row.skills || []) push(s);
  for (const s of row.topServices || []) {
    if (typeof s === 'string') push(s);
    else if (s && typeof s === 'object' && 'name' in s) push((s as { name?: string }).name);
  }
  if (out.length === 0) {
    for (const c of row.categories || []) push(c);
  }
  return out.slice(0, MAX_PREVIEW_LABELS);
}

export default function LiveHelpersHeroCard() {
  const { t } = useTranslation();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [displayedHelpers, setDisplayedHelpers] = useState<Helper[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return undefined;
    if (!('IntersectionObserver' in window)) {
      setIsVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setIsVisible(true);
      observer.disconnect();
    }, { rootMargin: '200px 0px' });
    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  const { helpers, businesses, restaurants, isLoading, fetchNextPage, hasMore, isFetchingNextPage } = useHelpersInfiniteScroll({
    latitude: userLocation?.lat,
    longitude: userLocation?.lng,
    limit: 10,
    radius: 60,
    enabled: isVisible && !!userLocation,
    includeRestaurants: true,
  });

  const mergedRows = useMemo(() => {
    const seen = new Set<string>();
    const out: Helper[] = [];
    for (const h of helpers) {
      if (seen.has(h.id)) continue;
      seen.add(h.id);
      out.push(h);
    }
    for (const b of businesses) {
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      out.push(b);
    }
    for (const r of restaurants || []) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
    }
    return out;
  }, [helpers, businesses, restaurants]);

  useEffect(() => {
    if (mergedRows.length > 0) {
      setDisplayedHelpers(mergedRows);
    }
  }, [mergedRows]);

  useEffect(() => {
    if (hasMore && !isFetchingNextPage && helpers.length > 0 && mergedRows.length < 25) {
      fetchNextPage();
    }
  }, [hasMore, isFetchingNextPage, helpers.length, mergedRows.length, fetchNextPage]);

  useEffect(() => {
    if (!isVisible) return undefined;
    let active = true;
    void getSharedBrowserLocation().then((location) => {
      if (!active) return;
      setUserLocation(location || { lat: FALLBACK_LAT, lng: FALLBACK_LNG });
    });
    return () => { active = false; };
  }, [isVisible]);

  useEffect(() => {
    if (displayedHelpers.length === 0) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % displayedHelpers.length);
    }, 5000);

    return () => clearInterval(interval);
  }, [displayedHelpers.length]);

  const isFallbackLocation =
    userLocation ? userLocation.lat === FALLBACK_LAT && userLocation.lng === FALLBACK_LNG : false;
  const location = isFallbackLocation ? t('liveHelpers.usingFallbackLocation') : t('homePage.search.nearYou');
  const badgeLabel =
    displayedHelpers.length > 0
      ? t('liveHelpers.onlineCount', { count: Math.min(displayedHelpers.length, 99) })
      : t('common:loading');
  const isLoading_ = isLoading || !userLocation;

  return (
    <div
      ref={cardRef}
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
            {t('liveHelpers.heroCardTitle')}
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
              <span style={{ opacity: 0.4 }}>{t('common:loading')}</span>
            ) : (
              <span>{t('liveHelpers.availableNow')}</span>
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

        {displayedHelpers.length > 0 ? (
          <div style={{ maxHeight: '210px', overflowY: 'auto' }}>
            {displayedHelpers.map((helper, i) => {
              const isBusiness = helper.type === 'business';
              const isRestaurant = helper.type === 'restaurant';
              const displayName = helper.businessName || helper.ownerName || '';
              const preview = mergeSkillServiceLabels(helper);
              const to = profilePath(helper);
              return (
                <Link
                  key={helper.id}
                  to={to}
                  aria-label={t('liveHelpers.viewProfileAria', { name: displayName })}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.75rem',
                    padding: '0.625rem 0',
                    borderTop: '1px solid var(--hp-divider)',
                    opacity: i === currentIndex ? 1 : 0.5,
                    transition: 'opacity 0.3s ease',
                    textDecoration: 'none',
                    color: 'inherit',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      background: helper.avatar
                        ? `url('${helper.avatar.replace(/'/g, "\\'")}') center/cover`
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
                    {!helper.avatar && initialsFromName(displayName)}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: '.8rem',
                        fontWeight: 600,
                        color: 'var(--hp-text)',
                        marginBottom: '0.125rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        flexWrap: 'wrap',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '.62rem',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                          padding: '2px 6px',
                          borderRadius: '999px',
                          background: isRestaurant
                            ? 'rgba(249,115,22,0.18)'
                            : isBusiness
                              ? 'rgba(99,102,241,0.2)'
                              : 'rgba(34,197,94,0.15)',
                          color: isRestaurant ? '#fdba74' : isBusiness ? '#a5b4fc' : 'var(--hp-green)',
                        }}
                      >
                        {isRestaurant
                          ? t('liveHelpers.badgeRestaurant')
                          : isBusiness
                            ? t('liveHelpers.badgeBusiness')
                            : t('liveHelpers.badgeHelper')}
                      </span>
                      <span className="truncate">{displayName.split(' ')[0]}</span>
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
                    {(helper.verified || helper.backgroundChecked) && (
                      <div
                        style={{
                          fontSize: '.7rem',
                          color: 'var(--hp-green)',
                          fontWeight: 500,
                          marginBottom: preview.length ? '0.25rem' : 0,
                        }}
                      >
                        ✓ {t('liveHelpers.verified')}
                      </div>
                    )}
                    {preview.length > 0 && (
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '0.25rem',
                          marginTop: '0.125rem',
                        }}
                      >
                        {preview.map((label) => (
                          <span
                            key={label}
                            style={{
                              fontSize: '.62rem',
                              lineHeight: 1.2,
                              padding: '2px 6px',
                              borderRadius: '6px',
                              background: 'var(--hp-surface-1, rgba(0,0,0,0.06))',
                              border: '1px solid var(--hp-divider)',
                              color: 'var(--hp-text-muted)',
                              maxWidth: '100%',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                            title={label}
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
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
                </Link>
              );
            })}
          </div>
        ) : (
          !isLoading_ && (
            <div style={{ textAlign: 'center', padding: '1rem 0', color: 'var(--hp-text-muted)' }}>
              <p style={{ fontSize: '.8rem' }}>{t('liveHelpers.noNearby')}</p>
            </div>
          )
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
