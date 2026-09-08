import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ProfileHeader from '../components/profile/ProfileHeader';
import QRCodeDisplay from '../components/profile/QRCodeDisplay';
import { Star, MapPin } from 'lucide-react';
import api from '../api/axios';
import PageMeta from '../components/PageMeta';
import { buildPublicProfileDescription, getPublicSiteUrl } from '../utils/seoDescription';
import './HelperPublicProfilePage.css';

/**
 * Helper Public Profile Page
 * Shows public helper profile with cover image at top and QR code
 */
export default function HelperPublicProfilePage() {
  const { t } = useTranslation();
  const { helperId } = useParams();
  const navigate = useNavigate();
  const [helper, setHelper] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showQRSection, setShowQRSection] = useState(false);

  useEffect(() => {
    loadHelperProfile();
  }, [helperId]);

  const loadHelperProfile = async () => {
    try {
      const { data } = await api.get(`/helpers/${helperId}/profile`);
      const profile = data.helper || data.data || data;
      setHelper({ ...profile, services: data.services || profile.services || [] });
    } catch (err) {
      setError(err.response?.data?.error || err.message || t('publicProfile.notFound'));
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="page-loading">{t('publicProfile.loading')}</div>;
  if (error || !helper) {
    return (
      <>
        <PageMeta
          title={t('publicProfile.notFound')}
          description={t('publicProfile.notFound')}
          url={`${getPublicSiteUrl()}/helpers/public/${helperId}`}
          noIndex
        />
        <div className="page-error">{error || t('publicProfile.notFound')}</div>
      </>
    );
  }

  const displayName = helper.businessName || helper.ownerName || t('common.helper');
  const profilePhoto = helper.profilePhotoUrl || helper.avatar;
  const coverImage = helper.coverImageUrl || helper.coverImage;
  const location = [helper.city, helper.state].filter(Boolean).join(', ');
  const services = helper.services || [];
  const startingRate = helper.startingRate || services.find((service) => service.price)?.price;
  const isAvailable = helper.isAvailableNow || helper.availabilityStatus === 'online';

  return (
    <div className="helper-public-profile">
      <PageMeta
        title={displayName}
        description={buildPublicProfileDescription({
          displayName,
          tagline: helper.tagline,
          bio: helper.bio,
          city: helper.city,
          state: helper.state,
          entityLabel: 'helper',
        })}
        image={coverImage || profilePhoto}
        url={`${getPublicSiteUrl()}/helpers/public/${helperId}`}
        type="profile"
      />
      {/* COVER IMAGE WITH QR OVERLAY - AT TOP */}
      <ProfileHeader
        helperId={helperId}
        helperName={displayName}
        coverImageUrl={coverImage}
      />

      {/* Main Profile Content */}
      <div className="profile-container">
        <div className="profile-main">
          {/* Helper Info */}
          <div className="profile-card">
            <div className="helper-header">
              <img
                src={profilePhoto}
                alt={displayName}
                className="helper-avatar"
              />
              <div className="helper-info">
                <h1>{displayName}</h1>
                <div className="helper-rating">
                  <Star size={18} fill="gold" color="gold" />
                  <span>{helper.rating} ({t('publicProfile.reviewCount', { count: helper.reviewCount })})</span>
                </div>
              </div>
            </div>

            <p className="helper-bio">{helper.bio}</p>

            {/* Contact Info */}
            <div className="contact-info">
              {location && (
                <div className="contact-item">
                  <MapPin size={18} />
                  <span>{location}</span>
                </div>
              )}
            </div>

            {/* CTA Button */}
            <button className="cta-button" onClick={() => navigate(`/book/${helperId}`)}>
              {t('booking.bookNow')}
            </button>
          </div>

          {/* Services */}
          <div className="profile-card">
            <h2>{t('helperProfile.services.title')}</h2>
            <div className="services-list">
              {services.map(service => (
                <div key={service.id} className="service-item">
                  <h4>{service.name}</h4>
                  <p>{service.description}</p>
                  <span className="service-price">{t('jobDetail.hourlyRate', { amount: `$${service.price}` })}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Reviews */}
          <div className="profile-card">
            <h2>{t('publicProfile.reviews')}</h2>
            {helper.reviews && helper.reviews.map(review => (
              <div key={review.id} className="review-item">
                <div className="review-header">
                  <span className="reviewer-name">{review.customerName}</span>
                  <span className="review-rating">★ {review.rating}</span>
                </div>
                <p className="review-text">{review.comment}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Sidebar */}
        <aside className="profile-sidebar">
          {/* QR Code Section */}
          <div className="sidebar-card">
            <h3>{t('profile.qrCode.title')}</h3>
            <QRCodeDisplay
              helperId={helperId}
              helperName={displayName}
            />
          </div>

          {/* Pricing Card */}
          <div className="sidebar-card">
            <h3>{t('helpersDir.pricePerHour')}</h3>
            <div className="pricing-item">
              <span>{t('helpersDir.priceStartingAt')}</span>
              <span className="price">{startingRate ? t('jobDetail.hourlyRate', { amount: `$${startingRate}` }) : t('common.notProvided')}</span>
            </div>
          </div>

          {/* Availability Badge */}
          <div className="sidebar-card">
            <h3>{t('helperProfile.hours.title')}</h3>
            <div className={`availability-badge ${isAvailable ? 'available' : 'unavailable'}`}>
              {isAvailable ? t('helpersDir.available') : t('common.unavailable')}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
