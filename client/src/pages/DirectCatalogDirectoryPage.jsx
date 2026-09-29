import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, ChevronLeft, Clock3, Search, Truck, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import { getDirectCatalog } from '../api/direct';
import { directCatalogHref, DIRECT_CATALOG_VIEWS } from '../utils/directCatalogNavigation';
import '../styles/DirectCatalog.css';

const PAGE_SIZE = 24;

function priceLabel(cents, currency = 'USD', quoteRequired) {
  if (cents == null) return quoteRequired;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: 0 }).format(Number(cents) / 100);
  } catch {
    return `$${Math.round(Number(cents) / 100)}`;
  }
}

function CatalogDirectoryCard({ children, className = '' }) {
  return <section className={`direct-catalog-card rounded-3xl border border-white/10 bg-slate-900/75 p-5 shadow-[0_18px_45px_rgba(15,23,42,0.18)] ${className}`}>{children}</section>;
}

function EmptyState({ children, tone = 'default' }) {
  const toneClass = tone === 'error'
    ? 'border-red-400/20 bg-red-400/5 text-red-100'
    : tone === 'notice'
      ? 'border-orange-400/20 bg-orange-400/5 text-orange-100'
      : 'border-white/10 text-slate-500';
  return <p className={`rounded-2xl border border-dashed p-10 text-center text-sm ${toneClass}`}>{children}</p>;
}

function updateParams(setSearchParams, updates) {
  setSearchParams((current) => {
    const next = new URLSearchParams(current);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === undefined || value === '') next.delete(key);
      else next.set(key, String(value));
    });
    return next;
  }, { replace: true });
}

