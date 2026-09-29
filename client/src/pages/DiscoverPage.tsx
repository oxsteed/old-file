/**
 * DiscoverPage — unified search across helpers, jobs, tools, and businesses.
 * Route: /discover?q=<query>
 *
 * Used as the landing page for discover alert emails and as a standalone
 * search experience on the web.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  Search, MapPin, User, Briefcase, Wrench, Building2,
  Star, ShieldCheck, Sparkles, AlertCircle, Loader2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DiscoverItem {
  type: 'helper' | 'job' | 'tool' | 'business' | 'product' | string;
  id: string;
  title: string;
  subtitle?: string;
  url?: string;
  meta?: string;
  imageUrl?: string;
  distanceMiles?: number;
  rating?: number;
  reviewCount?: number;
  verified?: boolean;
  backgroundChecked?: boolean;
  freshnessDays?: number;
  primaryAction?: string;
  priceHint?: string;
}

type FilterType = 'all' | 'helper' | 'job' | 'tool' | 'business';

// ── Helpers ───────────────────────────────────────────────────────────────────

function itemHref(item: DiscoverItem): string {
  if (item.url) {
    // relative path returned by backend
    if (item.url.startsWith('http')) return item.url;
    return item.url;
  }
  switch (item.type) {
    case 'helper':   return `/helpers/${item.id}`;
    case 'job':      return `/jobs/public/${item.id}`;
    case 'business': return `/businesses/public/${item.id}`;
    default:         return '#';
  }
}

function TypeIcon({ type }: { type: string }) {
  const cls = 'w-4 h-4';
  switch (type) {
    case 'helper':   return <User className={cls} />;
    case 'job':      return <Briefcase className={cls} />;
    case 'tool':     return <Wrench className={cls} />;
    case 'business': return <Building2 className={cls} />;
    default:         return <Sparkles className={cls} />;
  }
}

function typeBg(type: string): string {
  switch (type) {
    case 'helper':   return 'bg-emerald-500/15 text-emerald-400';
    case 'job':      return 'bg-orange-500/15 text-orange-400';
    case 'tool':     return 'bg-blue-500/15 text-blue-400';
    case 'business': return 'bg-purple-500/15 text-purple-400';
    default:         return 'bg-zinc-500/15 text-zinc-400';
  }
}

// ── Result card ───────────────────────────────────────────────────────────────

function ResultCard({ item }: { item: DiscoverItem }) {
  const { t } = useTranslation();
  const href = itemHref(item);
  const verifiedLabel = t('discoverPage.verified');
  const typeLabel = t(`discoverPage.types.${item.type}`, { defaultValue: item.type });

  return (
    <Link
      to={href}
      className="flex items-start gap-3 p-4 rounded-2xl bg-zinc-900 border border-white/[0.07]
                 hover:border-orange-500/30 hover:bg-zinc-800/70 transition-all duration-150"
    >
      {/* Type icon */}
      <div className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${typeBg(item.type)}`}>
        <TypeIcon type={item.type} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-white truncate">{item.title}</p>
          {item.distanceMiles != null && (
            <span className="flex-shrink-0 flex items-center gap-1 text-xs text-zinc-500">
              <MapPin className="w-3 h-3" />
              {item.distanceMiles.toFixed(1)} mi
            </span>
          )}
        </div>

        {item.subtitle && (
          <p className="text-xs text-zinc-400 mt-0.5 line-clamp-2">{item.subtitle}</p>
        )}

        <div className="flex items-center gap-3 mt-2 flex-wrap">
          {item.meta && (
            <span className="text-xs text-zinc-500">{item.meta}</span>
          )}
          {item.rating != null && item.rating > 0 && (
            <span className="flex items-center gap-1 text-xs text-yellow-400">
              <Star className="w-3 h-3 fill-yellow-400" />
              {item.rating.toFixed(1)}
              {item.reviewCount ? <span className="text-zinc-500">({item.reviewCount})</span> : null}
            </span>
          )}
          {item.verified && (
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <ShieldCheck className="w-3 h-3" /> {verifiedLabel}
            </span>
          )}
          {item.priceHint && (
            <span className="text-xs font-semibold text-orange-400">{item.priceHint}</span>
          )}
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${typeBg(item.type)}`}>
            {typeLabel}
          </span>
        </div>
      </div>

      {/* CTA hint */}
      <span className="flex-shrink-0 text-xs font-semibold text-orange-400 self-center">
        {item.primaryAction ?? t('discoverPage.viewAction')} →
      </span>
    </Link>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const FILTER_OPTIONS: { label: string; value: FilterType }[] = [
  { label: 'discoverPage.filters.all',        value: 'all' },
  { label: 'discoverPage.filters.helper',    value: 'helper' },
  { label: 'discoverPage.filters.job',       value: 'job' },
  { label: 'discoverPage.filters.tool',      value: 'tool' },
  { label: 'discoverPage.filters.business',  value: 'business' },
];

