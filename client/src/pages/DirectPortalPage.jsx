import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CheckCircle2, ChevronRight, Clock3, FileText, MapPin, MessageSquare, Package, PenLine, Plus, RefreshCw, Send, ShieldCheck, Sparkles, UploadCloud, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';
import { useAuth } from '../context/AuthContext';
import DirectCatalogLanding from './DirectCatalogLanding';
import {
  acceptDirectRequest,
  changeDirectRequest,
  confirmDirectProof,
  deleteDirectLocation,
  getDirectAccount,
  getDirectHistory,
  getDirectProfile,
  getDirectRequest,
  getDirectRequestMessages,
  lookupPublicDirectQuote,
  sendPublicDirectQuoteCode,
  saveDirectLocation,
  scheduleDirectRequest,
  sendDirectMessage,
  submitDirectProof,
  submitDirectRequest,
  verifyPublicDirectQuoteCode,
  uploadDirectAsset,
} from '../api/direct';

const DEFAULT_PROFILE = {
  companyName: 'OxSteed',
  headline: 'Food, tools, and local service work under one company.',
  minimumPriceCents: 10000,
  availabilityText: 'Monday through Thursday',
  baseCity: 'Springfield, OH',
  publicNote: 'Company-run service portal for customers who want a direct quote, a scheduled visit, and in-app proof/history.',
  serviceAreas: ['Springfield', 'Dayton', 'Columbus', 'Beavercreek', 'Fairborn', 'Urbana'],
  tools: [
    'Truck and hauling gear',
    'Power drill and bit set',
    'Ladders and step stools',
    'Pressure washer',
    'Hand tools and repair kit',
    'Measuring and layout tools',
    'Cleanup and janitorial supplies',
    'Phone and photo inspection kit',
  ],
  travelDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday'],
  travelCities: ['Springfield', 'Dayton', 'Columbus', 'Beavercreek', 'Fairborn', 'Urbana'],
};

const EMPTY_FORM = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  company_name: '',
  service_category: 'Home services',
  service_location: '',
  service_zip_code: '',
  budget_range: '',
  timeline: '',
  preferred_contact_method: 'email',
  preferred_date: '',
  preferred_time_window: '',
  urgency: 'normal',
  access_notes: '',
  details: '',
  service_city: '',
  photos: [],
};

const STATUS_FLOW = [
  'new',
  'reviewing',
  'quoted',
  'accepted',
  'scheduled',
  'en_route',
  'started',
  'waiting_customer',
  'completed',
  'closed',
  'cancelled',
];

