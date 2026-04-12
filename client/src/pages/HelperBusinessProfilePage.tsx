/**
 * HelperBusinessProfilePage
 *
 * Customer-facing helper/small-business profile page for OxSteed.
 *
 * Layout:
 *   - Desktop (lg+): 2-column grid. Left 7/12 = profile sections stacked.
 *                    Right 5/12 = sticky CTA card + embedded ChatPanel.
 *   - Mobile: single column, sticky mobile CTA bar at bottom,
 *             FAB triggers full-screen chat drawer.
 *
 * API integration notes (see bottom of file).
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import PageMeta from '../components/PageMeta';
import { MessageCircle, X, ArrowUp } from 'lucide-react';

import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

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
import ChatPanel from '../components/helperProfile/chat/ChatPanel';

// Dynamic blocks (Issue #35) — fetched client-side after static shell renders
import { AvailabilityBlock, PricingBlock, SlotsBlock } from '../components/helperProfile/DynamicBlocks';

// Types & API
import type { HelperProfileData, LoadingState, Service } from '../types/helperProfile';
import { fetchHelperProfile } from '../api/helpers';

// ── Loading skeleton ──────────────────────────────────────────────────────────
const ProfileSkeleton: React.FC = () => (
  <div className="animate-pulse space-y-4">
    <div className="h-56 bg-gray-800 rounded-none" />
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-4">
      <div className="flex gap-4">
        <div className="w-24 h-24 rounded-2xl bg-gray-800 -mt-12 flex-shrink-0" />
        <div className="space-y-2 flex-1 pt-2">
          <div className="h-6 bg-gray-800 rounded w-3/5" />
          <div className="h-4 bg-gray-800 rounded w-2/5" />
        </div>
      </div>
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-40 bg-gray-800 rounded-2xl" />
      ))}
    </div>
  </div>
);

// ── Error state ───────────────────────────────────────────────────────────────
const ProfileError: React.FC<{ message: string; onRetry: () => void }> = ({
  message,
  onRetry,
}) => (
  <div className="min-h-[50vh] flex flex-col items-center justify-center gap-4 px-4 text-center">
    <div className="w-14 h-14 rounded-full bg-red-900/30 flex items-center justify-center">
      <X className="w-7 h-7 text-red-400" aria-hidden="true" />
    </div>
    <div>
      <p className="text-white font-medium">Unable to load this profile</p>
      <p className="text-gray-400 text-sm mt-1">{message}</p>
    </div>
    <button
      onClick={onRetry}
      className="px-5 py-2.5 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium rounded-xl transition-colors"
    >
      Try again
    </button>
  </div>
);

// ── Mobile chat drawer ────────────────────────────────────────────────────────
const MobileChatDrawer: React.FC<{
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ open, onClose, children }) => {
  const drawerRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef<number>(0);
  const touchCurrentY = useRef<number>(0);
  // Track whether the current touch sequence started on the drag handle.
  // Only sequences that start there should move/dismiss the drawer.
  // This prevents touch events inside ChatTimeline (scroll) from being
  // captured by the dismiss logic — fixes Bugbot HIGH issue #1.
  const isDragging = useRef<boolean>(false);

  // Lock body scroll when drawer is open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  // ── Drag-handle touch handlers only ──────────────────────────────────────
  // These are attached exclusively to the drag handle div. Touches that begin
  // elsewhere (e.g. inside the scrollable ChatTimeline) never set isDragging,
  // so they fall through to normal scroll behaviour.
  const handleHandleTouchStart = (e: React.TouchEvent) => {
    isDragging.current = true;
    touchStartY.current = e.touches[0].clientY;
    touchCurrentY.current = e.touches[0].clientY;
  };

  const handleHandleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging.current) return;
    touchCurrentY.current = e.touches[0].clientY;
    const delta = touchCurrentY.current - touchStartY.current;
    if (!drawerRef.current) return;
    if (delta > 0) {
      // Disable CSS transition while finger is down so the drawer tracks
      // the finger with zero lag.
      drawerRef.current.classList.add('ox-drawer-dragging');
      drawerRef.current.style.transform = `translateY(${Math.min(delta, 120)}px)`;
    } else {
      // Finger moved back above the start point — snap to resting position
      // and re-enable transition so the snap feels smooth.
      drawerRef.current.classList.remove('ox-drawer-dragging');
      drawerRef.current.style.transform = '';
    }
  };

  // Shared cleanup used by both touchend and touchcancel.
  const snapBackDrawer = () => {
    if (drawerRef.current) {
      drawerRef.current.classList.remove('ox-drawer-dragging');
      drawerRef.current.style.transform = '';
    }
  };

  const handleHandleTouchEnd = () => {
    if (!isDragging.current) return;
    isDragging.current = false;
    const delta = touchCurrentY.current - touchStartY.current;
    if (delta > 80) {
      // Dismissing: do NOT remove the ox-drawer-dragging class or clear the
      // transform. Removing it would re-enable transition-transform, causing the
      // drawer to animate back up (wrong direction) before onClose unmounts it.
      onClose();
    } else {
      // Snap back: re-enable the CSS transition, then clear the transform so
      // the drawer smoothly returns to its resting position.
      snapBackDrawer();
    }
  };

  // touchcancel fires when the OS interrupts the touch sequence (incoming call,
  // system gesture, etc.). Without this handler isDragging stays true, the
  // ox-drawer-dragging class stays on, and the transform stays applied —
  // leaving the drawer visually stuck until the next complete drag.
  const handleHandleTouchCancel = () => {
    isDragging.current = false;
    snapBackDrawer();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label="Chat"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Drawer — transition-transform is the default; the 'ox-drawer-dragging'
          class removes it so there is no lag while the finger is down. */}
      <div
        ref={drawerRef}
        className="relative mt-auto bg-gray-950 rounded-t-2xl flex flex-col shadow-2xl transition-transform duration-300"
        style={{ height: '90dvh' }}
      >
        {/* Drag handle — tappable + swipeable */}
        <div
          className="flex justify-center pt-3 pb-1 flex-shrink-0 cursor-pointer"
          onTouchStart={handleHandleTouchStart}
          onTouchMove={handleHandleTouchMove}
          onTouchEnd={handleHandleTouchEnd}
          onTouchCancel={handleHandleTouchCancel}
          onClick={onClose}
          role="button"
          aria-label="Close chat"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && onClose()}
        >
          <div className="w-10 h-1 rounded-full bg-gray-600" aria-hidden="true" />
        </div>
        <div className="flex-1 overflow-hidden px-3 pb-3">
          {children}
        </div>
      </div>

      {/* Inline style: scoped to ox-drawer-dragging to avoid colliding with
          any other component that uses the generic 'dragging' class name. */}
      <style>{`.ox-drawer-dragging { transition: none !important; }`}</style>
    </div>
  );
};

