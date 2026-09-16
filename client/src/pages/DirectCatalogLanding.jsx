import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, ChevronRight, Clock3, Droplets, Gauge, Hammer, MapPin, Paintbrush, Ruler, Search, ShieldCheck, Trees, Truck, Wrench, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import { DEFAULT_DIRECT_PROFILE, getDirectCatalog, loadDirectProfile } from '../api/direct';
import '../styles/DirectCatalog.css';

const ICONS = { wrench: Wrench, zap: Zap, droplets: Droplets, hammer: Hammer, paintbrush: Paintbrush, trees: Trees, ruler: Ruler, drill: Gauge, truck: Truck, 'shield-check': ShieldCheck };
const SERVICE_PAGE_SIZE = 24;

function priceLabel(cents, currency = 'USD', quoteRequired) {
  if (cents == null) return quoteRequired;
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: 0 }).format(Number(cents) / 100); } catch { return `$${Math.round(Number(cents) / 100)}`; }
}

function CatalogCard({ children, className = '' }) {
  return <section className={`direct-catalog-card rounded-3xl border border-white/10 bg-slate-900/75 p-5 shadow-[0_18px_45px_rgba(15,23,42,0.18)] ${className}`}>{children}</section>;
}

function CatalogScrollRegion({ children, className = '' }) {
  return <div className={`direct-catalog-scroll-region ${className}`}>{children}</div>;
}

