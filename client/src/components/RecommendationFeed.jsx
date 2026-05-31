/**
 * RecommendationFeed.jsx
 *
 * Horizontal scrollable strip of "what to do next" cards.
 * Matches the existing dark design system: gray-900 cards, orange accents.
 *
 * Usage:
 *   import RecommendationFeed from '../components/RecommendationFeed';
 *   <RecommendationFeed />
 *
 * Pass `onAction` to be notified when a card CTA is clicked (e.g. to refresh
 * completions after a guide is started).
 */

import { useRef } from 'react';
import { Link } from 'react-router-dom';
import useRecommendations from '../hooks/useRecommendations';

// ── Icon set ─────────────────────────────────────────────────────────────

const icons = {
  book: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/>
      <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/>
    </svg>
  ),
  briefcase: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <rect x="2" y="7" width="20" height="14" rx="2"/>
      <path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/>
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
    </svg>
  ),
  wrench: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>
    </svg>
  ),
  dollar: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <line x1="12" y1="1" x2="12" y2="23"/>
      <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
    </svg>
  ),
  zap: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  ),
  star: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>
  ),
  map: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>
      <circle cx="12" cy="10" r="3"/>
    </svg>
  ),
  share: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
    </svg>
  ),
  shield: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  ),
  award: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <circle cx="12" cy="8" r="7"/>
      <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>
    </svg>
  ),
};

// ── Colour accent per type ────────────────────────────────────────────────

const ACCENT = {
  guide:             'text-blue-400   bg-blue-500/10   border-blue-500/20',
  post_job:          'text-orange-400 bg-orange-500/10 border-orange-500/20',
  find_helper:       'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  rent_tool:         'text-purple-400 bg-purple-500/10 border-purple-500/20',
  list_tool:         'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  earn_income:       'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  start_business:    'text-orange-400 bg-orange-500/10 border-orange-500/20',
  get_consultant:    'text-blue-400   bg-blue-500/10   border-blue-500/20',
  explore_franchise: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  activate_referral: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  complete_profile:  'text-red-400    bg-red-500/10    border-red-500/20',
  upskill_badge:     'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
};

const BTN_ACCENT = {
  guide:             'bg-blue-500/20   hover:bg-blue-500/30   text-blue-300',
  post_job:          'bg-orange-500/20 hover:bg-orange-500/30 text-orange-300',
  find_helper:       'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300',
  rent_tool:         'bg-purple-500/20 hover:bg-purple-500/30 text-purple-300',
  list_tool:         'bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300',
  earn_income:       'bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300',
  start_business:    'bg-orange-500/20 hover:bg-orange-500/30 text-orange-300',
  get_consultant:    'bg-blue-500/20   hover:bg-blue-500/30   text-blue-300',
  explore_franchise: 'bg-purple-500/20 hover:bg-purple-500/30 text-purple-300',
  activate_referral: 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300',
  complete_profile:  'bg-red-500/20    hover:bg-red-500/30    text-red-300',
  upskill_badge:     'bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300',
};

// ── Card ─────────────────────────────────────────────────────────────────

function RecCard({ rec, onDismiss }) {
  const accent = ACCENT[rec.type] || ACCENT.guide;
  const btnAcc = BTN_ACCENT[rec.type] || BTN_ACCENT.guide;
  const icon   = icons[rec.icon_hint] || icons.zap;

  return (
    <div className={`
      flex-shrink-0 w-64 flex flex-col justify-between
      bg-gray-900/80 border rounded-2xl p-4 gap-3
      transition-transform duration-200 hover:-translate-y-0.5
      ${accent.split(' ').slice(2).join(' ')}
    `}>
      {/* header row */}
      <div className="flex items-start justify-between gap-2">
        <div className={`p-2 rounded-xl ${accent.split(' ').slice(1, 2).join(' ')}`}>
          <span className={accent.split(' ')[0]}>{icon}</span>
        </div>
        <button
          onClick={() => onDismiss(rec.id)}
          aria-label="Dismiss"
          className="p-1 text-gray-600 hover:text-gray-400 transition rounded-lg hover:bg-gray-800"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      {/* body */}
      <div className="flex-1">
        <p className="text-white text-sm font-semibold leading-snug mb-1">{rec.title}</p>
        <p className="text-gray-400 text-xs leading-relaxed line-clamp-2">{rec.subtitle}</p>
      </div>

      {/* reason pill */}
      <p className="text-[10px] text-gray-600 leading-tight truncate" title={rec.reason}>
        {rec.reason}
      </p>

      {/* CTA */}
      <Link
        to={rec.action_url}
        className={`
          inline-flex items-center justify-center gap-1.5
          text-xs font-semibold px-3 py-2 rounded-xl transition
          ${btnAcc}
        `}
      >
        {rec.action_label}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
          <line x1="5" y1="12" x2="19" y2="12"/>
          <polyline points="12 5 19 12 12 19"/>
        </svg>
      </Link>
    </div>
  );
}

// ── Feed ─────────────────────────────────────────────────────────────────

/**
 * @param {object}   props
 * @param {string}   [props.title='What to do next']  — section header text
 * @param {function} [props.onAction]                 — called after CTA click
 */
export default function RecommendationFeed({ title = 'What to do next', onAction }) {
  const { recommendations, loading, dismiss } = useRecommendations();
  const scrollRef = useRef(null);

  if (loading) {
    return (
      <div className="mb-6">
        <p className="text-xs uppercase tracking-widest font-semibold text-gray-500 mb-3">{title}</p>
        <div className="flex gap-3 overflow-hidden">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex-shrink-0 w-64 h-40 bg-gray-800/60 rounded-2xl animate-pulse"/>
          ))}
        </div>
      </div>
    );
  }

  if (!recommendations.length) return null;

  const scrollLeft  = () => scrollRef.current?.scrollBy({ left: -280, behavior: 'smooth' });
  const scrollRight = () => scrollRef.current?.scrollBy({ left:  280, behavior: 'smooth' });

  return (
    <section className="mb-6">
      {/* header */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs uppercase tracking-widest font-semibold text-gray-500">{title}</p>
        {recommendations.length > 3 && (
          <div className="flex gap-1">
            <button
              onClick={scrollLeft}
              aria-label="Scroll left"
              className="p-1.5 text-gray-500 hover:text-white rounded-lg hover:bg-gray-800 transition"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
            <button
              onClick={scrollRight}
              aria-label="Scroll right"
              className="p-1.5 text-gray-500 hover:text-white rounded-lg hover:bg-gray-800 transition"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* card strip */}
      <div
        ref={scrollRef}
        className="flex gap-3 overflow-x-auto pb-2 scroll-smooth"
        style={{ scrollbarWidth: 'none' }}
      >
        {recommendations.map((rec) => (
          <RecCard
            key={rec.id}
            rec={rec}
            onDismiss={dismiss}
          />
        ))}
      </div>
    </section>
  );
}
