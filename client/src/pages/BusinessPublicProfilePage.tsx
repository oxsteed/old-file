import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import ProfileHeader from '../components/profile/ProfileHeader';
import ProfileShareControls from '../components/helperProfile/ProfileShareControls';
import PublicProfileMessenger from '../components/helperProfile/chat/PublicProfileMessenger.jsx';
import ProfileJsonLd from '../components/ProfileJsonLd';
import api from '../api/axios';
import PageMeta from '../components/PageMeta';
import { buildPublicProfileDescription, getPublicSiteUrl } from '../utils/seoDescription';
import { businessProfilePath } from '../utils/profileUrls';
import PublicProfileSummaryCard from '../components/publicProfile/PublicProfileSummaryCard';
import { buildPublicProfileSummaryModel } from '../utils/profileStudio';
import MediaProfilePreview from '../components/media/MediaProfilePreview';
import './BusinessPublicProfilePage.css';

/**
 * Business Public Profile Page (admin customer-snapshot renderer).
 *
 * Live public business URLs (/b/:id, /businesses/public/:id, /business/:id)
 * all render BusinessProfilePage (GV-1: one canonical page). This component
 * is kept for the admin customer-preview snapshot and for
 * normalizeBusinessPublicProfile, and mirrors the same owner-free contract:
 * Pay/status come from business-scoped endpoints, never the owner's id.
 */
/** Capitalize each word for display ("dayton, oh" -> "Dayton, Oh"). Data may be stored lowercase. */
function capitalizeWords(value) {
  return String(value || '')
    .split(' ')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Single collapsible FAQ row, styled for this page's theme tokens. */
function FaqItem({ faq }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="faq-item">
      <button
        type="button"
        className="faq-question"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span>{faq.question}</span>
        <span className="faq-chevron" aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open && <p className="faq-answer">{faq.answer}</p>}
    </div>
  );
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
    faqs: profile.faqs || data.faqs || [],
    policies: profile.policies || data.policies || [],
    // Guest-contact gate: the API returns allow_guest_contact (businessController).
    // Default true when absent, for back-compat with the pre-flag response.
    allowGuestContact: profile.allow_guest_contact !== false,
    allowLiveChat: profile.allow_live_chat !== false,
    // Section visibility flags (businesses table, migration 730). Default true
    // when absent, for back-compat with the API before the flags were exposed.
    showServices: profile.show_services !== false,
    showFaqs: profile.show_faqs !== false,
    showPolicies: profile.show_policies !== false,
    showGallery: profile.show_gallery !== false,
    showHours: profile.show_hours !== false,
  };
}

