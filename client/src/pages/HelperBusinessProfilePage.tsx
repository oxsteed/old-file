/**
 * HelperBusinessProfilePage
 *
 * Customer-facing helper/small-business profile page for OxSteed.
 *
 * Layout:
 *   - Desktop (lg+): 2-column grid. Left 7/12 = profile sections stacked.
 *                    Right 5/12 = sticky reputation + messenger invite card.
 *   - Mobile: single column, sticky mobile CTA bar at bottom.
 *   - Messenger dock (desktop panel / mobile sheet) shared by header CTA + launcher.
 *
 * API integration notes (see bottom of file).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageMeta from '../components/PageMeta';
import ProfileJsonLd from '../components/ProfileJsonLd';
import { buildPublicProfileDescription, getPublicSiteUrl } from '../utils/seoDescription';
import ProfileShareControls from '../components/helperProfile/ProfileShareControls';
import { MessageCircle, Flag, GraduationCap } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';
import toast from 'react-hot-toast';
import { defaultProfileChatDestination } from '../components/helperProfile/chat/messengerDockState.js';
import UserReputationCard from '../components/UserReputationCard';
import ReportModal from '../components/ReportModal';

import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import CancellationStats from '../components/CancellationStats';
import {
  ProfileSkeleton,
  ProfileError,
  BackToTopButton,
  SectionNav,
} from '../components/PublicProfilePageChrome';

// Profile sections
import BusinessHeader from '../components/helperProfile/BusinessHeader';
import ServicesSection from '../components/helperProfile/ServicesSection';
import GallerySection from '../components/helperProfile/GallerySection';
import HoursSection from '../components/helperProfile/HoursSection';
import LocationSection from '../components/helperProfile/LocationSection';
import PoliciesSection from '../components/helperProfile/PoliciesSection';
import ReviewsSection from '../components/helperProfile/ReviewsSection';
import FAQSection from '../components/helperProfile/FAQSection';
import CTASection from '../components/helperProfile/CTASection';

// Chat
import PublicProfileMessenger from '../components/helperProfile/chat/PublicProfileMessenger.jsx';
import { MessengerInviteCard } from '../components/helperProfile/chat/MessengerDock.jsx';

// Dynamic blocks (Issue #35) - fetched client-side after static shell renders
import { AvailabilityBlock, PricingBlock, SlotsBlock } from '../components/helperProfile/DynamicBlocks';

// Types & API
import type { HelperProfileData, LoadingState, Service } from '../types/helperProfile';
import { fetchHelperProfile } from '../api/helpers';
// Template system
import { ProfileTemplateRenderer, getTemplateBehavior } from '../components/profileTemplates/index';
import { LAUNCH_VISIBILITY } from '../utils/launchScope';

// ── Main page component ───────────────────────────────────────────────────────
const HelperBusinessProfilePage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user } = useAuth();

  const [data, setData] = useState<HelperProfileData | null>(null);
  const [loadState, setLoadState] = useState<LoadingState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [activeTemplate, setActiveTemplate] = useState<string>('default');
  const [chatOpen, setChatOpen] = useState(false);
  const [savedHelperId, setSavedHelperId] = useState<number | null>(null);
  const [savingHelper, setSavingHelper] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [guestSignInModalOpen, setGuestSignInModalOpen] = useState(false);
  const [chatDestination, setChatDestination] = useState<'helper' | 'oxsteed'>(defaultProfileChatDestination()); // provider, not OxSteed AI

  // Set scroll-padding-top so SectionNav anchor links don't hide under sticky bars
  useEffect(() => {
    // Approximate: Navbar (~64px) + SectionNav (~40px) + a little breathing room
    const previous = document.documentElement.style.scrollPaddingTop;
    document.documentElement.style.scrollPaddingTop = '112px';
    return () => {
      document.documentElement.style.scrollPaddingTop = previous;
    };
  }, []);

  const loadProfile = useCallback(async () => {
    setLoadState('loading');
    setError(null);

    try {
      const profileData = await fetchHelperProfile(id!);
      setData(profileData);
      setActiveTemplate((profileData as any).activeTemplate || 'default');
      setLoadState('success');
    } catch (err) {
      setError(t('helperProfile.chrome.unableToLoad'));
      setLoadState('error');
    }
  }, [id]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (!user || !id) {
      setSavedHelperId(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data: saved } = await api.get('/life/saved-helpers');
        if (cancelled) return;
        const match = (saved.saved_helpers || []).find((item: any) => String(item.helper_id) === String(id));
        setSavedHelperId(match?.id ?? null);
      } catch {
        if (!cancelled) setSavedHelperId(null);
      }
    })();
    return () => { cancelled = true; };
  }, [id, user]);

  // Service selection - placeholder for routing to booking flow
  const handleSelectService = useCallback(
    (service: Service) => {
      const hint = encodeURIComponent(service.name || '');
      navigate(`/book/${id}?serviceHint=${hint}`);
    },
    [id, navigate]
  );

  const handleBookNow = useCallback(() => {
    const params = new URLSearchParams({
      helperName: data?.helper.businessName || '',
    });
    navigate(`/book/${id}?${params.toString()}`);
  }, [id, data, navigate]);

  const handlePostJobPublic = useCallback(() => {
    const params = new URLSearchParams({
      helperId: id!,
      helperName: data?.helper.businessName || '',
    });
    navigate(`/post-job?${params.toString()}`);
  }, [id, data, navigate]);

  const handleTemplatePrimaryAction = useCallback(() => {
    if (!LAUNCH_VISIBILITY.specializedProfileTemplates) {
      handleBookNow();
      return;
    }
    const behavior = getTemplateBehavior(activeTemplate);
    if (behavior.primaryIntent === 'maintenance_request') {
      const params = new URLSearchParams({
        helperId: id!,
        helperName: data?.helper.businessName || '',
        mode: 'maintenance_request',
      });
      navigate(`/post-job?${params.toString()}`);
      return;
    }
    if (behavior.primaryIntent === 'tool_rental') {
      navigate('/tool-rentals');
      return;
    }
    handleBookNow();
  }, [activeTemplate, data, handleBookNow, id, navigate]);

  const handleToggleSavedHelper = useCallback(async () => {
    if (!id) return;
    if (!user) {
      navigate('/login', { state: { from: `/helpers/public/${id}` } });
      return;
    }
    if (String(user.id) === String(id)) {
      toast.error(t('helperProfile.header.cannotSaveSelf'));
      return;
    }
    setSavingHelper(true);
    try {
      if (savedHelperId) {
        await api.delete(`/life/saved-helpers/${savedHelperId}`);
        setSavedHelperId(null);
        toast.success(t('helperProfile.header.removedSavedHelper', { name: data?.helper?.businessName || data?.helper?.ownerName || '' }));
      } else {
        const { data: saved } = await api.post('/life/saved-helpers', {
          helper_id: id,
        });
        setSavedHelperId(saved.id);
        toast.success(t('helperProfile.header.addedSavedHelper', { name: data?.helper?.businessName || data?.helper?.ownerName || '' }));
      }
    } catch {
      toast.error(t('helperProfile.header.saveHelperFailed'));
    } finally {
      setSavingHelper(false);
    }
  }, [data, id, navigate, savedHelperId, t, user]);

  const openMessengerDock = useCallback(() => {
    if (user) {
      setChatOpen(true);
      return;
    }
    const allow = data?.helper?.allowGuestContact !== false;
    if (allow) {
      setChatOpen(true);
    } else {
      setGuestSignInModalOpen(true);
    }
  }, [user, data?.helper?.allowGuestContact]);

  const handleMessageHelper = useCallback(() => {
    setChatDestination('helper');
    openMessengerDock();
  }, [openMessengerDock]);

  const handleOpenChat = useCallback(() => {
    openMessengerDock();
  }, [openMessengerDock]);

  // ── Render states ──────────────────────────────────────────────────────────
  if (loadState === 'loading' || loadState === 'idle') {
    return (
      <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-white">
        <Navbar />
        <ProfileSkeleton />
      </div>
    );
  }

  if (loadState === 'error' || !data) {
    return (
      <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-white">
        <Navbar />
        <main className="py-16">
          <ProfileError
            message={error ?? 'Unknown error'}
            onRetry={loadProfile}
          />
        </main>
        <Footer />
      </div>
    );
  }

  const { helper, services, gallery, hours, location, policies, reviews, faqs, visibility, chatSession } =
    data;

  const isGuestVisitor = !user;
  const templateBehavior = getTemplateBehavior(
    LAUNCH_VISIBILITY.specializedProfileTemplates ? activeTemplate : 'default',
  );

  // ── Template override: non-default templates replace the page interior ─────
  if (LAUNCH_VISIBILITY.specializedProfileTemplates && activeTemplate && activeTemplate !== 'default') {
    return (
      <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-white">
        <PageMeta
          title={helper.businessName || helper.ownerName}
          description={buildPublicProfileDescription({
            displayName: helper.businessName || helper.ownerName,
            tagline: helper.tagline,
            bio: helper.bio,
            city: helper.city,
            state: helper.state,
            entityLabel: 'helper',
          })}
          image={helper.coverImage || helper.avatar}
          url={`${getPublicSiteUrl()}/helpers/public/${id}`}
          type="profile"
        />
        <Navbar />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 pb-2">
          <ProfileShareControls
            shareUrl={`${getPublicSiteUrl()}/helpers/public/${id}`}
            shareTitle={helper.businessName || helper.ownerName}
          />
        </div>
        <ProfileTemplateRenderer slug={activeTemplate} profileData={data} />
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-white">
      <PageMeta
        title={helper.businessName || helper.ownerName}
        description={buildPublicProfileDescription({
          displayName: helper.businessName || helper.ownerName,
          tagline: helper.tagline,
          bio: helper.bio,
          city: helper.city,
          state: helper.state,
          entityLabel: 'helper',
        })}
        image={helper.coverImage || helper.avatar}
        url={`${getPublicSiteUrl()}/helpers/public/${id}`}
        type="profile"
      />
      <ProfileJsonLd
        variant="helper"
        helperId={id!}
        helper={helper}
        location={location}
        services={services}
      />
      <Navbar />

      {/* Helper hero — PublicProfileSummaryCard via BusinessHeader / PublicProfileHero */}
      <BusinessHeader
        helperId={id}
        helper={helper}
        onBookNow={handleBookNow}
        onPostJobPublic={handlePostJobPublic}
        onToggleSaved={handleToggleSavedHelper}
        isSaved={!!savedHelperId}
        savingHelper={savingHelper}
        onOpenChat={handleMessageHelper}
        shareUrl={`${getPublicSiteUrl()}/helpers/public/${id}`}
        shareTitle={helper.businessName || helper.ownerName}
      />

      {/* Sticky section nav */}
      <SectionNav />

      {/* Page body */}
      <main
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8"
        id="main-content"
      >
        <div className="flex flex-col lg:grid lg:grid-cols-12 gap-8">
          {/* ── Left column: profile sections ──────────────── */}
          <div className="lg:col-span-7 space-y-6">
            {/* Bio callout - only render if bio exists */}
            {helper.bio && (
              <section
                aria-labelledby="bio-heading"
                className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl px-6 py-5"
              >
                <h2 id="bio-heading" className="text-base font-semibold text-white mb-2">
                  {t('businessProfile.about', { name: helper.businessName })}
                </h2>
                <p className="text-gray-600 dark:text-gray-300 text-sm leading-relaxed">{helper.bio}</p>
              </section>
            )}

            {/* ── Skill badges from Learn completions ── */}
            {helper.skillBadges && helper.skillBadges.length > 0 && (
              <section
                aria-labelledby="skill-badges-heading"
                className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl px-6 py-5"
              >
                <h2 id="skill-badges-heading" className="text-base font-semibold text-white mb-3 flex items-center gap-2">
                  <GraduationCap size={16} className="text-orange-500" />
                  {t('helperProfile.skillBadges')}
                </h2>
                <div className="flex flex-wrap gap-2">
                  {helper.skillBadges.map((b: { id: string; label: string; category: string }) => (
                    <span
                      key={b.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-orange-500/10 text-orange-400 border border-orange-500/25"
                    >
                      <GraduationCap size={12} />
                      {b.label}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* CTA Section - moved from right sidebar */}
            <CTASection
              helper={helper}
              services={services}
              onBookNow={handleTemplatePrimaryAction}
              onMessageHelper={handleMessageHelper}
              onOpenChat={handleOpenChat}
              hasServices={services.length > 0}
              primaryLabel={templateBehavior.primaryCta}
              secondaryLabel={templateBehavior.secondaryCta}
              allowPrimaryWithoutServices={templateBehavior.allowPrimaryWithoutServices}
            />

            {visibility?.services && (
              <ServicesSection
                services={services}
                onSelectService={handleSelectService}
              />
            )}

            {visibility?.gallery && (
              <GallerySection images={gallery} />
            )}

            {/* Hours + Location side by side on md+ */}
            <div className="grid sm:grid-cols-2 gap-6">
              {visibility?.hours && (
                <HoursSection hours={hours} />
              )}
              <LocationSection location={location} />
            </div>

            {visibility?.policies && (
              <PoliciesSection policies={policies} />
            )}

            {/* ── Dynamic blocks (Issue #35) ── fetched client-side after page load ── */}
            <AvailabilityBlock helperId={id!} />
            <PricingBlock helperId={id!} />
            <SlotsBlock helperId={id!} />

            {/* Helper reliability & job acceptance history */}
            {id && (
              <CancellationStats
                userId={id}
                type="helper"
                showDetails={true}
              />
            )}

            <ReviewsSection
              reviews={reviews}
              overallRating={helper.rating}
              totalCount={helper.reviewCount}
            />

            {visibility?.faqs && (
              <FAQSection faqs={faqs} />
            )}

            {/*
              Bottom padding so mobile CTA bar + launcher + iOS home indicator
              don't obscure the last section. h-32 = 128px covers:
                CTA bar ~64px + launcher ~80px + safe area ~34px
            */}
            <div className="h-32 lg:hidden" aria-hidden="true" />
          </div>

          {/* ── Right column: Chat (desktop) ─────────── */}
          <aside
            className="hidden lg:flex lg:col-span-5 flex-col gap-5"
            aria-label={t('businessProfile.bookAndChatAria')}
          >
            {/* Sticky wrapper: scroll internally so tall reputation card + chat fit below navbar */}
            <div className="sticky top-[7.25rem] max-h-[calc(100vh-7.25rem)] flex flex-col gap-5 overflow-y-auto overscroll-contain">
              <UserReputationCard userId={helper.id} />
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

      {/*
        ── Mobile: sticky bottom CTA bar ──────────────────────────
        env(safe-area-inset-bottom) ensures buttons aren't hidden
        behind the iPhone home indicator.
      */}
      <div
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 px-4 pt-3 bg-white/95 dark:bg-gray-900/95 backdrop-blur border-t border-gray-200 dark:border-gray-800 flex items-center gap-3"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        aria-label={t('businessProfile.quickActionsAria')}
      >
        <button
          onClick={handleOpenChat}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-medium text-sm flex-1 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors active:bg-gray-200 dark:active:bg-gray-700"
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
        avatarUrl={helper.avatar}
        avatarShape="round"
        isGuest={isGuestVisitor}
        allowLiveChat={helper.allowLiveChat}
        allowGuestContact={helper.allowGuestContact !== false}
        destination={chatDestination}
        onDestinationChange={setChatDestination}
        entityKind="helper"
      />

      {guestSignInModalOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70"
          role="dialog"
          aria-modal="true"
          aria-labelledby="guest-signin-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-900 p-6 shadow-xl">
            <h2 id="guest-signin-title" className="text-lg font-semibold text-white mb-2">
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
          userId={helper.id}
          userName={helper.businessName}
          onClose={() => setReportModalOpen(false)}
          onSuccess={() => setReportModalOpen(false)}
        />
      )}

      <BackToTopButton />
    </div>
  );
};

export default HelperBusinessProfilePage;

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * API INTEGRATION NOTES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. PROFILE DATA  GET /api/helpers/:id/profile
 *    Returns: HelperProfile, services, gallery, hours, location, policies, faqs
 *    Replace: mock import in loadProfile()
 *
 * 2. REVIEWS       GET /api/helpers/:id/reviews?page=1&limit=10
 *    Supports pagination. Add a `nextPage` cursor to ReviewsSection props.
 *
 * 3. CHAT SESSION  POST /api/chat/sessions  { helperId }
 *    Returns: ChatSession with id, initialMessages, statuses
 *    Then connect via Socket.io: socket.join(session.id)
 *    Incoming events:
 *      - chat:message   → append ChatMessage to timeline
 *      - chat:event     → append TimelineEvent (booking, handoff, etc.)
 *      - chat:typing    → set typing indicator
 *      - chat:status    → update helperStatus / oxsteedStatus
 *
 * 4. SEND MESSAGE  POST /api/chat/sessions/:sessionId/messages  { content, attachments }
 *    Replace: the setTimeout mock in ChatPanel.handleSend()
 *
 * 5. BOOKING CTA   Navigate to /book/:helperId?service=:serviceId
 *    Replace: handleBookNow and handleSelectService callbacks
 *
 * 6. AUTH CONTEXT  Wrap page with useAuth() to pass userId to chat session
 *    so messages are attributed to the logged-in customer.
 *
 * 7. SEO / META    Add react-helmet-async <title> and <meta> tags using
 *    helper.businessName, helper.tagline, and helper.coverImage.
 * ─────────────────────────────────────────────────────────────────────────────
 */
