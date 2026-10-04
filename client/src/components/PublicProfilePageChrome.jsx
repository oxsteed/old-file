/**
 * Shared shell UI for public helper/business profile pages
 * (skeleton, error, section nav, back-to-top).
 */
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, ArrowUp } from 'lucide-react';

export function ProfileSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-56 bg-gray-200 dark:bg-gray-800 rounded-none" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-4">
        <div className="flex gap-4">
          <div className="w-24 h-24 rounded-2xl bg-gray-200 dark:bg-gray-800 -mt-12 flex-shrink-0" />
          <div className="space-y-2 flex-1 pt-2">
            <div className="h-6 bg-gray-200 dark:bg-gray-800 rounded w-3/5" />
            <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-2/5" />
          </div>
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-40 bg-gray-200 dark:bg-gray-800 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

export function ProfileError({ message, onRetry, headline = undefined }) {
  const { t } = useTranslation();
  const resolvedHeadline = headline ?? t('helperProfile.chrome.unableToLoad');
  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="w-14 h-14 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
        <X className="w-7 h-7 text-red-600 dark:text-red-400" aria-hidden="true" />
      </div>
      <div>
        <p className="text-gray-900 dark:text-white font-medium">{resolvedHeadline}</p>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">{message}</p>
      </div>
      <button
        onClick={onRetry}
        className="px-5 py-2.5 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium rounded-xl transition-colors"
      >
        {t('helperProfile.chrome.tryAgain')}
      </button>
    </div>
  );
}

export function BackToTopButton() {
  const { t } = useTranslation();
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
      className="fixed bottom-24 start-4 z-30 lg:bottom-8 lg:start-auto lg:end-4 w-10 h-10 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors shadow-lg flex items-center justify-center"
      aria-label={t('helperProfile.chrome.backToTop')}
    >
      <ArrowUp className="w-4 h-4" aria-hidden="true" />
    </button>
  );
}

export function SectionNav({ visibleSections }) {
  const { t } = useTranslation();
  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const sections = [
    { id: 'services', label: t('helperProfile.chrome.sectionServices') },
    { id: 'gallery', label: t('helperProfile.chrome.sectionGallery') },
    { id: 'reviews', label: t('helperProfile.chrome.sectionReviews') },
    { id: 'faqs', label: t('helperProfile.chrome.sectionFaqs') },
    { id: 'policies', label: t('helperProfile.chrome.sectionPolicies') },
  ].filter((s) => !visibleSections || visibleSections.includes(s.id));
  return (
    <nav aria-label={t('helperProfile.chrome.pageSections')} className="sticky top-0 z-20 bg-white/90 dark:bg-gray-950/90 backdrop-blur-md border-b border-gray-200 dark:border-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <ul className="flex gap-1 overflow-x-auto hide-scrollbar py-2" role="list">
          {sections.map((s) => (
            <li key={s.id} role="listitem">
              <button
                onClick={() => scrollTo(s.id)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors whitespace-nowrap"
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

export const PROFILE_PAGE_SECTIONS = [
  { id: 'services', label: 'Services' },
  { id: 'gallery', label: 'Photos' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'faqs', label: 'FAQs' },
  { id: 'policies', label: 'Policies' },
];
