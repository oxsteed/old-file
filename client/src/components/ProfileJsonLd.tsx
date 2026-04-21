import { Helmet } from 'react-helmet-async';
import type { HelperProfile, LocationInfo, Service } from '../types/helperProfile';
import { getPublicSiteUrl, toAbsoluteUrl } from '../utils/seoDescription';

type ProfileJsonLdProps =
  | {
      variant: 'helper';
      helperId: string;
      helper: HelperProfile;
      location: LocationInfo;
      services: Service[];
    }
  | {
      variant: 'business';
      businessId: number | string;
      helper: HelperProfile;
      location: LocationInfo;
      services: Service[];
    };

export default function ProfileJsonLd(props: ProfileJsonLdProps) {
  const origin = getPublicSiteUrl();
  const { helper, location, services } = props;

  if (props.variant === 'helper') {
    const profileUrl = `${origin}/helpers/${props.helperId}`;
    const knowsAbout = [
      ...helper.categories,
      ...services.map((s) => s.name).filter(Boolean),
    ].slice(0, 24);

    const data = {
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: helper.businessName,
      description: helper.bio || helper.tagline || undefined,
      image: helper.avatar ? toAbsoluteUrl(helper.avatar) : undefined,
      url: profileUrl,
      jobTitle: helper.tagline || undefined,
      address:
        location.city || location.state
          ? {
              '@type': 'PostalAddress',
              addressLocality: location.city || undefined,
              addressRegion: location.state || undefined,
              addressCountry: 'US',
            }
          : undefined,
      areaServed: {
        '@type': 'AdministrativeArea',
        name: [location.city, location.state].filter(Boolean).join(', ') || 'United States',
      },
      knowsAbout: knowsAbout.length ? knowsAbout : undefined,
      aggregateRating:
        helper.reviewCount > 0
          ? {
              '@type': 'AggregateRating',
              ratingValue: helper.rating,
              reviewCount: helper.reviewCount,
              bestRating: 5,
            }
          : undefined,
    };

    return (
      <Helmet>
        <script type="application/ld+json">{JSON.stringify(data)}</script>
      </Helmet>
    );
  }

  const profileUrl = `${origin}/business/${props.businessId}`;
  const data = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: helper.businessName,
    description: helper.bio || helper.tagline || undefined,
    image: (helper.coverImage || helper.avatar) ? toAbsoluteUrl(helper.coverImage || helper.avatar) : undefined,
    url: profileUrl,
    address:
      location.city || location.state
        ? {
            '@type': 'PostalAddress',
            addressLocality: location.city || undefined,
            addressRegion: location.state || undefined,
            addressCountry: 'US',
          }
        : undefined,
    areaServed: {
      '@type': 'AdministrativeArea',
      name: [location.city, location.state].filter(Boolean).join(', ') || 'United States',
    },
    aggregateRating:
      helper.reviewCount > 0
        ? {
            '@type': 'AggregateRating',
            ratingValue: helper.rating,
            reviewCount: helper.reviewCount,
            bestRating: 5,
          }
        : undefined,
    hasOfferCatalog:
      services.length > 0
        ? {
            '@type': 'OfferCatalog',
            name: 'Services',
            itemListElement: services.slice(0, 20).map((s) => ({
              '@type': 'Offer',
              itemOffered: { '@type': 'Service', name: s.name },
            })),
          }
        : undefined,
  };

  return (
    <Helmet>
      <script type="application/ld+json">{JSON.stringify(data)}</script>
    </Helmet>
  );
}
