// client/src/pages/BusinessProfilePage.jsx
//
// Public-facing business profile page.
// URL: /business/:id  - no auth required to view.
//
// Layout is intentionally identical to HelperBusinessProfilePage.tsx.
// Business API data is mapped to the HelperProfileData shape so all the
// same shared components (BusinessHeader, ServicesSection, ReviewsSection,
// ChatPanel, DynamicBlocks, etc.) render without modification.

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MessageCircle, Flag } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import UserReputationCard from '../components/UserReputationCard';
import ReportModal from '../components/ReportModal';

import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import PageMeta from '../components/PageMeta';
import ProfileJsonLd from '../components/ProfileJsonLd';
import { buildPublicProfileDescription, getPublicSiteUrl } from '../utils/seoDescription';
import ProfileShareControls from '../components/helperProfile/ProfileShareControls';
import {
  ProfileSkeleton,
  ProfileError,
  BackToTopButton,
  SectionNav,
} from '../components/PublicProfilePageChrome';

// Profile section components (same set as HelperBusinessProfilePage)
import BusinessHeader from '../components/helperProfile/BusinessHeader';
import ServicesSection from '../components/helperProfile/ServicesSection';
import GallerySection from '../components/helperProfile/GallerySection';
import HoursSection from '../components/helperProfile/HoursSection';
import LocationSection from '../components/helperProfile/LocationSection';
import PoliciesSection from '../components/helperProfile/PoliciesSection';
import ReviewsSection from '../components/helperProfile/ReviewsSection';
import FAQSection from '../components/helperProfile/FAQSection';
import CTASection from '../components/helperProfile/CTASection';
import PublicProfileMessenger from '../components/helperProfile/chat/PublicProfileMessenger.jsx';
import { MessengerInviteCard } from '../components/helperProfile/chat/MessengerDock.jsx';
import { AvailabilityBlock, PricingBlock, SlotsBlock } from '../components/helperProfile/DynamicBlocks';

import { getBusinessPublicProfile } from '../api/businesses';
import { getPublicPropertyOperations } from '../api/propertyOperations';
import { getPublicTradesOperations } from '../api/tradesOperations';
import { getPublicBeautyOperations } from '../api/beautyOperations';
import { getPublicCreativeOperations } from '../api/creativeOperations';
import { getPublicProfessionalOperations } from '../api/professionalOperations';
import { getPublicContinuityOperations } from '../api/continuityOperations';
import { ProfileTemplateRenderer, getTemplateBehavior } from '../components/profileTemplates/index';
import { LAUNCH_VISIBILITY } from '../utils/launchScope';

// ── Data mapping helpers ──────────────────────────────────────────────────────

function buildBadges(business, t) {
  const badges = [];
    if (business.is_business_verified)
      badges.push({ id: 'biz', label: t('businessProfile.badgeBusinessVerified', 'Business Verified'), icon: 'shield-check', color: 'blue' });
    return badges;
}

/**
 * Maps the raw API response from GET /api/businesses/:id/public
 * to the HelperProfileData shape expected by the shared components.
 */
function mapToHelperProfileData(profile, t) {
  const { business, services, reviews, gallery, faqs, policies, hours } = profile;

  const helper = {
    id:            business.owner_id,
    businessName:  business.business_name,
    ownerName:     business.owner_name || business.business_name,
    tagline:       business.profile_headline || '',
    bio:           business.description || business.bio_short || '',
    avatar:        business.logo_url || business.owner_photo || '',
    coverImage:    business.cover_photo_url || '',
    rating:        parseFloat(business.avg_rating) || 0,
    reviewCount:   parseInt(business.total_reviews, 10) || 0,
    jobsCompleted: parseInt(business.completed_jobs_count, 10) || 0,
    memberSince:   business.member_since,
        verified:      !!business.is_business_verified,
    responseTime:  '',
    responseRate:  0,
    badges:        buildBadges(business, t),
    categories:    business.business_type ? [business.business_type] : [],
    city:          business.address_city || '',
    state:         business.address_state || '',
    allowGuestContact:
      typeof business.allow_guest_contact === 'boolean'
        ? business.allow_guest_contact
        : true,
  };

  const mappedServices = (services || []).map(s => ({
    id:          String(s.id),
    name:        s.name,
    description: s.description || '',
    price:       parseFloat(s.price) || 0,
    priceUnit:   s.price_unit || 'flat',
    duration:    s.duration || '',
    popular:     !!s.popular,
    category:    s.category || 'General',
  }));

  const mappedGallery = (gallery || []).map(g => ({
    id:      String(g.id),
    url:     g.url,
    alt:     g.alt || g.caption || t('businessProfile.galleryAlt'),
    caption: g.caption || '',
    type:    'photo',
  }));

  const mappedReviews = (reviews || []).map(r => ({
    id:          String(r.id),
    authorName:  `${r.first_name} ${(r.last_name || '')[0] || ''}.`,
    rating:      r.rating,
    date:        r.created_at,
    serviceUsed: '',
    content:     r.comment || '',
    helpfulCount:0,
    verified:    true,
    helperReply: r.response ? { content: r.response, date: r.response_at } : undefined,
  }));

  const mappedFaqs = (faqs || []).map(f => ({
    id:       String(f.id),
    question: f.question,
    answer:   f.answer,
  }));

  const mappedPolicies = (policies || []).map(p => ({
    id:      String(p.id),
    title:   p.title,
    content: p.content,
    icon:    p.icon || 'file-text',
  }));

  const location = {
    city:          business.address_city  || '',
    state:         business.address_state || '',
    zip:           '',
    serviceRadius: business.service_radius_miles || 10,
    radiusUnit:    'miles',
    servesRemotely:false,
    serviceLat:    business.service_lat ?? null,
    serviceLng:    business.service_lng ?? null,
  };

  // Hours: mapped from business_hours table (Phase 3 business content)
  // Convert day_of_week (0-6) to day names expected by HoursSection
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const mappedHours = (hours || []).map(h => ({
    day:    DAY_NAMES[h.day_of_week] || 'Sunday',
    open:   h.start_time || '00:00',
    close:  h.end_time || '00:00',
    closed: h.is_closed || false,
  }));

  const chatSession = {
    id:            `session_${business.owner_id}`,
    destination:   'business',
    status:        'ai_assistant',
    helperStatus:  'ai_assistant',
    oxsteedStatus: 'ai_assistant',
    timeline:      [],
    typing:        null,
  };

  return {
    helper,
    services:    mappedServices,
    gallery:     mappedGallery,
    reviews:     mappedReviews,
    faqs:        mappedFaqs,
    policies:    mappedPolicies,
    location,
    hours:       mappedHours,
    chatSession,
    // Extras not in HelperProfileData - kept for supplementary sections
    team:    profile.team || [],
    bizId:   business.id,
    phone:   business.phone,
    website: business.website,
  };
}

