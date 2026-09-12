import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  DollarSign,
  FileText,
  Mail,
  MapPin,
  MessageSquare,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Users,
  Wrench,
  TrendingUp,
  CheckCircle2,
  AlertTriangle,
  Clock3,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';
import { useAuth } from '../context/AuthContext';
import {
  confirmDirectProof,
  getDirectAdminCustomer,
  getDirectAdminDashboard,
  getDirectAdminInbox,
  getDirectAdminReports,
  getDirectAdminRequest,
  getDirectAdminSettings,
  getDirectAdminTeam,
  updateDirectAdminRequest,
  updateDirectAdminSettings,
  sendDirectAdminTestEmail,
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

const STATUS_OPTIONS = [
  'new',
  'reviewing',
  'quoted',
  'contacted',
  'accepted',
  'scheduled',
  'en_route',
  'started',
  'waiting_customer',
  'completed',
  'closed',
  'cancelled',
];

const PAYMENT_OPTIONS = ['unpaid', 'proof_submitted', 'confirmed', 'partially_paid', 'paid', 'disputed', 'refunded', 'cancelled'];

function currencyLabel(amountCents, currencyCode = 'USD') {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: String(currencyCode || 'USD').toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(amountCents || 0) / 100);
  } catch {
    return `$${(Number(amountCents || 0) / 100).toFixed(2)}`;
  }
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function statusLabel(status) {
  const map = {
    new: 'Requested',
    reviewing: 'Reviewing',
    quoted: 'Quoted',
    contacted: 'Contacted',
    accepted: 'Accepted',
    scheduled: 'Scheduled',
    en_route: 'En route',
    started: 'Started',
    waiting_customer: 'Waiting',
    completed: 'Completed',
    closed: 'Closed',
    cancelled: 'Cancelled',
  };
  return map[String(status || 'new').toLowerCase()] || status || 'Requested';
}

function statusTone(status) {
  const key = String(status || 'new').toLowerCase();
  if (['completed', 'closed'].includes(key)) return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20';
  if (['scheduled', 'accepted'].includes(key)) return 'bg-orange-500/15 text-orange-300 border-orange-500/20';
  if (['en_route', 'started'].includes(key)) return 'bg-sky-500/15 text-sky-300 border-sky-500/20';
  if (['reviewing', 'waiting_customer'].includes(key)) return 'bg-violet-500/15 text-violet-300 border-violet-500/20';
  if (key === 'cancelled') return 'bg-gray-500/15 text-gray-300 border-gray-500/20';
  return 'bg-blue-500/15 text-blue-300 border-blue-500/20';
}

