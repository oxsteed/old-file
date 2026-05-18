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
  MobileChatDrawer,
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
import ChatPanel from '../components/helperProfile/chat/ChatPanel';
import { AvailabilityBlock, PricingBlock, SlotsBlock } from '../components/helperProfile/DynamicBlocks';

import { getBusinessPublicProfile } from '../api/businesses';
import { getPublicPropertyOperations } from '../api/propertyOperations';
import { getPublicTradesOperations } from '../api/tradesOperations';
import { getPublicBeautyOperations } from '../api/beautyOperations';
import { getPublicCreativeOperations } from '../api/creativeOperations';
import { ProfileTemplateRenderer, getTemplateBehavior } from '../components/profileTemplates/index';
import TemplateBehaviorPanel from '../components/profileTemplates/TemplateBehaviorPanel';
import '../components/profileTemplates/TemplateBehaviorPanel.css';

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
    destination:   'helper',
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

function PropertyOperationsPublicSection({ data }) {
  if (!data) return null;
  const settings = data.settings || {};
  const packages = data.packages || [];
  const metrics = data.metrics || {};

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-2xl px-6 py-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">Property Operations</p>
          <h2 className="mt-2 text-lg font-semibold text-white">Tenant-ready maintenance workflow</h2>
          <p className="mt-2 text-sm leading-7 text-gray-300">
            {settings.tenant_portal_intro || 'Tenants can report issues with urgency, access notes, photos, and repair-window preferences while the property team keeps the response and compliance trail organized.'}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Response promise</p>
            <p className="mt-2 text-2xl font-semibold text-white">{settings.response_promise_hours || 24}h</p>
          </div>
          <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Units tracked</p>
            <p className="mt-2 text-2xl font-semibold text-white">{metrics.total_units || 0}</p>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Trusted process signals</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(settings.trust_artifacts || []).map((item) => (
              <span key={item} className="rounded-full border border-gray-700 bg-gray-900 px-3 py-1 text-xs font-medium text-gray-200">
                {item}
              </span>
            ))}
          </div>
          {settings.emergency_phone || settings.after_hours_policy ? (
            <div className="mt-4 space-y-2 text-sm text-gray-300">
              {settings.emergency_phone ? <p><strong>Emergency line:</strong> {settings.emergency_phone}</p> : null}
              {settings.after_hours_policy ? <p><strong>After hours:</strong> {settings.after_hours_policy}</p> : null}
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Live service packages</p>
          <div className="mt-3 space-y-3">
            {packages.length === 0 ? (
              <p className="text-sm text-gray-400">Maintenance intake is live. Package-level billing can be configured inside Business Hub.</p>
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

function TradesOperationsPublicSection({ data }) {
  if (!data) return null;
  const settings = data.settings || {};
  const trustRecords = data.trustRecords || [];
  const recommendations = data.recommendations || [];
  const metrics = data.metrics || {};

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-2xl px-6 py-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-200">Trades Operations</p>
          <h2 className="mt-2 text-lg font-semibold text-white">Diagnostic-first technical workflow</h2>
          <p className="mt-2 text-sm leading-7 text-gray-300">
            {settings.intake_instructions || 'This profile is set up to capture the issue clearly, document diagnosis, and turn written findings into the right repair or upgrade recommendation.'}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Response promise</p>
            <p className="mt-2 text-2xl font-semibold text-white">{settings.response_promise_hours || 12}h</p>
          </div>
          <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Estimate turnaround</p>
            <p className="mt-2 text-2xl font-semibold text-white">{settings.estimate_turnaround_hours || 24}h</p>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Authority and proof</p>
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
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Live recommendation signals</p>
          <div className="mt-3 space-y-3">
            {recommendations.length === 0 ? (
              <p className="text-sm text-gray-400">Diagnostics and written recommendations can be managed from Business Hub as this template is configured further.</p>
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
              {metrics.critical_recommendations || 0} critical recommendations tracked internally.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function BeautyOperationsPublicSection({ data }) {
  if (!data) return null;
  const settings = data.settings || {};
  const packages = data.packages || [];
  const trustRecords = data.trustRecords || [];
  const metrics = data.metrics || {};

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-2xl px-6 py-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-pink-200">Beauty Operations</p>
          <h2 className="mt-2 text-lg font-semibold text-white">Prep-aware booking and retention workflow</h2>
          <p className="mt-2 text-sm leading-7 text-gray-300">
            {settings.prep_instructions || 'This profile is set up to capture look goals, sensitivities, prep expectations, and rebook timing before the chair is locked in.'}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Response promise</p>
            <p className="mt-2 text-2xl font-semibold text-white">{settings.response_promise_hours || 6}h</p>
          </div>
          <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Rebook window</p>
            <p className="mt-2 text-2xl font-semibold text-white">{settings.rebook_window_days || 42}d</p>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Prep and trust signals</p>
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
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Packages and repeat rituals</p>
          <div className="mt-3 space-y-3">
            {packages.length === 0 ? (
              <p className="text-sm text-gray-400">Beauty intake is live. Memberships, series, and ritual packages can be configured inside Business Hub.</p>
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
              {metrics.rebooked_requests || 0} rebooked visits are tracked internally.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function CreativeOperationsPublicSection({ data }) {
  if (!data) return null;
  const settings = data.settings || {};
  const packages = data.packages || [];
  const approvalRecords = data.approvalRecords || [];
  const metrics = data.metrics || {};

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-2xl px-6 py-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-200">Creative Operations</p>
          <h2 className="mt-2 text-lg font-semibold text-white">Discovery-to-delivery project workflow</h2>
          <p className="mt-2 text-sm leading-7 text-gray-300">
            {settings.approval_policy || 'This profile is set up for creative discovery, proof approvals, and final delivery follow-through instead of a vague portfolio contact path.'}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Response promise</p>
            <p className="mt-2 text-2xl font-semibold text-white">{settings.response_promise_hours || 12}h</p>
          </div>
          <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Delivery window</p>
            <p className="mt-2 text-2xl font-semibold text-white">{settings.delivery_window_days || 14}d</p>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Process and proof signals</p>
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
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Packages and project framing</p>
          <div className="mt-3 space-y-3">
            {packages.length === 0 ? (
              <p className="text-sm text-gray-400">Creative discovery is live. Packages and proof-stage records can be configured inside Business Hub.</p>
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
              {metrics.proposals_waiting || 0} proposals are tracked internally right now.
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
  const [loadState,       setLoadState]       = useState('idle');
  const [error,           setError]           = useState(null);
  const [activeTemplate,  setActiveTemplate]  = useState('default');
  const [chatOpen,    setChatOpen]    = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [guestSignInModalOpen, setGuestSignInModalOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 1024); // lg breakpoint

  // Track window resize to determine if we're on mobile/tablet
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 1024); // lg breakpoint in Tailwind
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
      if ((raw.business?.active_template || 'default') === 'property_manager') {
        getPublicPropertyOperations(id).then(setPropertyOpsData).catch(() => {});
      } else {
        setPropertyOpsData(null);
      }
      if (['trades_pro', 'electrician', 'auto_mechanic'].includes(raw.business?.active_template || 'default')) {
        getPublicTradesOperations(id).then(setTradesOpsData).catch(() => {});
      } else {
        setTradesOpsData(null);
      }
      if (['beauty_style', 'barbershop', 'hair_stylist', 'spa_skincare'].includes(raw.business?.active_template || 'default')) {
        getPublicBeautyOperations(id).then(setBeautyOpsData).catch(() => {});
      } else {
        setBeautyOpsData(null);
      }
      if (['photographer', 'creative_studio', 'graphic_design'].includes(raw.business?.active_template || 'default')) {
        getPublicCreativeOperations(id).then(setCreativeOpsData).catch(() => {});
      } else {
        setCreativeOpsData(null);
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
    // On desktop, scroll to chat panel in sidebar. On mobile, open drawer.
    if (!isMobile) {
      // Desktop: scroll right sidebar into view
      const chatAside = document.querySelector('aside[aria-label*="bookAndChat"]');
      if (chatAside) {
        chatAside.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }

    // Mobile: open chat drawer
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
  }, [isMobile, user, profileData?.helper?.allowGuestContact]);

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
  const templateBehavior = getTemplateBehavior(activeTemplate);

  // ── Template override: non-default templates replace the page interior ─────
  if (activeTemplate && activeTemplate !== 'default') {
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
          url={`${getPublicSiteUrl()}/business/${id}`}
          type="profile"
        />
        <Navbar />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 pb-2">
          <ProfileShareControls
            shareUrl={`${getPublicSiteUrl()}/business/${id}`}
            shareTitle={helper.businessName}
            i18nPrefix="businessProfile"
          />
        </div>
        <ProfileTemplateRenderer slug={activeTemplate} profileData={profileData} />
        <div className="px-4 sm:px-6 lg:px-8">
          <TemplateBehaviorPanel
            compact
            behavior={templateBehavior}
            onPrimaryAction={handleTemplatePrimaryAction}
            onSecondaryAction={handleOpenChat}
          />
          {activeTemplate === 'property_manager' ? (
            <div className="mt-6">
              <PropertyOperationsPublicSection data={propertyOpsData} />
            </div>
          ) : null}
          {['trades_pro', 'electrician', 'auto_mechanic'].includes(activeTemplate) ? (
            <div className="mt-6">
              <TradesOperationsPublicSection data={tradesOpsData} />
            </div>
          ) : null}
          {['beauty_style', 'barbershop', 'hair_stylist', 'spa_skincare'].includes(activeTemplate) ? (
            <div className="mt-6">
              <BeautyOperationsPublicSection data={beautyOpsData} />
            </div>
          ) : null}
          {['photographer', 'creative_studio', 'graphic_design'].includes(activeTemplate) ? (
            <div className="mt-6">
              <CreativeOperationsPublicSection data={creativeOpsData} />
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
        url={`${getPublicSiteUrl()}/business/${id}`}
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

      {/* Business hero header - identical component to helper profile */}
      <BusinessHeader
        helperId={helper.id}
        helper={helper}
        onBookNow={handleBookNow}
        onPostJobPublic={handlePostJobPublic}
        onOpenChat={handleOpenChat}
        shareUrl={`${getPublicSiteUrl()}/business/${id}`}
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

            <TemplateBehaviorPanel
              behavior={templateBehavior}
              onPrimaryAction={handleTemplatePrimaryAction}
              onSecondaryAction={handleOpenChat}
            />

            {activeTemplate === 'property_manager' ? (
              <PropertyOperationsPublicSection data={propertyOpsData} />
            ) : null}
            {['trades_pro', 'electrician', 'auto_mechanic'].includes(activeTemplate) ? (
              <TradesOperationsPublicSection data={tradesOpsData} />
            ) : null}
            {['beauty_style', 'barbershop', 'hair_stylist', 'spa_skincare'].includes(activeTemplate) ? (
              <BeautyOperationsPublicSection data={beautyOpsData} />
            ) : null}
            {['photographer', 'creative_studio', 'graphic_design'].includes(activeTemplate) ? (
              <CreativeOperationsPublicSection data={creativeOpsData} />
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

            {/* Bottom padding for mobile CTA bar + FAB + iOS home indicator */}
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
              <div className="flex-1 min-h-0" style={{ minHeight: '360px', maxHeight: 'min(80vh, calc(100vh - 200px))' }}>
                <ChatPanel
                  session={chatSession}
                  helperName={helper.businessName}
                  helperId={helper.id}
                  businessId={String(bizId)}
                  isGuest={isGuestVisitor}
                  allowLiveChat={helper.allowLiveChat}
                  variant="sidebar"
                  className="h-full"
                />
              </div>
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
          onClick={services.length > 0 ? handleBookNow : undefined}
          disabled={services.length === 0}
          title={services.length === 0 ? t('helperProfile.cta.noServicesTitle') : undefined}
          className="flex-[2] py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold text-sm transition-colors shadow-lg shadow-brand-500/20 disabled:opacity-50 disabled:cursor-not-allowed active:bg-brand-700"
          aria-label={t('businessProfile.bookBusinessAria')}
        >
          {t('businessProfile.bookNow')}
        </button>
      </div>

      {/* ── Mobile chat drawer ───────────────────────────────────────── */}
      <MobileChatDrawer open={chatOpen} onClose={() => setChatOpen(false)}>
        <ChatPanel
          session={chatSession}
          helperName={helper.businessName}
          helperId={helper.id}
          businessId={String(bizId)}
          isGuest={isGuestVisitor}
          allowLiveChat={helper.allowLiveChat}
          variant="modal"
          onClose={() => setChatOpen(false)}
          className="h-full"
        />
      </MobileChatDrawer>

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

      {/* ── Mobile chat FAB ──────────────────────────────────────────── */}
      {!chatOpen && (
        <button
          onClick={handleOpenChat}
          className="lg:hidden fixed right-4 z-30 w-12 h-12 rounded-full bg-brand-500 hover:bg-brand-600 text-white shadow-lg shadow-brand-500/30 flex items-center justify-center transition-colors active:bg-brand-700"
          style={{ bottom: 'calc(76px + env(safe-area-inset-bottom))' }}
          aria-label="Open chat"
        >
          <MessageCircle className="w-5 h-5" aria-hidden="true" />
        </button>
      )}

      <BackToTopButton />
    </div>
  );
}