function currencyLabel(amountCents, currencyCode = 'USD', locale) {
  try {
    return new Intl.NumberFormat(locale || undefined, {
      style: 'currency',
      currency: String(currencyCode || 'USD').toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(amountCents || 0) / 100);
  } catch {
    return `$${(Number(amountCents || 0) / 100).toFixed(2)}`;
  }
}

function formatDate(value, locale) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(locale || undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(value, locale) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(locale || undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function statusLabel(status, t) {
  const labels = {
    new: ['requested', 'Requested'],
    reviewing: ['reviewing', 'Reviewing'],
    quoted: ['quoted', 'Quoted'],
    contacted: ['contacted', 'Contacted'],
    accepted: ['accepted', 'Accepted'],
    scheduled: ['scheduled', 'Scheduled'],
    en_route: ['enRoute', 'En route'],
    started: ['started', 'Started'],
    waiting_customer: ['waitingCustomer', 'Waiting on customer'],
    completed: ['completed', 'Completed'],
    closed: ['closed', 'Closed'],
    cancelled: ['cancelled', 'Cancelled'],
  };
  const match = labels[String(status || 'new').toLowerCase()];
  return match ? t(`directPortal.status.${match[0]}`, { defaultValue: match[1] }) : status || t('directPortal.status.requested', { defaultValue: 'Requested' });
}

function paymentLabel(status, t) {
  const key = String(status || 'unpaid').toLowerCase();
  const labels = {
    unpaid: ['unpaid', 'Unpaid'],
    pending: ['pending', 'Pending'],
    submitted: ['submitted', 'Submitted'],
    partially_paid: ['partiallyPaid', 'Partially paid'],
    paid: ['paid', 'Paid'],
    disputed: ['disputed', 'Disputed'],
    refunded: ['refunded', 'Refunded'],
  };
  const match = labels[key];
  return match ? t(`directPortal.paymentStatus.${match[0]}`, { defaultValue: match[1] }) : status || t('directPortal.paymentStatus.unpaid', { defaultValue: 'Unpaid' });
}

function statusTone(status) {
  const key = String(status || 'new').toLowerCase();
  if (['completed', 'closed'].includes(key)) return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25';
  if (['scheduled', 'accepted'].includes(key)) return 'bg-orange-500/15 text-orange-300 border-orange-500/25';
  if (['en_route', 'started'].includes(key)) return 'bg-sky-500/15 text-sky-300 border-sky-500/25';
  if (['waiting_customer', 'reviewing'].includes(key)) return 'bg-violet-500/15 text-violet-300 border-violet-500/25';
  if (key === 'cancelled') return 'bg-gray-500/15 text-gray-300 border-gray-500/20';
  return 'bg-blue-500/15 text-blue-300 border-blue-500/25';
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

function EmptyState({ icon: Icon = Package, title, body, action }) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-slate-950/80 p-6 text-center shadow-sm">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-500/10 text-orange-300">
        <Icon size={24} />
      </div>
      <h3 className="text-xl font-semibold text-white">{title}</h3>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-400">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function SectionCard({ title, eyebrow, children, className = '', ...props }) {
  return (
    <section {...props} className={`rounded-[28px] border border-white/10 bg-slate-950/80 p-5 shadow-sm ${className}`}>
      {eyebrow && (
        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-orange-300">{eyebrow}</div>
      )}
      <h2 className="mt-2 text-2xl font-semibold text-white">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({ label, hint, children, required = false }) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-semibold text-slate-200">
        {label}{required ? ' *' : ''}
      </span>
      {children}
      {hint && <span className="text-xs leading-5 text-slate-500">{hint}</span>}
    </label>
  );
}

function Input(props) {
  return <input {...props} className={`w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-orange-500/50 ${props.className || ''}`} />;
}

function Select(props) {
  return <select {...props} className={`w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none focus:border-orange-500/50 ${props.className || ''}`} />;
}

function Textarea(props) {
  return <textarea {...props} className={`w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-orange-500/50 ${props.className || ''}`} />;
}

function Chip({ children, tone = 'default' }) {
  const tones = {
    default: 'bg-white/5 text-slate-200 border-white/10',
    blue: 'bg-sky-500/10 text-sky-200 border-sky-500/20',
    orange: 'bg-orange-500/10 text-orange-200 border-orange-500/20',
    emerald: 'bg-emerald-500/10 text-emerald-200 border-emerald-500/20',
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-semibold ${tones[tone] || tones.default}`}>
      {children}
    </span>
  );
}

function DirectShell({ profile, title, subtitle, children, heroRight, path = '/direct', noIndex = false }) {
  const { t } = useTranslation();

  return (
    <PageShell>
      <PageMeta title={title ? `${title} | OxSteed Direct` : 'OxSteed Direct'} description={subtitle || profile.publicNote || profile.headline} url={`${window.location.origin}${path}`} noIndex={noIndex} />
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-[36px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[0_28px_80px_rgba(15,23,42,0.45)]">
          <div className="grid gap-6 px-5 py-6 lg:grid-cols-[1.1fr_0.9fr] lg:px-8 lg:py-8">
            <div className="space-y-5">
              <div className="inline-flex items-center gap-2 rounded-full border border-orange-500/25 bg-orange-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-orange-200">
                OxSteed Direct
              </div>
              <div className="space-y-3">
                <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                  {title || profile.companyName}
                </h1>
                <p className="max-w-3xl text-base leading-7 text-slate-300 sm:text-lg">
                  {subtitle || profile.headline}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Chip tone="orange">{t('directPortal.common.minimum', { amount: `$${Math.round(profile.minimumPriceCents / 100)}`, defaultValue: '{{amount}} minimum' })}</Chip>
                <Chip tone="blue">{profile.availabilityText}</Chip>
              <Chip tone="emerald">{t('homePage.company.serviceArea', { defaultValue: `${profile.baseCity} - service within 60 miles` })}</Chip>
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-white/5 p-5 backdrop-blur">
              {heroRight}
            </div>
          </div>
        </div>

        <div className="mt-6">{children}</div>
      </div>
    </PageShell>
  );
}

async function loadProfile(locale) {
  try {
    const data = await getDirectProfile(locale);
    return { ...DEFAULT_PROFILE, ...(data?.profile || {}), catalog: data?.catalog || { categories: [], tools: [] }, serviceAreas: data?.serviceAreas?.map((area) => area.label) || data?.profile?.serviceAreas || DEFAULT_PROFILE.serviceAreas };
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function DirectLandingPage() {
  return <DirectCatalogLanding />;
}

function DirectLandingLegacyPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const [profile, setProfile] = useState(DEFAULT_PROFILE);

  useEffect(() => {
    let active = true;
    loadProfile().then((next) => {
      if (active) setProfile(next);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!location?.pathname?.endsWith('/services')) return;
    const el = document.getElementById('services');
    if (el) {
      requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }, [location.pathname]);

  return (
    <DirectShell
      profile={profile}
      path={location.pathname}
      title={`${profile.companyName} Direct`}
      subtitle={t('homePage.company.subcopy', { defaultValue: profile.publicNote })}
      heroRight={(
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
            <div className="text-xs uppercase tracking-[0.22em] text-slate-500">
              {t('homePage.company.howItWorks', { defaultValue: 'How it works' })}
            </div>
            <div className="mt-3 grid gap-2 text-sm text-slate-300">
              <p>{t('homePage.company.step1', { defaultValue: '1. Request a quote with a few details and photos.' })}</p>
              <p>{t('homePage.company.step2', { defaultValue: '2. Review the estimate and pick a schedule window.' })}</p>
              <p>{t('homePage.company.step3', { defaultValue: '3. Upload proof, keep the receipt, and track the whole job history.' })}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link to="/direct/request-quote" className="inline-flex items-center gap-2 rounded-full bg-orange-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-orange-600">
              {t('homePage.company.requestQuote', { defaultValue: 'Request a quote' })} <ChevronRight size={16} />
            </Link>
            <Link to="/direct/view-quote" className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
              {t('homePage.company.viewQuote', { defaultValue: 'View quote' })}
            </Link>
            <Link to="/direct/service-area" reloadDocument className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
              {t('homePage.company.checkServiceArea', { defaultValue: 'Check service area' })}
            </Link>
            <Link to="/direct/history" className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
              {t('homePage.company.viewHistory', { defaultValue: 'View history' })}
            </Link>
          </div>
        </div>
      )}
    >
      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard id="services" title={t('homePage.company.services', { defaultValue: 'Services' })} eyebrow={t('homePage.company.kicker', { defaultValue: 'OxSteed as a company' })} className="scroll-mt-28">
          <div className="flex flex-wrap gap-2">
            {(profile.serviceAreas || DEFAULT_PROFILE.serviceAreas).map((city) => <Chip key={city}>{city}</Chip>)}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Chip tone="orange">{t('homePage.company.serviceTypes.homeHelp', { defaultValue: 'Home help' })}</Chip>
            <Chip tone="blue">{t('homePage.company.serviceTypes.toolBased', { defaultValue: 'Tool-based jobs' })}</Chip>
            <Chip tone="emerald">{t('homePage.company.serviceTypes.delivery', { defaultValue: 'Delivery and hauling' })}</Chip>
            <Chip tone="default">{t('homePage.company.serviceTypes.cleanup', { defaultValue: 'Cleanup and setup' })}</Chip>
          </div>
        </SectionCard>

        <SectionCard title={t('homePage.company.tools', { defaultValue: 'Tools' })} eyebrow={t('homePage.company.whatWeBring', { defaultValue: 'What we bring' })}>
          <div className="flex flex-wrap gap-2">
            {(profile.tools || DEFAULT_PROFILE.tools).map((tool) => <Chip key={tool}>{tool}</Chip>)}
          </div>
        </SectionCard>

        <SectionCard title={t('homePage.company.travelCities', { defaultValue: 'Travel cities' })} eyebrow={t('homePage.company.mondayToThursday', { defaultValue: 'Monday to Thursday' })}>
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <MapPin size={16} className="text-orange-300" />
              {t('homePage.company.baseCity', { defaultValue: 'Base city' })}: <strong className="text-white">{profile.baseCity}</strong>
            </div>
            <div className="flex flex-wrap gap-2">
              {(profile.travelCities || DEFAULT_PROFILE.travelCities).map((city) => <Chip key={city} tone="blue">{city}</Chip>)}
            </div>
          </div>
        </SectionCard>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <SectionCard title={t('homePage.company.whyDirect', { defaultValue: 'Why Direct' })} eyebrow={t('homePage.company.companyOwned', { defaultValue: 'Company-owned service flow' })}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-white"><Sparkles size={16} className="text-orange-300" /> {t('homePage.company.simpleQuote', { defaultValue: 'Simple quote intake' })}</div>
              <p className="mt-2 text-sm leading-6 text-slate-400">{t('homePage.company.simpleQuoteBody', { defaultValue: 'Public customers can request a quote without wading through marketplace browsing.' })}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-white"><ShieldCheck size={16} className="text-emerald-300" /> {t('homePage.company.clearProof', { defaultValue: 'Clear proof and history' })}</div>
              <p className="mt-2 text-sm leading-6 text-slate-400">{t('homePage.company.clearProofBody', { defaultValue: 'Every receipt, proof upload, and status change stays attached to the job record.' })}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-white"><Clock3 size={16} className="text-sky-300" /> {t('homePage.company.scheduleWindow', { defaultValue: 'Schedule by window' })}</div>
              <p className="mt-2 text-sm leading-6 text-slate-400">{t('homePage.company.scheduleWindowBody', { defaultValue: 'Jobs can be quoted, scheduled, and updated without restarting the request from scratch.' })}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-white"><FileText size={16} className="text-violet-300" /> {t('homePage.company.longTermRecords', { defaultValue: 'Long-term records' })}</div>
              <p className="mt-2 text-sm leading-6 text-slate-400">{t('homePage.company.longTermRecordsBody', { defaultValue: 'Request history, locations, and customer notes are kept in one portal for future work.' })}</p>
            </div>
          </div>
        </SectionCard>

        <SectionCard title={t('homePage.company.nextStep', { defaultValue: 'Next step' })} eyebrow={t('homePage.company.startHere', { defaultValue: 'Start here' })}>
          <div className="space-y-4">
            <p className="text-sm leading-6 text-slate-300">{t('homePage.company.nextStepBody', { defaultValue: 'Tell us what you need, where the work is, and whether you want to move fast or keep things flexible.' })}</p>
            <Link to="/direct/request-quote" className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-orange-600">
              {t('homePage.company.requestQuote', { defaultValue: 'Request a quote' })} <ChevronRight size={16} />
            </Link>
            <Link to="/direct/view-quote" className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
              {t('homePage.company.viewQuote', { defaultValue: 'View quote' })}
            </Link>
          </div>
        </SectionCard>
      </div>
    </DirectShell>
  );
}

export function DirectQuoteRequestPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [loading, setLoading] = useState(false);
  const [draftId] = useState(() => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `draft-${Date.now()}`));
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({
    ...EMPTY_FORM,
    first_name: user?.first_name || '',
    last_name: user?.last_name || '',
    email: user?.email || '',
    phone: user?.phone || '',
  });

  useEffect(() => {
    let active = true;
    loadProfile().then((next) => {
      if (active) setProfile(next);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setForm((current) => ({
      ...current,
      first_name: user?.first_name || current.first_name,
      last_name: user?.last_name || current.last_name,
      email: user?.email || current.email,
      phone: user?.phone || current.phone,
    }));
  }, [user]);

  const canSubmit = useMemo(() => (
    form.first_name.trim() &&
    form.last_name.trim() &&
    form.email.trim() &&
    form.service_category.trim() &&
    form.service_location.trim() &&
    form.service_zip_code.trim() &&
    form.details.trim()
  ), [form]);

  const update = (key) => (event) => {
    const value = event.target.value;
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleUpload = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;

    setUploading(true);
    try {
      for (const file of files.slice(0, 6)) {
        const response = await uploadDirectAsset(file, { purpose: 'quote-photo', draftId });
        setAttachments((current) => [...current, response.attachment]);
      }
      toast.success(t('directPortal.request.messages.photoUploaded', { defaultValue: 'Photo attachment uploaded.' }));
    } catch (error) {
      toast.error(error?.response?.data?.error || t('directPortal.request.errors.uploadPhoto', { defaultValue: 'Could not upload photo.' }));
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = (key) => {
    setAttachments((current) => current.filter((attachment) => attachment.key !== key));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canSubmit) {
      toast.error(t('directPortal.request.errors.requiredFields', { defaultValue: 'Please fill in the required fields.' }));
      return;
    }

    setLoading(true);
    try {
      const payload = {
        first_name: form.first_name,
        last_name: form.last_name,
        email: form.email,
        phone: form.phone,
        company_name: form.company_name,
        service_category: form.service_category,
        service_location: form.service_location,
        service_zip_code: form.service_zip_code,
        budget_range: form.budget_range,
        timeline: form.timeline,
        preferred_contact_method: form.preferred_contact_method,
        details: form.details,
        metadata: {
          flow: 'direct',
          draftId,
          serviceType: form.service_category,
          serviceCity: form.service_city,
          serviceZipCode: form.service_zip_code,
          preferredDate: form.preferred_date,
          preferredTimeWindow: form.preferred_time_window,
          urgency: form.urgency,
          accessNotes: form.access_notes,
          photoAttachments: attachments,
        },
      };

      const response = await submitDirectRequest(payload);
      toast.success(t('directPortal.request.messages.sent', { defaultValue: 'Quote request sent.' }));
      navigate(`/direct/request-quote/thanks?referenceId=${response.referenceId || response.requestId}`, {
        replace: true,
        state: { referenceId: response.referenceId || response.requestId },
      });
    } catch (error) {
      toast.error(error?.response?.data?.error || t('directPortal.request.errors.submit', { defaultValue: 'Could not submit your request.' }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <DirectShell
      profile={profile}
      title={t('directPortal.request.title', { defaultValue: 'Request a Direct quote' })}
      subtitle={t('directPortal.request.subtitle', { defaultValue: 'Keep it simple. Tell us what you need, where the work is, and when you want it done.' })}
      heroRight={(
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
            <div className="text-xs uppercase tracking-[0.22em] text-slate-500">{t('directPortal.request.whatToInclude', { defaultValue: 'What to include' })}</div>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-300">
              <li>{t('directPortal.request.include.contact', { defaultValue: 'Contact info and preferred contact method' })}</li>
              <li>{t('directPortal.request.include.work', { defaultValue: 'Service type, city, and any access notes' })}</li>
              <li>{t('directPortal.request.include.timeline', { defaultValue: 'Budget range, preferred date, and urgency' })}</li>
            </ul>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
            <UploadCloud size={18} className="text-orange-300" />
            {t('directPortal.request.photoHint', { defaultValue: 'You can attach photos before you hit submit.' })}
          </div>
        </div>
      )}
    >
      <form onSubmit={handleSubmit} className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <SectionCard title={t('directPortal.request.sections.yourDetails', { defaultValue: 'Your details' })} eyebrow={t('directPortal.request.eyebrows.customer', { defaultValue: 'Customer' })}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('directPortal.request.fields.firstName')} required><Input value={form.first_name} onChange={update('first_name')} /></Field>
              <Field label={t('directPortal.request.fields.lastName')} required><Input value={form.last_name} onChange={update('last_name')} /></Field>
              <Field label={t('directPortal.request.fields.email')} required><Input type="email" value={form.email} onChange={update('email')} /></Field>
              <Field label={t('directPortal.request.fields.phone')}><Input value={form.phone} onChange={update('phone')} /></Field>
              <Field label={t('directPortal.request.fields.companyName')}><Input value={form.company_name} onChange={update('company_name')} placeholder={t('directPortal.request.placeholders.optional')} /></Field>
              <Field label={t('directPortal.request.fields.contactMethod')}>
                <Select value={form.preferred_contact_method} onChange={update('preferred_contact_method')}>
                  <option value="email">{t('directPortal.request.contactMethods.email')}</option>
                  <option value="phone">{t('directPortal.request.contactMethods.phone')}</option>
                  <option value="text">{t('directPortal.request.contactMethods.text')}</option>
                  <option value="either">{t('directPortal.request.contactMethods.either')}</option>
                </Select>
              </Field>
            </div>
          </SectionCard>

          <SectionCard title={t('directPortal.request.sections.workDetails', { defaultValue: 'Work details' })} eyebrow={t('directPortal.request.eyebrows.quoteRequest', { defaultValue: 'Quote request' })}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('directPortal.request.fields.serviceType')} required>
                <Select value={form.service_category} onChange={update('service_category')}>
                  <option>{t('directPortal.request.serviceCategories.homeServices')}</option>
                  <option>{t('directPortal.request.serviceCategories.restaurantServices')}</option>
                  <option>{t('directPortal.request.serviceCategories.businessSetup')}</option>
                  <option>{t('directPortal.request.serviceCategories.businessSupport')}</option>
                  <option>{t('directPortal.request.serviceCategories.maintenance')}</option>
                  <option>{t('directPortal.request.serviceCategories.other')}</option>
                </Select>
              </Field>
              <Field label={t('directPortal.request.fields.workLocation')} required hint={t('directPortal.request.hints.workLocation')}>
                <Input value={form.service_location} onChange={update('service_location')} placeholder={t('directPortal.request.placeholders.workLocation')} />
              </Field>
              <Field label={t('directPortal.request.fields.serviceZipCode')} required hint={t('directPortal.request.hints.serviceZipCode', { defaultValue: 'Used to match your quote later.' })}>
                <Input inputMode="numeric" value={form.service_zip_code} onChange={update('service_zip_code')} placeholder={t('directPortal.request.placeholders.serviceZipCode')} maxLength={5} />
              </Field>
              <Field label={t('directPortal.request.fields.serviceCity')}><Input value={form.service_city} onChange={update('service_city')} placeholder={t('directPortal.request.placeholders.optional')} /></Field>
              <Field label={t('directPortal.request.fields.budgetRange')}><Input value={form.budget_range} onChange={update('budget_range')} placeholder={t('directPortal.request.placeholders.budgetRange')} /></Field>
              <Field label={t('directPortal.request.fields.preferredDate')}><Input type="date" value={form.preferred_date} onChange={update('preferred_date')} /></Field>
              <Field label={t('directPortal.request.fields.timeWindow')}><Input value={form.preferred_time_window} onChange={update('preferred_time_window')} placeholder={t('directPortal.request.placeholders.timeWindow')} /></Field>
              <Field label={t('directPortal.request.fields.urgency')}>
                <Select value={form.urgency} onChange={update('urgency')}>
                  <option value="low">{t('directPortal.request.urgency.low')}</option>
                  <option value="normal">{t('directPortal.request.urgency.normal')}</option>
                  <option value="high">{t('directPortal.request.urgency.high')}</option>
                  <option value="urgent">{t('directPortal.request.urgency.urgent')}</option>
                </Select>
              </Field>
              <Field label={t('directPortal.request.fields.timelineNotes')}><Input value={form.timeline} onChange={update('timeline')} placeholder={t('directPortal.request.placeholders.timelineNotes')} /></Field>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label={t('directPortal.request.fields.accessNotes')} hint={t('directPortal.request.hints.accessNotes')}><Textarea rows={4} value={form.access_notes} onChange={update('access_notes')} /></Field>
              <Field label={t('directPortal.request.fields.details')} required hint={t('directPortal.request.hints.details')}><Textarea rows={4} value={form.details} onChange={update('details')} /></Field>
            </div>
          </SectionCard>
        </div>

        <aside className="space-y-6">
          <SectionCard title={t('directPortal.request.sections.photos', { defaultValue: 'Photos' })} eyebrow={t('directPortal.request.eyebrows.attachments', { defaultValue: 'Attachments' })}>
            <div className="space-y-4">
              <label className="block rounded-2xl border border-dashed border-white/10 bg-slate-950/70 p-4 text-sm text-slate-300">
                <div className="flex items-center gap-2 font-semibold text-white">
                  <UploadCloud size={16} className="text-orange-300" /> {t('directPortal.request.uploadPhotos', { defaultValue: 'Upload photos' })}
                </div>
                <div className="mt-2 text-xs leading-5 text-slate-500">{t('directPortal.request.photoUploadHelp', { defaultValue: 'Add up to 6 photos. We keep the uploads tied to this quote draft.' })}</div>
                <input type="file" accept="image/*" multiple onChange={handleUpload} className="mt-3 block w-full text-sm text-slate-300 file:mr-3 file:rounded-full file:border-0 file:bg-orange-500 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-orange-600" />
              </label>
              {uploading && <div className="text-sm text-slate-400">{t('directPortal.request.uploadingPhotos', { defaultValue: 'Uploading photos…' })}</div>}
              {attachments.length > 0 ? (
                <div className="grid gap-2">
                  {attachments.map((attachment) => (
                    <div key={attachment.key || attachment.url} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-300">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-white">{attachment.name || t('directPortal.request.photoAttachment', { defaultValue: 'Photo attachment' })}</div>
                        <div className="text-xs text-slate-500">{attachment.type || t('directPortal.request.attachmentType', { defaultValue: 'image' })}</div>
                      </div>
                      <button type="button" onClick={() => removeAttachment(attachment.key)} className="rounded-full border border-white/10 p-2 text-slate-400 transition hover:bg-white/5 hover:text-white">
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-sm text-slate-500">{t('directPortal.request.noPhotos', { defaultValue: 'No photos attached yet.' })}</div>
              )}
            </div>
          </SectionCard>

          <SectionCard title={t('directPortal.request.sections.summary', { defaultValue: 'Summary' })} eyebrow={t('directPortal.request.eyebrows.launchReady', { defaultValue: 'Launch-ready' })}>
            <div className="space-y-3 text-sm leading-6 text-slate-300">
              <p>{t('directPortal.request.summary.queue', { defaultValue: 'We’ll send the request to the Direct ops queue.' })}</p>
              <p>{t('directPortal.request.summary.workflow', { defaultValue: 'Once the quote is ready, you can accept it, schedule the visit, and follow the case history here.' })}</p>
              <p>{t('directPortal.request.summary.history', { defaultValue: 'Proof uploads, receipts, and support messages stay attached to the same record.' })}</p>
            </div>
            <button type="submit" disabled={loading || !canSubmit} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60">
              {loading ? t('directPortal.request.actions.sending', { defaultValue: 'Sending...' }) : t('directPortal.request.actions.submit', { defaultValue: 'Request a quote' })}
            </button>
          </SectionCard>
        </aside>
      </form>
    </DirectShell>
  );
}

export function DirectQuoteThanksPage() {
  const { t } = useTranslation();
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [params] = useSearchParams();
  const referenceId = params.get('referenceId') || params.get('requestId') || '—';

  useEffect(() => {
    let active = true;
    loadProfile().then((next) => {
      if (active) setProfile(next);
    });
    return () => { active = false; };
  }, []);

  return (
    <DirectShell
      profile={profile}
      title={t('directPortal.thanks.title', { defaultValue: 'Request received' })}
      subtitle={t('directPortal.thanks.subtitle', { defaultValue: 'Thanks. Your Direct quote request is in the queue.' })}
      noIndex
      heroRight={(
        <div className="space-y-3 text-sm leading-6 text-slate-300">
          <p>{t('directPortal.thanks.body', { defaultValue: 'We’ve got your request and we’ll review it soon.' })}</p>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs uppercase tracking-[0.22em] text-slate-500">{t('directPortal.thanks.referenceLabel', { defaultValue: 'Reference' })}</div>
            <div className="mt-2 font-semibold text-white">{referenceId}</div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link to="/direct/history" className="rounded-full bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white">{t('directPortal.thanks.viewHistory', { defaultValue: 'View history' })}</Link>
            <Link to={`/direct/view-quote?referenceId=${encodeURIComponent(referenceId)}`} className="rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white">{t('homePage.company.viewQuote', { defaultValue: 'View quote' })}</Link>
            <Link to="/direct/support" className="rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white">{t('directPortal.thanks.openSupport', { defaultValue: 'Open support' })}</Link>
          </div>
        </div>
      )}
    >
      <SectionCard title={t('directPortal.thanks.nextTitle', { defaultValue: 'What happens next' })} eyebrow={t('directPortal.thanks.workflow', { defaultValue: 'Direct workflow' })}>
        <div className="grid gap-3 md:grid-cols-3">
          {[
            [t('directPortal.thanks.steps.review.title', { defaultValue: '1. Review' }), t('directPortal.thanks.steps.review.body', { defaultValue: 'We review the quote request and decide the next step.' })],
            [t('directPortal.thanks.steps.schedule.title', { defaultValue: '2. Schedule' }), t('directPortal.thanks.steps.schedule.body', { defaultValue: 'You can accept the quote and lock in a schedule window.' })],
            [t('directPortal.thanks.steps.proof.title', { defaultValue: '3. Proof & receipt' }), t('directPortal.thanks.steps.proof.body', { defaultValue: 'Upload proof or confirm receipt so history stays attached.' })],
          ].map(([title, body]) => (
            <div key={title} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="font-semibold text-white">{title}</div>
              <p className="mt-2 text-sm leading-6 text-slate-400">{body}</p>
            </div>
          ))}
        </div>
      </SectionCard>
    </DirectShell>
  );
}

export function DirectPublicQuoteLookupPage() {
  const { t, i18n } = useTranslation();
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [params] = useSearchParams();
  const [referenceId, setReferenceId] = useState(params.get('referenceId') || '');
  const [zipCode, setZipCode] = useState(params.get('zipCode') || '');
  const [lookup, setLookup] = useState(null);
  const [verifiedQuote, setVerifiedQuote] = useState(null);
  const [challengeToken, setChallengeToken] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    let active = true;
    loadProfile().then((next) => {
      if (active) setProfile(next);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (params.get('referenceId')) {
      setReferenceId(params.get('referenceId') || '');
    }
    if (params.get('zipCode')) {
      setZipCode(params.get('zipCode') || '');
    }
  }, [params]);

  const clearVerification = () => {
    setLookup(null);
    setVerifiedQuote(null);
    setChallengeToken('');
    setVerificationCode('');
    setMaskedEmail('');
    setExpiresAt('');
  };

  const handleLookup = async (event) => {
    event.preventDefault();
    const ref = referenceId.trim().toUpperCase();
    const zip = zipCode.trim();
    if (!ref || zip.replace(/\D/g, '').length !== 5) {
      toast.error(t('directPortal.lookup.errors.missing', { defaultValue: 'Enter a reference ID and a 5-digit ZIP code.' }));
      return;
    }

    setLoading(true);
    try {
      const data = await lookupPublicDirectQuote({ referenceId: ref, zipCode: zip });
      const nextQuote = data?.quote || null;
      setLookup(nextQuote);
      setVerifiedQuote(null);
      setChallengeToken('');
      setVerificationCode('');
      setMaskedEmail(nextQuote?.emailMasked || '');
      setExpiresAt('');
      toast.success(t('directPortal.lookup.messages.found', { defaultValue: 'Quote found.' }));
    } catch (error) {
      clearVerification();
      toast.error(error?.response?.data?.error || t('directPortal.lookup.errors.lookup', { defaultValue: 'Could not find that quote.' }));
    } finally {
      setLoading(false);
    }
  };

  const handleSendCode = async () => {
    const ref = referenceId.trim().toUpperCase();
    const zip = zipCode.trim();
    if (!ref || zip.replace(/\D/g, '').length !== 5) return;

    setSending(true);
    try {
      const data = await sendPublicDirectQuoteCode({ referenceId: ref, zipCode: zip });
      setChallengeToken(data?.challengeToken || '');
      setMaskedEmail(data?.maskedEmail || lookup?.emailMasked || '');
      setExpiresAt(data?.expiresAt || '');
      toast.success(t('directPortal.lookup.messages.codeSent', { defaultValue: 'Verification code sent.' }));
    } catch (error) {
      toast.error(error?.response?.data?.error || t('directPortal.lookup.errors.sendCode', { defaultValue: 'Could not send the verification code.' }));
    } finally {
      setSending(false);
    }
  };

  const handleVerifyCode = async () => {
    const ref = referenceId.trim().toUpperCase();
    const zip = zipCode.trim();
    const code = verificationCode.trim();
    if (!challengeToken || !code) {
      toast.error(t('directPortal.lookup.errors.missingCode', { defaultValue: 'Enter the code from your email.' }));
      return;
    }

    setVerifying(true);
    try {
      const data = await verifyPublicDirectQuoteCode({
        referenceId: ref,
        zipCode: zip,
        challengeToken,
        code,
      });
      setVerifiedQuote(data?.quote || null);
      toast.success(t('directPortal.lookup.messages.verified', { defaultValue: 'Code verified.' }));
    } catch (error) {
      toast.error(error?.response?.data?.error || t('directPortal.lookup.errors.verify', { defaultValue: 'Could not verify the code.' }));
    } finally {
      setVerifying(false);
    }
  };

  return (
    <DirectShell
      profile={profile}
      title={t('directPortal.lookup.title', { defaultValue: 'View your quote' })}
      subtitle={t('directPortal.lookup.subtitle', { defaultValue: 'Look up your OxSteed Direct quote with your reference ID and ZIP code, then verify by email for full details.' })}
      noIndex
      heroRight={(
        <div className="space-y-4 text-sm leading-6 text-slate-300">
          <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
            <div className="text-xs uppercase tracking-[0.22em] text-slate-500">{t('directPortal.lookup.stepsTitle', { defaultValue: 'How it works' })}</div>
            <ol className="mt-3 space-y-2">
              <li>{t('directPortal.lookup.steps.one', { defaultValue: '1. Enter your reference ID and ZIP code.' })}</li>
              <li>{t('directPortal.lookup.steps.two', { defaultValue: '2. Ask us to send a verification code to your email.' })}</li>
              <li>{t('directPortal.lookup.steps.three', { defaultValue: '3. Enter the code to unlock the quote details.' })}</li>
            </ol>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs uppercase tracking-[0.22em] text-slate-500">{t('directPortal.lookup.securityTitle', { defaultValue: 'Security' })}</div>
            <p className="mt-2">{t('directPortal.lookup.securityBody', { defaultValue: 'We use a long public reference, ZIP match, and email verification so your quote stays private.' })}</p>
          </div>
        </div>
      )}
    >
      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <SectionCard title={t('directPortal.lookup.formTitle', { defaultValue: 'Find your quote' })} eyebrow={t('directPortal.lookup.formEyebrow', { defaultValue: 'Public lookup' })}>
          <form onSubmit={handleLookup} className="space-y-4">
            <Field label={t('directPortal.lookup.fields.referenceId', { defaultValue: 'Reference ID' })} required>
              <Input
                value={referenceId}
                onChange={(event) => setReferenceId(event.target.value.toUpperCase())}
                placeholder={t('directPortal.lookup.placeholders.referenceId', { defaultValue: 'DQ-XXXXXXXXXXXX' })}
                autoComplete="off"
                spellCheck="false"
              />
            </Field>
            <Field label={t('directPortal.lookup.fields.zipCode', { defaultValue: 'ZIP code' })} required>
              <Input
                inputMode="numeric"
                value={zipCode}
                onChange={(event) => setZipCode(event.target.value.replace(/\D/g, '').slice(0, 5))}
                placeholder={t('directPortal.lookup.placeholders.zipCode', { defaultValue: '45501' })}
                maxLength={5}
              />
            </Field>
            <div className="flex flex-wrap gap-3">
              <button type="submit" disabled={loading} className="rounded-full bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
                {loading ? t('directPortal.lookup.actions.searching', { defaultValue: 'Looking up…' }) : t('directPortal.lookup.actions.find', { defaultValue: 'Find quote' })}
              </button>
              <Link to="/direct/request-quote" className="rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white">
                {t('homePage.company.requestQuote', { defaultValue: 'Request a quote' })}
              </Link>
            </div>
          </form>

          {lookup && (
            <div className="mt-6 rounded-[24px] border border-white/10 bg-white/5 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone="orange">{statusLabel(lookup.status, t)}</Chip>
                <Chip tone="blue">{paymentLabel(lookup.paymentStatus, t)}</Chip>
                {lookup.quoteAmountCents !== null && lookup.quoteAmountCents !== undefined && (
                  <Chip tone="emerald">{currencyLabel(lookup.quoteAmountCents, lookup.quoteCurrencyCode, i18n.resolvedLanguage)}</Chip>
                )}
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <InfoRow label={t('directPortal.lookup.labels.service', { defaultValue: 'Service' })} value={lookup.serviceCategory || '—'} />
                <InfoRow label={t('directPortal.lookup.labels.location', { defaultValue: 'Location' })} value={lookup.serviceLocation || '—'} />
                <InfoRow label={t('directPortal.lookup.labels.zipCode', { defaultValue: 'ZIP code' })} value={lookup.serviceZipCode || zipCode || '—'} />
                <InfoRow label={t('directPortal.lookup.labels.estimate', { defaultValue: 'Estimate' })} value={lookup.quoteAmountCents !== null && lookup.quoteAmountCents !== undefined ? currencyLabel(lookup.quoteAmountCents, lookup.quoteCurrencyCode, i18n.resolvedLanguage) : '—'} />
                <InfoRow label={t('directPortal.lookup.labels.preferredDate', { defaultValue: 'Preferred date' })} value={formatDate(lookup.preferredDate, i18n.resolvedLanguage)} />
                <InfoRow label={t('directPortal.lookup.labels.window', { defaultValue: 'Time window' })} value={lookup.preferredTimeWindow || '—'} />
                <InfoRow label={t('directPortal.lookup.labels.scheduled', { defaultValue: 'Scheduled' })} value={lookup.scheduledStartAt ? `${formatDateTime(lookup.scheduledStartAt, i18n.resolvedLanguage)}${lookup.scheduledEndAt ? ` → ${formatDateTime(lookup.scheduledEndAt, i18n.resolvedLanguage)}` : ''}` : '—'} />
                <InfoRow label={t('directPortal.lookup.labels.payment', { defaultValue: 'Payment' })} value={paymentLabel(lookup.paymentStatus, t)} />
              </div>
            </div>
          )}
        </SectionCard>

        <SectionCard title={t('directPortal.lookup.detailTitle', { defaultValue: 'Unlock full quote details' })} eyebrow={t('directPortal.lookup.detailEyebrow', { defaultValue: 'Email verification' })}>
          {!lookup ? (
            <EmptyState
              icon={ShieldCheck}
              title={t('directPortal.lookup.emptyTitle', { defaultValue: 'Search for your quote first' })}
              body={t('directPortal.lookup.emptyBody', { defaultValue: 'Enter your reference ID and ZIP code to get started.' })}
            />
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-4 text-sm leading-6 text-slate-300">
                <p>{t('directPortal.lookup.emailHelp', { defaultValue: 'We will send a verification code to the email on file before showing the full quote record.' })}</p>
                <p className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500">{t('directPortal.lookup.emailLabel', { defaultValue: 'Email on file' })}: <span className="text-white normal-case tracking-normal">{maskedEmail || lookup.emailMasked || t('directPortal.lookup.emailHidden', { defaultValue: 'hidden' })}</span></p>
                {expiresAt && (
                  <p className="mt-2 text-xs text-slate-500">{t('directPortal.lookup.expiresAt', { defaultValue: 'Code expires' })}: <span className="text-white">{formatDateTime(expiresAt, i18n.resolvedLanguage)}</span></p>
                )}
              </div>

              <div className="flex flex-wrap gap-3">
                <button type="button" onClick={handleSendCode} disabled={sending} className="rounded-full bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
                  {sending ? t('directPortal.lookup.actions.sendingCode', { defaultValue: 'Sending code…' }) : t('directPortal.lookup.actions.sendCode', { defaultValue: 'Send verification code' })}
                </button>
                <Link to="/direct/request-quote" className="rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white">
                  {t('homePage.company.requestQuote', { defaultValue: 'Request a quote' })}
                </Link>
              </div>

              <Field label={t('directPortal.lookup.fields.code', { defaultValue: 'Verification code' })}>
                <Input
                  inputMode="numeric"
                  value={verificationCode}
                  onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder={t('directPortal.lookup.placeholders.code', { defaultValue: '6-digit code' })}
                  maxLength={6}
                />
              </Field>

              <button type="button" onClick={handleVerifyCode} disabled={verifying || !challengeToken} className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm font-semibold text-emerald-200 disabled:cursor-not-allowed disabled:opacity-60">
                {verifying ? t('directPortal.lookup.actions.verifying', { defaultValue: 'Verifying…' }) : t('directPortal.lookup.actions.unlock', { defaultValue: 'Unlock details' })}
              </button>

              {verifiedQuote ? (
                <div className="space-y-4 rounded-[24px] border border-emerald-500/20 bg-emerald-500/10 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone="emerald">{t('directPortal.lookup.verifiedLabel', { defaultValue: 'Verified' })}</Chip>
                    <Chip tone="orange">{verifiedQuote.referenceId}</Chip>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <InfoRow label={t('directPortal.lookup.labels.customerName', { defaultValue: 'Customer' })} value={`${verifiedQuote.firstName || ''} ${verifiedQuote.lastName || ''}`.trim() || '—'} />
                    <InfoRow label={t('directPortal.lookup.labels.email', { defaultValue: 'Email' })} value={verifiedQuote.email || '—'} />
                    <InfoRow label={t('directPortal.lookup.labels.phone', { defaultValue: 'Phone' })} value={verifiedQuote.phone || '—'} />
                    <InfoRow label={t('directPortal.lookup.labels.contact', { defaultValue: 'Preferred contact' })} value={verifiedQuote.preferredContactMethod || '—'} />
                    <InfoRow label={t('directPortal.lookup.labels.serviceAddress', { defaultValue: 'Service address' })} value={verifiedQuote.serviceAddress || '—'} />
                    <InfoRow label={t('directPortal.lookup.labels.details', { defaultValue: 'Details' })} value={verifiedQuote.details || '—'} />
                  </div>
                  {verifiedQuote.photoAttachments?.length > 0 && (
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{t('directPortal.lookup.labels.attachments', { defaultValue: 'Attachments' })}</div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {verifiedQuote.photoAttachments.map((attachment) => (
                          <a key={attachment.key || attachment.url} href={attachment.url || '#'} target="_blank" rel="noreferrer" className="rounded-2xl border border-white/10 bg-slate-950/80 p-3 text-sm text-slate-200 hover:border-orange-500/30">
                            <div className="font-medium text-white">{attachment.name || t('directPortal.lookup.labels.attachment', { defaultValue: 'Attachment' })}</div>
                            <div className="mt-1 text-xs text-slate-500">{attachment.type || 'file'}</div>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-6 text-slate-400">
                  {t('directPortal.lookup.lockedBody', { defaultValue: 'After you verify the code, we will show the full quote details here.' })}
                </div>
              )}
            </div>
          )}
        </SectionCard>
      </div>
    </DirectShell>
  );
}

function RequestSnapshot({ request }) {
  const { t, i18n } = useTranslation();

  if (!request) return null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="orange">{statusLabel(request.status, t)}</Chip>
        <Chip tone="blue">{paymentLabel(request.paymentStatus, t)}</Chip>
        {request.quoteAmountCents !== null && request.quoteAmountCents !== undefined && (
          <Chip tone="emerald">{currencyLabel(request.quoteAmountCents, request.quoteCurrencyCode, i18n.resolvedLanguage)}</Chip>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <InfoRow label={t('directPortal.lookup.labels.service', { defaultValue: 'Service' })} value={request.serviceCategory} />
        <InfoRow label={t('directPortal.lookup.labels.location', { defaultValue: 'Location' })} value={request.serviceLocation} />
        <InfoRow label={t('directPortal.lookup.labels.preferredDate', { defaultValue: 'Preferred date' })} value={formatDate(request.preferredDate, i18n.resolvedLanguage)} />
        <InfoRow label={t('directPortal.lookup.labels.window', { defaultValue: 'Time window' })} value={request.preferredTimeWindow || '—'} />
        <InfoRow label={t('directPortal.case.fields.scheduledStart', { defaultValue: 'Scheduled start' })} value={formatDateTime(request.scheduledStartAt, i18n.resolvedLanguage)} />
        <InfoRow label={t('directPortal.case.fields.scheduledEnd', { defaultValue: 'Scheduled end' })} value={formatDateTime(request.scheduledEndAt, i18n.resolvedLanguage)} />
      </div>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm font-medium text-white">{value || '—'}</div>
    </div>
  );
}

function useDirectRequestData(id) {
  const { t } = useTranslation();
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState('');

  const load = async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const data = await getDirectRequest(id);
      setRequest(data?.request || null);
    } catch (err) {
      setError(err?.response?.data?.error || t('directPortal.case.errors.loadRequest', { defaultValue: 'Failed to load request' }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);
  return { request, setRequest, loading, error, refresh: load };
}

export function DirectQuoteDetailPage() {
  return <DirectCasePage mode="quote" />;
}

export function DirectBookingPage() {
  return <DirectCasePage mode="book" />;
}

export function DirectJobPage() {
  return <DirectCasePage mode="job" />;
}

export function DirectPaymentProofPage() {
  return <DirectCasePage mode="proof" />;
}

export function DirectPaymentReceiptPage() {
  return <DirectCasePage mode="receipt" />;
}

export function DirectChangePage() {
  return <DirectCasePage mode="change" />;
}

export function DirectHistoryPage() {
  const { t, i18n } = useTranslation();
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([loadProfile(), getDirectHistory()])
      .then(([nextProfile, data]) => {
        if (!active) return;
        setProfile(nextProfile);
        setHistory(Array.isArray(data?.requests) ? data.requests : []);
      })
      .catch(() => {
        if (active) toast.error(t('directPortal.history.errors.load', { defaultValue: 'Could not load history.' }));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  return (
    <DirectShell profile={profile} title={t('directPortal.history.title', { defaultValue: 'Service history' })} subtitle={t('directPortal.history.subtitle', { defaultValue: 'All of your Direct quote requests, jobs, and receipts in one place.' })}>
      {loading ? (
        <EmptyState icon={RefreshCw} title={t('directPortal.history.loadingTitle', { defaultValue: 'Loading history…' })} body={t('directPortal.history.loadingBody', { defaultValue: 'We’re pulling your Direct records now.' })} />
      ) : history.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={t('directPortal.history.emptyTitle', { defaultValue: 'No Direct history yet' })}
          body={t('directPortal.history.emptyBody', { defaultValue: 'Once you request a quote or schedule a job, the record will show up here.' })}
          action={<Link to="/direct/request-quote" className="rounded-full bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white">{t('homePage.company.requestQuote', { defaultValue: 'Request a quote' })}</Link>}
        />
      ) : (
        <div className="grid gap-4">
          {history.map((item) => (
            <Link key={item.id} to={`/direct/jobs/${item.id}`} className="rounded-[24px] border border-white/10 bg-slate-950/80 p-5 text-left transition hover:border-orange-500/30 hover:bg-slate-950">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold text-white">{item.serviceCategory || item.companyName || t('directPortal.common.directRequest', { defaultValue: 'Direct request' })}</div>
                  <div className="mt-1 text-sm text-slate-400">{item.serviceLocation || item.serviceCity || '—'}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Chip tone="blue">{statusLabel(item.status, t)}</Chip>
                  <Chip tone="emerald">{currencyLabel(item.quoteAmountCents || 0, item.quoteCurrencyCode, i18n.resolvedLanguage)}</Chip>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <InfoRow label={t('directPortal.status.requested', { defaultValue: 'Requested' })} value={formatDateTime(item.createdAt, i18n.resolvedLanguage)} />
                <InfoRow label={t('directPortal.status.scheduled', { defaultValue: 'Scheduled' })} value={formatDateTime(item.scheduledStartAt, i18n.resolvedLanguage)} />
                <InfoRow label={t('directPortal.lookup.labels.payment', { defaultValue: 'Payment' })} value={paymentLabel(item.paymentStatus, t)} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </DirectShell>
  );
}

export function DirectSupportPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [history, setHistory] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [request, setRequest] = useState(null);
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [profileData, historyData] = await Promise.all([loadProfile(), getDirectHistory()]);
      setProfile(profileData);
      const requests = Array.isArray(historyData?.requests) ? historyData.requests : [];
      setHistory(requests);
      const chosen = selectedId || requests.find((item) => ['new', 'reviewing', 'quoted', 'accepted', 'scheduled', 'started', 'waiting_customer'].includes(String(item.status || '').toLowerCase()))?.id || requests[0]?.id || null;
      setSelectedId(chosen);
      if (chosen) {
        const detail = await getDirectRequest(chosen);
        setRequest(detail?.request || null);
        setMessages(detail?.request?.messages || []);
      } else {
        setRequest(null);
        setMessages([]);
      }
    } catch {
      toast.error(t('directPortal.support.errors.load', { defaultValue: 'Could not load support.' }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    getDirectRequest(selectedId)
      .then((detail) => {
        if (!active) return;
        setRequest(detail?.request || null);
        setMessages(detail?.request?.messages || []);
      })
      .catch(() => {})
      .finally(() => {});
    return () => { active = false; };
  }, [selectedId]);

  const handleSend = async () => {
    const next = message.trim();
    if (!next || !selectedId) return;
    setSending(true);
    try {
      await sendDirectMessage(selectedId, next);
      setMessage('');
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.error || t('directPortal.support.errors.send', { defaultValue: 'Could not send message.' }));
    } finally {
      setSending(false);
    }
  };

  return (
    <DirectShell profile={profile} title={t('directPortal.support.title', { defaultValue: 'Support and messages' })} subtitle={t('directPortal.support.subtitle', { defaultValue: 'Keep support attached to the Direct request instead of a separate inbox.' })}>
      <div className="grid gap-6 xl:grid-cols-[0.7fr_1.3fr]">
        <SectionCard title={t('directPortal.support.requestsTitle', { defaultValue: 'Your Direct requests' })} eyebrow={t('directPortal.support.eyebrow', { defaultValue: 'Support' })} className="min-h-[28rem]">
          {loading ? (
            <div className="text-sm text-slate-400">{t('directPortal.common.loading', { defaultValue: 'Loading…' })}</div>
          ) : history.length === 0 ? (
            <EmptyState icon={MessageSquare} title={t('directPortal.support.emptyTitle', { defaultValue: 'Nothing here yet' })} body={t('directPortal.support.emptyBody', { defaultValue: 'Create a quote request first and the support thread will appear here.' })} />
          ) : (
            <div className="space-y-2">
              {history.map((item) => (
                <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={`w-full rounded-2xl border p-4 text-left transition ${String(selectedId) === String(item.id) ? 'border-orange-500/40 bg-orange-500/10' : 'border-white/10 bg-white/5 hover:border-white/20'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold text-white">{item.serviceCategory || t('directPortal.common.directRequest', { defaultValue: 'Direct request' })}</div>
                      <div className="mt-1 text-xs text-slate-500">{item.serviceLocation || item.serviceCity || '—'}</div>
                    </div>
                    <Chip tone="blue">{statusLabel(item.status, t)}</Chip>
                  </div>
                </button>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title={request ? t('directPortal.support.requestNumber', { id: request.id, defaultValue: 'Request #{{id}}' }) : t('directPortal.support.chooseRequest', { defaultValue: 'Choose a request' })} eyebrow={t('directPortal.support.conversation', { defaultValue: 'Conversation' })} className="min-h-[28rem]">
          {!request ? (
            <EmptyState icon={MessageSquare} title={t('directPortal.support.selectTitle', { defaultValue: 'Select a request' })} body={t('directPortal.support.selectBody', { defaultValue: 'Pick a Direct job on the left to open the support thread.' })} />
          ) : (
            <div className="space-y-4">
              <RequestSnapshot request={request} />
              <div className="rounded-[24px] border border-white/10 bg-slate-950/70 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-white"><MessageSquare size={15} className="text-orange-300" /> {t('directPortal.support.messages', { defaultValue: 'Messages' })}</div>
                <div className="mt-4 max-h-[22rem] space-y-3 overflow-auto pr-1">
                  {messages.length === 0 ? (
                    <div className="text-sm text-slate-500">{t('directPortal.support.noMessages', { defaultValue: 'No messages yet.' })}</div>
                  ) : (
                    messages.map((item) => (
                      <div key={item.id} className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6 ${item.senderRole === 'customer' ? 'ml-auto bg-orange-500 text-white' : 'bg-white/5 text-slate-200'}`}>
                        <div>{item.message}</div>
                        <div className={`mt-2 text-[11px] ${item.senderRole === 'customer' ? 'text-orange-100/80' : 'text-slate-500'}`}>{formatDateTime(item.createdAt, i18n.resolvedLanguage)}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="grid gap-3">
                <Textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('directPortal.support.messagePlaceholder', { defaultValue: 'Type your message to the OxSteed team...' })} />
                <div className="flex flex-wrap gap-3">
                  <button type="button" onClick={handleSend} disabled={sending || !message.trim()} className="inline-flex items-center gap-2 rounded-full bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
                    <Send size={15} /> {sending ? t('directPortal.support.sending', { defaultValue: 'Sending…' }) : t('directPortal.support.send', { defaultValue: 'Send' })}
                  </button>
                  <Link to="/support/escalation" className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white">
                    {t('directPortal.support.openEscalation', { defaultValue: 'Open live escalation' })}
                  </Link>
                </div>
              </div>
            </div>
          )}
        </SectionCard>
      </div>
    </DirectShell>
  );
}

export function DirectAccountPage() {
  const { t } = useTranslation();
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [data, setData] = useState({ locations: [] });
  const [form, setForm] = useState({
    label: '',
    address_line1: '',
    address_line2: '',
    city: '',
    region: '',
    postal_code: '',
    country_code: 'US',
    notes: '',
    is_default: true,
  });
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [profileData, accountData] = await Promise.all([loadProfile(), getDirectAccount()]);
      setProfile(profileData);
      setData(accountData || { locations: [] });
    } catch {
      toast.error(t('directPortal.account.errors.load', { defaultValue: 'Could not load account data.' }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const save = async () => {
    if (!form.label.trim() || !form.address_line1.trim() || !form.city.trim()) {
      toast.error(t('directPortal.account.errors.required', { defaultValue: 'Label, address, and city are required.' }));
      return;
    }
    try {
      await saveDirectLocation(editingId, form);
      toast.success(t('directPortal.account.messages.saved', { defaultValue: 'Location saved.' }));
      setEditingId(null);
      setForm({
        label: '',
        address_line1: '',
        address_line2: '',
        city: '',
        region: '',
        postal_code: '',
        country_code: 'US',
        notes: '',
        is_default: true,
      });
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.error || t('directPortal.account.errors.save', { defaultValue: 'Could not save location.' }));
    }
  };

  const editLocation = (location) => {
    setEditingId(location.id);
    setForm({
      label: location.label || '',
      address_line1: location.addressLine1 || '',
      address_line2: location.addressLine2 || '',
      city: location.city || '',
      region: location.region || '',
      postal_code: location.postalCode || '',
      country_code: location.countryCode || 'US',
      notes: location.notes || '',
      is_default: !!location.isDefault,
    });
  };

  return (
    <DirectShell profile={profile} title={t('directPortal.account.title', { defaultValue: 'Customer profile and locations' })} subtitle={t('directPortal.account.subtitle', { defaultValue: 'Save addresses, notes, and preferred city so future Direct jobs are easier to schedule.' })}>
      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <SectionCard title={t('directPortal.account.savedLocations', { defaultValue: 'Saved locations' })} eyebrow={t('directPortal.account.eyebrow', { defaultValue: 'Account' })}>
          {loading ? (
            <div className="text-sm text-slate-400">{t('directPortal.common.loading', { defaultValue: 'Loading…' })}</div>
          ) : (data.locations || []).length === 0 ? (
            <EmptyState icon={MapPin} title={t('directPortal.account.emptyTitle', { defaultValue: 'No saved locations' })} body={t('directPortal.account.emptyBody', { defaultValue: 'Add your first service address here.' })} />
          ) : (
            <div className="space-y-2">
              {data.locations.map((location) => (
                <div key={location.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-white">{location.label}{location.isDefault ? ` · ${t('directPortal.account.defaultLabel', { defaultValue: 'default' })}` : ''}</div>
                      <div className="mt-1 text-sm text-slate-400">{location.addressLine1}{location.addressLine2 ? `, ${location.addressLine2}` : ''}</div>
                      <div className="text-sm text-slate-400">{location.city}{location.region ? `, ${location.region}` : ''} {location.postalCode}</div>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => editLocation(location)} className="rounded-full border border-white/10 bg-slate-950/70 px-3 py-1.5 text-xs font-semibold text-white">{t('directPortal.account.actions.edit', { defaultValue: 'Edit' })}</button>
                      <button type="button" onClick={async () => { await deleteDirectLocation(location.id); toast.success(t('directPortal.account.messages.deleted', { defaultValue: 'Location deleted.' })); await load(); }} className="rounded-full border border-white/10 bg-slate-950/70 px-3 py-1.5 text-xs font-semibold text-white">{t('directPortal.account.actions.delete', { defaultValue: 'Delete' })}</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title={editingId ? t('directPortal.account.editLocation', { defaultValue: 'Edit location' }) : t('directPortal.account.addLocation', { defaultValue: 'Add a location' })} eyebrow={t('directPortal.account.profileEyebrow', { defaultValue: 'Profile' })}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('directPortal.account.fields.label', { defaultValue: 'Label' })} required><Input value={form.label} onChange={(e) => setForm((current) => ({ ...current, label: e.target.value }))} placeholder={t('directPortal.account.placeholders.label', { defaultValue: 'Home, shop, office...' })} /></Field>
            <Field label={t('directPortal.account.fields.countryCode', { defaultValue: 'Country code' })}><Input value={form.country_code} onChange={(e) => setForm((current) => ({ ...current, country_code: e.target.value }))} placeholder="US" /></Field>
            <Field label={t('directPortal.account.fields.address', { defaultValue: 'Address' })} required><Input value={form.address_line1} onChange={(e) => setForm((current) => ({ ...current, address_line1: e.target.value }))} /></Field>
            <Field label={t('directPortal.account.fields.addressLine2', { defaultValue: 'Address line 2' })}><Input value={form.address_line2} onChange={(e) => setForm((current) => ({ ...current, address_line2: e.target.value }))} /></Field>
            <Field label={t('directPortal.account.fields.city', { defaultValue: 'City' })} required><Input value={form.city} onChange={(e) => setForm((current) => ({ ...current, city: e.target.value }))} /></Field>
            <Field label={t('directPortal.account.fields.region', { defaultValue: 'Region / state' })}><Input value={form.region} onChange={(e) => setForm((current) => ({ ...current, region: e.target.value }))} /></Field>
            <Field label={t('directPortal.account.fields.postalCode', { defaultValue: 'Postal code' })}><Input value={form.postal_code} onChange={(e) => setForm((current) => ({ ...current, postal_code: e.target.value }))} /></Field>
            <Field label={t('directPortal.account.fields.defaultLocation', { defaultValue: 'Default location' })}>
              <Select value={form.is_default ? 'true' : 'false'} onChange={(e) => setForm((current) => ({ ...current, is_default: e.target.value === 'true' }))}>
                <option value="true">{t('directPortal.common.yes', { defaultValue: 'Yes' })}</option>
                <option value="false">{t('directPortal.common.no', { defaultValue: 'No' })}</option>
              </Select>
            </Field>
          </div>
          <div className="mt-4">
            <Field label={t('directPortal.account.fields.notes', { defaultValue: 'Notes' })}><Textarea rows={4} value={form.notes} onChange={(e) => setForm((current) => ({ ...current, notes: e.target.value }))} placeholder={t('directPortal.account.placeholders.notes', { defaultValue: 'Gate code, parking, service instructions...' })} /></Field>
          </div>
          <div className="mt-4 flex gap-3">
            <button type="button" onClick={save} className="rounded-full bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white">{t('directPortal.account.actions.save', { defaultValue: 'Save location' })}</button>
            {editingId && (
              <button type="button" onClick={() => { setEditingId(null); setForm({ ...form, label: '', address_line1: '', address_line2: '', city: '', region: '', postal_code: '', notes: '' }); }} className="rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white">
                {t('directPortal.account.actions.cancelEdit', { defaultValue: 'Cancel edit' })}
              </button>
            )}
          </div>
        </SectionCard>
      </div>
    </DirectShell>
  );
}

function Timeline({ request }) {
  const { t } = useTranslation();
  const events = [
    'new',
    'reviewing',
    'quoted',
    'accepted',
    'scheduled',
    'en_route',
    'started',
    'waiting_customer',
    'completed',
    'closed',
  ];
  const currentIndex = Math.max(events.findIndex((key) => key === String(request?.status || 'new').toLowerCase()), 0);
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
      {events.map((key, index) => (
        <div key={key} className={`rounded-2xl border p-3 text-center text-xs font-semibold uppercase tracking-[0.16em] ${index <= currentIndex ? 'border-orange-500/30 bg-orange-500/10 text-orange-200' : 'border-white/10 bg-white/5 text-slate-500'}`}>
          {statusLabel(key, t)}
        </div>
      ))}
    </div>
  );
}

function DirectCasePage({ mode }) {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [request, setRequest] = useState(null);
  const [messages, setMessages] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [proofForm, setProofForm] = useState({
    paymentMethod: 'cash',
    paymentReference: '',
    proofLink: '',
    note: '',
  });
  const [scheduleForm, setScheduleForm] = useState({
    preferredDate: '',
    preferredTimeWindow: '',
    serviceAddress: '',
    serviceCity: '',
    onSiteContactName: '',
    onSiteContactPhone: '',
    accessNotes: '',
  });
  const [locationData, setLocationData] = useState({ locations: [] });

  const load = async () => {
    setLoading(true);
    try {
      const profileData = await loadProfile();
      setProfile(profileData);
      if (mode === 'account') {
        const accountData = await getDirectAccount();
        setLocationData(accountData || { locations: [] });
        setLoading(false);
        return;
      }

      if (!id && mode !== 'history') {
        setLoading(false);
        return;
      }

      if (id) {
        const detail = await getDirectRequest(id);
        const nextRequest = detail?.request || null;
        setRequest(nextRequest);
        setMessages(nextRequest?.messages || []);
        setAttachments(Array.isArray(nextRequest?.photoAttachments) ? nextRequest.photoAttachments : []);
        setScheduleForm({
          preferredDate: nextRequest?.preferredDate ? String(nextRequest.preferredDate).slice(0, 10) : '',
          preferredTimeWindow: nextRequest?.preferredTimeWindow || '',
          serviceAddress: nextRequest?.serviceAddress || '',
          serviceCity: nextRequest?.serviceCity || '',
          onSiteContactName: nextRequest?.onSiteContactName || '',
          onSiteContactPhone: nextRequest?.onSiteContactPhone || '',
          accessNotes: nextRequest?.accessNotes || '',
        });
        setProofForm({
          paymentMethod: nextRequest?.paymentMethod || 'cash',
          paymentReference: nextRequest?.paymentReference || '',
          proofLink: nextRequest?.proofLink || '',
          note: '',
        });
      }
    } catch (error) {
      toast.error(error?.response?.data?.error || t('directPortal.case.errors.load', { defaultValue: 'Could not load the Direct record.' }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id, mode]);

  const header = useMemo(() => {
    switch (mode) {
      case 'quote': return { title: t('directPortal.case.headers.quote.title', { defaultValue: 'Quote review' }), subtitle: t('directPortal.case.headers.quote.subtitle', { defaultValue: 'Review the estimate and decide whether to accept it.' }) };
      case 'book': return { title: t('directPortal.case.headers.book.title', { defaultValue: 'Schedule your visit' }), subtitle: t('directPortal.case.headers.book.subtitle', { defaultValue: 'Pick a time window and confirm the service address.' }) };
      case 'job': return { title: t('directPortal.case.headers.job.title', { defaultValue: 'Job status' }), subtitle: t('directPortal.case.headers.job.subtitle', { defaultValue: 'Track the request from quote to completion.' }) };
      case 'proof': return { title: t('directPortal.case.headers.proof.title', { defaultValue: 'Payment proof' }), subtitle: t('directPortal.case.headers.proof.subtitle', { defaultValue: 'Upload a receipt or reference so the payment stays attached.' }) };
      case 'receipt': return { title: t('directPortal.case.headers.receipt.title', { defaultValue: 'Receipt confirmation' }), subtitle: t('directPortal.case.headers.receipt.subtitle', { defaultValue: 'Confirm that the proof has been received and tied to history.' }) };
      case 'history': return { title: t('directPortal.history.title', { defaultValue: 'Service history' }), subtitle: t('directPortal.case.headers.history.subtitle', { defaultValue: 'See every Direct request, quote, job, and receipt.' }) };
      case 'support': return { title: t('directPortal.case.headers.support.title', { defaultValue: 'Direct support' }), subtitle: t('directPortal.case.headers.support.subtitle', { defaultValue: 'Message the OxSteed team about this work.' }) };
      case 'account': return { title: t('directPortal.account.savedLocations', { defaultValue: 'Saved locations' }), subtitle: t('directPortal.case.headers.account.subtitle', { defaultValue: 'Keep service addresses and notes ready for the next visit.' }) };
      case 'change': return { title: t('directPortal.case.headers.change.title', { defaultValue: 'Cancel or reschedule' }), subtitle: t('directPortal.case.headers.change.subtitle', { defaultValue: 'Adjust the plan without restarting the entire flow.' }) };
      default: return { title: t('directPortal.common.directRequest', { defaultValue: 'Direct request' }), subtitle: t('directPortal.case.headers.default.subtitle', { defaultValue: 'Review and manage this case.' }) };
    }
  }, [mode, t]);

  const saveSchedule = async () => {
    if (!id) return;
    setActionBusy(true);
    try {
      const { request: updated } = await scheduleDirectRequest(id, scheduleForm);
      setRequest(updated);
      toast.success(t('directPortal.case.messages.scheduleSaved', { defaultValue: 'Schedule saved.' }));
      navigate(`/direct/jobs/${id}`);
    } catch (error) {
      toast.error(error?.response?.data?.error || t('directPortal.case.errors.saveSchedule', { defaultValue: 'Could not save schedule.' }));
    } finally {
      setActionBusy(false);
    }
  };

  const saveChange = async (action = 'reschedule') => {
    if (!id) return;
    setActionBusy(true);
    try {
      const { request: updated } = await changeDirectRequest(id, { ...scheduleForm, action });
      setRequest(updated);
      toast.success(action === 'cancel' ? t('directPortal.case.messages.cancelled', { defaultValue: 'Request cancelled.' }) : t('directPortal.case.messages.updated', { defaultValue: 'Request updated.' }));
      if (action === 'cancel') navigate('/direct/history');
    } catch (error) {
      toast.error(error?.response?.data?.error || t('directPortal.case.errors.update', { defaultValue: 'Could not update the request.' }));
    } finally {
      setActionBusy(false);
    }
  };

  const accept = async () => {
    if (!id) return;
    setActionBusy(true);
    try {
      const { request: updated } = await acceptDirectRequest(id);
      setRequest(updated);
      toast.success(t('directPortal.case.messages.quoteAccepted', { defaultValue: 'Quote accepted.' }));
      navigate(`/direct/book/${id}`);
    } catch (error) {
      toast.error(error?.response?.data?.error || t('directPortal.case.errors.acceptQuote', { defaultValue: 'Could not accept the quote.' }));
    } finally {
      setActionBusy(false);
    }
  };

  const reject = async () => {
    if (!id) return;
    const reason = window.prompt(t('directPortal.case.prompts.declineReason', { defaultValue: 'Why are you declining this quote?' })) || '';
    setActionBusy(true);
    try {
      const { request: updated } = await changeDirectRequest(id, { action: 'cancel', reason });
      setRequest(updated);
      toast.success(t('directPortal.case.messages.declined', { defaultValue: 'Request declined.' }));
      navigate('/direct/history');
    } catch (error) {
      toast.error(error?.response?.data?.error || t('directPortal.case.errors.declineQuote', { defaultValue: 'Could not decline the quote.' }));
    } finally {
      setActionBusy(false);
    }
  };

  const submitMessage = async () => {
    if (!id || !message.trim()) return;
    setActionBusy(true);
    try {
      await sendDirectMessage(id, message.trim());
      setMessage('');
      await load();
      toast.success(t('directPortal.case.messages.messageSent', { defaultValue: 'Message sent.' }));
    } catch (error) {
      toast.error(error?.response?.data?.error || t('directPortal.support.errors.send', { defaultValue: 'Could not send message.' }));
    } finally {
      setActionBusy(false);
    }
  };

  const handleProofUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !id) return;
    try {
      const response = await uploadDirectAsset(file, { purpose: 'payment-proof', requestId: id });
      setAttachments((current) => [...current, response.attachment]);
      setProofForm((current) => ({ ...current, proofLink: response.attachment?.url || current.proofLink }));
      toast.success(t('directPortal.case.messages.proofUploaded', { defaultValue: 'Proof attachment uploaded.' }));
    } catch (error) {
      toast.error(error?.response?.data?.error || t('directPortal.case.errors.uploadProof', { defaultValue: 'Could not upload proof.' }));
    }
  };

  const submitProof = async () => {
    if (!id) return;
    setActionBusy(true);
    try {
      const { request: updated } = await submitDirectProof(id, {
        ...proofForm,
        proofAttachment: attachments[0] || null,
      });
      setRequest(updated);
      toast.success(t('directPortal.case.messages.proofSaved', { defaultValue: 'Payment proof saved.' }));
      navigate(`/direct/payments/${id}`);
    } catch (error) {
      toast.error(error?.response?.data?.error || t('directPortal.case.errors.saveProof', { defaultValue: 'Could not save proof.' }));
    } finally {
      setActionBusy(false);
    }
  };

  const confirmProof = async () => {
    if (!id) return;
    setActionBusy(true);
    try {
      const { request: updated } = await confirmDirectProof(id, { note: 'Confirmed from Direct portal.' });
      setRequest(updated);
      toast.success(t('directPortal.case.messages.receiptConfirmed', { defaultValue: 'Receipt confirmed.' }));
      navigate(`/direct/history`);
    } catch (error) {
      toast.error(error?.response?.data?.error || t('directPortal.case.errors.confirmReceipt', { defaultValue: 'Could not confirm receipt.' }));
    } finally {
      setActionBusy(false);
    }
  };

  const locationOptions = Array.isArray(locationData.locations) ? locationData.locations : [];

  const title = header.title;
  const subtitle = header.subtitle;

  return (
    <DirectShell profile={profile} title={title} subtitle={subtitle}>
      {loading ? (
        <EmptyState icon={RefreshCw} title={t('directPortal.common.loading', { defaultValue: 'Loading…' })} body={t('directPortal.case.loadingBody', { defaultValue: 'Fetching the Direct record now.' })} />
      ) : mode === 'history' ? (
        <DirectHistoryPage />
      ) : mode === 'account' ? (
        <DirectAccountPage />
      ) : !request ? (
        <EmptyState icon={Package} title={t('directPortal.case.emptyTitle', { defaultValue: 'No record found' })} body={t('directPortal.case.emptyBody', { defaultValue: 'This Direct record is not available yet.' })} action={<Link to="/direct/request-quote" className="rounded-full bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white">{t('homePage.company.requestQuote', { defaultValue: 'Request a quote' })}</Link>} />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <SectionCard title={request.serviceCategory || request.companyName || t('directPortal.common.directRequest', { defaultValue: 'Direct request' })} eyebrow={t('directPortal.case.caseNumber', { id: request.id, defaultValue: 'Case #{{id}}' })}>
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone="orange">{statusLabel(request.status, t)}</Chip>
                <Chip tone="blue">{paymentLabel(request.paymentStatus, t)}</Chip>
                {request.quoteAmountCents !== null && request.quoteAmountCents !== undefined && (
                  <Chip tone="emerald">{currencyLabel(request.quoteAmountCents, request.quoteCurrencyCode, i18n.resolvedLanguage)}</Chip>
                )}
              </div>
              <RequestSnapshot request={request} />
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{t('directPortal.lookup.labels.details', { defaultValue: 'Details' })}</div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-300">{request.details || t('directPortal.case.noDescription', { defaultValue: 'No description yet.' })}</p>
              </div>
              {request.accessNotes && (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{t('directPortal.case.fields.accessNotes', { defaultValue: 'Access notes' })}</div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-300">{request.accessNotes}</p>
                </div>
              )}
              {Array.isArray(request.photoAttachments) && request.photoAttachments.length > 0 && (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{t('directPortal.request.sections.photos', { defaultValue: 'Photos' })}</div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {request.photoAttachments.map((attachment) => (
                      <a key={attachment.key || attachment.url} href={attachment.url || '#'} target="_blank" rel="noreferrer" className="rounded-2xl border border-white/10 bg-slate-950/80 p-3 text-sm text-slate-200 hover:border-orange-500/30">
                        <div className="font-medium text-white">{attachment.name || t('directPortal.case.photo', { defaultValue: 'Photo' })}</div>
                        <div className="mt-1 text-xs text-slate-500">{attachment.type || t('directPortal.lookup.labels.attachment', { defaultValue: 'Attachment' })}</div>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              <Timeline request={request} />

              <div className="flex flex-wrap gap-3">
                {mode === 'quote' && (
                  <>
                    <button type="button" onClick={accept} disabled={actionBusy} className="rounded-full bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">{t('directPortal.case.actions.acceptQuote', { defaultValue: 'Accept quote' })}</button>
                    <button type="button" onClick={reject} disabled={actionBusy} className="rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">{t('directPortal.case.actions.decline', { defaultValue: 'Decline' })}</button>
                    <Link to={`/direct/jobs/${id}/change`} className="rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white">{t('directPortal.case.actions.requestChanges', { defaultValue: 'Request changes' })}</Link>
                  </>
                )}
                {mode === 'book' && (
                  <button type="button" onClick={saveSchedule} disabled={actionBusy} className="rounded-full bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">{t('directPortal.case.actions.saveSchedule', { defaultValue: 'Save schedule' })}</button>
                )}
                {mode === 'proof' && (
                  <button type="button" onClick={submitProof} disabled={actionBusy} className="rounded-full bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">{t('directPortal.case.actions.submitProof', { defaultValue: 'Submit proof' })}</button>
                )}
                {mode === 'receipt' && (
                  <button type="button" onClick={confirmProof} disabled={actionBusy} className="rounded-full bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">{t('directPortal.case.actions.confirmReceipt', { defaultValue: 'Confirm receipt' })}</button>
                )}
                {mode === 'change' && (
                  <>
                    <button type="button" onClick={() => saveChange('reschedule')} disabled={actionBusy} className="rounded-full bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">{t('directPortal.case.actions.reschedule', { defaultValue: 'Reschedule' })}</button>
                    <button type="button" onClick={() => saveChange('cancel')} disabled={actionBusy} className="rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">{t('directPortal.case.actions.cancelRequest', { defaultValue: 'Cancel request' })}</button>
                  </>
                )}
              </div>
            </div>
          </SectionCard>

          <SectionCard title={mode === 'support' ? t('directPortal.support.conversation', { defaultValue: 'Conversation' }) : t('directPortal.case.actionsTitle', { defaultValue: 'Actions' })} eyebrow={t('directPortal.case.manageEyebrow', { defaultValue: 'Manage the case' })}>
            {mode === 'book' && (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('directPortal.lookup.labels.preferredDate', { defaultValue: 'Preferred date' })} required><Input type="date" value={scheduleForm.preferredDate} onChange={(e) => setScheduleForm((current) => ({ ...current, preferredDate: e.target.value }))} /></Field>
                  <Field label={t('directPortal.lookup.labels.window', { defaultValue: 'Time window' })} required><Input value={scheduleForm.preferredTimeWindow} onChange={(e) => setScheduleForm((current) => ({ ...current, preferredTimeWindow: e.target.value }))} placeholder={t('directPortal.case.placeholders.timeWindow', { defaultValue: 'Morning, afternoon, etc.' })} /></Field>
                  <Field label={t('directPortal.lookup.labels.serviceAddress', { defaultValue: 'Service address' })} required><Input value={scheduleForm.serviceAddress} onChange={(e) => setScheduleForm((current) => ({ ...current, serviceAddress: e.target.value }))} /></Field>
                  <Field label={t('directPortal.request.fields.serviceCity', { defaultValue: 'Service city' })}><Input value={scheduleForm.serviceCity} onChange={(e) => setScheduleForm((current) => ({ ...current, serviceCity: e.target.value }))} /></Field>
                  <Field label={t('directPortal.case.fields.onSiteContact', { defaultValue: 'On-site contact' })}><Input value={scheduleForm.onSiteContactName} onChange={(e) => setScheduleForm((current) => ({ ...current, onSiteContactName: e.target.value }))} /></Field>
                  <Field label={t('directPortal.case.fields.contactPhone', { defaultValue: 'Contact phone' })}><Input value={scheduleForm.onSiteContactPhone} onChange={(e) => setScheduleForm((current) => ({ ...current, onSiteContactPhone: e.target.value }))} /></Field>
                </div>
                <Field label={t('directPortal.case.fields.accessNotes', { defaultValue: 'Access notes' })}><Textarea rows={4} value={scheduleForm.accessNotes} onChange={(e) => setScheduleForm((current) => ({ ...current, accessNotes: e.target.value }))} /></Field>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-400">
                  {t('directPortal.case.savedLocationHelp', { defaultValue: 'Use one of your saved locations if the address is already in your account.' })}
                  {locationOptions.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {locationOptions.map((location) => (
                        <button key={location.id} type="button" onClick={() => setScheduleForm((current) => ({ ...current, serviceAddress: location.addressLine1, serviceCity: location.city, accessNotes: location.notes || current.accessNotes }))} className="rounded-full border border-white/10 bg-slate-950/70 px-3 py-1.5 text-xs font-semibold text-white">
                          {location.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {mode === 'proof' && (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('directPortal.case.fields.paymentMethod', { defaultValue: 'Payment method' })}><Select value={proofForm.paymentMethod} onChange={(e) => setProofForm((current) => ({ ...current, paymentMethod: e.target.value }))}><option value="cash">{t('directPortal.case.paymentMethods.cash', { defaultValue: 'Cash' })}</option><option value="cash_app">Cash App</option><option value="venmo">Venmo</option><option value="zelle">Zelle</option><option value="bank_transfer">{t('directPortal.case.paymentMethods.bankTransfer', { defaultValue: 'Bank transfer' })}</option><option value="other">{t('directPortal.request.serviceCategories.other', { defaultValue: 'Other' })}</option></Select></Field>
                  <Field label={t('directPortal.case.fields.receiptNumber', { defaultValue: 'Reference / receipt number' })}><Input value={proofForm.paymentReference} onChange={(e) => setProofForm((current) => ({ ...current, paymentReference: e.target.value }))} /></Field>
                </div>
                <Field label={t('directPortal.case.fields.proofLink', { defaultValue: 'Proof link' })}><Input value={proofForm.proofLink} onChange={(e) => setProofForm((current) => ({ ...current, proofLink: e.target.value }))} placeholder={t('directPortal.case.placeholders.proofLink', { defaultValue: 'Shared receipt, screenshot, or file link' })} /></Field>
                <Field label={t('directPortal.case.fields.uploadReceipt', { defaultValue: 'Upload receipt' })}><Input type="file" accept="image/*,application/pdf" onChange={handleProofUpload} /></Field>
                <Field label={t('directPortal.case.fields.note', { defaultValue: 'Note' })}><Textarea rows={4} value={proofForm.note} onChange={(e) => setProofForm((current) => ({ ...current, note: e.target.value }))} /></Field>
                {attachments.length > 0 && (
                  <div className="space-y-2">
                    {attachments.map((attachment) => (
                      <a key={attachment.key || attachment.url} href={attachment.url || '#'} target="_blank" rel="noreferrer" className="block rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-200">
                        {attachment.name || t('directPortal.case.receiptAttachment', { defaultValue: 'Receipt attachment' })}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}

            {mode === 'receipt' && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-6 text-slate-300">
                  {t('directPortal.case.fields.paymentStatus', { defaultValue: 'Payment status' })}: <strong className="text-white">{paymentLabel(request.paymentStatus, t)}</strong>
                  <br />
                  {t('directPortal.case.fields.proofReceived', { defaultValue: 'Proof received' })}: <strong className="text-white">{request.proofReceivedAt ? formatDateTime(request.proofReceivedAt, i18n.resolvedLanguage) : t('directPortal.case.notYet', { defaultValue: 'Not yet' })}</strong>
                  <br />
                  {t('directPortal.thanks.referenceLabel', { defaultValue: 'Reference' })}: <strong className="text-white">{request.paymentReference || '—'}</strong>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Link to={`/direct/payments/${id}/proof`} className="rounded-full bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white">{t('directPortal.case.actions.openProofUpload', { defaultValue: 'Open proof upload' })}</Link>
                  <button type="button" onClick={confirmProof} disabled={actionBusy} className="rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white">{t('directPortal.case.actions.confirmReceipt', { defaultValue: 'Confirm receipt' })}</button>
                </div>
              </div>
            )}

            {mode === 'change' && (
              <div className="space-y-4">
                <Field label={t('directPortal.case.fields.changeReason', { defaultValue: 'Reason for change' })}><Textarea rows={4} value={scheduleForm.accessNotes} onChange={(e) => setScheduleForm((current) => ({ ...current, accessNotes: e.target.value }))} placeholder={t('directPortal.case.placeholders.changeReason', { defaultValue: 'Tell us what needs to change...' })} /></Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('directPortal.case.fields.newDate', { defaultValue: 'New date' })}><Input type="date" value={scheduleForm.preferredDate} onChange={(e) => setScheduleForm((current) => ({ ...current, preferredDate: e.target.value }))} /></Field>
                  <Field label={t('directPortal.case.fields.newWindow', { defaultValue: 'New window' })}><Input value={scheduleForm.preferredTimeWindow} onChange={(e) => setScheduleForm((current) => ({ ...current, preferredTimeWindow: e.target.value }))} /></Field>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button type="button" onClick={() => saveChange('reschedule')} disabled={actionBusy} className="rounded-full bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white">{t('directPortal.case.actions.reschedule', { defaultValue: 'Reschedule' })}</button>
                  <button type="button" onClick={() => saveChange('cancel')} disabled={actionBusy} className="rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white">{t('directPortal.case.actions.cancel', { defaultValue: 'Cancel' })}</button>
                </div>
              </div>
            )}

            {mode === 'quote' && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-6 text-slate-300">
                  {t('directPortal.case.quoteReviewBody', { defaultValue: 'Review the quote and choose whether to accept it, decline it, or ask for changes.' })}
                </div>
                <div className="flex flex-wrap gap-3">
                  <button type="button" onClick={accept} disabled={actionBusy} className="rounded-full bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white">{t('directPortal.case.actions.acceptQuote', { defaultValue: 'Accept quote' })}</button>
                  <button type="button" onClick={reject} disabled={actionBusy} className="rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white">{t('directPortal.case.actions.decline', { defaultValue: 'Decline' })}</button>
                  <Link to={`/direct/jobs/${id}/change`} className="rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white">{t('directPortal.case.actions.askForChanges', { defaultValue: 'Ask for changes' })}</Link>
                </div>
              </div>
            )}

            {mode === 'job' && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-6 text-slate-300">
                  {t('directPortal.case.currentStatusPrefix', { defaultValue: 'The current status is' })} <strong className="text-white">{statusLabel(request.status, t)}</strong>. {t('directPortal.case.currentStatusSuffix', { defaultValue: 'We’ll keep the record in history as it moves through the workflow.' })}
                </div>
                <div className="flex flex-wrap gap-3">
                  <Link to={`/direct/jobs/${id}/change`} className="rounded-full bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white">{t('directPortal.case.actions.requestChange', { defaultValue: 'Request change' })}</Link>
                  <Link to="/direct/support" className="rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white">{t('directPortal.thanks.openSupport', { defaultValue: 'Open support' })}</Link>
                  <Link to={`/direct/payments/${id}/proof`} className="rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white">{t('directPortal.case.actions.uploadProof', { defaultValue: 'Upload proof' })}</Link>
                </div>
                <Timeline request={request} />
              </div>
            )}

            {mode === 'support' && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-6 text-slate-300">
                  {request?.messages?.length || messages.length ? t('directPortal.support.attachedConversation', { defaultValue: 'Your conversation is attached to this request.' }) : t('directPortal.support.noMessages', { defaultValue: 'No messages yet.' })}
                </div>
                <div className="space-y-2">
                  {(request?.messages || messages || []).map((item) => (
                    <div key={item.id} className={`rounded-2xl px-4 py-3 text-sm leading-6 ${item.senderRole === 'customer' ? 'bg-orange-500 text-white' : 'border border-white/10 bg-white/5 text-slate-200'}`}>
                      <div>{item.message}</div>
                      <div className={`mt-2 text-[11px] ${item.senderRole === 'customer' ? 'text-orange-100/80' : 'text-slate-500'}`}>{formatDateTime(item.createdAt, i18n.resolvedLanguage)}</div>
                    </div>
                  ))}
                </div>
                <Textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('directPortal.support.supportPlaceholder', { defaultValue: 'Send a message to OxSteed support…' })} />
                <button type="button" onClick={submitMessage} disabled={actionBusy || !message.trim()} className="inline-flex items-center gap-2 rounded-full bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
                  <Send size={15} /> {t('directPortal.support.send', { defaultValue: 'Send' })}
                </button>
              </div>
            )}

            {mode === 'account' && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-6 text-slate-300">
                  {t('directPortal.case.accountHelp', { defaultValue: 'Manage your saved service locations from the account page.' })}
                </div>
                <Link to="/direct/account" className="inline-flex rounded-full bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white">{t('directPortal.case.actions.openLocations', { defaultValue: 'Open locations' })}</Link>
              </div>
            )}
          </SectionCard>
        </div>
      )}
    </DirectShell>
  );
}

export default function DirectPortalPage({ view }) {
  if (view === 'landing') return <DirectLandingPage />;
  if (view === 'request') return <DirectQuoteRequestPage />;
  if (view === 'thanks') return <DirectQuoteThanksPage />;
  if (view === 'lookup') return <DirectPublicQuoteLookupPage />;
  if (view === 'quote') return <DirectQuoteDetailPage />;
  if (view === 'book') return <DirectBookingPage />;
  if (view === 'job') return <DirectJobPage />;
  if (view === 'proof') return <DirectPaymentProofPage />;
  if (view === 'receipt') return <DirectPaymentReceiptPage />;
  if (view === 'history') return <DirectHistoryPage />;
  if (view === 'support') return <DirectSupportPage />;
  if (view === 'account') return <DirectAccountPage />;
  if (view === 'change') return <DirectChangePage />;
  return <DirectLandingPage />;
}