// customerSnapshot is used only by the admin's static renderer, never mounted
// as a live customer page or enabled by a URL/query parameter.
export default function BusinessPublicProfilePage({ customerSnapshot = null } = {}) {
  const { t } = useTranslation();
  const { businessId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [business, setBusiness] = useState(() => customerSnapshot ? normalizeBusinessPublicProfile(customerSnapshot) : null);
  const [loading, setLoading] = useState(!customerSnapshot);
  const [error, setError] = useState(null);
  const [payUrl, setPayUrl] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [guestSignInModalOpen, setGuestSignInModalOpen] = useState(false);

  useEffect(() => {
    if (customerSnapshot) return;
    loadBusiness();
  }, [businessId]);

  // Owner's public QR pay link; the header shows a Pay button when present.
  const payBusinessId = business?.id;
  useEffect(() => {
    if (!payBusinessId || customerSnapshot) return;
    let cancelled = false;
    api
      .get(`/qr-payments/public/business/${encodeURIComponent(payBusinessId)}/pay-code`)
      .then((res) => {
        if (!cancelled && res.data?.pay_url) setPayUrl(res.data.pay_url);
      })
      .catch(() => {
        /* no pay link; the Pay button stays hidden */
      });
    return () => { cancelled = true; };
  }, [payBusinessId, customerSnapshot]);

  const loadBusiness = async () => {
    try {
      const { data } = await api.get(`/businesses/${businessId}/public`);
      const loaded = normalizeBusinessPublicProfile(data);
      // Canonicalize: when a vanity slug is claimed, the short URL is canonical.
      const slug = loaded.profile_slug || loaded.profileSlug;
      if (slug && slug !== String(businessId)) {
        navigate(businessProfilePath({ businessId, slug }), { replace: true });
      }
      setBusiness(loaded);
    } catch (err) {
      setError(err.response?.data?.error || err.message || t('businessPublicProfile.notFound'));
    } finally {
      setLoading(false);
    }
  };

  // Guest messenger: mirrors BusinessProfilePage's handleOpenChat. Signed-in
  // users open the dock directly; guests open it only when the business
  // allows guest contact, otherwise they get the sign-in prompt.
  const handleOpenChat = () => {
    if (user) {
      setChatOpen(true);
      return;
    }
    if (business?.allowGuestContact !== false) {
      setChatOpen(true);
    } else {
      setGuestSignInModalOpen(true);
    }
  };

  const chatSession = business
    ? {
        id: `session_business_${business.id || businessId}`,
        destination: 'business',
        status: 'ai_assistant',
        helperStatus: 'ai_assistant',
        oxsteedStatus: 'ai_assistant',
        timeline: [],
        typing: null,
      }
    : null;

  if (loading) return <div className="page-loading">{t('businessPublicProfile.loading')}</div>;
  if (error || !business) {
    return (
      <>
        <PageMeta
          title={t('businessPublicProfile.notFound')}
          description={t('businessPublicProfile.notFound')}
          url={`${getPublicSiteUrl()}${businessProfilePath({ businessId })}`}
          noIndex
        />
        <div className="page-error">{error || t('businessPublicProfile.notFound')}</div>
      </>
    );
  }

  return (
    <div className="business-public-profile">
      {!customerSnapshot && (
        <>
          <PageMeta
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
          />
          <ProfileJsonLd
            variant="business"
            businessId={business.id || businessId}
            helper={
              {
                id: String(business.id || businessId || ''),
                businessName: business.name || business.business_name || '',
                ownerName: '',
                bio: business.description || '',
                tagline: business.headline || business.profile_headline || '',
                avatar: business.profilePhotoUrl || business.logo_url || '',
                coverImage: business.coverImageUrl || business.cover_photo_url || '',
                rating: business.rating ?? 0,
                reviewCount: business.reviewCount ?? 0,
                jobsCompleted: business.jobsCompleted ?? 0,
                memberSince: '',
                verified: false,
                responseTime: '',
                responseRate: 0,
                badges: [],
                categories: [],
                // Extra slug key so ProfileJsonLd emits the canonical /b/:slug URL.
                profile_slug: business.profile_slug || business.profileSlug || undefined,
              } as React.ComponentProps<typeof ProfileJsonLd>['helper']
            }
            location={{
              city: business.location?.split(',')[0]?.trim() || business.address_city || '',
              state: business.location?.split(',')[1]?.trim() || business.address_state || '',
              zip: '',
              serviceRadius: 0,
              radiusUnit: 'miles',
              servesRemotely: false,
            }}
            services={(business.services || []).map((s) => ({ name: s.name }))}
          />
        </>
      )}
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
                  {(user || business.allowGuestContact !== false) && (
                    <button className="cta-button cta-button-secondary" type="button" onClick={handleOpenChat}>
                      {t('businessPublicProfile.messageBusiness')}
                    </button>
                  )}
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

          <MediaProfilePreview
            handle={business.profile_slug || business.profileSlug || `business-${business.id || businessId}`}
          />

          {/* Services */}
          {business.showServices && (
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
          )}

          {/* Portfolio/Projects */}
          {business.showGallery && (
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
          )}

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

          {/* FAQs */}
          {business.showFaqs && (
          <div className="profile-card">
            <h2>{t('businessPublicProfile.faqsTitle')}</h2>
            {business.faqs && business.faqs.length > 0 ? (
              <div className="faqs-list">
                {business.faqs.map((faq) => (
                  <FaqItem key={faq.id} faq={faq} />
                ))}
              </div>
            ) : (
              <p className="profile-empty">{t('businessPublicProfile.faqsEmpty')}</p>
            )}
          </div>
          )}

          {/* Policies */}
          {business.showPolicies && (
          <div className="profile-card">
            <h2>{t('businessPublicProfile.policiesTitle')}</h2>
            {business.policies && business.policies.length > 0 ? (
              <dl className="policies-list">
                {business.policies.map((policy) => (
                  <div key={policy.id} className="policy-item">
                    <dt>{policy.title}</dt>
                    <dd>{policy.content}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="profile-empty">{t('businessPublicProfile.policiesEmpty')}</p>
            )}
          </div>
          )}
        </div>

        {/* Sidebar */}
        <aside className="profile-sidebar">
          {/* Hours Card */}
          {business.showHours && (
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
          )}

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

      {/* Messenger dock: always available to signed-in visitors; guests only
          when the business allows guest contact (GV-2). */}
      {(user || business.allowGuestContact !== false) && chatSession && (
        <PublicProfileMessenger
          open={chatOpen}
          onOpen={handleOpenChat}
          onClose={() => setChatOpen(false)}
          session={chatSession}
          helperName={business.name || business.business_name || ''}
          helperId={null}
          businessId={String(business.id || businessId)}
          avatarUrl={business.profilePhotoUrl || business.logo_url}
          avatarShape="square"
          isGuest={!user}
          allowLiveChat={business.allowLiveChat !== false}
          allowGuestContact={business.allowGuestContact !== false}
          entityKind="business"
          // Optional passthroughs (BusinessProfilePage omits these too).
          destination={undefined}
          onDestinationChange={undefined}
        />
      )}

      {/* Guests blocked by the contact gate are prompted to sign in */}
      {guestSignInModalOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70"
          role="dialog"
          aria-modal="true"
          aria-labelledby="biz-guest-signin-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-900 p-6 shadow-xl">
            <h2 id="biz-guest-signin-title" className="text-lg font-semibold text-white mb-2">
              {t('helperProfile.guestSignInTitle', { name: business.name || business.business_name })}
            </h2>
            <p className="text-sm text-gray-400 mb-6">
              {t('helperProfile.guestSignInBody')}
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                to="/login"
                className="flex-1 text-center py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold text-sm transition-colors"
              >
                {t('auth.signIn')}
              </Link>
              <Link
                to="/join"
                className="flex-1 text-center py-2.5 rounded-xl border border-gray-600 text-gray-200 font-semibold text-sm hover:bg-gray-800 transition-colors"
              >
                {t('nav.register')}
              </Link>
            </div>
            <button
              type="button"
              onClick={() => setGuestSignInModalOpen(false)}
              className="mt-4 w-full text-sm text-gray-500 hover:text-gray-300"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
