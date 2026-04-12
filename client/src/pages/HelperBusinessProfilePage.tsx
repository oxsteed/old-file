/**
 * HelperBusinessProfilePage
 *
 * Customer-facing helper/small-business profile page for OxSteed.
 *
 * Layout:
 * - Desktop (lg+): 2-column grid. Left 7/12 = profile sections stacked.
 *   Right 5/12 = sticky CTA card + embedded ChatPanel.
 * - Mobile: single column, sticky mobile CTA bar at bottom,
 *   FAB triggers full-screen chat drawer.
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
  const [startY, setStartY] = useState<number | null>(null);
  const [currentY, setCurrentY] = useState(0);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const handleTouchStart = (e: React.TouchEvent) => {
    setStartY(e.touches[0].clientY);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (startY === null) return;
    const deltaY = e.touches[0].clientY - startY;
    if (deltaY > 0) setCurrentY(deltaY);
  };

  const handleTouchEnd = () => {
    if (currentY > 100) {
      onClose();
    }
    setStartY(null);
    setCurrentY(0);
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
        className="absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />
      
      {/* Drawer */}
      <div 
        ref={drawerRef}
        className="relative mt-auto bg-gray-950 rounded-t-2xl flex flex-col h-[90dvh] shadow-2xl transition-transform duration-300 ease-out border-t border-gray-800 pb-[env(safe-area-inset-bottom)]"
        style={{ transform: `translateY(${currentY}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Drag handle */}
        <button 
          className="flex justify-center pt-3 pb-2 flex-shrink-0 cursor-grab active:cursor-grabbing w-full group"
          onClick={onClose}
          aria-label="Close chat"
        >
          <div className="w-12 h-1.5 rounded-full bg-gray-800 group-hover:bg-gray-700 transition-colors" aria-hidden="true" />
        </button>

        <div className="flex-1 min-h-0 px-3 pb-3">
          {children}
        </div>
      </div>
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
      className="fixed bottom-[136px] right-4 z-30 lg:bottom-8 w-10 h-10 rounded-full bg-gray-800/90 backdrop-blur border border-gray-700 text-gray-300 hover:text-white hover:bg-gray-700 transition-all shadow-lg flex items-center justify-center active:scale-90"
      aria-label="Back to top"
    >
      <ArrowUp className="w-4 h-4" aria-hidden="true" />
    </button>
  );
};

// ── Page nav anchors ──────────────────────────────────────────────────────────
const PAGE_SECTIONS = [
  { id: 'services', label: 'Services' },
  { id: 'gallery', label: 'Photos' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'faqs', label: 'FAQs' },
  { id: 'policies', label: 'Policies' },
];

const SectionNav: React.FC = () => {
  const scrollTo = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      // Offset for sticky nav + section nav
      const offset = 120;
      const elementPosition = element.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - offset;

      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth'
      });
    }
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

            {/* Bottom padding so mobile CTA bar doesn't cover content */}
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

      {/* ── Mobile: sticky bottom CTA bar ───────────────────── */}
      <div
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] bg-gray-900/95 backdrop-blur border-t border-gray-800 flex items-center gap-3"
        aria-label="Quick actions"
      >
        <button
          onClick={handleOpenChat}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-gray-700 text-gray-200 font-medium text-sm flex-1 hover:bg-gray-800 transition-colors"
          aria-label="Open chat with this helper"
        >
          <MessageCircle className="w-4 h-4" aria-hidden="true" />
          Message
        </button>
        <button
          onClick={services.length > 0 ? handleBookNow : undefined}
          disabled={services.length === 0}
          title={services.length === 0 ? "This helper hasn't listed services yet — send them a message." : undefined}
          className="flex-[2] py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold text-sm transition-colors shadow-lg shadow-brand-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
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

      {/* ── Mobile chat FAB (alternative entry point) ────────── */}
      {!chatOpen && (
        <button
          onClick={handleOpenChat}
          className="lg:hidden fixed bottom-[88px] right-4 z-30 w-12 h-12 rounded-full bg-brand-500 hover:bg-brand-600 text-white shadow-lg shadow-brand-500/30 flex items-center justify-center transition-all active:scale-95"
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
