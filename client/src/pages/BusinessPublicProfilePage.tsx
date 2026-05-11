import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ProfileHeader from '../components/profile/ProfileHeader';
import QRCodeDisplay from '../components/profile/QRCodeDisplay';
import { Star, MapPin, Phone, Mail, Users } from 'lucide-react';
import './BusinessPublicProfilePage.css';

/**
 * Business Public Profile Page
 * Shows public business profile with cover image at top and QR code
 */
export default function BusinessPublicProfilePage() {
  const { t } = useTranslation();
  const { businessId } = useParams();
  const [business, setBusiness] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadBusiness();
  }, [businessId]);

  const loadBusiness = async () => {
    try {
      const response = await fetch(`/api/businesses/${businessId}/public`);
      if (response.ok) {
        const data = await response.json();
        setBusiness(data.data);
      } else {
        setError(t('businessPublicProfile.notFound'));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="page-loading">{t('businessPublicProfile.loading')}</div>;
  if (error) return <div className="page-error">{error}</div>;
  if (!business) return <div className="page-error">{t('businessPublicProfile.notFound')}</div>;

  return (
    <div className="business-public-profile">
      {/* COVER IMAGE WITH QR OVERLAY - AT TOP */}
      <ProfileHeader
        helperId={businessId}
        helperName={business.name}
        coverImageUrl={business.coverImageUrl}
      />

      {/* Main Profile Content */}
      <div className="profile-container">
        <div className="profile-main">
          {/* Business Info */}
          <div className="profile-card">
            <div className="business-header">
              <img
                src={business.profilePhotoUrl}
                alt={business.name}
                className="business-logo"
              />
              <div className="business-info">
                <h1>{business.name}</h1>
                <div className="business-rating">
                  <Star size={18} fill="gold" color="gold" />
                  <span>{business.rating} ({t('businessPublicProfile.reviewCount', { count: business.reviewCount })})</span>
                </div>
              </div>
            </div>

            <p className="business-description">{business.description}</p>

            {/* Contact Info */}
            <div className="contact-info">
              {business.location && (
                <div className="contact-item">
                  <MapPin size={18} />
                  <span>{business.location}</span>
                </div>
              )}
              {business.phone && (
                <div className="contact-item">
                  <Phone size={18} />
                  <span>{business.phone}</span>
                </div>
              )}
              {business.email && (
                <div className="contact-item">
                  <Mail size={18} />
                  <span>{business.email}</span>
                </div>
              )}
              {business.teamSize && (
                <div className="contact-item">
                  <Users size={18} />
                  <span>{t('businessPublicProfile.teamMembers', { count: business.teamSize })}</span>
                </div>
              )}
            </div>

            {/* CTA Button */}
            <button className="cta-button">
              {t('businessProfile.contactBusiness')}
            </button>
          </div>

          {/* Services */}
          <div className="profile-card">
            <h2>{t('businessPublicProfile.servicesOffered')}</h2>
            <div className="services-grid">
              {business.services && business.services.map(service => (
                <div key={service.id} className="service-card">
                  <h3>{service.name}</h3>
                  <p>{service.description}</p>
                  <span className="service-price">${service.price}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Portfolio/Projects */}
          <div className="profile-card">
            <h2>{t('businessPublicProfile.recentWork')}</h2>
            <div className="projects-grid">
              {business.projects && business.projects.map(project => (
                <div key={project.id} className="project-item">
                  <img src={project.image} alt={project.name} />
                  <h4>{project.name}</h4>
                </div>
              ))}
            </div>
          </div>

          {/* Reviews */}
          <div className="profile-card">
            <h2>{t('businessPublicProfile.customerReviews')}</h2>
            {business.reviews && business.reviews.map(review => (
              <div key={review.id} className="review-item">
                <div className="review-header">
                  <span className="reviewer-name">{review.customerName}</span>
                  <span className="review-rating">★ {review.rating}</span>
                </div>
                <p className="review-text">{review.comment}</p>
                <span className="review-date">{review.date}</span>
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
              helperId={businessId}
              helperName={business.name}
            />
          </div>

          {/* Hours Card */}
          <div className="sidebar-card">
            <h3>{t('businessPublicProfile.businessHours')}</h3>
            <div className="hours-list">
              {business.hours && Object.entries(business.hours).map(([day, hours]) => (
                <div key={day} className="hour-item">
                  <span className="day">{day}</span>
                  <span className="time">
                    {hours.closed ? t('businessPublicProfile.closed') : `${hours.open} - ${hours.close}`}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Stats Card */}
          <div className="sidebar-card">
            <h3>{t('businessPublicProfile.stats')}</h3>
            <div className="stats-grid">
              <div className="stat">
                <span className="stat-value">{business.jobsCompleted}</span>
                <span className="stat-label">{t('businessPublicProfile.jobsCompleted')}</span>
              </div>
              <div className="stat">
                <span className="stat-value">{business.yearsInBusiness}</span>
                <span className="stat-label">{t('businessPublicProfile.yearsInBusiness')}</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