export default function DirectCatalogDirectoryPage({ view = 'services' }) {
  const { t, i18n } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const definition = DIRECT_CATALOG_VIEWS[view] || DIRECT_CATALOG_VIEWS.services;
  const category = searchParams.get('category') || '';
  const search = searchParams.get('q') || '';
  const offset = Math.max(Number(searchParams.get('offset') || 0), 0);
  const [catalog, setCatalog] = useState({ categories: [], tools: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const timer = window.setTimeout(() => {
      getDirectCatalog(i18n.resolvedLanguage, {
        view,
        category: category || undefined,
        search: search.trim() || undefined,
        limit: PAGE_SIZE,
        offset,
      }).then((data) => {
        if (!active) return;
        setCatalog(data.catalog || { categories: [], tools: [] });
      }).catch((requestError) => {
        if (!active) return;
        setError(requestError.response?.data?.error || t('directCatalog.directoryLoadError', { defaultValue: 'This Direct directory is temporarily unavailable.' }));
      }).finally(() => {
        if (active) setLoading(false);
      });
    }, 120);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [category, i18n.resolvedLanguage, offset, search, t, view]);

  const categories = catalog.categories || [];
  const selectedCategory = categories.find((item) => item.slug === category);
  const items = useMemo(() => {
    if (view === 'tools') return catalog.tools || [];
    return categories.flatMap((item) => (item.services || []).map((service) => ({ ...service, categoryName: item.name })));
  }, [catalog.tools, categories, view]);
  const pagination = view === 'tools' ? catalog.toolPagination : catalog.servicePagination;
  const hasMore = Boolean(pagination && offset + items.length < pagination.total);
  const title = view === 'tools'
    ? t('directCatalog.toolsDirectoryTitle', { defaultValue: 'Direct tools and equipment' })
    : t('directCatalog.servicesDirectoryTitle', { defaultValue: 'Direct services' });
  const subtitle = view === 'tools'
    ? t('directCatalog.toolsDirectorySubtitle', { defaultValue: 'See the equipment OxSteed uses to support Direct work.' })
    : t('directCatalog.servicesDirectorySubtitle', { defaultValue: 'Browse published Direct services, availability, and next steps.' });

  useEffect(() => {
    if (!category || !categories.length || selectedCategory) return;
    updateParams(setSearchParams, { category: null, offset: null });
  }, [categories.length, category, selectedCategory, setSearchParams]);

  return (
    <PageShell>
      <PageMeta title={`${title} | OxSteed Direct`} description={subtitle} url={`${window.location.origin}${definition.path}`} />
      <main className="direct-catalog-content mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8" id="main-content">
        <header className="direct-catalog-header mb-6 flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-white/10 bg-slate-950/80 px-5 py-4 shadow-lg">
          <div className="flex flex-wrap items-center gap-3 text-sm font-semibold text-slate-300">
            <Link to="/direct" className="inline-flex items-center gap-1 text-orange-300 hover:text-orange-200"><ChevronLeft size={16} />{t('directCatalog.backToDirect', { defaultValue: 'Back to Direct' })}</Link>
            <span className="text-slate-600" aria-hidden="true">/</span>
            <span>{title}</span>
          </div>
          <nav className="flex flex-wrap items-center gap-2" aria-label={t('directCatalog.directoryNavigation', { defaultValue: 'Direct directories' })}>
            <Link to={directCatalogHref('skills')} className="rounded-full border border-white/10 px-3 py-2 text-xs text-slate-300 hover:border-orange-400/50">{t('directCatalog.viewAllCategories', { defaultValue: 'View all skills' })}</Link>
            <Link to={directCatalogHref('services')} className="rounded-full border border-white/10 px-3 py-2 text-xs text-slate-300 hover:border-orange-400/50">{t('directCatalog.viewAllServices', { defaultValue: 'View all services' })}</Link>
            <Link to={directCatalogHref('tools')} className="rounded-full border border-white/10 px-3 py-2 text-xs text-slate-300 hover:border-orange-400/50">{t('directCatalog.viewAllTools', { defaultValue: 'View all tools' })}</Link>
          </nav>
        </header>

        <section className="direct-catalog-hero mb-6 rounded-[32px] border border-white/10 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-6 sm:p-8">
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.24em] text-orange-300">OxSteed Direct</div>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-5xl">{title}</h1>
              <p className="mt-3 max-w-3xl text-base leading-7 text-slate-300">{subtitle}</p>
            </div>
            {view === 'tools' && <Truck className="text-orange-300" size={42} aria-hidden="true" />}
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
          <CatalogDirectoryCard>
            <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-white">{t('directCatalog.skillCategories', { defaultValue: 'Skill categories' })}</h2>
            <div className="mt-4 space-y-2">
              <button type="button" onClick={() => updateParams(setSearchParams, { category: null, offset: null })} className={`w-full rounded-xl border px-3 py-3 text-left text-sm font-semibold ${!category ? 'border-orange-400 bg-orange-500 text-white' : 'border-white/10 bg-white/5 text-slate-300 hover:border-orange-400/50'}`}>{t('directCatalog.allCategories', { defaultValue: 'All categories' })}</button>
              {categories.map((item) => {
                const active = item.slug === category;
                return <button type="button" key={item.slug} onClick={() => updateParams(setSearchParams, { category: item.slug, offset: null })} className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-3 text-left text-sm font-semibold ${active ? 'border-orange-400 bg-orange-500 text-white' : 'border-white/10 bg-white/5 text-slate-300 hover:border-orange-400/50'}`}><span>{item.name}</span><span className="text-xs opacity-70">{view === 'tools' ? (item.slug === category ? items.length : '') : item.visibleServiceCount || ''}</span></button>;
              })}
            </div>
          </CatalogDirectoryCard>

          <CatalogDirectoryCard className="min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.16em] text-orange-300">{selectedCategory?.name || t('directCatalog.directServices', { defaultValue: 'Direct services' })}</div>
                <h2 className="mt-1 text-2xl font-bold text-white">{t('directCatalog.directoryResults', { defaultValue: 'Available now' })}</h2>
              </div>
              {pagination && <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-400">{t('directCatalog.listed', { count: pagination.total, defaultValue: '{{count}} listed' })}</span>}
            </div>
            <label className="relative mt-4 block"><Search size={17} className="absolute start-3 top-3.5 text-slate-500" /><input value={search} onChange={(event) => updateParams(setSearchParams, { q: event.target.value, offset: null })} aria-label={view === 'tools' ? t('directCatalog.searchToolsAria', { defaultValue: 'Search tools' }) : t('directCatalog.searchServicesAria', { defaultValue: 'Search services' })} placeholder={view === 'tools' ? t('directCatalog.searchTools', { defaultValue: 'Search tools...' }) : t('directCatalog.searchServices', { category: selectedCategory?.name || t('directCatalog.directServices', { defaultValue: 'Direct' }), defaultValue: 'Search {{category}} services...' })} className="w-full rounded-xl border border-white/10 bg-slate-950/80 py-3 ps-10 pe-3 text-sm text-white outline-none focus:border-orange-500" /></label>

            <div className="mt-5 space-y-3" aria-live="polite">
              {loading && !items.length && <EmptyState>{t('directCatalog.loadingDirectory', { defaultValue: 'Loading Direct catalog...' })}</EmptyState>}
              {!loading && error && <EmptyState tone="error"><span>{error}</span><button type="button" onClick={() => updateParams(setSearchParams, { offset: null })} className="ms-2 font-semibold underline">{t('directCatalog.retry', { defaultValue: 'Try again' })}</button></EmptyState>}
              {!loading && !error && !items.length && <EmptyState tone={selectedCategory?.lifecycleStatus === 'coming_soon' ? 'notice' : 'default'}>{selectedCategory?.lifecycleStatus === 'coming_soon' ? t('directCatalog.categoryComingSoon', { defaultValue: 'Services in this category are coming soon.' }) : view === 'tools' ? t('directCatalog.noTools', { defaultValue: 'No published tools match your search.' }) : t('directCatalog.noServices', { defaultValue: 'No published services match this search.' })}</EmptyState>}
              {view === 'services' && items.map((service) => {
                const requestHref = `/direct/request-quote?service=${encodeURIComponent(service.name)}&serviceSlug=${encodeURIComponent(service.slug)}&serviceId=${encodeURIComponent(service.id)}`;
                const bookHref = `/direct/book-slot?serviceId=${encodeURIComponent(service.id)}&serviceSlug=${encodeURIComponent(service.slug)}&service=${encodeURIComponent(service.name)}`;
                return <article key={service.id} className="rounded-2xl border border-white/10 bg-slate-950/60 p-4"><div className="flex items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-white">{service.name}</h3>{service.lifecycleStatus === 'paused' && <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-200">{t('directCatalog.paused', { defaultValue: 'Temporarily unavailable' })}</span>}</div><p className="mt-1 text-sm leading-5 text-slate-400">{service.description}</p></div><strong className="shrink-0 text-sm text-white">{priceLabel(service.priceCents, service.currencyCode, t('directCatalog.quoteRequired', { defaultValue: 'Quote required' }))}</strong></div><div className="mt-3 flex flex-wrap items-center justify-between gap-2"><span className="inline-flex items-center gap-1.5 text-xs text-slate-500"><Clock3 size={14} />{service.typicalWorkdays?.length ? service.typicalWorkdays.join(' · ') : t('directCatalog.scheduleByQuote', { defaultValue: 'Schedule by quote' })}</span><div className="flex flex-wrap gap-2">{service.bookable && <Link to={bookHref} className="inline-flex items-center gap-1 rounded-lg bg-orange-500 px-3 py-2 text-xs font-bold text-white">{t('directCatalog.book', { defaultValue: 'Book' })} <ArrowRight size={14} /></Link>}{service.requestable && <Link to={requestHref} className="inline-flex items-center gap-1 rounded-lg border border-orange-500/40 px-3 py-2 text-xs font-bold text-orange-100">{t('directCatalog.request', { defaultValue: 'Request' })} <ArrowRight size={14} /></Link>}{!service.requestable && !service.bookable && <span className="text-xs font-semibold text-amber-200">{t('directCatalog.currentlyUnavailable', { defaultValue: 'Currently unavailable' })}</span>}</div></div></article>;
              })}
              {view === 'tools' && items.map((tool) => <article key={tool.id} className="flex gap-3 rounded-2xl border border-white/10 bg-slate-950/60 p-4"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-orange-300"><Wrench size={19} /></div><div className="min-w-0"><h3 className="font-semibold text-white">{tool.name}</h3><p className="mt-1 text-sm leading-5 text-slate-400">{tool.description}</p><span className={`mt-2 inline-flex items-center gap-1 text-xs ${tool.isOperationallyAvailable ? 'text-emerald-300' : 'text-amber-200'}`}><CheckCircle2 size={13} />{tool.isOperationallyAvailable ? t('directCatalog.availableWhenScheduled', { defaultValue: 'Available when scheduled' }) : t('directCatalog.currentlyUnavailable', { defaultValue: 'Currently unavailable' })}</span></div></article>)}
              {hasMore && <button type="button" onClick={() => updateParams(setSearchParams, { offset: offset + PAGE_SIZE })} disabled={loading} className="w-full rounded-xl border border-orange-500/30 px-4 py-3 text-sm font-semibold text-orange-200 hover:bg-orange-500/10 disabled:opacity-50">{t('directCatalog.showMoreServices', { count: `${offset + items.length}/${pagination.total}`, defaultValue: 'Show more ({{count}})' })}</button>}
            </div>
            {view === 'tools' && <div className="mt-5 rounded-2xl border border-orange-500/20 bg-orange-500/5 p-4 text-sm text-slate-300"><p>{t('directCatalog.toolsDirectoryRentalNote', { defaultValue: 'These are OxSteed Direct tools and equipment. For peer-owned tools available for rental, visit the separate rental marketplace.' })}</p><Link to="/tool-rentals" className="mt-3 inline-flex items-center gap-2 font-semibold text-orange-300">{t('directCatalog.browseToolRentals', { defaultValue: 'Browse tool rentals' })} <ArrowRight size={14} /></Link></div>}
          </CatalogDirectoryCard>
        </div>
      </main>
    </PageShell>
  );
}