// ── Back-to-top button ────────────────────────────────────────────────────────
const BackToTopButton: React.FC = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handler = () => setVisible(window.scrollY > 600);
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, []);

  if (!visible) return null;

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      // Moved to left-4 so it never collides with the FAB (right side)
      className="fixed bottom-24 left-4 z-30 lg:bottom-8 lg:left-auto lg:right-4 w-10 h-10 rounded-full bg-gray-800 border border-gray-700 text-gray-300 hover:text-white hover:bg-gray-700 transition-colors shadow-lg flex items-center justify-center"
      aria-label="Back to top"
    >
      <ArrowUp className="w-4 h-4" aria-hidden="true" />
    </button>
  );
};

// ── Page nav anchors ──────────────────────────────────────────────────────────
const PAGE_SECTIONS = [
  { id: 'services',  label: 'Services'  },
  { id: 'gallery',   label: 'Photos'    },
  { id: 'reviews',   label: 'Reviews'   },
  { id: 'faqs',      label: 'FAQs'      },
  { id: 'policies',  label: 'Policies'  },
];

const SectionNav: React.FC = () => {
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <nav
      aria-label="Page sections"
      className="sticky top-0 z-20 bg-gray-950/90 backdrop-blur-md border-b border-gray-800"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <ul className="flex gap-1 overflow-x-auto hide-scrollbar py-2" role="list">
          {PAGE_SECTIONS.map((s) => (
            <li key={s.id} role="listitem">
              <button
                onClick={() => scrollTo(s.id)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-400 hover:text-white hover:bg-gray-800 transition-colors whitespace-nowrap"
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
};

// ── Main page component ───────────────────────────────────────────────────────
const HelperBusinessProfilePage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [data, setData] = useState<HelperProfileData | null>(null);
  const [loadState, setLoadState] = useState<LoadingState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

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
      setLoadState('success');
    } catch (err) {
      setError('Something went wrong loading this profile. Please try again.');
      setLoadState('error');
    }
  }, [id]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  // Service selection — placeholder for routing to booking flow
  const handleSelectService = useCallback((service: Service) => {
    /**
     * API INTEGRATION POINT:
     *   navigate(`/book/${data?.helper.id}?service=${service.id}`)
     */
    console.info('[OxSteed] Service selected for booking:', service.id, service.name);
  }, []);

  const handleBookNow = useCallback(() => {
    const params = new URLSearchParams({ helperId: id!, helperName: data?.helper.businessName || '' });
    navigate(`/post-job?${params.toString()}`);
  }, [id, data, navigate]);

  const handleOpenChat = useCallback(() => {
    setChatOpen(true);
  }, []);

  // ── Render states ──────────────────────────────────────────────────────────
  if (loadState === 'loading' || loadState === 'idle') {
    return (
      <div className="min-h-screen bg-gray-950 text-white">
        <Navbar />
        <ProfileSkeleton />
      </div>
    );
  }

  if (loadState === 'error' || !data) {
    return (
      <div className="min-h-screen bg-gray-950 text-white">
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

  const { helper, services, gallery, hours, location, policies, reviews, faqs, chatSession } =
    data;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <PageMeta
        title={helper.businessName || helper.ownerName}
        description={
          helper.tagline ||
          `Hire ${helper.businessName || helper.ownerName} on OxSteed — verified local helper in ${helper.city || 'your area'}.`
        }
        image={helper.coverImage || helper.avatar}
        url={`https://oxsteed.com/helpers/${id}`}
        type="profile"
      />
      <Navbar />

      {/* Business hero header */}
      <BusinessHeader
        helper={helper}
        onBookNow={handleBookNow}
        onOpenChat={handleOpenChat}
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
            {/* Bio callout — only render if bio exists */}
            {helper.bio && (
              <section
                aria-labelledby="bio-heading"
                className="bg-gray-900 border border-gray-800 rounded-2xl px-6 py-5"
              >
                <h2 id="bio-heading" className="text-base font-semibold text-white mb-2">
                  About {helper.businessName}
                </h2>
                <p className="text-gray-300 text-sm leading-relaxed">{helper.bio}</p>
              </section>
            )}

            <ServicesSection
              services={services}
              onSelectService={handleSelectService}
            />

            <GallerySection images={gallery} />

            {/* Hours + Location side by side on md+ */}
            <div className="grid sm:grid-cols-2 gap-6">
              <HoursSection hours={hours} />
              <LocationSection location={location} />
            </div>

            <PoliciesSection policies={policies} />

            {/* ── Dynamic blocks (Issue #35) ── fetched client-side after page load ── */}
            <AvailabilityBlock helperId={id!} />
            <PricingBlock helperId={id!} />
            <SlotsBlock helperId={id!} />

            <ReviewsSection
              reviews={reviews}
              overallRating={helper.rating}
              totalCount={helper.reviewCount}
            />

            <FAQSection faqs={faqs} />

            {/*
              Bottom padding so mobile CTA bar + FAB + iOS home indicator
              don't obscure the last section. h-32 = 128px covers:
                CTA bar ~64px + FAB position ~80px + safe area ~34px
            */}
            <div className="h-32 lg:hidden" aria-hidden="true" />
          </div>

          {/* ── Right column: CTA + Chat (desktop) ─────────── */}
          <aside
            className="hidden lg:flex lg:col-span-5 flex-col gap-5"
            aria-label="Book and chat"
          >
            {/* Sticky wrapper */}
            <div className="sticky top-16 space-y-5 max-h-[calc(100vh-5rem)] flex flex-col">
              <CTASection
                helper={helper}
                onBookNow={handleBookNow}
                onOpenChat={handleOpenChat}
                hasServices={services.length > 0}
              />
              <div className="flex-1 min-h-0" style={{ minHeight: '480px', height: '540px' }}>
                <ChatPanel
                  session={chatSession}
                  helperName={helper.businessName}
                  helperId={helper.id}
                  variant="sidebar"
                  className="h-full"
                />
              </div>
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
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 px-4 pt-3 bg-gray-900/95 backdrop-blur border-t border-gray-800 flex items-center gap-3"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        aria-label="Quick actions"
      >
        <button
          onClick={handleOpenChat}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-gray-700 text-gray-200 font-medium text-sm flex-1 hover:bg-gray-800 transition-colors active:bg-gray-700"
          aria-label="Open chat with this helper"
        >
          <MessageCircle className="w-4 h-4" aria-hidden="true" />
          Message
        </button>
        <button
          onClick={services.length > 0 ? handleBookNow : undefined}
          disabled={services.length === 0}
          title={services.length === 0 ? "This helper hasn't listed services yet — send them a message." : undefined}
          className="flex-[2] py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold text-sm transition-colors shadow-lg shadow-brand-500/20 disabled:opacity-50 disabled:cursor-not-allowed active:bg-brand-700"
          aria-label="Book this helper"
        >
          Book Now
        </button>
      </div>

      {/* ── Mobile chat drawer ───────────────────────────────── */}
      <MobileChatDrawer open={chatOpen} onClose={() => setChatOpen(false)}>
        <ChatPanel
          session={chatSession}
          helperName={helper.businessName}
          helperId={helper.id}
          variant="modal"
          onClose={() => setChatOpen(false)}
          className="h-full"
        />
      </MobileChatDrawer>

      {/*
        ── Mobile chat FAB ────────────────────────────────────────
        bottom-[76px] clears the CTA bar (~64px tall) on all phones.
        Stays on the RIGHT side; BackToTop is now on the LEFT.
      */}
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
