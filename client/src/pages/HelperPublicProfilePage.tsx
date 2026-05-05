import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ProfileHeader from '../components/profile/ProfileHeader';
import QRCodeDisplay from '../components/profile/QRCodeDisplay';
import { Star, MapPin, Phone, Mail } from 'lucide-react';
import './HelperPublicProfilePage.css';

/**
 * Helper Public Profile Page
 * Shows public helper profile with cover image at top and QR code
 */
export default function HelperPublicProfilePage() {
  const { t } = useTranslation();
  const { helperId } = useParams();
  const [helper, setHelper] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showQRSection, setShowQRSection] = useState(false);

  useEffect(() => {
    loadHelperProfile();
  }, [helperId]);

  const loadHelperProfile = async () => {
    try {
      const response = await fetch(`/api/helpers/${helperId}/profile`);
      if (response.ok) {
        const data = await response.json();
        setHelper(data.data);
      } else {
        setError('Helper not found');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="page-loading">Loading profile...</div>;
  if (error) return <div className="page-error">{error}</div>;
  if (!helper) return <div className="page-error">Helper not found</div>;

  return (
    <div className="helper-public-profile">
      {/* COVER IMAGE WITH QR OVERLAY - AT TOP */}
      <ProfileHeader
        helperId={helperId}
        helperName={`${helper.firstName} ${helper.lastName}`}
        coverImageUrl={helper.coverImageUrl}
      />

      {/* Main Profile Content */}
      <div className="profile-container">
        <div className="profile-main">
          {/* Helper Info */}
          <div className="profile-card">
            <div className="helper-header">
              <img
                src={helper.profilePhotoUrl}
                alt={helper.firstName}
                className="helper-avatar"
              />
              <div className="helper-info">
                <h1>{helper.firstName} {helper.lastName}</h1>
                <div className="helper-rating">
                  <Star size={18} fill="gold" color="gold" />
                  <span>{helper.rating} ({helper.reviewCount} reviews)</span>
                </div>
              </div>
            </div>

            <p className="helper-bio">{helper.bio}</p>

            {/* Contact Info */}
            <div className="contact-info">
              {helper.location && (
                <div className="contact-item">
                  <MapPin size={18} />
                  <span>{helper.location}</span>
                </div>
              )}
              {helper.phone && (
                <div className="contact-item">
                  <Phone size={18} />
                  <span>{helper.phone}</span>
                </div>
              )}
              {helper.email && (
                <div className="contact-item">
                  <Mail size={18} />
                  <span>{helper.email}</span>
                </div>
              )}
            </div>

            {/* CTA Button */}
            <button className="cta-button">
              {t('booking.bookNow')}
            </button>
          </div>

          {/* Services */}
          <div className="profile-card">
            <h2>Services</h2>
            <div className="services-list">
              {helper.services && helper.services.map(service => (
                <div key={service.id} className="service-item">
                  <h4>{service.name}</h4>
                  <p>{service.description}</p>
                  <span className="service-price">${service.rate}/hr</span>
                </div>
              ))}
            </div>
          </div>

          {/* Reviews */}
          <div className="profile-card">
            <h2>Reviews</h2>
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
              helperName={`${helper.firstName} ${helper.lastName}`}
            />
          </div>

          {/* Pricing Card */}
          <div className="sidebar-card">
            <h3>Pricing</h3>
            <div className="pricing-item">
              <span>Starting at</span>
              <span className="price">${helper.startingRate}/hour</span>
            </div>
          </div>

          {/* Availability Badge */}
          <div className="sidebar-card">
            <h3>Availability</h3>
            <div className={`availability-badge ${helper.isAvailable ? 'available' : 'unavailable'}`}>
              {helper.isAvailable ? 'Available Now' : 'Unavailable'}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
