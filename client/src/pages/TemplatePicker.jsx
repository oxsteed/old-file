// client/src/pages/TemplatePicker.jsx
// Template picker for Helper & Business Dashboards
// Browse 30 templates, preview, activate, purchase lifetime access

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../api/axios';
import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';
import { TEMPLATE_REGISTRY, ProfileTemplateRenderer } from '../components/profileTemplates/index';

// ── Icons ──────────────────────────────────────────────────────────────────
const Ico = ({ children, size = 18, cls = 'text-gray-400' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
    className={`flex-shrink-0 ${cls}`}>{children}</svg>
);
const IcoCheck    = p => <Ico {...p}><polyline points="20 6 9 17 4 12"/></Ico>;
const IcoLock     = p => <Ico {...p}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></Ico>;
const IcoStar     = p => <Ico {...p}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></Ico>;
const IcoEye      = p => <Ico {...p}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></Ico>;
const IcoX        = p => <Ico {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></Ico>;
const IcoZap      = p => <Ico {...p}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></Ico>;
const IcoPalette  = p => <Ico {...p}><circle cx="12" cy="12" r="10"/><path d="M8 12h.01M12 8h.01M16 12h.01M12 16h.01"/></Ico>;
const IcoArrow    = p => <Ico {...p}><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></Ico>;
const IcoRefresh  = p => <Ico {...p}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></Ico>;

// ── Category labels & colors ────────────────────────────────────────────────
const CATEGORY_META = {
  general:  { label: 'All',              color: 'bg-gray-700/50 text-gray-300' },
  home:     { label: 'Home & Property',  color: 'bg-amber-500/20 text-amber-400' },
  creative: { label: 'Creative & Media', color: 'bg-purple-500/20 text-purple-400' },
  health:   { label: 'Health & Wellness',color: 'bg-emerald-500/20 text-emerald-400' },
  care:     { label: 'Care & Education', color: 'bg-pink-500/20 text-pink-400' },
  events:   { label: 'Events & Food',    color: 'bg-orange-500/20 text-orange-400' },
  beauty:   { label: 'Beauty & Style',   color: 'bg-rose-500/20 text-rose-400' },
  tech:     { label: 'Tech & Business',  color: 'bg-blue-500/20 text-blue-400' },
};

// Template thumbnail – a mini color-coded preview card
const TEMPLATE_ACCENT = {
  default:              'from-gray-700 to-gray-800',
  trades_pro:           'from-blue-800 to-slate-900',
  handyman:             'from-amber-600 to-orange-700',
  home_garden:          'from-green-700 to-emerald-900',
  cleaning_service:     'from-cyan-600 to-teal-800',
  pest_control:         'from-red-700 to-zinc-900',
  moving_hauling:       'from-blue-900 to-yellow-700',
  interior_design:      'from-yellow-700 to-amber-900',
  creative_studio:      'from-gray-900 to-orange-700',
  graphic_design:       'from-gray-100 to-gray-300',
  music_audio:          'from-purple-900 to-fuchsia-800',
  writing_copy:         'from-amber-100 to-stone-300',
  fitness_pro:          'from-red-900 to-black',
  wellness_therapy:     'from-purple-200 to-lavender-300',
  nutrition_diet:       'from-green-200 to-lime-300',
  mental_health:        'from-blue-200 to-sky-300',
  care_trust:           'from-pink-200 to-rose-300',
  pet_services:         'from-orange-400 to-amber-600',
  tutoring_education:   'from-blue-700 to-navy-900',
  child_development:    'from-yellow-400 to-pink-500',
  events_entertainment: 'from-purple-800 to-yellow-700',
  catering_food:        'from-amber-700 to-orange-900',
  wedding_services:     'from-rose-200 to-pink-400',
  beauty_style:         'from-pink-400 to-rose-600',
  barbershop:           'from-gray-900 to-yellow-700',
  spa_skincare:         'from-green-200 to-teal-400',
  tech_it:              'from-black to-green-900',
  web_app_dev:          'from-indigo-900 to-blue-700',
  consulting_coaching:  'from-blue-900 to-yellow-800',
  legal_admin:          'from-gray-900 to-yellow-900',
};

// ── Sample data for live preview (no auth needed) ──────────────────────────
const PREVIEW_SAMPLE_DATA = {
  helper: {
    id: 'preview',
    businessName: 'Preview Services',
    ownerName: 'Alex Morgan',
    tagline: 'Quality work you can count on.',
    bio: 'This is a sample profile so you can see exactly how this template looks before activating it. Your real name, bio, photos, and services will appear here once you activate.',
    avatar: '',
    coverImage: '',
    rating: 4.9,
    reviewCount: 127,
    jobsCompleted: 340,
    memberSince: '2022-01-15',
    verified: true,
    responseTime: '< 1 hour',
    responseRate: 98,
    badges: [
      { id: 'b1', label: 'Top Rated', icon: 'star', variant: 'top_rated' },
      { id: 'b2', label: 'Licensed', icon: 'shield', variant: 'verified' },
    ],
    categories: ['General'],
    city: 'Chicago',
    state: 'IL',
    allowGuestContact: true,
  },
  services: [
    { id: 's1', name: 'Standard Service', description: 'Example service to show how cards render in this template.', price: 85, priceUnit: 'hour', popular: true, category: 'General' },
    { id: 's2', name: 'Premium Package', description: 'Second service row to show grid layout and spacing.', price: 220, priceUnit: 'flat', category: 'General' },
  ],
  gallery: [
    { id: 'g1', url: 'https://images.unsplash.com/photo-1504148455328-c376907d081c?auto=format&fit=crop&w=600&q=60', alt: 'Sample work' },
    { id: 'g2', url: 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=600&q=60', alt: 'Sample project' },
  ],
  reviews: [
    { id: 'r1', authorName: 'Jamie K.', rating: 5, content: 'Excellent work and communication. Would hire again without hesitation.' },
    { id: 'r2', authorName: 'Riley P.', rating: 5, content: 'Professional from start to finish. Highly recommend.' },
  ],
  faqs: [
    { id: 'f1', question: 'Do you offer free estimates?', answer: 'Yes. Estimates are complimentary within our normal service area.' },
    { id: 'f2', question: 'What areas do you serve?', answer: 'Metro area and nearby suburbs, typically within 25 miles.' },
  ],
  bizId: null,
  phone: '(555) 010-0199',
  website: 'https://example.com',
};

// ── Modal: Preview ──────────────────────────────────────────────────────────
const PreviewModal = ({ template, slug, pricing, hasAccess, trialExpiry, isActive, onClose, onActivate, onPurchase, activating, purchasing }) => {
  const { t } = useTranslation();
  if (!template) return null;

  const price = pricing?.[slug];
  const monthly = price ? (price.monthly_price_cents / 100).toFixed(2) : '9.99';
  const lifetime = price ? (price.lifetime_price_cents / 100).toFixed(2) : '49.99';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-2 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="preview-modal-title"
    >
      <div
        className="relative flex flex-col md:flex-row w-full h-full max-w-5xl max-h-[92vh] bg-gray-950 rounded-2xl overflow-hidden shadow-2xl border border-gray-700/40"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Left: live template render ── */}
        <div className="flex-1 overflow-y-auto bg-white min-h-0">
          {/* Sample-data notice banner */}
          <div className="sticky top-0 z-10 flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600/90 backdrop-blur-sm text-white text-xs font-medium">
            <IcoEye size={13} cls="text-white" />
            {t('templatePicker.previewSampleNotice', { defaultValue: 'Preview using sample data — your real content will appear once activated' })}
          </div>
          <ProfileTemplateRenderer slug={slug} profileData={PREVIEW_SAMPLE_DATA} />
        </div>

        {/* ── Right: info + action panel ── */}
        <div className="w-full md:w-72 flex-shrink-0 flex flex-col bg-gray-900 border-t md:border-t-0 md:border-l border-gray-700/50 p-5 overflow-y-auto">
          {/* Close button */}
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 id="preview-modal-title" className="text-lg font-bold text-white leading-tight">{template.name}</h2>
              <span className={`inline-block mt-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${CATEGORY_META[template.category]?.color || 'bg-gray-700 text-gray-300'}`}>
                {CATEGORY_META[template.category]?.label}
              </span>
            </div>
            <button
              onClick={onClose}
              aria-label={t('templatePicker.closePreview')}
              className="p-1.5 rounded-full bg-gray-800 hover:bg-gray-700 transition flex-shrink-0 ml-2"
            >
              <IcoX size={14} cls="text-white" />
            </button>
          </div>

          {/* Active badge */}
          {isActive && (
            <div className="mb-4 px-3 py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30">
              <p className="text-emerald-400 text-xs font-semibold flex items-center gap-1.5">
                <IcoCheck size={12} cls="text-emerald-400" />
                {t('templatePicker.currentlyActive')}
              </p>
            </div>
          )}

          {/* Pricing */}
          {template.is_free ? (
            <p className="text-emerald-400 font-semibold text-sm mb-4">{t('templatePicker.freeForever')}</p>
          ) : hasAccess && trialExpiry ? (
            <p className="text-sky-400 text-sm font-semibold mb-4 flex items-center gap-1.5">
              <IcoCheck size={14} cls="text-sky-400" />
              {t('templatePicker.trialExpires', {
                date: new Date(trialExpiry).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
              })}
            </p>
          ) : hasAccess ? (
            <p className="text-blue-400 text-sm font-semibold mb-4 flex items-center gap-1.5">
              <IcoCheck size={14} cls="text-blue-400" />
              {t('templatePicker.unlocked')}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2 mb-4">
              <div className="bg-gray-800 rounded-xl p-3 text-center">
                <div className="text-gray-400 text-[10px] mb-0.5">{t('templatePicker.monthlyPrice')}</div>
                <div className="text-white font-bold text-base">${monthly}</div>
                <div className="text-gray-500 text-[10px]">{t('templatePicker.perMonth')}</div>
              </div>
              <div className="bg-gradient-to-br from-amber-500/20 to-orange-500/10 border border-amber-500/30 rounded-xl p-3 text-center">
                <div className="text-amber-400 text-[10px] mb-0.5 font-semibold">{t('templatePicker.lifetimePrice')}</div>
                <div className="text-white font-bold text-base">${lifetime}</div>
                <div className="text-amber-400/70 text-[10px]">{t('templatePicker.oneTimePay')}</div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-2 mt-auto pt-4">
            {isActive ? (
              <button
                disabled
                className="w-full py-2.5 rounded-xl bg-emerald-500/20 text-emerald-400 font-semibold text-sm flex items-center justify-center gap-2 cursor-default"
              >
                <IcoCheck size={15} cls="text-emerald-400" />
                {t('templatePicker.currentlyActive')}
              </button>
            ) : (hasAccess || template.is_free) ? (
              <button
                onClick={() => onActivate(slug)}
                disabled={activating}
                className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {activating ? <IcoRefresh size={15} cls="text-white animate-spin" /> : <IcoZap size={15} cls="text-white" />}
                {activating ? t('templatePicker.activating') : t('templatePicker.activateNow')}
              </button>
            ) : (
              <button
                onClick={() => onPurchase(slug)}
                disabled={purchasing}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white font-bold text-sm transition disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {purchasing ? <IcoRefresh size={15} cls="text-white animate-spin" /> : <IcoStar size={15} cls="text-white" />}
                {purchasing ? t('templatePicker.purchasing') : t('templatePicker.purchaseLifetime', { price: lifetime })}
              </button>
            )}
            <button
              onClick={onClose}
              className="w-full px-4 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition"
            >
              {t('common.close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Template Card ───────────────────────────────────────────────────────────
const TemplateCard = ({ slug, template, isActive, hasAccess, trialExpiry, onPreview, onActivate, activating }) => {
  const { t } = useTranslation();
  const accent = TEMPLATE_ACCENT[slug] || 'from-gray-700 to-gray-900';

  return (
    <div
      className={`relative flex flex-col rounded-2xl overflow-hidden border transition-all duration-200 group
        ${isActive
          ? 'border-emerald-500/60 shadow-lg shadow-emerald-900/30'
          : 'border-gray-700/50 hover:border-gray-500/60 hover:shadow-lg hover:shadow-black/30'
        }
        bg-gray-900/60`}
    >
      {/* Thumbnail */}
      <div className={`relative h-28 bg-gradient-to-br ${accent} flex items-center justify-center`}>
        <IcoPalette size={32} cls="text-white/50" />

        {/* Badges */}
        <div className="absolute top-2 left-2 flex gap-1.5">
          {template.is_free ? (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500 text-white">
              {t('templatePicker.free')}
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/90 text-white flex items-center gap-1">
              <IcoStar size={9} cls="text-white" />
              {t('templatePicker.premium')}
            </span>
          )}
          {!template.is_free && hasAccess && trialExpiry && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/90 text-white">
              {t('templatePicker.trial')}
            </span>
          )}
          {isActive && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500 text-white">
              {t('templatePicker.active')}
            </span>
          )}
        </div>

        {/* Lock overlay */}
        {!template.is_free && !hasAccess && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
            <IcoLock size={24} cls="text-white/80" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-4 flex flex-col gap-3 flex-1">
        <div>
          <h3 className="text-white font-semibold text-sm leading-tight">{template.name}</h3>
          <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${CATEGORY_META[template.category]?.color}`}>
            {CATEGORY_META[template.category]?.label}
          </span>
        </div>

        {/* Access status */}
        <div className="text-xs">
          {hasAccess || template.is_free ? (
            trialExpiry && !template.is_free ? (
              <span className="text-sky-400 flex items-center gap-1">
                <IcoCheck size={11} cls="text-sky-400" />
                {t('templatePicker.trialExpires', {
                  date: new Date(trialExpiry).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
                })}
              </span>
            ) : (
              <span className="text-emerald-400 flex items-center gap-1">
                <IcoCheck size={11} cls="text-emerald-400" />
                {t('templatePicker.unlocked')}
              </span>
            )
          ) : (
            <span className="text-amber-400 flex items-center gap-1">
              <IcoLock size={11} cls="text-amber-400" />
              {t('templatePicker.premiumRequired')}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 mt-auto">
          <button
            onClick={() => onPreview(slug)}
            aria-label={t('templatePicker.previewAriaLabel', { name: template.name })}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium transition"
          >
            <IcoEye size={13} cls="text-gray-400" />
            {t('templatePicker.preview')}
          </button>
          {isActive ? (
            <button
              disabled
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-emerald-500/15 text-emerald-400 text-xs font-semibold cursor-default"
            >
              <IcoCheck size={13} cls="text-emerald-400" />
              {t('templatePicker.active')}
            </button>
          ) : (hasAccess || template.is_free) ? (
            <button
              onClick={() => onActivate(slug)}
              disabled={activating === slug}
              aria-label={t('templatePicker.activateAriaLabel', { name: template.name })}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition disabled:opacity-60"
            >
              {activating === slug
                ? <IcoRefresh size={13} cls="text-white animate-spin" />
                : <IcoZap size={13} cls="text-white" />
              }
              {activating === slug ? t('templatePicker.activating') : t('templatePicker.activate')}
            </button>
          ) : (
            <button
              onClick={() => onPreview(slug)}
              aria-label={t('templatePicker.unlockAriaLabel', { name: template.name })}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 text-xs font-semibold transition"
            >
              <IcoLock size={13} cls="text-amber-400" />
              {t('templatePicker.unlock')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Main page ───────────────────────────────────────────────────────────────
export default function TemplatePicker() {
  const { t } = useTranslation();

  // Determine profile type from URL query param; default to helper
  const [searchParams] = useSearchParams();
  const profileType = searchParams.get('type') === 'business' ? 'business' : 'helper';

  const [templates, setTemplates]         = useState([]);
  const [pricing, setPricing]             = useState({});   // slug → pricing row
  const [myAccess, setMyAccess]           = useState([]);   // array of slug strings I own
  const [trialExpiries, setTrialExpiries] = useState({});  // slug → expiry ISO string
  const [activeSlug, setActiveSlug]       = useState('default');
  const [loading, setLoading]             = useState(true);
  const [activating, setActivating]       = useState(null); // slug being activated
  const [purchasing, setPurchasing]       = useState(null); // slug being purchased

  const [filterCat, setFilterCat]         = useState('all');
  const [filterAccess, setFilterAccess]   = useState('all'); // all | owned | free
  const [search, setSearch]               = useState('');
  const [previewSlug, setPreviewSlug]     = useState(null);

  // ── Load data ──────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, aRes, activeRes] = await Promise.all([
        api.get('/templates'),
        api.get('/templates/my-access'),
        api.get(`/templates/active?type=${profileType}`),
      ]);

      // Build pricing map keyed by slug
      const pricingMap = {};
      (tRes.data?.data || []).forEach(row => { pricingMap[row.slug] = row; });
      setPricing(pricingMap);

      // Templates list from registry (always complete, server just adds pricing)
      const all = Object.entries(TEMPLATE_REGISTRY).map(([slug, meta]) => ({
        slug,
        ...meta,
        ...(pricingMap[slug] || {}),
      }));
      setTemplates(all);

      const accessRows = aRes.data?.data || [];
      setMyAccess(accessRows.map(r => r.template_slug));
      const trialMap = {};
      accessRows.forEach(r => {
        if (r.access_type === 'free_trial' && r.expiry_date) {
          trialMap[r.template_slug] = r.expiry_date;
        }
      });
      setTrialExpiries(trialMap);
      setActiveSlug(activeRes.data?.data?.active_template || 'default');
    } catch (err) {
      toast.error(t('templatePicker.loadError'));
    } finally {
      setLoading(false);
    }
  }, [profileType, t]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Activate ───────────────────────────────────────────────────────────────
  const handleActivate = async (slug) => {
    setActivating(slug);
    try {
      await api.post('/templates/activate', { template_slug: slug, profile_type: profileType });
      setActiveSlug(slug);
      setPreviewSlug(null);
      toast.success(t('templatePicker.activatedSuccess', { name: TEMPLATE_REGISTRY[slug]?.name || slug }));
    } catch (err) {
      const msg = err.response?.data?.error || t('templatePicker.activateError');
      toast.error(msg);
    } finally {
      setActivating(null);
    }
  };

  // ── Purchase lifetime ──────────────────────────────────────────────────────
  const handlePurchase = async (slug) => {
    setPurchasing(slug);
    try {
      await api.post('/templates/purchase/lifetime', { template_slug: slug });
      setMyAccess(prev => [...prev, slug]);
      toast.success(t('templatePicker.purchaseSuccess', { name: TEMPLATE_REGISTRY[slug]?.name || slug }));
      // Auto-activate after purchase
      await handleActivate(slug);
    } catch (err) {
      const msg = err.response?.data?.error || t('templatePicker.purchaseError');
      toast.error(msg);
    } finally {
      setPurchasing(null);
    }
  };

  // ── Filter ─────────────────────────────────────────────────────────────────
  const filtered = templates.filter(tpl => {
    if (filterCat !== 'all' && tpl.category !== filterCat) return false;
    if (filterAccess === 'owned' && !myAccess.includes(tpl.slug) && !tpl.is_free) return false;
    if (filterAccess === 'free' && !tpl.is_free) return false;
    if (search && !tpl.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const previewTemplate = previewSlug ? { ...TEMPLATE_REGISTRY[previewSlug], slug: previewSlug } : null;

  // ── Back link ──────────────────────────────────────────────────────────────
  const backHref = profileType === 'business' ? '/business-hub' : '/helper-dashboard';
  const backLabel = profileType === 'business' ? t('templatePicker.backToBizHub') : t('templatePicker.backToHelperDash');

  return (
    <PageShell>
      <PageMeta title={t('templatePicker.pageTitle')} description={t('templatePicker.pageDescription')} />

      <div className="min-h-screen bg-[var(--app-bg)] py-8 px-4">
        <div className="max-w-6xl mx-auto">

          {/* Header */}
          <div className="mb-8">
            <Link
              to={backHref}
              className="inline-flex items-center gap-1.5 text-gray-400 hover:text-white text-sm mb-4 transition"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
              {backLabel}
            </Link>
            <h1 className="text-3xl font-bold text-white mb-2">{t('templatePicker.heading')}</h1>
            <p className="text-gray-400 text-sm max-w-xl">{t('templatePicker.subheading')}</p>
          </div>

          {/* Active template banner */}
          {!loading && (
            <div className="flex items-center gap-3 mb-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-xl">
              <IcoZap size={18} cls="text-blue-400 flex-shrink-0" />
              <div>
                <span className="text-white text-sm font-semibold">{t('templatePicker.currentTemplate')}: </span>
                <span className="text-blue-300 text-sm font-bold">
                  {TEMPLATE_REGISTRY[activeSlug]?.name || 'Default'}
                </span>
              </div>
              {activeSlug !== 'default' && (
                <button
                  onClick={() => handleActivate('default')}
                  disabled={activating === 'default'}
                  className="ml-auto text-xs text-gray-400 hover:text-white flex items-center gap-1 transition"
                >
                  <IcoRefresh size={13} cls="text-gray-400" />
                  {t('templatePicker.revertDefault')}
                </button>
              )}
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3 mb-6">
            {/* Search */}
            <div className="relative flex-1 min-w-[180px]">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('templatePicker.searchPlaceholder')}
                aria-label={t('templatePicker.searchAriaLabel')}
                className="w-full pl-9 pr-4 py-2 bg-gray-800 border border-gray-700/50 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30"
              />
            </div>

            {/* Category filter */}
            <select
              value={filterCat}
              onChange={e => setFilterCat(e.target.value)}
              aria-label={t('templatePicker.filterCategoryLabel')}
              className="px-3 py-2 bg-gray-800 border border-gray-700/50 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50"
            >
              <option value="all">{t('templatePicker.allCategories')}</option>
              {Object.entries(CATEGORY_META).filter(([k]) => k !== 'general').map(([key, meta]) => (
                <option key={key} value={key}>{meta.label}</option>
              ))}
            </select>

            {/* Access filter */}
            <div className="flex rounded-lg overflow-hidden border border-gray-700/50">
              {[
                { val: 'all',   label: t('templatePicker.filterAll')   },
                { val: 'owned', label: t('templatePicker.filterOwned') },
                { val: 'free',  label: t('templatePicker.filterFree')  },
              ].map(({ val, label }) => (
                <button
                  key={val}
                  onClick={() => setFilterAccess(val)}
                  className={`px-3 py-2 text-xs font-medium transition ${filterAccess === val ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <span className="text-gray-500 text-xs ml-auto">
              {t('templatePicker.showingCount', { shown: filtered.length, total: templates.length })}
            </span>
          </div>

          {/* Grid */}
          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="rounded-2xl bg-gray-800/50 h-52 animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-20">
              <IcoPalette size={40} cls="text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400 text-sm">{t('templatePicker.noResults')}</p>
              <button onClick={() => { setSearch(''); setFilterCat('all'); setFilterAccess('all'); }}
                className="mt-3 text-blue-400 text-sm hover:underline">
                {t('templatePicker.clearFilters')}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {filtered.map(tpl => (
                <TemplateCard
                  key={tpl.slug}
                  slug={tpl.slug}
                  trialExpiry={trialExpiries[tpl.slug] || null}
                  template={tpl}
                  isActive={activeSlug === tpl.slug}
                  hasAccess={myAccess.includes(tpl.slug)}
                  onPreview={setPreviewSlug}
                  onActivate={handleActivate}
                  activating={activating}
                />
              ))}
            </div>
          )}

          {/* Category sections legend */}
          {!loading && filtered.length > 0 && (
            <div className="mt-10 pt-8 border-t border-gray-800">
              <h2 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-4">{t('templatePicker.categoriesLegend')}</h2>
              <div className="flex flex-wrap gap-2">
                {Object.entries(CATEGORY_META).filter(([k]) => k !== 'general').map(([key, meta]) => (
                  <button
                    key={key}
                    onClick={() => setFilterCat(filterCat === key ? 'all' : key)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${meta.color} ${filterCat === key ? 'ring-1 ring-white/30' : 'opacity-80 hover:opacity-100'}`}
                  >
                    {meta.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Preview Modal */}
      {previewSlug && (
        <PreviewModal
          template={TEMPLATE_REGISTRY[previewSlug] ? { ...TEMPLATE_REGISTRY[previewSlug], name: TEMPLATE_REGISTRY[previewSlug].name } : null}
          slug={previewSlug}
          pricing={pricing}
          hasAccess={myAccess.includes(previewSlug)}
          trialExpiry={trialExpiries[previewSlug] || null}
          isActive={activeSlug === previewSlug}
          onClose={() => setPreviewSlug(null)}
          onActivate={handleActivate}
          onPurchase={handlePurchase}
          activating={activating === previewSlug}
          purchasing={purchasing === previewSlug}
        />
      )}
    </PageShell>
  );
}