function SectionCard({ title, eyebrow, children, className = '' }) {
  return (
    <section className={`rounded-[28px] border border-white/10 bg-slate-950/80 p-5 shadow-sm ${className}`}>
      {eyebrow && <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-orange-300">{eyebrow}</div>}
      <h2 className="mt-2 text-2xl font-semibold text-white">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({ label, children, hint, required = false }) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-semibold text-slate-200">{label}{required ? ' *' : ''}</span>
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
    violet: 'bg-violet-500/10 text-violet-200 border-violet-500/20',
  };
  return <span className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-semibold ${tones[tone] || tones.default}`}>{children}</span>;
}

function AdminShell({ title, subtitle, profile, children, right }) {
  const path = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : '/direct/admin';
  return (
    <PageShell>
      <PageMeta title={title ? `${title} | OxSteed Direct Admin` : 'OxSteed Direct Admin'} description={subtitle || profile.publicNote || profile.headline} url={path} />
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-[36px] border border-white/10 bg-gradient-to-br from-slate-950 via-slate-950 to-slate-900 shadow-[0_28px_80px_rgba(15,23,42,0.45)]">
          <div className="grid gap-6 px-5 py-6 lg:grid-cols-[1.1fr_0.9fr] lg:px-8 lg:py-8">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-orange-500/25 bg-orange-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-orange-200">
                Direct admin console
              </div>
              <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">{title}</h1>
              <p className="max-w-3xl text-base leading-7 text-slate-300 sm:text-lg">{subtitle}</p>
              <div className="flex flex-wrap gap-2">
                <Chip tone="orange">${Math.round(profile.minimumPriceCents / 100)} minimum</Chip>
                <Chip tone="blue">{profile.availabilityText}</Chip>
                <Chip tone="emerald">{profile.baseCity}</Chip>
              </div>
            </div>
            <div className="rounded-[28px] border border-white/10 bg-white/5 p-5 backdrop-blur">
              {right}
            </div>
          </div>
        </div>
        <div className="mt-6">{children}</div>
      </div>
    </PageShell>
  );
}

function NoAccess() {
  return (
    <div className="rounded-[28px] border border-white/10 bg-slate-950/80 p-8 text-center text-slate-300">
      <ShieldCheck className="mx-auto text-orange-300" size={32} />
      <h2 className="mt-4 text-2xl font-semibold text-white">Direct admin access only</h2>
      <p className="mt-2 text-sm leading-6 text-slate-400">This section is reserved for OxSteed staff who can quote, dispatch, and confirm payments.</p>
      <div className="mt-5 flex justify-center gap-3">
        <Link to="/dashboard" className="rounded-full bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white">Go to dashboard</Link>
        <Link to="/direct" className="rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white">View Direct landing</Link>
      </div>
    </div>
  );
}

function MiniStat({ label, value, icon: Icon, tone = 'default' }) {
  const tones = {
    default: 'bg-white/5 text-white',
    orange: 'bg-orange-500/10 text-orange-200',
    blue: 'bg-sky-500/10 text-sky-200',
    emerald: 'bg-emerald-500/10 text-emerald-200',
    violet: 'bg-violet-500/10 text-violet-200',
  };
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className={`inline-flex rounded-xl p-2 ${tones[tone] || tones.default}`}><Icon size={16} /></div>
      <div className="mt-3 text-2xl font-semibold text-white">{value}</div>
      <div className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">{label}</div>
    </div>
  );
}

function RequestSnapshot({ request }) {
  if (!request) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <InfoRow label="Service" value={request.serviceCategory} />
      <InfoRow label="Location" value={request.serviceLocation || request.serviceCity} />
      <InfoRow label="Requested" value={formatDateTime(request.createdAt)} />
      <InfoRow label="Preferred date" value={formatDate(request.preferredDate)} />
      <InfoRow label="Status" value={statusLabel(request.status)} />
      <InfoRow label="Payment" value={request.paymentStatus || 'unpaid'} />
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

function useDirectAdminProfile() {
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  useEffect(() => {
    let active = true;
    getDirectAdminSettings()
      .then((data) => {
        if (!active) return;
        if (data?.settings) {
          setProfile({
            ...DEFAULT_PROFILE,
            ...data.settings,
          });
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  return [profile, setProfile];
}

function useAdminAccess() {
  const { user, loading } = useAuth();
  const isStaff = user && ['admin', 'super_admin'].includes(user.role);
  return { user, loading, isStaff };
}

function useDirectRequestList({ status = '', search = '', page = 1 } = {}) {
  const [requests, setRequests] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async (next = { status, search, page }) => {
    setLoading(true);
    setError('');
    try {
      const data = await getDirectAdminInbox({
        status: next.status || undefined,
        search: next.search || undefined,
        page: next.page || 1,
        limit: 20,
      });
      setRequests(Array.isArray(data?.requests) ? data.requests : []);
      setTotal(Number(data?.total || 0));
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load inbox');
    } finally {
      setLoading(false);
    }
  };

  return { requests, total, loading, error, setRequests, setTotal, load };
}

function DirectAdminDashboardView() {
  const { t } = useTranslation();
  const [profile] = useDirectAdminProfile();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getDirectAdminDashboard()
      .then((next) => {
        if (active) setData(next);
      })
      .catch((error) => {
        if (active) toast.error(error?.response?.data?.error || 'Failed to load Direct dashboard');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  return (
    <AdminShell
      title={t('directAdminPortal.dashboardTitle', { defaultValue: 'Direct dashboard' })}
      subtitle={t('directAdminPortal.dashboardSubtitle', { defaultValue: 'Track the Direct intake pipeline, upcoming work, unpaid items, and urgent issues from one staff view.' })}
      profile={profile}
      right={(
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4 text-sm leading-6 text-slate-300">
            {t('directAdminPortal.dashboardRight', { defaultValue: 'Use this console to quote work, schedule visits, review payment proof, and keep the customer record current.' })}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Link to="/direct/admin/inbox" className="rounded-2xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white text-center">{t('directAdminPortal.openInbox', { defaultValue: 'Open inbox' })}</Link>
            <Link to="/direct/admin/settings" className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white text-center">{t('directAdminPortal.settings', { defaultValue: 'Settings' })}</Link>
          </div>
        </div>
      )}
    >
      {loading ? (
        <SectionCard title={t('directAdminPortal.loading', { defaultValue: 'Loading…' })} eyebrow={t('directAdminPortal.dashboardEyebrow', { defaultValue: 'Dashboard' })}>
          <div className="text-sm text-slate-400">{t('directAdminPortal.fetchingData', { defaultValue: 'Fetching Direct operations data…' })}</div>
        </SectionCard>
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
            <MiniStat label="Total requests" value={data?.totals?.total_requests || 0} icon={ClipboardList} tone="blue" />
            <MiniStat label="Intake" value={data?.totals?.intake_requests || 0} icon={Search} tone="violet" />
            <MiniStat label="Quoted" value={data?.totals?.quoted_requests || 0} icon={FileText} tone="orange" />
            <MiniStat label="Scheduled" value={data?.totals?.scheduled_requests || 0} icon={CalendarDays} tone="emerald" />
            <MiniStat label="Active" value={data?.totals?.active_requests || 0} icon={Clock3} tone="blue" />
            <MiniStat label="Unpaid" value={data?.totals?.unpaid_requests || 0} icon={DollarSign} tone="orange" />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <SectionCard title={t('directAdminPortal.upcomingWork', { defaultValue: 'Upcoming work' })} eyebrow={t('directAdminPortal.dispatchEyebrow', { defaultValue: 'Dispatch' })}>
              <div className="space-y-2">
                {(data?.upcoming || []).length === 0 ? (
                  <div className="text-sm text-slate-500">{t('directAdminPortal.noUpcomingJobs', { defaultValue: 'No upcoming jobs yet.' })}</div>
                ) : data.upcoming.map((item) => (
                  <Link key={item.id} to={`/direct/admin/jobs/${item.id}`} className="block rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:border-orange-500/30">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold text-white">{item.first_name} {item.last_name}</div>
                        <div className="mt-1 text-sm text-slate-400">{item.service_category} · {item.service_city || item.service_location || '—'}</div>
                      </div>
                      <Chip tone="blue">{formatDateTime(item.scheduled_start_at)}</Chip>
                    </div>
                  </Link>
                ))}
              </div>
            </SectionCard>

            <SectionCard title={t('directAdminPortal.unpaidItems', { defaultValue: 'Unpaid items' })} eyebrow={t('directAdminPortal.paymentProofEyebrow', { defaultValue: 'Payment proof' })}>
              <div className="space-y-2">
                {(data?.unpaid || []).length === 0 ? (
                  <div className="text-sm text-slate-500">{t('directAdminPortal.noPaymentIssues', { defaultValue: 'No payment issues right now.' })}</div>
                ) : data.unpaid.map((item) => (
                  <Link key={item.id} to={`/direct/admin/payments/${item.id}`} className="block rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:border-orange-500/30">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold text-white">{item.first_name} {item.last_name}</div>
                        <div className="mt-1 text-sm text-slate-400">{item.service_category} · {item.service_location || '—'}</div>
                      </div>
                      <Chip tone={item.payment_status === 'proof_submitted' ? 'violet' : 'orange'}>{item.payment_status || 'unpaid'}</Chip>
                    </div>
                  </Link>
                ))}
              </div>
            </SectionCard>
          </div>
        </div>
      )}
    </AdminShell>
  );
}

function DirectAdminInboxView() {
  const { t } = useTranslation();
  const [profile] = useDirectAdminProfile();
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get('status') || '';
  const query = searchParams.get('q') || '';
  const page = Number(searchParams.get('page') || '1');
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [draft, setDraft] = useState({ status: 'new', admin_notes: '', quote_amount_cents: '', payment_status: 'unpaid' });
  const [saving, setSaving] = useState(false);
  const list = useDirectRequestList({ status, search: query, page });
  const updateSearch = (updates) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === undefined || value === '') next.delete(key);
      else next.set(key, String(value));
    });
    setSearchParams(next);
  };

  useEffect(() => {
    list.load({ status, search: query, page });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, query, page]);

  useEffect(() => {
    const current = list.requests[0];
    if (!selectedId && current) setSelectedId(current.id);
  }, [list.requests, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    getDirectAdminRequest(selectedId)
      .then((data) => {
        if (!active) return;
        const req = data?.request || null;
        setDetail(req);
        setDraft({
          status: req?.status || 'new',
          admin_notes: req?.adminNotes || '',
          quote_amount_cents: req?.quoteAmountCents ?? '',
          payment_status: req?.paymentStatus || 'unpaid',
        });
      })
      .catch((error) => toast.error(error?.response?.data?.error || 'Failed to load request'));
    return () => { active = false; };
  }, [selectedId]);

  const save = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      const payload = {
        status: draft.status,
        admin_notes: draft.admin_notes,
        quote_amount_cents: draft.quote_amount_cents === '' ? null : Number(draft.quote_amount_cents),
        payment_status: draft.payment_status,
      };
      const { request } = await updateDirectAdminRequest(selectedId, payload);
      setDetail(request);
      list.setRequests((current) => current.map((item) => (String(item.id) === String(selectedId) ? request : item)));
      toast.success('Request updated.');
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Could not update request.');
    } finally {
      setSaving(false);
    }
  };

  const selected = detail || list.requests.find((item) => String(item.id) === String(selectedId)) || null;

  return (
    <AdminShell
      title={t('directAdminPortal.inboxTitle', { defaultValue: 'Direct inbox' })}
      subtitle={t('directAdminPortal.inboxSubtitle', { defaultValue: 'Queue all new quote requests, filter by status, and open any request for the estimate and next-step details.' })}
      profile={profile}
      right={(
        <div className="space-y-3">
          <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4 text-sm text-slate-300">
            {t('directAdminPortal.inboxRight', { defaultValue: 'Public intake should be short. This is where staff shape it into a real job record.' })}
          </div>
          <Link to="/direct/admin/calendar" className="inline-flex items-center gap-2 rounded-2xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white">
            {t('directAdminPortal.openCalendar', { defaultValue: 'Open calendar' })} <ChevronRight size={16} />
          </Link>
        </div>
      )}
    >
      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <SectionCard title={t('directAdminPortal.filters', { defaultValue: 'Filters' })} eyebrow={t('directAdminPortal.inboxEyebrow', { defaultValue: 'Inbox' })}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <span className="text-xs uppercase tracking-[0.18em] text-slate-500">{t('directAdminPortal.search', { defaultValue: 'Search' })}</span>
              <Input value={query} onChange={(e) => updateSearch({ q: e.target.value, page: 1 })} placeholder={t('directAdminPortal.searchPlaceholder', { defaultValue: 'Name, email, city, company...' })} />
            </div>
            <div className="grid gap-2">
              <span className="text-xs uppercase tracking-[0.18em] text-slate-500">{t('directAdminPortal.status', { defaultValue: 'Status' })}</span>
              <Select value={status} onChange={(e) => updateSearch({ status: e.target.value, page: 1 })}>
                <option value="">{t('directAdminPortal.allStatuses', { defaultValue: 'All statuses' })}</option>
                {STATUS_OPTIONS.map((item) => <option key={item} value={item}>{statusLabel(item)}</option>)}
              </Select>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button type="button" onClick={() => list.load({ status, search: query, page })} className="rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white">{t('directAdminPortal.refresh', { defaultValue: 'Refresh' })}</button>
            <div className="text-sm text-slate-500">{list.total || 0} request(s)</div>
          </div>
        </SectionCard>

        <SectionCard title={t('directAdminPortal.requestQueue', { defaultValue: 'Request queue' })} eyebrow={t('directAdminPortal.directIntake', { defaultValue: 'Direct intake' })}>
          {list.loading ? (
            <div className="text-sm text-slate-400">{t('directAdminPortal.loadingRequests', { defaultValue: 'Loading requests…' })}</div>
          ) : list.requests.length === 0 ? (
            <div className="text-sm text-slate-500">{t('directAdminPortal.noRequestsFound', { defaultValue: 'No requests found.' })}</div>
          ) : (
            <div className="space-y-2">
              {list.requests.map((item) => (
                <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={`w-full rounded-2xl border p-4 text-left transition ${String(selectedId) === String(item.id) ? 'border-orange-500/40 bg-orange-500/10' : 'border-white/10 bg-white/5 hover:border-white/20'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold text-white">{item.firstName} {item.lastName}</div>
                      <div className="mt-1 text-xs text-slate-500">{item.serviceCategory} · {item.serviceLocation || item.serviceCity || '—'}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Chip tone="blue">{statusLabel(item.status)}</Chip>
                      <Chip tone="orange">{item.paymentStatus || 'unpaid'}</Chip>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {selected && (
        <div className="mt-6 grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          <SectionCard title={`${selected.firstName} ${selected.lastName}`} eyebrow={`Request #${selected.id}`}>
            <RequestSnapshot request={selected} />
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{t('directAdminPortal.notes', { defaultValue: 'Notes' })}</div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-300">{selected.details || 'No details provided.'}</p>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {selected.events?.slice?.(0, 6)?.map?.((event) => (
                <span key={event.id} className="rounded-full border border-white/10 bg-slate-950/70 px-3 py-1.5 text-xs text-slate-300">{event.title}</span>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link to={`/direct/jobs/${selected.id}`} className="rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white">{t('directAdminPortal.publicJobView', { defaultValue: 'Open public job view' })}</Link>
              <Link to={`/direct/admin/jobs/${selected.id}`} className="rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white">{t('directAdminPortal.workOrder', { defaultValue: 'Work order' })}</Link>
            </div>
          </SectionCard>

          <SectionCard title={t('directAdminPortal.editRequest', { defaultValue: 'Edit request' })} eyebrow={t('directAdminPortal.quoteBuilder', { defaultValue: 'Quote builder' })}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('directAdminPortal.statusLabel', { defaultValue: 'Status' })}><Select value={draft.status} onChange={(e) => setDraft((current) => ({ ...current, status: e.target.value }))}>{STATUS_OPTIONS.map((item) => <option key={item} value={item}>{statusLabel(item)}</option>)}</Select></Field>
              <Field label={t('directAdminPortal.paymentStatus', { defaultValue: 'Payment status' })}><Select value={draft.payment_status} onChange={(e) => setDraft((current) => ({ ...current, payment_status: e.target.value }))}>{PAYMENT_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}</Select></Field>
              <Field label={t('directAdminPortal.quoteAmount', { defaultValue: 'Quote amount (cents)' })}><Input type="number" value={draft.quote_amount_cents} onChange={(e) => setDraft((current) => ({ ...current, quote_amount_cents: e.target.value }))} /></Field>
              <Field label={t('directAdminPortal.preferredDate', { defaultValue: 'Preferred date' })}><Input type="date" value={selected.preferredDate || ''} readOnly /></Field>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label={t('directAdminPortal.scheduledStart', { defaultValue: 'Scheduled start' })}><Input type="datetime-local" value={selected.scheduledStartAt ? String(selected.scheduledStartAt).slice(0, 16) : ''} readOnly /></Field>
              <Field label={t('directAdminPortal.scheduledEnd', { defaultValue: 'Scheduled end' })}><Input type="datetime-local" value={selected.scheduledEndAt ? String(selected.scheduledEndAt).slice(0, 16) : ''} readOnly /></Field>
            </div>
            <div className="mt-4">
              <Field label={t('directAdminPortal.adminNotes', { defaultValue: 'Admin notes' })}><Textarea rows={5} value={draft.admin_notes} onChange={(e) => setDraft((current) => ({ ...current, admin_notes: e.target.value }))} /></Field>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" onClick={save} disabled={saving} className="rounded-full bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{saving ? t('directAdminPortal.saving', { defaultValue: 'Saving…' }) : t('directAdminPortal.saveRequest', { defaultValue: 'Save request' })}</button>
              <Link to={`/direct/admin/payments/${selected.id}`} className="rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white">{t('directAdminPortal.paymentReview', { defaultValue: 'Payment review' })}</Link>
            </div>
          </SectionCard>
        </div>
      )}
    </AdminShell>
  );
}