// ── Team section (business-specific supplement) ───────────────────────────────
function TeamSection({ team }) {
  const { t } = useTranslation();
  if (!team || team.length === 0) return null;

  function getInitials(first, last) {
    return `${(first || '')[0] || ''}${(last || '')[0] || ''}`.toUpperCase() || '?';
  }

  return (
    <section
      aria-labelledby="team-heading"
      className="bg-gray-900 border border-gray-800 rounded-2xl px-6 py-5"
      id="team"
    >
      <h2 id="team-heading" className="text-base font-semibold text-white mb-4">
        {t('businessProfile.ourTeam')}
      </h2>
      <ul className="space-y-3" role="list">
        {team.map((member, i) => (
          <li key={i} className="flex items-center gap-3">
            {member.profile_photo_url ? (
              <img
                src={member.profile_photo_url}
                alt={`${member.first_name} ${member.last_name}`}
                className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                loading="lazy"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-gray-700 border border-gray-600 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-semibold text-gray-300 select-none">
                  {getInitials(member.first_name, member.last_name)}
                </span>
              </div>
            )}
            <div>
              <p className="text-sm font-medium text-white">
                {member.first_name} {member.last_name}
              </p>
              <p className="text-xs text-gray-400">
                {member.role === 'manager' ? t('businessProfile.manager') : t('businessProfile.representative')}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Contact links section (business-specific supplement) ─────────────────────
function ContactLinksSection({ phone, website }) {
  const { t } = useTranslation();
  if (!phone && !website) return null;

  return (
    <section
      aria-labelledby="contact-heading"
      className="bg-gray-900 border border-gray-800 rounded-2xl px-6 py-5"
    >
      <h2 id="contact-heading" className="text-base font-semibold text-white mb-3">
        {t('businessProfile.contact')}
      </h2>
      <div className="flex flex-wrap gap-3">
        {phone && (
          <a
            href={`tel:${phone}`}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-800 border border-gray-700 text-sm text-gray-200 hover:bg-gray-700 transition-colors"
          >
            📞 {phone}
          </a>
        )}
        {website && (
          <a
            href={website}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-800 border border-gray-700 text-sm text-gray-200 hover:bg-gray-700 transition-colors"
          >
            🌐 {website.replace(/^https?:\/\//, '')}
          </a>
        )}
      </div>
    </section>
  );
}

function PropertyOperationsPublicSection({ data, t }) {
  if (!data) return null;
  const settings = data.settings || {};
  const packages = data.packages || [];
  const metrics = data.metrics || {};

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-2xl px-6 py-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">{t('businessProfile.operations.property.title')}</p>
          <h2 className="mt-2 text-lg font-semibold text-white">{t('businessProfile.operations.property.heading')}</h2>
          <p className="mt-2 text-sm leading-7 text-gray-300">
            {settings.tenant_portal_intro || t('businessProfile.operations.property.intro')}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('businessProfile.operations.common.responsePromise')}</p>
            <p className="mt-2 text-2xl font-semibold text-white">{settings.response_promise_hours || 24}h</p>
          </div>
          <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('businessProfile.operations.property.unitsTracked')}</p>
            <p className="mt-2 text-2xl font-semibold text-white">{metrics.total_units || 0}</p>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('businessProfile.operations.property.trustSignals')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(settings.trust_artifacts || []).map((item) => (
              <span key={item} className="rounded-full border border-gray-700 bg-gray-900 px-3 py-1 text-xs font-medium text-gray-200">
                {item}
              </span>
            ))}
          </div>
          {settings.emergency_phone || settings.after_hours_policy ? (
            <div className="mt-4 space-y-2 text-sm text-gray-300">
              {settings.emergency_phone ? <p><strong>{t('businessProfile.operations.property.emergencyLine')}:</strong> {settings.emergency_phone}</p> : null}
              {settings.after_hours_policy ? <p><strong>{t('businessProfile.operations.property.afterHours')}:</strong> {settings.after_hours_policy}</p> : null}
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('businessProfile.operations.property.packages')}</p>
          <div className="mt-3 space-y-3">
            {packages.length === 0 ? (
              <p className="text-sm text-gray-400">{t('businessProfile.operations.property.emptyPackages')}</p>
            ) : packages.map((item) => (
              <div key={item.id} className="rounded-2xl border border-gray-800 bg-gray-900 px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-white">{item.name}</p>
                  <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-[11px] font-semibold text-amber-200">{item.pricing_model}</span>
                </div>
                {item.description ? <p className="mt-2 text-sm text-gray-400">{item.description}</p> : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function TradesOperationsPublicSection({ data, t }) {
  if (!data) return null;
  const settings = data.settings || {};
  const trustRecords = data.trustRecords || [];
  const recommendations = data.recommendations || [];
  const metrics = data.metrics || {};

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-2xl px-6 py-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-200">{t('businessProfile.operations.trades.title')}</p>
          <h2 className="mt-2 text-lg font-semibold text-white">{t('businessProfile.operations.trades.heading')}</h2>
          <p className="mt-2 text-sm leading-7 text-gray-300">
            {settings.intake_instructions || t('businessProfile.operations.trades.intro')}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('businessProfile.operations.common.responsePromise')}</p>
            <p className="mt-2 text-2xl font-semibold text-white">{settings.response_promise_hours || 12}h</p>
          </div>
          <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('businessProfile.operations.trades.estimateTurnaround')}</p>
            <p className="mt-2 text-2xl font-semibold text-white">{settings.estimate_turnaround_hours || 24}h</p>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('businessProfile.operations.trades.trustSignals')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(settings.trust_artifacts || []).map((item) => (
              <span key={item} className="rounded-full border border-gray-700 bg-gray-900 px-3 py-1 text-xs font-medium text-gray-200">
                {item}
              </span>
            ))}
          </div>
          {trustRecords.length > 0 ? (
            <div className="mt-4 space-y-2 text-sm text-gray-300">
              {trustRecords.slice(0, 3).map((record) => (
                <p key={record.id}><strong>{record.record_type}:</strong> {record.title}</p>
              ))}
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('businessProfile.operations.trades.recommendations')}</p>
          <div className="mt-3 space-y-3">
            {recommendations.length === 0 ? (
              <p className="text-sm text-gray-400">{t('businessProfile.operations.trades.emptyRecommendations')}</p>
            ) : recommendations.slice(0, 3).map((item) => (
              <div key={item.id} className="rounded-2xl border border-gray-800 bg-gray-900 px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-white">{item.title}</p>
                  <span className="rounded-full bg-blue-400/10 px-2 py-0.5 text-[11px] font-semibold text-blue-200">{item.priority}</span>
                </div>
                {item.description ? <p className="mt-2 text-sm text-gray-400">{item.description}</p> : null}
              </div>
            ))}
            <p className="text-xs text-gray-500">
              {t('businessProfile.operations.trades.criticalTracked', { count: metrics.critical_recommendations || 0 })}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function BeautyOperationsPublicSection({ data, t }) {
  if (!data) return null;
  const settings = data.settings || {};
  const packages = data.packages || [];
  const trustRecords = data.trustRecords || [];
  const metrics = data.metrics || {};

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-2xl px-6 py-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-pink-200">{t('businessProfile.operations.beauty.title')}</p>
          <h2 className="mt-2 text-lg font-semibold text-white">{t('businessProfile.operations.beauty.heading')}</h2>
          <p className="mt-2 text-sm leading-7 text-gray-300">
            {settings.prep_instructions || t('businessProfile.operations.beauty.intro')}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('businessProfile.operations.common.responsePromise')}</p>
            <p className="mt-2 text-2xl font-semibold text-white">{settings.response_promise_hours || 6}h</p>
          </div>
          <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('businessProfile.operations.beauty.rebookWindow')}</p>
            <p className="mt-2 text-2xl font-semibold text-white">{settings.rebook_window_days || 42}d</p>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('businessProfile.operations.beauty.trustSignals')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(settings.trust_artifacts || []).map((item) => (
              <span key={item} className="rounded-full border border-gray-700 bg-gray-900 px-3 py-1 text-xs font-medium text-gray-200">
                {item}
              </span>
            ))}
          </div>
          {trustRecords.length > 0 ? (
            <div className="mt-4 space-y-2 text-sm text-gray-300">
              {trustRecords.slice(0, 3).map((record) => (
                <p key={record.id}><strong>{record.record_type}:</strong> {record.title}</p>
              ))}
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('businessProfile.operations.beauty.packages')}</p>
          <div className="mt-3 space-y-3">
            {packages.length === 0 ? (
              <p className="text-sm text-gray-400">{t('businessProfile.operations.beauty.emptyPackages')}</p>
            ) : packages.slice(0, 3).map((item) => (
              <div key={item.id} className="rounded-2xl border border-gray-800 bg-gray-900 px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-white">{item.package_name}</p>
                  <span className="rounded-full bg-pink-400/10 px-2 py-0.5 text-[11px] font-semibold text-pink-200">{item.package_type}</span>
                </div>
                {item.description ? <p className="mt-2 text-sm text-gray-400">{item.description}</p> : null}
              </div>
            ))}
            <p className="text-xs text-gray-500">
              {t('businessProfile.operations.beauty.rebookedTracked', { count: metrics.rebooked_requests || 0 })}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function CreativeOperationsPublicSection({ data, t }) {
  if (!data) return null;
  const settings = data.settings || {};
  const packages = data.packages || [];
  const approvalRecords = data.approvalRecords || [];
  const metrics = data.metrics || {};

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-2xl px-6 py-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-200">{t('businessProfile.operations.creative.title')}</p>
          <h2 className="mt-2 text-lg font-semibold text-white">{t('businessProfile.operations.creative.heading')}</h2>
          <p className="mt-2 text-sm leading-7 text-gray-300">
            {settings.approval_policy || t('businessProfile.operations.creative.intro')}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('businessProfile.operations.common.responsePromise')}</p>
            <p className="mt-2 text-2xl font-semibold text-white">{settings.response_promise_hours || 12}h</p>
          </div>
          <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('businessProfile.operations.creative.deliveryWindow')}</p>
            <p className="mt-2 text-2xl font-semibold text-white">{settings.delivery_window_days || 14}d</p>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('businessProfile.operations.creative.trustSignals')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(settings.trust_artifacts || []).map((item) => (
              <span key={item} className="rounded-full border border-gray-700 bg-gray-900 px-3 py-1 text-xs font-medium text-gray-200">
                {item}
              </span>
            ))}
          </div>
          {approvalRecords.length > 0 ? (
            <div className="mt-4 space-y-2 text-sm text-gray-300">
              {approvalRecords.slice(0, 3).map((record) => (
                <p key={record.id}><strong>{record.record_type}:</strong> {record.title}</p>
              ))}
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('businessProfile.operations.creative.packages')}</p>
          <div className="mt-3 space-y-3">
            {packages.length === 0 ? (
              <p className="text-sm text-gray-400">{t('businessProfile.operations.creative.emptyPackages')}</p>
            ) : packages.slice(0, 3).map((item) => (
              <div key={item.id} className="rounded-2xl border border-gray-800 bg-gray-900 px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-white">{item.package_name}</p>
                  <span className="rounded-full bg-orange-400/10 px-2 py-0.5 text-[11px] font-semibold text-orange-200">{item.package_type}</span>
                </div>
                {item.description ? <p className="mt-2 text-sm text-gray-400">{item.description}</p> : null}
              </div>
            ))}
            <p className="text-xs text-gray-500">
              {t('businessProfile.operations.creative.proposalsTracked', { count: metrics.proposals_waiting || 0 })}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function ProfessionalOperationsPublicSection({ data, t }) {
  if (!data) return null;
  const settings = data.settings || {};
  const packages = data.packages || [];
  const complianceRecords = data.complianceRecords || [];
  const metrics = data.metrics || {};

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-2xl px-6 py-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-200">{t('businessProfile.operations.professional.title')}</p>
          <h2 className="mt-2 text-lg font-semibold text-white">{t('businessProfile.operations.professional.heading')}</h2>
          <p className="mt-2 text-sm leading-7 text-gray-300">
            {settings.engagement_policy || t('businessProfile.operations.professional.intro')}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('businessProfile.operations.common.responsePromise')}</p>
            <p className="mt-2 text-2xl font-semibold text-white">{settings.response_promise_hours || 24}h</p>
          </div>
          <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('businessProfile.operations.professional.reminderCadence')}</p>
            <p className="mt-2 text-2xl font-semibold text-white">{settings.recurring_reminder_days || 30}d</p>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('businessProfile.operations.professional.trustSignals')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(settings.trust_artifacts || []).map((item) => (
              <span key={item} className="rounded-full border border-gray-700 bg-gray-900 px-3 py-1 text-xs font-medium text-gray-200">
                {item}
              </span>
            ))}
          </div>
          {complianceRecords.length > 0 ? (
            <div className="mt-4 space-y-2 text-sm text-gray-300">
              {complianceRecords.slice(0, 3).map((record) => (
                <p key={record.id}><strong>{record.record_type}:</strong> {record.title}</p>
              ))}
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('businessProfile.operations.professional.packages')}</p>
          <div className="mt-3 space-y-3">
            {packages.length === 0 ? (
              <p className="text-sm text-gray-400">{t('businessProfile.operations.professional.emptyPackages')}</p>
            ) : packages.slice(0, 3).map((item) => (
              <div key={item.id} className="rounded-2xl border border-gray-800 bg-gray-900 px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-white">{item.package_name}</p>
                  <span className="rounded-full bg-sky-400/10 px-2 py-0.5 text-[11px] font-semibold text-sky-200">{item.package_type}</span>
                </div>
                {item.description ? <p className="mt-2 text-sm text-gray-400">{item.description}</p> : null}
              </div>
            ))}
            <p className="text-xs text-gray-500">
              {t('businessProfile.operations.professional.obligationsTracked', { count: metrics.obligations_due || 0 })}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function ContinuityOperationsPublicSection({ data, t }) {
  if (!data) return null;
  const settings = data.settings || {};
  const plans = data.plans || [];
  const trustRecords = data.trustRecords || [];
  const metrics = data.metrics || {};

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-2xl px-6 py-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200">{t('businessProfile.operations.continuity.title')}</p>
          <h2 className="mt-2 text-lg font-semibold text-white">{t('businessProfile.operations.continuity.heading')}</h2>
          <p className="mt-2 text-sm leading-7 text-gray-300">
            {settings.continuity_pitch || t('businessProfile.operations.continuity.intro')}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('businessProfile.operations.common.responsePromise')}</p>
            <p className="mt-2 text-2xl font-semibold text-white">{settings.response_promise_hours || 12}h</p>
          </div>
          <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('businessProfile.operations.continuity.nextSession')}</p>
            <p className="mt-2 text-2xl font-semibold text-white">{settings.next_session_window_days || 14}d</p>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('businessProfile.operations.continuity.trustSignals')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(settings.trust_artifacts || []).map((item) => (
              <span key={item} className="rounded-full border border-gray-700 bg-gray-900 px-3 py-1 text-xs font-medium text-gray-200">
                {item}
              </span>
            ))}
          </div>
          {trustRecords.length > 0 ? (
            <div className="mt-4 space-y-2 text-sm text-gray-300">
              {trustRecords.slice(0, 3).map((record) => (
                <p key={record.id}><strong>{record.record_type}:</strong> {record.title}</p>
              ))}
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('businessProfile.operations.continuity.packages')}</p>
          <div className="mt-3 space-y-3">
            {plans.length === 0 ? (
              <p className="text-sm text-gray-400">{t('businessProfile.operations.continuity.emptyPackages')}</p>
            ) : plans.slice(0, 3).map((item) => (
              <div key={item.id} className="rounded-2xl border border-gray-800 bg-gray-900 px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-white">{item.plan_name}</p>
                  <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-200">{item.plan_type}</span>
                </div>
                {item.description ? <p className="mt-2 text-sm text-gray-400">{item.description}</p> : null}
              </div>
            ))}
            <p className="text-xs text-gray-500">
              {t('businessProfile.operations.continuity.clientsTracked', { count: metrics.continuity_clients || 0 })}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Main page component ───────────────────────────────────────────────────────
export default function BusinessProfilePage() {
  const { id }    = useParams();
  const navigate  = useNavigate();
  const { t }     = useTranslation();
  const { user } = useAuth();

  const [profileData,     setProfileData]     = useState(null);
  const [propertyOpsData, setPropertyOpsData] = useState(null);
  const [tradesOpsData, setTradesOpsData] = useState(null);
  const [beautyOpsData, setBeautyOpsData] = useState(null);
  const [creativeOpsData, setCreativeOpsData] = useState(null);
  const [professionalOpsData, setProfessionalOpsData] = useState(null);
  const [continuityOpsData, setContinuityOpsData] = useState(null);
  const [loadState,       setLoadState]       = useState('idle');
  const [error,           setError]           = useState(null);
  const [activeTemplate,  setActiveTemplate]  = useState('default');
  const [chatOpen,    setChatOpen]    = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [guestSignInModalOpen, setGuestSignInModalOpen] = useState(false);

  // Scroll padding: Navbar (~64px) + SectionNav (~40px) + breathing room
  useEffect(() => {
    const prev = document.documentElement.style.scrollPaddingTop;
    document.documentElement.style.scrollPaddingTop = '112px';
    return () => { document.documentElement.style.scrollPaddingTop = prev; };
  }, []);

  const loadProfile = useCallback(async () => {
    setLoadState('loading');
    setError(null);
    try {
      const raw = await getBusinessPublicProfile(id);
      setProfileData(mapToHelperProfileData(raw, t));
      setActiveTemplate(raw.business?.active_template || 'default');
      if (!LAUNCH_VISIBILITY.specializedProfileTemplates) {
        setPropertyOpsData(null);
        setTradesOpsData(null);
        setBeautyOpsData(null);
        setCreativeOpsData(null);
        setProfessionalOpsData(null);
        setContinuityOpsData(null);
      } else {
        const template = raw.business?.active_template || 'default';
        if (template === 'property_manager') getPublicPropertyOperations(id).then(setPropertyOpsData).catch(() => {});
        else setPropertyOpsData(null);
        if (['trades_pro', 'electrician', 'auto_mechanic'].includes(template)) getPublicTradesOperations(id).then(setTradesOpsData).catch(() => {});
        else setTradesOpsData(null);
        if (['beauty_style', 'barbershop', 'hair_stylist', 'spa_skincare'].includes(template)) getPublicBeautyOperations(id).then(setBeautyOpsData).catch(() => {});
        else setBeautyOpsData(null);
        if (['photographer', 'creative_studio', 'graphic_design'].includes(template)) getPublicCreativeOperations(id).then(setCreativeOpsData).catch(() => {});
        else setCreativeOpsData(null);
        if (['accountant', 'consulting_coaching', 'legal_admin'].includes(template)) getPublicProfessionalOperations(id).then(setProfessionalOpsData).catch(() => {});
        else setProfessionalOpsData(null);
        if (['fitness_pro', 'wellness_therapy', 'nutrition_diet', 'mental_health', 'massage_therapist', 'care_trust', 'pet_services', 'tutoring_education', 'child_development', 'dog_walker', 'math_tutor'].includes(template)) getPublicContinuityOperations(id).then(setContinuityOpsData).catch(() => {});
        else setContinuityOpsData(null);
      }
      setLoadState('success');
    } catch (e) {
      setError(
        e?.response?.status === 404
          ? t('businessProfile.notFound')
          : t('businessProfile.loadFailed')
      );
      setLoadState('error');
    }
  }, [id]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const handleBookNow = useCallback(() => {
    if (!profileData) return;
    // Route through the business booking endpoint so the booking_requests row
    // is tagged with business_id (per migration 214). The server still resolves
    // the owner helper as the default acceptor.
    const bizId = profileData.bizId || id;
    const params = new URLSearchParams({
      businessName: profileData.helper.businessName,
    });
    navigate(`/book/business/${bizId}?${params.toString()}`);
  }, [profileData, navigate, id]);

  const handleTemplatePrimaryAction = useCallback(() => {
    if (!profileData) return;
    if (!LAUNCH_VISIBILITY.specializedProfileTemplates) {
      handleBookNow();
      return;
    }
    const behavior = getTemplateBehavior(activeTemplate);
    if (behavior.primaryIntent === 'maintenance_request') {
      navigate(`/business/${profileData.bizId || id}/maintenance-request`);
      return;
    }
    if (behavior.primaryIntent === 'trades_diagnostic') {
      navigate(`/business/${profileData.bizId || id}/trades-request`);
      return;
    }
    if (behavior.primaryIntent === 'beauty_intake') {
      navigate(`/business/${profileData.bizId || id}/beauty-intake`);
      return;
    }
    if (behavior.primaryIntent === 'creative_intake') {
      navigate(`/business/${profileData.bizId || id}/creative-intake`);
      return;
    }
    if (behavior.primaryIntent === 'professional_intake') {
      navigate(`/business/${profileData.bizId || id}/professional-intake`);
      return;
    }
    if (behavior.primaryIntent === 'continuity_intake') {
      navigate(`/business/${profileData.bizId || id}/continuity-intake`);
      return;
    }
    if (behavior.primaryIntent === 'tool_rental') {
      navigate('/tool-rentals');
      return;
    }
    handleBookNow();
  }, [activeTemplate, handleBookNow, id, navigate, profileData]);

  const handlePostJobPublic = useCallback(() => {
    if (!profileData) return;
    const bizId = profileData.bizId || id;
    const params = new URLSearchParams({
      businessId: bizId,
      businessName: profileData.helper.businessName,
    });
    navigate(`/post-job?${params.toString()}`);
  }, [profileData, navigate, id]);

  const handleOpenChat = useCallback(() => {
    if (user) {
      setChatOpen(true);
      return;
    }
    const allow = profileData?.helper?.allowGuestContact !== false;
    if (allow) {
      setChatOpen(true);
    } else {
      setGuestSignInModalOpen(true);
    }
  }, [user, profileData?.helper?.allowGuestContact]);

  const handleSelectService = useCallback(
    (service) => {
      if (!profileData) return;
      const bizId = profileData.bizId || id;
      const params = new URLSearchParams({
        businessName: profileData.helper.businessName,
      });
      if (service.name?.trim()) {
        params.set('serviceHint', service.name.trim());
      }
      navigate(`/book/business/${bizId}?${params.toString()}`);
    },
    [profileData, navigate, id]
  );

  // ── Loading / error shells ─────────────────────────────────────────────────
  if (loadState === 'loading' || loadState === 'idle') {
    return (
      <div className="min-h-screen bg-gray-950 text-white">
        <Navbar />
        <ProfileSkeleton />
      </div>
    );
  }

  if (loadState === 'error' || !profileData) {
    return (
      <div className="min-h-screen bg-gray-950 text-white">
        <Navbar />
        <main className="py-16">
          <ProfileError
            headline={t('businessProfile.unableToLoad')}
            message={error ?? 'Unknown error'}
            onRetry={loadProfile}
          />
        </main>
        <Footer />
      </div>
    );
  }

  const {
    helper, services, gallery, hours, location,
    policies, reviews, faqs, chatSession,
    team, bizId, phone, website,
  } = profileData;

  const isGuestVisitor = !user;
  const templateBehavior = getTemplateBehavior(
    LAUNCH_VISIBILITY.specializedProfileTemplates ? activeTemplate : 'default',
  );

  // ── Template override: non-default templates replace the page interior ─────
  if (LAUNCH_VISIBILITY.specializedProfileTemplates && activeTemplate && activeTemplate !== 'default') {
    return (
      <div className="min-h-screen bg-gray-950 text-white">
        <PageMeta
          title={helper.businessName}
          description={buildPublicProfileDescription({
            displayName: helper.businessName,
            tagline: helper.tagline,
            bio: helper.bio,
            city: helper.city,
            state: helper.state,
            entityLabel: 'business',
          })}
          image={helper.coverImage || helper.avatar}
          url={`${getPublicSiteUrl()}/businesses/public/${id}`}
          type="profile"
        />
        <Navbar />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 pb-2">
          <ProfileShareControls
            shareUrl={`${getPublicSiteUrl()}/businesses/public/${id}`}
            shareTitle={helper.businessName}
            i18nPrefix="businessProfile"
          />
        </div>
        <ProfileTemplateRenderer slug={activeTemplate} profileData={profileData} />
        <div className="px-4 sm:px-6 lg:px-8">
          {activeTemplate === 'property_manager' ? (
            <div className="mt-6">
              <PropertyOperationsPublicSection data={propertyOpsData} t={t} />
            </div>
          ) : null}
          {['trades_pro', 'electrician', 'auto_mechanic'].includes(activeTemplate) ? (
            <div className="mt-6">
              <TradesOperationsPublicSection data={tradesOpsData} t={t} />
            </div>
          ) : null}
          {['beauty_style', 'barbershop', 'hair_stylist', 'spa_skincare'].includes(activeTemplate) ? (
            <div className="mt-6">
              <BeautyOperationsPublicSection data={beautyOpsData} t={t} />
            </div>
          ) : null}
          {['photographer', 'creative_studio', 'graphic_design'].includes(activeTemplate) ? (
            <div className="mt-6">
              <CreativeOperationsPublicSection data={creativeOpsData} t={t} />
            </div>
          ) : null}
          {['accountant', 'consulting_coaching', 'legal_admin'].includes(activeTemplate) ? (
            <div className="mt-6">
              <ProfessionalOperationsPublicSection data={professionalOpsData} t={t} />
            </div>
          ) : null}
          {['fitness_pro', 'wellness_therapy', 'nutrition_diet', 'mental_health', 'massage_therapist', 'care_trust', 'pet_services', 'tutoring_education', 'child_development', 'dog_walker', 'math_tutor'].includes(activeTemplate) ? (
            <div className="mt-6">
              <ContinuityOperationsPublicSection data={continuityOpsData} t={t} />
            </div>
          ) : null}
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <PageMeta
        title={helper.businessName}
        description={buildPublicProfileDescription({
          displayName: helper.businessName,
          tagline: helper.tagline,
          bio: helper.bio,
          city: helper.city,
          state: helper.state,
          entityLabel: 'business',
        })}
        image={helper.coverImage || helper.avatar}
        url={`${getPublicSiteUrl()}/businesses/public/${id}`}
        type="profile"
      />
      <ProfileJsonLd
        variant="business"
        businessId={bizId}
        helper={helper}
        location={location}
        services={services}
      />
      <Navbar />

      {/* Business hero — PublicProfileSummaryCard via BusinessHeader / PublicProfileHero */}
      <BusinessHeader
        helperId={helper.id}
        helper={helper}
        onBookNow={handleBookNow}
        onPostJobPublic={handlePostJobPublic}
        onOpenChat={handleOpenChat}
        shareUrl={`${getPublicSiteUrl()}/businesses/public/${id}`}
        shareTitle={helper.businessName}
        shareI18nPrefix="businessProfile"
      />

      {/* Sticky section nav */}
      <SectionNav />

      {/* Page body */}
      <main
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8"
        id="main-content"
      >
        <div className="flex flex-col lg:grid lg:grid-cols-12 gap-8">

          {/* ── Left column ────────────────────────────────────────── */}
          <div className="lg:col-span-7 space-y-6">

            {/* Bio */}
            {helper.bio && (
              <section
                aria-labelledby="bio-heading"
                className="bg-gray-900 border border-gray-800 rounded-2xl px-6 py-5"
              >
                <h2 id="bio-heading" className="text-base font-semibold text-white mb-2">
                  {t('businessProfile.about', { name: helper.businessName })}
                </h2>
                <p className="text-gray-300 text-sm leading-relaxed">{helper.bio}</p>
              </section>
            )}

            {/* Contact links (phone / website) */}
            <ContactLinksSection phone={phone} website={website} />

            {LAUNCH_VISIBILITY.specializedProfileTemplates && activeTemplate === 'property_manager' ? (
              <PropertyOperationsPublicSection data={propertyOpsData} t={t} />
            ) : null}
            {LAUNCH_VISIBILITY.specializedProfileTemplates && ['trades_pro', 'electrician', 'auto_mechanic'].includes(activeTemplate) ? (
              <TradesOperationsPublicSection data={tradesOpsData} t={t} />
            ) : null}
            {LAUNCH_VISIBILITY.specializedProfileTemplates && ['beauty_style', 'barbershop', 'hair_stylist', 'spa_skincare'].includes(activeTemplate) ? (
              <BeautyOperationsPublicSection data={beautyOpsData} t={t} />
            ) : null}
            {LAUNCH_VISIBILITY.specializedProfileTemplates && ['photographer', 'creative_studio', 'graphic_design'].includes(activeTemplate) ? (
              <CreativeOperationsPublicSection data={creativeOpsData} t={t} />
            ) : null}
            {LAUNCH_VISIBILITY.specializedProfileTemplates && ['accountant', 'consulting_coaching', 'legal_admin'].includes(activeTemplate) ? (
              <ProfessionalOperationsPublicSection data={professionalOpsData} t={t} />
            ) : null}
            {LAUNCH_VISIBILITY.specializedProfileTemplates && ['fitness_pro', 'wellness_therapy', 'nutrition_diet', 'mental_health', 'massage_therapist', 'care_trust', 'pet_services', 'tutoring_education', 'child_development', 'dog_walker', 'math_tutor'].includes(activeTemplate) ? (
              <ContinuityOperationsPublicSection data={continuityOpsData} t={t} />
            ) : null}

            {/* Services & Pricing (empty state built into component) */}
            <ServicesSection
              services={services}
              onSelectService={handleSelectService}
            />

            {/* Photo gallery */}
            <GallerySection images={gallery} />

            {/* Team members */}
            <TeamSection team={team} />

            {/* Hours + Location side by side on md+ */}
            <div className="grid sm:grid-cols-2 gap-6">
              {hours.length > 0 && <HoursSection hours={hours} />}
              <LocationSection location={location} />
            </div>

            <PoliciesSection policies={policies} />

            {/*
              Dynamic blocks - use owner_id as helperId so these endpoints
              resolve against the business owner's helper profile data.
              Each block silently renders null if the fetch fails.
            */}
            <AvailabilityBlock helperId={helper.id} />
            <PricingBlock      helperId={helper.id} />
            <SlotsBlock        helperId={helper.id} />

            <ReviewsSection
              reviews={reviews}
              overallRating={helper.rating}
              totalCount={helper.reviewCount}
            />

            <FAQSection faqs={faqs} />

            {/* Bottom padding for mobile CTA bar + launcher + iOS home indicator */}
            <div className="h-32 lg:hidden" aria-hidden="true" />
          </div>

          {/* ── Right column: CTA + Chat (desktop) ─────────────────── */}
          <aside
            className="hidden lg:flex lg:col-span-5 flex-col gap-5"
            aria-label={t('businessProfile.bookAndChatAria')}
          >
            <div className="sticky top-[7.25rem] space-y-5 max-h-[calc(100vh-7.25rem)] flex flex-col overflow-y-auto overscroll-contain">
              <UserReputationCard userId={helper.id} />
              <CTASection
                helper={helper}
                onBookNow={handleTemplatePrimaryAction}
                onMessageHelper={handleOpenChat}
                onOpenChat={handleOpenChat}
                hasServices={services.length > 0}
                primaryLabel={templateBehavior.primaryCta}
                secondaryLabel={templateBehavior.secondaryCta}
                allowPrimaryWithoutServices={templateBehavior.allowPrimaryWithoutServices}
              />
              {user && (
                <button
                  onClick={() => setReportModalOpen(true)}
                  className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl border border-red-600/30 text-red-400 font-medium text-sm hover:bg-red-950/20 transition-colors"
                  aria-label={t('reportModal.reportUser', { name: helper.businessName })}
                >
                  <Flag size={16} />
                  {t('reportModal.report')}
                </button>
              )}
              <MessengerInviteCard
                displayName={helper.businessName}
                onOpen={handleOpenChat}
              />
            </div>
          </aside>

        </div>
      </main>

      <Footer />

      {/* ── Mobile sticky CTA bar ────────────────────────────────────── */}
      <div
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 px-4 pt-3 bg-gray-900/95 backdrop-blur border-t border-gray-800 flex items-center gap-3"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        aria-label={t('businessProfile.quickActionsAria')}
      >
        <button
          onClick={handleOpenChat}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-gray-700 text-gray-200 font-medium text-sm flex-1 hover:bg-gray-800 transition-colors active:bg-gray-700"
          aria-label={t('businessProfile.openChatAria')}
        >
          <MessageCircle className="w-4 h-4" aria-hidden="true" />
          {t('businessProfile.message')}
        </button>
        <button
          onClick={services.length > 0 ? handleBookNow : handleOpenChat}
          className="flex-[2] py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold text-sm transition-colors shadow-lg shadow-brand-500/20 active:bg-brand-700"
          aria-label={services.length > 0 ? t('businessProfile.bookBusinessAria') : t('helperProfile.cta.messageHelperAria')}
        >
          {services.length > 0 ? t('businessProfile.bookNow') : t('helperProfile.cta.contactForPricing')}
        </button>
      </div>

      <PublicProfileMessenger
        open={chatOpen}
        onOpen={handleOpenChat}
        onClose={() => setChatOpen(false)}
        session={chatSession}
        helperName={helper.businessName}
        helperId={helper.id}
        businessId={String(bizId)}
        avatarUrl={helper.avatar}
        avatarShape="square"
        isGuest={isGuestVisitor}
        allowLiveChat={helper.allowLiveChat}
        allowGuestContact={helper.allowGuestContact !== false}
        entityKind="business"
      />

      {guestSignInModalOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70"
          role="dialog"
          aria-modal="true"
          aria-labelledby="biz-guest-signin-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-900 p-6 shadow-xl">
            <h2 id="biz-guest-signin-title" className="text-lg font-semibold text-white mb-2">
              {t('helperProfile.guestSignInTitle', { name: helper.businessName })}
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
                to="/register/customer"
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

      {reportModalOpen && (
        <ReportModal
          reportedUserId={helper.id}
          reportedName={helper.businessName}
          onClose={() => setReportModalOpen(false)}
        />
      )}

      <BackToTopButton />
    </div>
  );
}