export default function DiscoverPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') || '';

  const [query, setQuery]           = useState(initialQuery);
  const [inputValue, setInputValue] = useState(initialQuery);
  const [filter, setFilter]         = useState<FilterType>('all');
  const [results, setResults]       = useState<DiscoverItem[]>([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [total, setTotal]           = useState(0);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setTotal(0); return; }
    setLoading(true);
    setError('');
    try {
      const params: Record<string, string> = { q, limit: '40' };
      // Pass browser geolocation if available
      if (navigator.geolocation) {
        await new Promise<void>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              params.lat = String(pos.coords.latitude);
              params.lng = String(pos.coords.longitude);
              resolve();
            },
            () => resolve(),
            { timeout: 3000 }
          );
        });
      }
      const { data } = await api.get('/discover', { params });
      setResults(data.results ?? []);
      setTotal(data.total ?? (data.results?.length ?? 0));
    } catch {
      setError(t('discoverPage.searchFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  // Run search when query URL param loads
  useEffect(() => {
    if (initialQuery) search(initialQuery);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced input → query
  const handleInput = (val: string) => {
    setInputValue(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setQuery(val);
      setSearchParams(val ? { q: val } : {}, { replace: true });
      search(val);
    }, 350);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setQuery(inputValue);
    setSearchParams(inputValue ? { q: inputValue } : {}, { replace: true });
    search(inputValue);
  };

  const filtered = filter === 'all' ? results : results.filter((r) => r.type === filter);

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-white">
      <Navbar />

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-10">
        {/* Hero */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black tracking-tight mb-2">
            {t('discoverPage.title')}
          </h1>
          <p className="text-zinc-400 text-sm">
            {t('discoverPage.subtitle')}
          </p>
        </div>

        {/* Search form */}
        <form onSubmit={handleSubmit} className="relative mb-6">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500 pointer-events-none" />
          <input
            type="search"
            value={inputValue}
            onChange={(e) => handleInput(e.target.value)}
            placeholder={t('discoverPage.searchPlaceholder')}
            className="w-full pl-12 pr-4 py-4 rounded-2xl bg-zinc-900 border border-white/[0.08]
                       text-white placeholder-zinc-500 text-sm focus:outline-none
                       focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/30 transition"
            autoFocus
          />
          {loading && (
            <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-orange-400 animate-spin" />
          )}
        </form>

        {/* Filter chips */}
        {results.length > 0 && (
          <div className="flex gap-2 flex-wrap mb-6">
            {FILTER_OPTIONS.map(({ label, value }) => {
              const count = value === 'all' ? results.length : results.filter((r) => r.type === value).length;
              if (value !== 'all' && count === 0) return null;
              return (
                <button
                  key={value}
                  onClick={() => setFilter(value)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition
                    ${filter === value
                      ? 'bg-orange-500 border-orange-500 text-white'
                      : 'border-white/[0.08] text-zinc-400 hover:border-orange-500/30 hover:text-white'
                    }`}
              >
                  {t(label)} {count > 0 && <span className="opacity-60 ml-1">{count}</span>}
                </button>
              );
            })}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-6">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Results */}
        {filtered.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs text-zinc-500 mb-1">
              {t('discoverPage.resultsSummary', {
                count: total,
                query,
              })}
            </p>
            {filtered.map((item) => (
              <ResultCard key={`${item.type}-${item.id}`} item={item} />
            ))}
          </div>
        )}

        {/* Empty state after search */}
        {!loading && query && filtered.length === 0 && !error && (
          <div className="text-center py-16 text-zinc-500">
            <Search className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">
              {t('discoverPage.noResults', { query })}
            </p>
            <p className="text-xs mt-1">{t('discoverPage.noResultsHint')}</p>
          </div>
        )}

        {/* Initial state */}
        {!loading && !query && (
          <div className="text-center py-16 text-zinc-500">
            <Sparkles className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">{t('discoverPage.startHint')}</p>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