export function DirectCatalogPanels({ profile }) {
  const { t, i18n } = useTranslation();
  const [catalog, setCatalog] = useState(profile.catalog || { categories: [], tools: [] });
  const [selectedCategory, setSelectedCategory] = useState('');
  const [categorySearch, setCategorySearch] = useState('');
  const [serviceSearch, setServiceSearch] = useState('');
  const [toolSearch, setToolSearch] = useState('');
  const [servicePage, setServicePage] = useState(1);
  const [services, setServices] = useState([]);
  const [serviceTotal, setServiceTotal] = useState(null);
  const [serviceLoading, setServiceLoading] = useState(false);
  const [serviceLoadError, setServiceLoadError] = useState('');
  const categories = catalog.categories || [];
  const selected = categories.find((category) => category.id === selectedCategory) || categories[0];
  const selectedSlug = selected?.slug || '';
  const tools = useMemo(() => (catalog.tools || [])
    .filter((tool) => !selectedSlug || tool.categorySlug === selectedSlug)
    .filter((tool) => `${tool.name} ${tool.description}`.toLowerCase().includes(toolSearch.trim().toLowerCase())), [catalog.tools, selectedSlug, toolSearch]);
  const visibleCategories = categories.filter((category) => category.name.toLowerCase().includes(categorySearch.trim().toLowerCase()));
  const serviceQuery = serviceSearch.trim();
  const toolQuery = toolSearch.trim();
  const selectedIsComingSoon = selected?.lifecycleStatus === 'coming_soon' && !selected?.liveServiceCount;
  const selectedIsPaused = selected?.lifecycleStatus === 'paused';
  useEffect(() => setCatalog(profile.catalog || { categories: [], tools: [] }), [profile.catalog]);
  useEffect(() => {
    setServicePage(1);
    setServices([]);
    setServiceTotal(null);
    setServiceLoadError('');
  }, [selectedSlug, serviceSearch]);
  useEffect(() => {
    if (!selectedSlug) return undefined;
    let active = true;
    const timer = window.setTimeout(async () => {
      setServiceLoading(true);
      setServiceLoadError('');
      try {
        const data = await getDirectCatalog(i18n.resolvedLanguage, {
          categorySlug: selectedSlug,
          search: serviceQuery || undefined,
          limit: SERVICE_PAGE_SIZE,
          offset: (servicePage - 1) * SERVICE_PAGE_SIZE,
        });
        if (!active) return;
        const nextCatalog = data.catalog || { categories: [], tools: [] };
        const nextCategory = (nextCatalog.categories || []).find((category) => category.slug === selectedSlug);
        const nextServices = nextCategory?.services || [];
        setCatalog(nextCatalog);
        setServices((current) => servicePage === 1 ? nextServices : [...current, ...nextServices]);
        setServiceTotal(nextCategory?.liveServiceCount ?? nextServices.length + ((servicePage - 1) * SERVICE_PAGE_SIZE));
      } catch (error) {
        if (active) setServiceLoadError(error.response?.data?.error || 'Direct services are temporarily unavailable.');
      } finally {
        if (active) setServiceLoading(false);
      }
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [i18n.resolvedLanguage, selectedSlug, servicePage, serviceQuery]);
  function serviceEmptyState() {
    if (serviceLoading && !services.length) return <p className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-500">{t('directCatalog.loadingServices', { defaultValue: 'Loading services...' })}</p>;
    if (serviceLoadError) return <p className="rounded-2xl border border-dashed border-red-400/20 bg-red-400/5 p-8 text-center text-sm text-red-100">{serviceLoadError}</p>;
    if (serviceQuery) return <p className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-500">{t('directCatalog.noServices', { defaultValue: 'No published services match this search.' })}</p>;
    if (selectedIsComingSoon) return <p className="rounded-2xl border border-dashed border-orange-400/20 bg-orange-400/5 p-8 text-center text-sm text-orange-100">{t('directCatalog.categoryComingSoon', { defaultValue: 'Services in this category are coming soon.' })}</p>;
    if (selectedIsPaused) return <p className="rounded-2xl border border-dashed border-amber-400/20 bg-amber-400/5 p-8 text-center text-sm text-amber-100">{t('directCatalog.categoryPaused', { defaultValue: 'This category is temporarily unavailable.' })}</p>;
    return <p className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-500">{t('directCatalog.noServices', { defaultValue: 'No published services match this search.' })}</p>;
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[260px_minmax(0,1fr)_330px]">
      <CatalogCard>
        <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-white">{t('directCatalog.skillCategories', { defaultValue: 'Skill categories' })}</h2>
        <label className="relative mt-4 block"><Search size={17} className="absolute left-3 top-3.5 text-slate-500" /><input aria-label={t('directCatalog.searchCategoriesAria', { defaultValue: 'Search categories' })} placeholder={t('directCatalog.searchCategories', { defaultValue: 'Search categories...' })} className="w-full rounded-xl border border-white/10 bg-slate-950/80 py-3 pl-10 pr-3 text-sm text-white outline-none focus:border-orange-500" onChange={(event) => setCategorySearch(event.target.value)} /></label>
        <CatalogScrollRegion className="mt-4">
          <div className="space-y-2">
            {visibleCategories.map((category) => { const Icon = ICONS[category.iconKey] || Wrench; const active = (selected?.id || '') === category.id; const comingSoon = category.lifecycleStatus === 'coming_soon'; return <button type="button" key={category.id} disabled={comingSoon} onClick={() => { setSelectedCategory(category.id); setServiceSearch(''); setToolSearch(''); }} className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left text-sm font-semibold transition ${active ? 'border-orange-400 bg-orange-500 text-white' : comingSoon ? 'border-white/10 bg-white/5 text-slate-500' : 'border-white/10 bg-white/5 text-slate-300 hover:border-orange-400/50'}`}><Icon size={19} />{category.name}{comingSoon && <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-orange-300">{t('directCatalog.comingSoon', { defaultValue: 'Coming soon' })}</span>}</button>; })}
            {!visibleCategories.length && <p className="rounded-xl border border-dashed border-white/10 p-4 text-sm text-slate-500">{t('directCatalog.noCategories', { defaultValue: 'No published categories yet.' })}</p>}
          </div>
        </CatalogScrollRegion>
        <Link to="/helpers" className="direct-catalog-view-all mt-3">{t('directCatalog.viewAllCategories', { defaultValue: 'View all skills' })} <ArrowRight size={14} /></Link>
      </CatalogCard>

      <CatalogCard className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-xs font-bold uppercase tracking-[0.16em] text-orange-300">{selected?.name || t('directCatalog.directServices', { defaultValue: 'Direct services' })}</div><h2 className="mt-1 text-2xl font-bold text-white">{t('directCatalog.availableServices', { defaultValue: 'Available services' })}</h2></div>{selected && !selectedIsComingSoon && !selectedIsPaused && <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-400">{t('directCatalog.listed', { count: serviceTotal ?? selected.availableServiceCount ?? 0, defaultValue: '{{count}} listed' })}</span>}{selectedIsComingSoon && <span className="rounded-full border border-orange-400/30 bg-orange-400/10 px-3 py-1 text-xs font-semibold text-orange-200">{t('directCatalog.comingSoon', { defaultValue: 'Coming soon' })}</span>}{selectedIsPaused && <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-200">{t('directCatalog.paused', { defaultValue: 'Temporarily unavailable' })}</span>}</div>
        <label className="relative mt-4 block"><Search size={17} className="absolute left-3 top-3.5 text-slate-500" /><input aria-label={t('directCatalog.searchServicesAria', { defaultValue: 'Search services' })} value={serviceSearch} onChange={(event) => setServiceSearch(event.target.value)} placeholder={t('directCatalog.searchServices', { category: selected?.name || t('directCatalog.directServices', { defaultValue: 'Direct' }), defaultValue: 'Search {{category}} services...' })} className="w-full rounded-xl border border-white/10 bg-slate-950/80 py-3 pl-10 pr-3 text-sm text-white outline-none focus:border-orange-500" /></label>
        <CatalogScrollRegion className="mt-4">
          <div className="space-y-3">{services.map((service) => <article key={service.id} className={`rounded-2xl border border-white/10 bg-slate-950/60 p-4 ${service.requestable ? '' : 'opacity-80'}`}><div className="flex items-start justify-between gap-4"><div><h3 className="font-semibold text-white">{service.name}</h3><p className="mt-1 text-sm leading-5 text-slate-400">{service.description}</p></div><strong className="shrink-0 text-sm text-white">{priceLabel(service.priceCents, service.currencyCode, t('directCatalog.quoteRequired', { defaultValue: 'Quote required' }))}</strong></div><div className="mt-3 flex flex-wrap items-center justify-between gap-2"><span className="inline-flex items-center gap-1.5 text-xs text-slate-500"><Clock3 size={14} />{service.availabilityDays?.length ? service.availabilityDays.join(' · ') : t('directCatalog.scheduleByQuote', { defaultValue: 'Schedule by quote' })}</span>{service.requestable ? <Link to={`/direct/request-quote?service=${encodeURIComponent(service.name)}&serviceSlug=${encodeURIComponent(service.slug)}&serviceId=${encodeURIComponent(service.id)}`} className="inline-flex items-center gap-1 rounded-lg bg-orange-500 px-3 py-2 text-xs font-bold text-white hover:bg-orange-600">{t('directCatalog.request', { defaultValue: 'Request' })} <ArrowRight size={14} /></Link> : <span className="text-xs font-semibold text-amber-200">{t('directCatalog.currentlyUnavailable', { defaultValue: 'Currently unavailable' })}</span>}</div></article>)}{!services.length && serviceEmptyState()}{serviceTotal != null && services.length < serviceTotal && <button type="button" disabled={serviceLoading} onClick={() => setServicePage((page) => page + 1)} className="w-full rounded-xl border border-orange-500/30 px-4 py-3 text-sm font-semibold text-orange-200 hover:bg-orange-500/10 disabled:opacity-50">{t('directCatalog.showMoreServices', { count: `${services.length}/${serviceTotal}`, defaultValue: 'Show more services ({{count}})' })}</button>}</div>
        </CatalogScrollRegion>
        <Link to="/direct/services" className="direct-catalog-view-all mt-3">{t('directCatalog.viewAllServices', { defaultValue: 'View all services' })} <ArrowRight size={14} /></Link>
      </CatalogCard>

      <CatalogCard>
        <div className="flex items-start justify-between gap-3"><div><div className="text-xs font-bold uppercase tracking-[0.16em] text-orange-300">{t('directCatalog.equipment', { defaultValue: 'Equipment' })}</div><h2 className="mt-1 text-2xl font-bold text-white">{t('directCatalog.toolsEquipment', { defaultValue: 'Tools & equipment' })}</h2></div><Truck className="text-orange-300" size={22} /></div>
        <label className="relative mt-4 block"><Search size={17} className="absolute left-3 top-3.5 text-slate-500" /><input aria-label={t('directCatalog.searchToolsAria', { defaultValue: 'Search tools' })} value={toolSearch} onChange={(event) => setToolSearch(event.target.value)} placeholder={t('directCatalog.searchTools', { defaultValue: 'Search tools...' })} className="w-full rounded-xl border border-white/10 bg-slate-950/80 py-3 pl-10 pr-3 text-sm text-white outline-none focus:border-orange-500" /></label>
        <CatalogScrollRegion className="mt-4">
          <div className="space-y-3">{tools.map((tool) => { const Icon = ICONS[tool.iconKey] || Wrench; const toolCategory = categories.find((category) => category.slug === tool.categorySlug); return <article key={tool.id} className="flex gap-3 rounded-2xl border border-white/10 bg-slate-950/60 p-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-orange-300"><Icon size={19} /></div><div className="min-w-0"><h3 className="font-semibold text-white">{tool.name}</h3>{(toolCategory?.name || tool.categorySlug) && <span className="mt-1 inline-flex rounded-full border border-orange-500/20 bg-orange-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-200">{toolCategory?.name || tool.categorySlug}</span>}<p className="mt-1 text-xs leading-5 text-slate-400">{tool.description}</p><span className={`mt-2 inline-flex items-center gap-1 text-xs ${tool.isOperationallyAvailable ? 'text-emerald-300' : 'text-amber-200'}`}><CheckCircle2 size={13} /> {tool.isOperationallyAvailable ? t('directCatalog.availableWhenScheduled', { defaultValue: 'Available when scheduled' }) : t('directCatalog.currentlyUnavailable', { defaultValue: 'Currently unavailable' })}</span></div></article>; })}{!tools.length && <p className={`rounded-2xl border border-dashed p-8 text-center text-sm ${toolQuery ? 'border-white/10 text-slate-500' : 'border-orange-400/20 bg-orange-400/5 text-orange-100'}`}>{toolQuery ? t('directCatalog.noTools', { defaultValue: 'No published tools match your search.' }) : t('directCatalog.toolsComingSoon', { defaultValue: 'Tools and equipment are coming soon.' })}</p>}</div>
        </CatalogScrollRegion>
        <Link to="/direct/services" className="direct-catalog-view-all mt-3">{t('directCatalog.viewAllTools', { defaultValue: 'View all tools' })} <ArrowRight size={14} /></Link>
      </CatalogCard>
    </div>
  );
}

export function DirectCatalogContent({ profile, embedded = false }) {
  const { t } = useTranslation();
  const areas = profile.serviceAreas || [];

  return (
    <div className={`direct-catalog-content ${embedded ? 'w-full' : 'mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8'}`} aria-labelledby="direct-catalog-title">
      <header className="direct-catalog-header mb-6 flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-white/10 bg-slate-950/80 px-5 py-4 shadow-lg">
        <div className="flex items-center gap-3"><img src="/logo.png" alt="OxSteed" className="h-10 w-10 rounded-xl" /><div><div className="text-xl font-bold text-white">OxSteed</div><div className="text-xs uppercase tracking-[0.2em] text-orange-300">OxSteed Direct</div></div></div>
        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-300" aria-label={t('directCatalog.navigation', { defaultValue: 'Direct navigation' })}>
          <Link to="/direct/request-quote" className="rounded-full bg-orange-500 px-4 py-2 text-white hover:bg-orange-600">{t('homePage.company.requestQuote', { defaultValue: 'Request a quote' })}</Link>
          <Link to="/direct/view-quote" className="rounded-full border border-white/10 px-4 py-2 hover:bg-white/10">{t('homePage.company.viewQuote', { defaultValue: 'View quote' })}</Link>
          <Link to="/direct/service-area" reloadDocument className="rounded-full border border-white/10 px-4 py-2 hover:bg-white/10">{t('homePage.company.checkServiceArea', { defaultValue: 'Check service area' })}</Link>
        </div>
      </header>

      <section className="direct-catalog-hero mb-6 rounded-[32px] border border-white/10 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-6 sm:p-8"><div className="flex flex-wrap items-end justify-between gap-5"><div><div className="text-xs font-bold uppercase tracking-[0.24em] text-orange-300">{profile.companyName || 'OxSteed'}</div><h1 id="direct-catalog-title" className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-5xl">{profile.headline || t('directCatalog.heroFallback', { defaultValue: 'Direct service, organized for real work.' })}</h1><p className="mt-3 max-w-3xl text-base leading-7 text-slate-300">{profile.publicNote || t('directCatalog.heroCopyFallback', { defaultValue: 'Browse available Direct services, tools, and coverage from one place.' })}</p></div><div className="flex flex-wrap gap-2 text-sm"><span className="rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-orange-200">{t('directCatalog.minimum', { amount: `$${Math.round((profile.minimumPriceCents || 0) / 100)}`, defaultValue: '{{amount}} minimum' })}</span><span className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-slate-200">{profile.availabilityText}</span></div></div></section>

      <DirectCatalogPanels profile={profile} />

      <section className="direct-catalog-coverage mt-5 grid gap-5 rounded-3xl border border-white/10 bg-slate-950/70 p-5 lg:grid-cols-[1fr_auto]"><div><div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.16em] text-orange-300"><MapPin size={17} /> {t('directCatalog.serviceCoverage', { defaultValue: 'Service coverage' })}</div><p className="mt-2 text-sm leading-6 text-slate-300">{t('directCatalog.coverageCopy', { city: profile.baseCity || 'Springfield, OH', defaultValue: '{{city}} and surrounding locations within the active Direct coverage areas.' })}</p><div className="mt-3 flex flex-wrap gap-2">{areas.map((area) => <span key={area} className="rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-200">{area}</span>)}{!areas.length && <span className="text-sm text-slate-500">{t('directCatalog.coverageConfiguring', { defaultValue: 'Coverage areas are being configured.' })}</span>}</div></div><div className="flex items-center"><Link to="/direct/service-area" reloadDocument className="inline-flex items-center gap-2 rounded-full border border-orange-500/30 px-4 py-2.5 text-sm font-semibold text-orange-200 hover:bg-orange-500/10">{t('directCatalog.checkLocation', { defaultValue: 'Check exact location' })} <ChevronRight size={16} /></Link></div></section>
    </div>
  );
}

function CatalogState({ error, onRetry }) {
  const { t } = useTranslation();
  if (!error) return <div className="mx-auto flex min-h-[420px] w-full max-w-[1500px] items-center justify-center px-4 py-12 text-slate-300">{t('directCatalog.loading', { defaultValue: 'Loading Direct services...' })}</div>;
  return <div className="mx-auto flex min-h-[420px] w-full max-w-[1500px] flex-col items-center justify-center gap-4 px-4 py-12 text-center text-slate-300"><p>{t('directCatalog.loadError', { defaultValue: 'Direct services are temporarily unavailable.' })}</p><button type="button" onClick={onRetry} className="rounded-full bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600">{t('directCatalog.retry', { defaultValue: 'Try again' })}</button></div>;
}

export default function DirectCatalogLanding({ embedded = false }) {
  const { i18n } = useTranslation();
  const [profile, setProfile] = useState(DEFAULT_DIRECT_PROFILE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadDirectProfile(i18n.resolvedLanguage).then((result) => {
      if (!active) return;
      setProfile(result.profile);
      setError(result.error);
      setLoading(false);
    });
    return () => { active = false; };
  }, [i18n.resolvedLanguage, reloadToken]);

  let content;
  if (loading) {
    content = <CatalogState />;
  } else if (error) {
    content = <CatalogState error={error} onRetry={() => setReloadToken((value) => value + 1)} />;
  } else {
    content = <DirectCatalogContent profile={profile} embedded={embedded} />;
  }
  if (embedded) return content;
  return <PageShell><PageMeta title="OxSteed Direct" description={profile.publicNote || profile.headline} url={`${window.location.origin}/direct`} />{content}</PageShell>;
}
