import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { History } from 'lucide-react';
import { useRecentlyViewed } from '../hooks/useRecentlyViewed';

/**
 * "Recently viewed" / continue-where-you-left-off strip.
 * Reads from the client-side store maintained by recordView() in
 * useRecentlyViewed.js. Renders nothing when there is nothing to resume.
 */
export default function RecentlyViewedStrip({ kind, className = '' }) {
  const { t } = useTranslation();
  const items = useRecentlyViewed(kind);

  if (items.length === 0) return null;

  return (
    <section className={className} aria-label={t('recentlyViewed.title')}>
      <div className="flex items-center gap-2 mb-3">
        <History className="w-4 h-4 text-brand-600" aria-hidden="true" />
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">
          {t('recentlyViewed.title')}
        </h2>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2" style={{ WebkitOverflowScrolling: 'touch' }}>
        {items.map((item) => (
          <Link
            key={item.id}
            to={item.href}
            className="shrink-0 w-40 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden hover:shadow-md transition-shadow"
          >
            <div className="w-full h-20 bg-gray-100 dark:bg-gray-800 flex items-center justify-center overflow-hidden">
              {item.image ? (
                <img src={item.image} alt="" className="w-full h-full object-cover" loading="lazy" />
              ) : (
                <span className="text-xl font-semibold text-gray-400 dark:text-gray-500">
                  {(item.title || '?').trim().charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <div className="p-2">
              <p className="text-xs font-semibold text-gray-900 dark:text-white truncate" title={item.title}>
                {item.title}
              </p>
              {item.subtitle ? (
                <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate" title={item.subtitle}>
                  {item.subtitle}
                </p>
              ) : null}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