function calendarDayStart(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function calendarDayEnd(value) {
  const date = calendarDayStart(value);
  date.setDate(date.getDate() + 1);
  return date;
}

function calendarStartOfWeek(value) {
  const date = calendarDayStart(value);
  date.setDate(date.getDate() - date.getDay());
  return date;
}

function calendarAddDays(value, amount) {
  const date = calendarDayStart(value);
  date.setDate(date.getDate() + amount);
  return date;
}

function calendarDateKey(value) {
  const date = calendarDayStart(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function calendarDaysForView(viewMode, cursorDate) {
  if (viewMode === 'day') return [calendarDayStart(cursorDate)];
  if (viewMode === 'week') return Array.from({ length: 7 }, (_, index) => calendarAddDays(calendarStartOfWeek(cursorDate), index));
  const monthStart = new Date(cursorDate.getFullYear(), cursorDate.getMonth(), 1);
  const firstCell = calendarStartOfWeek(monthStart);
  return Array.from({ length: 42 }, (_, index) => calendarAddDays(firstCell, index));
}

function calendarRangeLabel(viewMode, days) {
  if (!days.length) return '';
  if (viewMode === 'day') return days[0].toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const first = days[0].toLocaleDateString([], { month: 'short', day: 'numeric' });
  const last = days[days.length - 1].toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  return `${first} – ${last}`;
}

function CalendarJobCard({ item, compact = false }) {
  return (
    <Link
      to={`/direct/admin/jobs/${item.id}`}
      className={`block rounded-xl border border-white/10 bg-slate-950/75 transition hover:border-orange-500/40 ${compact ? 'px-2 py-1.5' : 'p-4'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className={`truncate font-semibold text-white ${compact ? 'text-xs' : 'text-sm'}`}>
            {item.first_name} {item.last_name}
          </div>
          <div className={`mt-1 truncate text-slate-400 ${compact ? 'text-[10px]' : 'text-xs'}`}>
            {formatDateTime(item.scheduled_start_at)} · {item.service_city || item.service_location || 'No city'}
          </div>
        </div>
        <Chip tone={item.status === 'scheduled' ? 'orange' : 'blue'}>{statusLabel(item.status)}</Chip>
      </div>
      {!compact && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
          <span>{item.service_category || 'Direct service'}</span>
          <span>·</span>
          <span>{item.payment_status || 'unpaid'}</span>
          {item.quote_amount_cents != null && <><span>·</span><span>{currencyLabel(item.quote_amount_cents, item.quote_currency_code)}</span></>}
        </div>
      )}
    </Link>
  );
}

function DirectAdminCalendarView() {
  const [profile] = useDirectAdminProfile();
  const [data, setData] = useState(null);
  const [viewMode, setViewMode] = useState('month');
  const [cursorDate, setCursorDate] = useState(() => new Date());
  const [status, setStatus] = useState('');
  const [city, setCity] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const days = useMemo(() => calendarDaysForView(viewMode, cursorDate), [viewMode, cursorDate]);
  const rangeStart = days[0] || calendarDayStart(cursorDate);
  const rangeEnd = viewMode === 'month' ? calendarAddDays(rangeStart, 42) : calendarDayEnd(days[days.length - 1] || cursorDate);
  const rangeLabel = calendarRangeLabel(viewMode, days);

  const loadCalendar = async () => {
    setLoading(true);
    setError('');
    try {
      const next = await getDirectAdminDashboard({
        from: rangeStart.toISOString(),
        to: rangeEnd.toISOString(),
        status: status || undefined,
        city: city || undefined,
        search: search.trim() || undefined,
      });
      setData(next);
    } catch (requestError) {
      setError(requestError?.response?.data?.error || 'Failed to load the dispatch calendar.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCalendar();
  }, [viewMode, cursorDate, status, city, search]);

  const jobs = data?.upcoming || [];
  const jobsByDay = useMemo(() => jobs.reduce((groups, item) => {
    const key = calendarDateKey(item.scheduled_start_at);
    groups[key] = groups[key] || [];
    groups[key].push(item);
    return groups;
  }, {}), [jobs]);
  const cities = useMemo(() => Array.from(new Set([
    ...(profile.travelCities || []),
    ...(data?.travelDensity || []).map((item) => item.city),
  ].filter(Boolean))), [profile.travelCities, data]);
  const moveCursor = (amount) => {
    const next = new Date(cursorDate);
    if (viewMode === 'month') next.setMonth(next.getMonth() + amount);
    else next.setDate(next.getDate() + (viewMode === 'week' ? amount * 7 : amount));
    setCursorDate(next);
  };

  return (
    <AdminShell
      title="Dispatch calendar"
      subtitle="See upcoming work by date, city, and urgency so you can route travel days without opening every request."
      profile={profile}
      right={<div className="space-y-3 text-sm leading-6 text-slate-300"><div>Showing future, active scheduled work only.</div><button type="button" onClick={loadCalendar} disabled={loading} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 font-semibold text-white disabled:opacity-50"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh</button></div>}
    >
      <SectionCard title="Schedule" eyebrow="Calendar">
        <div className="flex flex-col gap-3 border-b border-white/10 pb-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setCursorDate(new Date())} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white">Today</button>
            <button type="button" onClick={() => moveCursor(-1)} aria-label="Previous period" className="rounded-xl border border-white/10 bg-white/5 p-2 text-white"><ChevronLeft size={17} /></button>
            <button type="button" onClick={() => moveCursor(1)} aria-label="Next period" className="rounded-xl border border-white/10 bg-white/5 p-2 text-white"><ChevronRight size={17} /></button>
            <span className="ml-1 text-sm font-semibold text-slate-200">{rangeLabel}</span>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Calendar view">
            {['day', 'week', 'month', 'agenda'].map((mode) => (
              <button key={mode} type="button" onClick={() => setViewMode(mode)} aria-pressed={viewMode === mode} className={`rounded-xl border px-3 py-2 text-xs font-semibold capitalize transition ${viewMode === mode ? 'border-orange-500/40 bg-orange-500/15 text-orange-200' : 'border-white/10 bg-white/5 text-slate-400 hover:text-white'}`}>{mode}</button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customer, service, or city..." aria-label="Search calendar" />
          <Select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status">
            <option value="">All active statuses</option>
            {['scheduled', 'accepted', 'en_route', 'started', 'waiting_customer'].map((item) => <option key={item} value={item}>{statusLabel(item)}</option>)}
          </Select>
          <Select value={city} onChange={(event) => setCity(event.target.value)} aria-label="Filter by city">
            <option value="">All service cities</option>
            {cities.map((item) => <option key={item} value={item}>{item}</option>)}
          </Select>
        </div>

        {error ? (
          <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200"><span>{error}</span><button type="button" onClick={loadCalendar} className="rounded-xl border border-red-400/30 px-3 py-2 font-semibold text-red-100">Retry</button></div>
        ) : loading ? (
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-10 text-center text-sm text-slate-400"><Loader2 className="mx-auto mb-3 animate-spin text-orange-300" size={20} />Loading scheduled work…</div>
        ) : viewMode === 'agenda' ? (
          <div className="mt-4 space-y-4">
            {jobs.length === 0 ? <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center text-sm text-slate-500">No future scheduled jobs match these filters.</div> : Array.from(new Set(jobs.map((item) => calendarDateKey(item.scheduled_start_at))).values()).map((key) => (
              <div key={key}>
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-orange-300">{new Date(`${key}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</div>
                <div className="grid gap-2 lg:grid-cols-2">{(jobsByDay[key] || []).map((item) => <CalendarJobCard key={item.id} item={item} />)}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
            <div className="grid grid-cols-7 border-b border-white/10 bg-white/5 text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((item) => <div key={item} className="p-2">{item}</div>)}
            </div>
            <div className={`grid grid-cols-7 gap-px bg-white/10 ${viewMode === 'day' ? 'grid-cols-1' : ''}`}>
              {days.map((day) => {
                const key = calendarDateKey(day);
                const dayJobs = jobsByDay[key] || [];
                const outsideMonth = viewMode === 'month' && day.getMonth() !== cursorDate.getMonth();
                return (
                  <div key={key} className={`min-h-[140px] bg-slate-950 p-2 ${outsideMonth ? 'opacity-40' : ''} ${viewMode === 'day' ? 'min-h-[320px]' : ''}`}>
                    <div className="mb-2 flex items-center justify-between gap-2"><span className="text-xs font-semibold text-slate-300">{day.getDate()}</span>{dayJobs.length > 0 && <span className="rounded-full bg-orange-500/15 px-2 py-0.5 text-[10px] font-semibold text-orange-200">{dayJobs.length}</span>}</div>
                    <div className="space-y-1.5">{dayJobs.slice(0, viewMode === 'day' ? 20 : 3).map((item) => <CalendarJobCard key={item.id} item={item} compact={viewMode !== 'day'} />)}</div>
                    {dayJobs.length > (viewMode === 'day' ? 20 : 3) && <div className="mt-2 text-center text-[10px] text-slate-500">+{dayJobs.length - (viewMode === 'day' ? 20 : 3)} more</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </SectionCard>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <SectionCard title="Travel density" eyebrow="Route planning">
          {(data?.travelDensity || []).length === 0 ? <div className="text-sm text-slate-500">No future route data for this range.</div> : <div className="grid gap-2 sm:grid-cols-2">{data.travelDensity.map((item) => <div key={item.city} className="rounded-2xl border border-white/10 bg-white/5 p-4"><div className="flex items-center justify-between gap-3"><span className="font-semibold text-white">{item.city}</span><Chip tone="emerald">{item.job_count} job{item.job_count === 1 ? '' : 's'}</Chip></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-900"><div className="h-full rounded-full bg-orange-500" style={{ width: `${Math.min(100, (Number(item.job_count) / Math.max(1, jobs.length)) * 100)}%` }} /></div></div>)}</div>}
        </SectionCard>
        <SectionCard title="Dispatch summary" eyebrow="Operations">
          <div className="grid grid-cols-2 gap-3"><MiniStat label="Jobs in range" value={jobs.length} icon={CalendarDays} tone="blue" /><MiniStat label="Cities" value={(data?.travelDensity || []).length} icon={MapPin} tone="emerald" /></div>
          <p className="mt-4 text-xs leading-5 text-slate-500">Counts exclude completed, canceled, and closed requests. Travel time and worker availability will be applied by the next dispatch units.</p>
        </SectionCard>
      </div>
    </AdminShell>
  );
}

function DirectAdminCaseView({ mode }) {
  const { id } = useParams();
  const [profile] = useDirectAdminProfile();
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');
  const [draft, setDraft] = useState({
    status: 'new',
    payment_status: 'unpaid',
    quote_amount_cents: '',
    service_address: '',
    service_city: '',
    preferred_date: '',
    preferred_time_window: '',
    on_site_contact_name: '',
    on_site_contact_phone: '',
    access_notes: '',
    payment_method: '',
    payment_reference: '',
  });

  useEffect(() => {
    let active = true;
    setLoading(true);
    getDirectAdminRequest(id)
      .then((data) => {
        if (!active) return;
        const req = data?.request || null;
        setRequest(req);
        setDraft({
          status: req?.status || 'new',
          payment_status: req?.paymentStatus || 'unpaid',
          quote_amount_cents: req?.quoteAmountCents ?? '',
          service_address: req?.serviceAddress || '',
          service_city: req?.serviceCity || '',
          preferred_date: req?.preferredDate ? String(req.preferredDate).slice(0, 10) : '',
          preferred_time_window: req?.preferredTimeWindow || '',
          on_site_contact_name: req?.onSiteContactName || '',
          on_site_contact_phone: req?.onSiteContactPhone || '',
          access_notes: req?.accessNotes || '',
          payment_method: req?.paymentMethod || '',
          payment_reference: req?.paymentReference || '',
        });
      })
      .catch((error) => toast.error(error?.response?.data?.error || 'Failed to load Direct record'))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);

  const header = useMemo(() => {
    switch (mode) {
      case 'quote': return { title: 'Quote builder', subtitle: 'Turn the customer request into a clean estimate with the next steps attached.' };
      case 'job': return { title: 'Work order', subtitle: 'Track the active job, status changes, notes, and service details.' };
      case 'payment': return { title: 'Payment proof review', subtitle: 'Confirm direct payment proof, mark paid, or flag a dispute.' };
      default: return { title: 'Direct request', subtitle: 'Review and manage the request.' };
    }
  }, [mode]);

  const save = async () => {
    if (!id) return;
    setSaving(true);
    try {
      const payload = {
        status: draft.status,
        payment_status: draft.payment_status,
        quote_amount_cents: draft.quote_amount_cents === '' ? null : Number(draft.quote_amount_cents),
        service_address: draft.service_address,
        service_city: draft.service_city,
        preferred_date: draft.preferred_date,
        preferred_time_window: draft.preferred_time_window,
        on_site_contact_name: draft.on_site_contact_name,
        on_site_contact_phone: draft.on_site_contact_phone,
        access_notes: draft.access_notes,
        payment_method: draft.payment_method,
        payment_reference: draft.payment_reference,
        admin_notes: note,
      };
      const { request: updated } = await updateDirectAdminRequest(id, payload);
      setRequest(updated);
      toast.success('Work order saved.');
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Could not save work order.');
    } finally {
      setSaving(false);
    }
  };

  const confirmProof = async () => {
    setSaving(true);
    try {
      const { request: updated } = await confirmDirectProof(id, { note: 'Confirmed by Direct admin.' });
      setRequest(updated);
      toast.success('Proof confirmed.');
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Could not confirm proof.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AdminShell title={header.title} subtitle={header.subtitle} profile={profile} right={<div className="text-sm text-slate-300">Loading…</div>}>
        <SectionCard title="Loading…" eyebrow="Direct">
          <div className="text-sm text-slate-400">Fetching the record…</div>
        </SectionCard>
      </AdminShell>
    );
  }

  if (!request) {
    return (
      <AdminShell title={header.title} subtitle={header.subtitle} profile={profile} right={<div className="text-sm text-slate-300">No record found.</div>}>
        <SectionCard title="No record found" eyebrow="Direct">
          <div className="text-sm text-slate-400">This request is not available.</div>
        </SectionCard>
      </AdminShell>
    );
  }

  return (
    <AdminShell
      title={`${header.title} #${request.id}`}
      subtitle={header.subtitle}
      profile={profile}
      right={(
        <div className="space-y-3 text-sm leading-6 text-slate-300">
          <div><strong className="text-white">Customer:</strong> {request.firstName} {request.lastName}</div>
          <div><strong className="text-white">Status:</strong> {statusLabel(request.status)}</div>
          <div><strong className="text-white">Payment:</strong> {request.paymentStatus || 'unpaid'}</div>
          <div className="flex flex-wrap gap-2">
            <Link to={`/direct/jobs/${request.id}`} className="rounded-full bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white">Public job view</Link>
            <Link to="/direct/admin/inbox" className="rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white">Back to inbox</Link>
          </div>
        </div>
      )}
    >
      <div className="grid gap-4 xl:grid-cols-[1fr_0.95fr]">
        <SectionCard title={request.serviceCategory || 'Direct request'} eyebrow="Record">
          <RequestSnapshot request={request} />
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Details</div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-300">{request.details || 'No details provided.'}</p>
          </div>
          {request.proofAttachment?.url && (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Payment proof</div>
              <a href={request.proofAttachment.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-orange-300 underline">Open uploaded proof</a>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {(request.messages || []).slice(0, 5).map((message) => (
              <span key={message.id} className="rounded-full border border-white/10 bg-slate-950/70 px-3 py-1.5 text-xs text-slate-300">
                {message.senderRole}: {message.message.slice(0, 30)}
              </span>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Edit fields" eyebrow="Ops">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status"><Select value={draft.status} onChange={(e) => setDraft((current) => ({ ...current, status: e.target.value }))}>{STATUS_OPTIONS.map((item) => <option key={item} value={item}>{statusLabel(item)}</option>)}</Select></Field>
            <Field label="Payment status"><Select value={draft.payment_status} onChange={(e) => setDraft((current) => ({ ...current, payment_status: e.target.value }))}>{PAYMENT_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}</Select></Field>
            <Field label="Quote amount (cents)"><Input type="number" value={draft.quote_amount_cents} onChange={(e) => setDraft((current) => ({ ...current, quote_amount_cents: e.target.value }))} /></Field>
            <Field label="Payment method"><Input value={draft.payment_method} onChange={(e) => setDraft((current) => ({ ...current, payment_method: e.target.value }))} /></Field>
            <Field label="Payment reference"><Input value={draft.payment_reference} onChange={(e) => setDraft((current) => ({ ...current, payment_reference: e.target.value }))} /></Field>
            <Field label="Preferred date"><Input type="date" value={draft.preferred_date} onChange={(e) => setDraft((current) => ({ ...current, preferred_date: e.target.value }))} /></Field>
            <Field label="Time window"><Input value={draft.preferred_time_window} onChange={(e) => setDraft((current) => ({ ...current, preferred_time_window: e.target.value }))} /></Field>
            <Field label="Service city"><Input value={draft.service_city} onChange={(e) => setDraft((current) => ({ ...current, service_city: e.target.value }))} /></Field>
            <Field label="Contact name"><Input value={draft.on_site_contact_name} onChange={(e) => setDraft((current) => ({ ...current, on_site_contact_name: e.target.value }))} /></Field>
            <Field label="Contact phone"><Input value={draft.on_site_contact_phone} onChange={(e) => setDraft((current) => ({ ...current, on_site_contact_phone: e.target.value }))} /></Field>
            <Field label="Service address"><Input value={draft.service_address} onChange={(e) => setDraft((current) => ({ ...current, service_address: e.target.value }))} /></Field>
          </div>
          <div className="mt-4">
            <Field label="Access notes"><Textarea rows={4} value={draft.access_notes} onChange={(e) => setDraft((current) => ({ ...current, access_notes: e.target.value }))} /></Field>
          </div>
          <div className="mt-4">
            <Field label="Internal note"><Textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} hint="Visible to staff, not exposed publicly." /></Field>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={save} disabled={saving} className="rounded-full bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{saving ? 'Saving…' : 'Save changes'}</button>
            {mode === 'payment' && (
              <>
                <button type="button" onClick={confirmProof} disabled={saving} className="rounded-full bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">Confirm proof</button>
                <button type="button" onClick={() => setDraft((current) => ({ ...current, payment_status: 'disputed' }))} disabled={saving} className="rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white">Mark disputed</button>
              </>
            )}
          </div>
        </SectionCard>
      </div>
    </AdminShell>
  );
}

function DirectAdminCustomerView() {
  const { userId } = useParams();
  const [profile] = useDirectAdminProfile();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    getDirectAdminCustomer(userId)
      .then((next) => { if (active) setData(next?.customer || null); })
      .catch((error) => toast.error(error?.response?.data?.error || 'Failed to load customer'));
    return () => { active = false; setLoading(false); };
  }, [userId]);
  return (
    <AdminShell title={`Customer CRM ${userId ? `#${userId}` : ''}`} subtitle="See repeat work, preferences, and saved locations for a customer." profile={profile} right={<div className="text-sm text-slate-300">Use this to understand repeat work and preferences.</div>}>
      {loading || !data ? (
        <SectionCard title="Loading…" eyebrow="Customer"><div className="text-sm text-slate-400">Fetching customer details…</div></SectionCard>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          <SectionCard title="Requests" eyebrow="History">
            <div className="space-y-2">
              {(data.requests || []).map((item) => (
                <Link key={item.id} to={`/direct/admin/jobs/${item.id}`} className="block rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold text-white">{item.serviceCategory}</div>
                      <div className="mt-1 text-sm text-slate-400">{item.serviceLocation || item.serviceCity || '—'}</div>
                    </div>
                    <Chip tone="blue">{statusLabel(item.status)}</Chip>
                  </div>
                </Link>
              ))}
            </div>
          </SectionCard>
          <SectionCard title="Locations" eyebrow="CRM">
            <div className="space-y-2">
              {(data.locations || []).map((location) => (
                <div key={location.id} className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
                  <div className="font-semibold text-white">{location.label}{location.isDefault ? ' · default' : ''}</div>
                  <div className="mt-1">{location.addressLine1}{location.addressLine2 ? `, ${location.addressLine2}` : ''}</div>
                  <div>{location.city}{location.region ? `, ${location.region}` : ''} {location.postalCode}</div>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      )}
    </AdminShell>
  );
}

function DirectAdminSettingsView() {
  const [profile, setProfile] = useDirectAdminProfile();
  const [saving, setSaving] = useState(false);
  const update = (key) => (e) => setProfile((current) => ({ ...current, [key]: e.target.value }));
  const save = async () => {
    setSaving(true);
    try {
      await updateDirectAdminSettings({
        companyName: profile.companyName,
        headline: profile.headline,
        minimumPriceCents: profile.minimumPriceCents,
        availabilityText: profile.availabilityText,
        baseCity: profile.baseCity,
        publicNote: profile.publicNote,
        serviceAreas: profile.serviceAreas.join(', '),
        tools: profile.tools.join(', '),
        travelDays: profile.travelDays.join(', '),
        travelCities: profile.travelCities.join(', '),
        supportEmail: profile.supportEmail,
        supportPhone: profile.supportPhone,
      });
      toast.success('Direct settings saved.');
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminShell title="Service area and tools" subtitle="Update the company-owned Direct offer without redesigning the page." profile={profile} right={<div className="text-sm text-slate-300">These settings drive the public Direct landing page.</div>}>
      <div className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
        <SectionCard title="Public settings" eyebrow="Direct">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Company name"><Input value={profile.companyName} onChange={update('companyName')} /></Field>
            <Field label="Base city"><Input value={profile.baseCity} onChange={update('baseCity')} /></Field>
            <Field label="Starting price (cents)"><Input type="number" value={profile.minimumPriceCents} onChange={(e) => setProfile((current) => ({ ...current, minimumPriceCents: Number(e.target.value) || 0 }))} /></Field>
            <Field label="Availability text"><Input value={profile.availabilityText} onChange={update('availabilityText')} /></Field>
          </div>
          <div className="mt-4">
            <Field label="Headline"><Textarea rows={3} value={profile.headline} onChange={update('headline')} /></Field>
          </div>
          <div className="mt-4">
            <Field label="Public note"><Textarea rows={4} value={profile.publicNote} onChange={update('publicNote')} /></Field>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Service areas (comma separated)"><Textarea rows={4} value={profile.serviceAreas.join(', ')} onChange={(e) => setProfile((current) => ({ ...current, serviceAreas: e.target.value.split(',').map((item) => item.trim()).filter(Boolean) }))} /></Field>
            <Field label="Tools (comma separated)"><Textarea rows={4} value={profile.tools.join(', ')} onChange={(e) => setProfile((current) => ({ ...current, tools: e.target.value.split(',').map((item) => item.trim()).filter(Boolean) }))} /></Field>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Travel days"><Textarea rows={3} value={profile.travelDays.join(', ')} onChange={(e) => setProfile((current) => ({ ...current, travelDays: e.target.value.split(',').map((item) => item.trim()).filter(Boolean) }))} /></Field>
            <Field label="Travel cities"><Textarea rows={3} value={profile.travelCities.join(', ')} onChange={(e) => setProfile((current) => ({ ...current, travelCities: e.target.value.split(',').map((item) => item.trim()).filter(Boolean) }))} /></Field>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Support email"><Input value={profile.supportEmail || ''} onChange={update('supportEmail')} /></Field>
            <Field label="Support phone"><Input value={profile.supportPhone || ''} onChange={update('supportPhone')} /></Field>
          </div>
          <div className="mt-4">
            <button type="button" onClick={save} disabled={saving} className="rounded-full bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{saving ? 'Saving…' : 'Save settings'}</button>
          </div>
        </SectionCard>

        <SectionCard title="Preview" eyebrow="Public page">
          <div className="space-y-4 text-sm leading-6 text-slate-300">
            <div><strong className="text-white">Minimum price:</strong> {currencyLabel(profile.minimumPriceCents)}</div>
            <div><strong className="text-white">Service area:</strong> {(profile.serviceAreas || []).join(', ')}</div>
            <div><strong className="text-white">Tools:</strong> {(profile.tools || []).slice(0, 6).join(', ')}{(profile.tools || []).length > 6 ? '…' : ''}</div>
            <div><strong className="text-white">Travel days:</strong> {(profile.travelDays || []).join(', ')}</div>
            <div><strong className="text-white">Travel cities:</strong> {(profile.travelCities || []).join(', ')}</div>
          </div>
        </SectionCard>
      </div>
    </AdminShell>
  );
}

function DirectAdminReportsView() {
  const [profile] = useDirectAdminProfile();
  const [report, setReport] = useState(null);
  useEffect(() => {
    getDirectAdminReports().then((data) => setReport(data?.report || null)).catch(() => {});
  }, []);
  return (
    <AdminShell title="Reporting" subtitle="Leads, conversion, completed work, and payment status at a glance." profile={profile} right={<div className="text-sm text-slate-300">Use this for weekly review.</div>}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MiniStat label="Total requests" value={report?.total_requests || 0} icon={ClipboardList} tone="blue" />
        <MiniStat label="Accepted" value={report?.accepted_requests || 0} icon={CheckCircle2} tone="emerald" />
        <MiniStat label="Completed" value={report?.completed_requests || 0} icon={TrendingUp} tone="violet" />
        <MiniStat label="Outstanding" value={report?.outstanding_payments || 0} icon={AlertTriangle} tone="orange" />
      </div>
      <div className="mt-4">
        <SectionCard title="Summary" eyebrow="Ops">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 text-sm text-slate-300">
            <InfoRow label="Requested" value={report?.requested_requests || 0} />
            <InfoRow label="Quoted" value={report?.quoted_requests || 0} />
            <InfoRow label="Scheduled" value={report?.scheduled_requests || 0} />
            <InfoRow label="Confirmed payments" value={report?.confirmed_payments || 0} />
            <InfoRow label="Outstanding payments" value={report?.outstanding_payments || 0} />
            <InfoRow label="Total" value={report?.total_requests || 0} />
          </div>
        </SectionCard>
      </div>
    </AdminShell>
  );
}

function DirectAdminTeamView() {
  const [profile] = useDirectAdminProfile();
  const [team, setTeam] = useState([]);
  useEffect(() => {
    getDirectAdminTeam().then((data) => setTeam(Array.isArray(data?.members) ? data.members : [])).catch(() => {});
  }, []);
  return (
    <AdminShell title="Team access" subtitle="See which staff members can access the Direct ops flow." profile={profile} right={<div className="text-sm text-slate-300">Grant access from your main admin user management later if needed.</div>}>
      <SectionCard title="Staff" eyebrow="Access">
        <div className="space-y-2">
          {team.length === 0 ? (
            <div className="text-sm text-slate-500">No team members found.</div>
          ) : team.map((member) => (
            <div key={member.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-white">{member.firstName} {member.lastName}</div>
                  <div className="mt-1 text-sm text-slate-400">{member.email}</div>
                </div>
                <Chip tone={member.role === 'super_admin' ? 'violet' : 'orange'}>{member.role}</Chip>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>
    </AdminShell>
  );
}

function DirectAdminEmailTestView() {
  const [profile] = useDirectAdminProfile();
  const { user, loading, isStaff } = useAdminAccess();
  const [recipientEmail, setRecipientEmail] = useState('');
  const [subject, setSubject] = useState('OxSteed email test');
  const [message, setMessage] = useState('If you received this, the OxSteed email system is working.');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (user?.email) setRecipientEmail((current) => current || user.email);
  }, [user?.email]);

  if (loading) {
    return (
      <PageShell>
        <div className="mx-auto max-w-4xl px-4 py-10 text-slate-300">Loading…</div>
      </PageShell>
    );
  }

  if (!isStaff) return <NoAccess />;

  const handleSend = async () => {
    const nextRecipient = recipientEmail.trim() || user?.email || '';
    if (!nextRecipient) {
      toast.error('Recipient email is required.');
      return;
    }

    setSending(true);
    setResult(null);
    try {
      const data = await sendDirectAdminTestEmail({
        recipientEmail: nextRecipient,
        subject: subject.trim() || 'OxSteed email test',
        message: message.trim() || 'If you received this, the OxSteed email system is working.',
      });
      setResult({ status: 'success', ...data });
      toast.success(`Test email sent to ${data.recipientEmail || nextRecipient}.`);
    } catch (error) {
      const errorMessage = error?.response?.data?.error || 'Could not send test email.';
      setResult({ status: 'error', error: errorMessage });
      toast.error(errorMessage);
    } finally {
      setSending(false);
    }
  };

  return (
    <AdminShell
      title="Email test"
      subtitle="Send a real email through the live Direct mail configuration and confirm delivery before using it in production flows."
      profile={profile}
      right={(
        <div className="space-y-3 text-sm leading-6 text-slate-300">
          <div>This page uses the same mail transport Direct requests rely on.</div>
          <div>Default recipient: your signed-in admin email.</div>
          <div>If it fails, check the provider keys and from-address settings in Coolify.</div>
        </div>
      )}
    >
      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <SectionCard title="Send a test email" eyebrow="Email">
          <div className="grid gap-4">
            <Field label="Recipient email" required hint="Defaults to your signed-in admin email.">
              <Input
                type="email"
                value={recipientEmail}
                onChange={(event) => setRecipientEmail(event.target.value)}
                placeholder={user?.email || 'name@example.com'}
              />
            </Field>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Subject" required>
                <Input value={subject} onChange={(event) => setSubject(event.target.value)} />
              </Field>
              <Field label="Quick actions">
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => setRecipientEmail(user?.email || '')}
                    className="rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
                  >
                    Use my email
                  </button>
                  <button
                    type="button"
                    onClick={() => setSubject('OxSteed email test')}
                    className="rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
                  >
                    Reset subject
                  </button>
                </div>
              </Field>
            </div>

            <Field label="Message" required hint="This becomes the body of the email.">
              <Textarea rows={7} value={message} onChange={(event) => setMessage(event.target.value)} />
            </Field>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleSend}
                disabled={sending}
                className="inline-flex items-center gap-2 rounded-full bg-orange-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Mail size={15} />
                {sending ? 'Sending…' : 'Send test email'}
              </button>
            </div>
          </div>
        </SectionCard>

        <div className="space-y-6">
          <SectionCard title="What this checks" eyebrow="Verification">
            <div className="space-y-3 text-sm leading-6 text-slate-300">
              <p>It sends a real transactional email using the live Direct mail configuration.</p>
              <p>It confirms the sender, recipient, subject, and HTML rendering all work together.</p>
              <p>Use it after changing API keys, from-address settings, or deployment env vars.</p>
            </div>
          </SectionCard>

          <SectionCard title="Latest result" eyebrow="Status">
            {result ? (
              result.status === 'success' ? (
                <div className="space-y-3 text-sm leading-6 text-slate-300">
                  <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-emerald-100">
                    Test email sent successfully.
                  </div>
                  <InfoRow label="Recipient" value={result.recipientEmail} />
                  <InfoRow label="Subject" value={result.subject} />
                  <InfoRow label="Provider message ID" value={result.providerMessageId || '—'} />
                </div>
              ) : (
                <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm leading-6 text-red-100">
                  {result.error || 'The email test failed.'}
                </div>
              )
            ) : (
              <div className="text-sm leading-6 text-slate-400">
                No test has been sent yet. Use the button above to confirm the mail stack.
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </AdminShell>
  );
}

function DirectAdminLanding() {
  const [profile] = useDirectAdminProfile();
  const [isStaff, setIsStaff] = useState(true);
  const { user, loading } = useAdminAccess();
  useEffect(() => {
    if (!loading) setIsStaff(Boolean(user && ['admin', 'super_admin'].includes(user.role)));
  }, [loading, user]);
  if (loading) {
    return (
      <PageShell>
        <div className="mx-auto max-w-4xl px-4 py-10 text-slate-300">Loading…</div>
      </PageShell>
    );
  }
  if (!isStaff) return <Navigate to="/dashboard" replace />;
  return (
    <AdminShell
      title="OxSteed Direct admin"
      subtitle="Internal operations for company-owned Direct service: quote, schedule, proof, and customer history."
      profile={profile}
      right={(
        <div className="space-y-3 text-sm text-slate-300">
          <div>Quote requests, dispatch, payment proof, and service records live here.</div>
          <Link to="/direct/admin/inbox" className="inline-flex items-center gap-2 rounded-2xl bg-orange-500 px-4 py-3 font-semibold text-white">Open inbox <ChevronRight size={16} /></Link>
        </div>
      )}
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Link to="/direct/admin/dashboard" className="rounded-[24px] border border-white/10 bg-white/5 p-5">
          <div className="text-sm uppercase tracking-[0.2em] text-slate-500">Dashboard</div>
          <div className="mt-2 text-xl font-semibold text-white">Pipeline and urgent items</div>
          <p className="mt-2 text-sm leading-6 text-slate-400">Open counts, upcoming jobs, and unpaid work.</p>
        </Link>
        <Link to="/direct/admin/inbox" className="rounded-[24px] border border-white/10 bg-white/5 p-5">
          <div className="text-sm uppercase tracking-[0.2em] text-slate-500">Inbox</div>
          <div className="mt-2 text-xl font-semibold text-white">Quote requests queue</div>
          <p className="mt-2 text-sm leading-6 text-slate-400">Review requests and turn them into estimates.</p>
        </Link>
        <Link to="/direct/admin/settings" className="rounded-[24px] border border-white/10 bg-white/5 p-5">
          <div className="text-sm uppercase tracking-[0.2em] text-slate-500">Settings</div>
          <div className="mt-2 text-xl font-semibold text-white">Service area and tools</div>
          <p className="mt-2 text-sm leading-6 text-slate-400">Update minimums, cities, travel days, and tools.</p>
        </Link>
        <a href="/admin/direct-service-areas" className="rounded-[24px] border border-orange-500/20 bg-orange-500/5 p-5">
          <div className="text-sm uppercase tracking-[0.2em] text-orange-300">Coverage controls</div>
          <div className="mt-2 text-xl font-semibold text-white">Manage service areas</div>
          <p className="mt-2 text-sm leading-6 text-slate-400">Add or update live map coverage and distance radii.</p>
        </a>
        <Link to="/direct/admin/email-test" className="rounded-[24px] border border-white/10 bg-white/5 p-5">
          <div className="text-sm uppercase tracking-[0.2em] text-slate-500">Email</div>
          <div className="mt-2 text-xl font-semibold text-white">Send a test message</div>
          <p className="mt-2 text-sm leading-6 text-slate-400">Confirm the live mail provider is sending customer emails correctly.</p>
        </Link>
      </div>
    </AdminShell>
  );
}

export default function DirectAdminPortalPage({ view = 'dashboard' }) {
  if (view === 'landing') return <DirectAdminLanding />;
  if (view === 'dashboard') return <DirectAdminDashboardView />;
  if (view === 'inbox') return <DirectAdminInboxView />;
  if (view === 'calendar') return <DirectAdminCalendarView />;
  if (view === 'quote') return <DirectAdminCaseView mode="quote" />;
  if (view === 'job') return <DirectAdminCaseView mode="job" />;
  if (view === 'payment') return <DirectAdminCaseView mode="payment" />;
  if (view === 'customer') return <DirectAdminCustomerView />;
  if (view === 'settings') return <DirectAdminSettingsView />;
  if (view === 'reports') return <DirectAdminReportsView />;
  if (view === 'team') return <DirectAdminTeamView />;
  if (view === 'email-test') return <DirectAdminEmailTestView />;
  return <DirectAdminDashboardView />;
}
