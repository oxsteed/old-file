import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ProfileHeader from '../components/profile/ProfileHeader';
import ProfileShareControls from '../components/helperProfile/ProfileShareControls';
import api from '../api/axios';
import PageMeta from '../components/PageMeta';
import { buildPublicProfileDescription, getPublicSiteUrl } from '../utils/seoDescription';
import { businessProfilePath } from '../utils/profileUrls';
import PublicProfileSummaryCard from '../components/publicProfile/PublicProfileSummaryCard';
import { buildPublicProfileSummaryModel } from '../utils/profileStudio';
import './BusinessPublicProfilePage.css';

/**
 * Business Public Profile Page
 * Shows public business profile with cover image at top and QR code
 */
/** Capitalize each word for display ("dayton, oh" -> "Dayton, Oh"). Data may be stored lowercase. */
function capitalizeWords(value) {
  return String(value || '')
    .split(' ')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export function normalizeBusinessPublicProfile(data) {
  const profile = data.business || data.data || data;
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return {
    ...profile,
    name: profile.name || profile.business_name,
    profilePhotoUrl: profile.profilePhotoUrl || profile.logo_url,
    coverImageUrl: profile.coverImageUrl || profile.cover_photo_url,
    rating: profile.rating ?? profile.avg_rating,
    reviewCount: profile.reviewCount ?? profile.total_reviews,
    location: capitalizeWords(profile.location || [profile.address_city, profile.address_state].filter(Boolean).join(', ')),
    teamSize: profile.teamSize ?? data.team?.length,
    jobsCompleted: profile.jobsCompleted ?? profile.completed_jobs_count,
    services: profile.services || data.services || [],
    projects: profile.projects || (data.gallery || []).map(item => ({ ...item, image: item.url, name: item.caption || item.alt || '' })),
    reviews: profile.reviews || (data.reviews || []).map(item => ({ ...item,
      customerName: [item.first_name, item.last_name].filter(Boolean).join(' '), date: item.created_at,
    })),
    hours: profile.hours || (Array.isArray(data.hours) ? Object.fromEntries(data.hours.map(item => [
      days[item.day_of_week] || String(item.day_of_week), { closed: item.is_closed, open: item.start_time, close: item.end_time },
    ])) : data.hours),
  };
}

// customerSnapshot is used only by the admin's static renderer, never mounted
// as a live customer page or enabled by a URL/query parameter.
export default function BusinessPublicProfilePage({ customerSnapshot = null } = {}) {
  const { t } = useTranslation();
  const { businessId } = useParams();
  const navigate = useNavigate();
  const [business, setBusiness] = useState(() => customerSnapshot ? normalizeBusinessPublicProfile(customerSnapshot) : null);
  const [loading, setLoading] = useState(!customerSnapshot);
  const [error, setError] = useState(null);
  const [payUrl, setPayUrl] = useState(null);

  useEffect(() => {
    if (customerSnapshot) return;
    loadBusiness();
  }, [businessId]);

  // Owner's public QR pay link; the header shows a Pay button when present.
  useEffect(() => {
    if (!business?.owner_id) return;
    let cancelled = false;
    api
      .get(`/qr-payments/public/user/${encodeURIComponent(business.owner_id)}/pay-code`)
      .then((res) => {
        if (!cancelled && res.data?.pay_url) setPayUrl(res.data.pay_url);
      })
      .catch(() => {
        /* no pay link; the Pay button stays hidden */
      });
    return () => { cancelled = true; };
  }, [business?.owner_id]);

  const loadBusiness = async () => {
    try {
      const { data } = await api.get(`/businesses/${businessId}/public`);
      const loaded = normalizeBusinessPublicProfile(data);
      // Canonicalize: when a vanity slug is claimed, the short URL is canonical.
      const slug = loaded.profile_slug || loaded.profileSlug;
      if (slug && slug !== String(businessId)) {
        navigate(businessProfilePath({ businessId: slug }), { replace: true });
      }
      setBusiness(loaded);
    } catch (err) {
      setError(err.response?.data?.error || err.message || t('businessPublicProfile.notFound'));
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="page-loading">{t('businessPublicProfile.loading')}</div>;
  if (error || !business) {
    return (
      <>
        <PageMeta
          title={t('businessPublicProfile.notFound')}
          description={t('businessPublicProfile.notFound')}
          url={`${getPublicSiteUrl()}/businesses/public/${businessId}`}
          noIndex
        />
        <div className="page-error">{error || t('businessPublicProfile.notFound')}</div>
      </>
    );
  }

  return (
    <div className="business-public-profile">
      {!customerSnapshot && <PageMeta
        title={business.name || business.business_name}
        description={buildPublicProfileDescription({
          displayName: business.name || business.business_name,
          tagline: business.headline || business.profile_headline,
          bio: business.description,
          city: business.location?.split(',')[0] || business.address_city,
          state: business.location?.split(',')[1]?.trim() || business.address_state,
          entityLabel: 'business',
        })}
        image={business.coverImageUrl || business.cover_photo_url || business.profilePhotoUrl || business.logo_url}
        url={`${getPublicSiteUrl()}${businessProfilePath(business)}`}
        type="profile"
      />}
      {/* Cover image (compact branded band when there is no cover photo) */}
      <ProfileHeader
        coverImageUrl={business.coverImageUrl || business.cover_photo_url}
      />

      {/* Main Profile Content */}
      <div className="profile-container">
        <div className="profile-main">
          {/* Business Info — shared summary with Profile Studio preview */}
          <PublicProfileSummaryCard
            {...buildPublicProfileSummaryModel({
              variant: 'business',
              cover: null,
              avatar: business.profilePhotoUrl,
              name: business.name || business.business_name || '',
              tagline: business.headline || business.profile_headline || '',
              meta: business.location || '',
              contact: [
                business.phone,
                business.email,
                business.teamSize
                  ? t('businessPublicProfile.teamMembers', { count: business.teamSize })
                  : '',
              ].filter(Boolean).join(' · '),
              about: business.description || '',
              ratingLabel: business.reviewCount > 0 && business.rating != null
                ? `${business.rating} (${t('businessPublicProfile.reviewCount', { count: business.reviewCount })})`
                : t('businessPublicProfile.noReviewsYet'),
            })}
            surface="public"
            footer={(
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <button className="cta-button" type="button" onClick={() => navigate(`/book/business/${businessId}`)}>
                    {t('businessProfile.contactBusiness')}
                  </button>
                  {payUrl && (
                    <a className="cta-button cta-button-secondary" href={payUrl} style={{ textDecoration: 'none' }}>
                      {t('businessProfile.pay', { defaultValue: 'Pay' })}
                    </a>
                  )}
                </div>
                <ProfileShareControls
                  shareUrl={`${getPublicSiteUrl()}${businessProfilePath(business)}`}
                  shareTitle={business.name || business.business_name || ''}
                  i18nPrefix="businessProfile"
                  qrImageUrl={`/api/business-profile/${encodeURIComponent(business.id || businessId)}/qr-code?size=medium&format=png`}
                />
              </div>
            )}
          />

          {/* Services */}
          <div className="profile-card">
            <h2>{t('businessPublicProfile.servicesOffered')}</h2>
            {business.services && business.services.length > 0 ? (
              <div className="services-grid">
                {business.services.map(service => (
                  <div key={service.id} className="service-card">
                    <h3>{service.name}</h3>
                    <p>{service.description}</p>
                    <span className="service-price">${service.price}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="profile-empty">{t('businessPublicProfile.servicesEmpty')}</p>
            )}
          </div>

          {/* Portfolio/Projects */}
          <div className="profile-card">
            <h2>{t('businessPublicProfile.recentWork')}</h2>
            {business.projects && business.projects.length > 0 ? (
              <div className="projects-grid">
                {business.projects.map(project => (
                  <div key={project.id} className="project-item">
                    <img src={project.image} alt={project.name} />
                    <h4>{project.name}</h4>
                  </div>
                ))}
              </div>
            ) : (
              <p className="profile-empty">{t('businessPublicProfile.recentWorkEmpty')}</p>
            )}
          </div>

          {/* Reviews */}
          <div className="profile-card">
            <h2>{t('businessPublicProfile.customerReviews')}</h2>
            {business.reviews && business.reviews.length > 0 ? business.reviews.map(review => (
              <div key={review.id} className="review-item">
                <div className="review-header">
                  <span className="reviewer-name">{review.customerName}</span>
                  <span className="review-rating">★ {review.rating}</span>
                </div>
                <p className="review-text">{review.comment}</p>
                <span className="review-date">{review.date}</span>
              </div>
            )) : (
              <p className="profile-empty">{t('businessPublicProfile.reviewsEmpty')}</p>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <aside className="profile-sidebar">
          {/* Hours Card */}
          <div className="sidebar-card">
            <h3>{t('businessPublicProfile.businessHours')}</h3>
            {business.hours && Object.keys(business.hours).length > 0 ? (
              <div className="hours-list">
                {Object.entries(business.hours as Record<string, any>).map(([day, hours]) => (
                  <div key={day} className="hour-item">
                    <span className="day">{day}</span>
                    <span className="time">
                      {hours?.closed ? t('businessPublicProfile.closed') : `${hours?.open} - ${hours?.close}`}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="profile-empty">{t('businessPublicProfile.hoursEmpty')}</p>
            )}
          </div>

          {/* Stats Card */}
          <div className="sidebar-card">
            <h3>{t('businessPublicProfile.stats')}</h3>
            <div className="stats-grid">
              <div className="stat">
                <span className="stat-value">{business.jobsCompleted ?? '—'}</span>
                <span className="stat-label">{t('businessPublicProfile.jobsCompleted')}</span>
              </div>
              <div className="stat">
                <span className="stat-value">{business.yearsInBusiness ?? '—'}</span>
                <span className="stat-label">{t('businessPublicProfile.yearsInBusiness')}</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
