import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from '../../api/axios';
import toast from 'react-hot-toast';
import BusinessLaunchRequestDetail from './BusinessLaunchRequestDetail';
import { useAbortableFetch } from '../lib/useAbortableFetch';
import AdminErrorState from '../lib/AdminErrorState';
import ConfirmDialog from '../lib/ConfirmDialog';
import { SuggestDropdown } from '../../components/SuggestDropdown';
import '../lib/suggestDropdownAdmin.css';

const STATUS_COLORS = {
  pending: '#FFA500',
  contacted: '#4F46E5',
  kickoff_scheduled: '#8B5CF6',
  in_progress: '#0EA5E9',
  completed: '#10B981',
  cancelled: '#EF4444',
  archived: '#9CA3AF',
};

const STATUS_PIPELINE = [
  { key: 'pending', labelKey: 'businessLaunchAdmin.statusNew', defaultLabel: 'New' },
  { key: 'contacted', labelKey: 'businessLaunchAdmin.statusContacted', defaultLabel: 'Contacted' },
  { key: 'kickoff_scheduled', labelKey: 'businessLaunchAdmin.statusKickoffScheduled', defaultLabel: 'Session Scheduled' },
  { key: 'in_progress', labelKey: 'businessLaunchAdmin.statusInProgress', defaultLabel: 'In Progress' },
  { key: 'completed', labelKey: 'businessLaunchAdmin.statusCompleted', defaultLabel: 'Completed' },
  { key: 'archived', labelKey: 'businessLaunchAdmin.statusArchived', defaultLabel: 'Archived' },
];

const URGENCY_LABELS = {
  exploring: { key: 'businessLaunchAdmin.urgencyExploring', fallback: 'Just Exploring' },
  two_weeks: { key: 'businessLaunchAdmin.urgencyTwoWeeks', fallback: '2 Weeks' },
  one_month: { key: 'businessLaunchAdmin.urgencyOneMonth', fallback: '1 Month' },
  asap: { key: 'businessLaunchAdmin.urgencyAsap', fallback: 'ASAP' },
};

const URGENT_COLORS = {
  exploring: '#6B7280',
  two_weeks: '#F59E0B',
  one_month: '#F97316',
  asap: '#DC2626',
};

function Badge({ color, children }) {
  return (
    <span style={{ display: 'inline-block', background: color || '#6B7280', color: 'white', padding: '0.2rem 0.65rem', borderRadius: '12px', fontSize: '0.78rem', fontWeight: 600 }}>
      {children}
    </span>
  );
}

function StatusBadge({ status }) {
  const label = status.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return <Badge color={STATUS_COLORS[status]}>{label}</Badge>;
}

function UrgencyBadge({ urgency }) {
  const { t } = useTranslation();
  const entry = URGENCY_LABELS[urgency];
  return <Badge color={URGENT_COLORS[urgency] || '#6B7280'}>{entry ? t(entry.key, { defaultValue: entry.fallback }) : urgency}</Badge>;
}

// Every status change goes through a parent-level confirmation dialog:
// the menu asks the parent to confirm, then the parent performs the PATCH.
function QuickStatusMenu({ request, onStatusRequest }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  function requestUpdate(newStatus) {
    setOpen(false);
    onStatusRequest(request, newStatus);
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-label={t('businessLaunchAdmin.statusMenuLabel')}
        style={{ padding: '0.3rem 0.6rem', borderRadius: '5px', border: '1px solid var(--color-border)', background: 'none', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--color-text)' }}
      >
        {t('businessLaunchAdmin.statusButton', { defaultValue: 'Status' })} ▾
      </button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: '100%', zIndex: 100, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', minWidth: '160px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', overflow: 'hidden' }}>
          {STATUS_PIPELINE.map(s => (
            <button key={s.key} onClick={() => requestUpdate(s.key)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.6rem 1rem', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem', color: STATUS_COLORS[s.key], fontWeight: request.status === s.key ? 700 : 400 }}>
              {request.status === s.key ? '✓ ' : ''}{t(s.labelKey, { defaultValue: s.defaultLabel })}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BusinessLaunchAdmin() {
  const { t } = useTranslation();
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ status: '', package: '', urgency: '', state: '', country: '' });
  const [page, setPage] = useState(1);
  const [statusTarget, setStatusTarget] = useState(null);
  const [archiveTarget, setArchiveTarget] = useState(null);

  const { data, error, loading, reload } = useAbortableFetch(async (signal) => {
    const params = new URLSearchParams({ page, limit: 20 });
    if (filters.status) params.set('status', filters.status);
    if (filters.package) params.set('package', filters.package);
    if (filters.urgency) params.set('urgency', filters.urgency);
    if (filters.state) params.set('state', filters.state);
    if (filters.country) params.set('country', filters.country);
    if (search) params.set('search', search);

    const res = await axios.get(`/consulting/business-launch/requests?${params}`, { signal });
    return {
      requests: res.data.data || [],
      pagination: res.data.pagination || {},
    };
  }, [filters, page, search]);

  const requests = data?.requests ?? [];
  const pagination = data?.pagination ?? {};

  // Typeahead suggestions from the latest loaded launch-request rows.
  const launchRequestSuggestItems = useMemo(() => {
    const seen = new Set();
    const items = [];
    for (const r of requests) {
      if (r.id == null || seen.has(r.id)) continue;
      seen.add(r.id);
      const title = `${r.first_name || ''} ${r.last_name || ''}`.trim() || r.email || String(r.id);
      items.push({ id: r.id, title, meta: r.email || undefined });
    }
    return items;
  }, [requests]);

  // Confirmed status change (quick status menu). ConfirmDialog stays open and
  // shows the error if the PATCH fails.
  const confirmStatusChange = async () => {
    const { request, newStatus } = statusTarget;
    await axios.patch(`/consulting/business-launch/requests/${request.id}`, { status: newStatus });
    toast.success(t('businessLaunchAdmin.statusUpdated'));
    setStatusTarget(null);
    reload();
  };

  // Confirmed archive. ConfirmDialog stays open and shows the error if the
  // PATCH fails.
  const confirmArchive = async () => {
    const req = archiveTarget;
    await axios.patch(`/consulting/business-launch/requests/${req.id}`, { status: 'archived' });
    toast.success(t('businessLaunchAdmin.requestArchived', { defaultValue: 'Request archived' }));
    setArchiveTarget(null);
    reload();
  };

  function exportCSV() {
    const headers = ['Name', 'Email', 'Phone', 'Package', 'Country', 'State', 'Urgency', 'Status', 'Submitted'];
    const rows = requests.map(r => [
      `${r.first_name} ${r.last_name}`,
      r.email,
      r.phone || '',
      r.package_selected || '',
      r.operating_country || '',
      r.operating_state || '',
      ((r.urgency && URGENCY_LABELS[r.urgency] && t(URGENCY_LABELS[r.urgency].key, { defaultValue: URGENCY_LABELS[r.urgency].fallback })) || r.urgency) || '',
      r.status,
      r.created_at ? new Date(r.created_at).toLocaleDateString() : '',
    ]);
    const csv = [headers, ...rows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `business-launch-requests-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const archiveRequest = (req) => {
    setArchiveTarget(req);
  };

  const inputStyle = { padding: '0.55rem 0.75rem', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.9rem' };
  const btnStyle = { padding: '0.55rem 1rem', borderRadius: '6px', border: 'none', background: 'var(--color-primary)', color: 'white', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem' };

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '2rem' }}>
      {/* Breadcrumb */}
      <nav style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1.25rem' }}>
        <Link to="/admin" style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>{t('businessLaunchAdmin.breadcrumbAdmin', { defaultValue: 'Admin' })}</Link>
        {' / '}
        <Link to="/admin/consulting" style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>{t('businessLaunchAdmin.breadcrumbConsulting', { defaultValue: 'Consulting' })}</Link>
        {' / '}
        <span>{t('businessLaunchAdmin.breadcrumbCurrent', { defaultValue: 'Business Launch' })}</span>
      </nav>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ margin: '0 0 0.25rem', fontSize: '1.75rem', fontWeight: 700 }}>{t('businessLaunchAdmin.title', { defaultValue: 'Founder Development Program' })}</h1>
          <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
            {t('businessLaunchAdmin.totalRequests', { defaultValue: '{{count}} total requests', count: pagination.total || 0 })}
          </p>
        </div>
        <button onClick={exportCSV} style={{ ...btnStyle, background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
          {t('businessLaunchAdmin.exportCsv', { defaultValue: 'Export CSV' })}
        </button>
      </div>

      {/* Status Pipeline */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', overflowX: 'auto', paddingBottom: '0.25rem' }}>
        {STATUS_PIPELINE.map((s, i) => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
            <button
              onClick={() => { setFilters(f => ({ ...f, status: f.status === s.key ? '' : s.key })); setPage(1); }}
              style={{ padding: '0.4rem 0.85rem', borderRadius: '20px', border: `2px solid ${STATUS_COLORS[s.key]}`, background: filters.status === s.key ? STATUS_COLORS[s.key] : 'transparent', color: filters.status === s.key ? 'white' : STATUS_COLORS[s.key], fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              {t(s.labelKey, { defaultValue: s.defaultLabel })}
            </button>
            {i < STATUS_PIPELINE.length - 1 && <span style={{ color: 'var(--color-border)', fontWeight: 700 }}>→</span>}
          </div>
        ))}
      </div>

      {/* Search & Filters */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ minWidth: '200px' }}>
          <SuggestDropdown
            id="business-launch-search"
            items={launchRequestSuggestItems}
            value={search}
            onQueryChange={(q) => { setSearch(q); setPage(1); }}
            onSelect={(item) => { setSearch(item.title || ''); setPage(1); }}
            recentsKey="oxsteed_admin_business_launch_search_recents"
            placeholder={t('businessLaunchAdmin.searchPlaceholder', { defaultValue: 'Search name, email...' })}
            ariaLabel={t('businessLaunchAdmin.searchPlaceholder', { defaultValue: 'Search name, email...' })}
            className="sd-admin-adaptive"
          />
        </div>
        <select style={inputStyle} value={filters.package} onChange={e => { setFilters(f => ({ ...f, package: e.target.value })); setPage(1); }}>
          <option value="">{t('businessLaunchAdmin.filterAllPackages', { defaultValue: 'All Packages' })}</option>
          <option value="foundation">{t('businessLaunchAdmin.packageFoundation', { defaultValue: 'Foundation ($750)' })}</option>
          <option value="launch">{t('businessLaunchAdmin.packageLaunch', { defaultValue: 'Launch ($1,500)' })}</option>
          <option value="accelerator">{t('businessLaunchAdmin.packageAccelerator', { defaultValue: 'Accelerator ($3,000)' })}</option>
        </select>
        <select style={inputStyle} value={filters.urgency} onChange={e => { setFilters(f => ({ ...f, urgency: e.target.value })); setPage(1); }}>
          <option value="">{t('businessLaunchAdmin.filterAllUrgency', { defaultValue: 'All Urgency' })}</option>
          <option value="exploring">{t('businessLaunchAdmin.urgencyExploring', { defaultValue: 'Just Exploring' })}</option>
          <option value="two_weeks">2 Weeks</option>
          <option value="one_month">1 Month</option>
          <option value="asap">ASAP</option>
        </select>
        <select style={inputStyle} value={filters.state} onChange={e => { setFilters(f => ({ ...f, state: e.target.value })); setPage(1); }}>
          <option value="">{t('businessLaunchAdmin.filterAllStates', { defaultValue: 'All States' })}</option>
          {['CA', 'TX', 'FL', 'NY', 'PA', 'IL', 'OH', 'GA', 'NC', 'MI', 'NJ', 'VA', 'WA', 'AZ', 'MA', 'TN', 'IN', 'MO', 'MD', 'WI', 'CO', 'MN', 'SC', 'AL', 'LA', 'KY', 'OR', 'OK', 'CT', 'UT', 'IA', 'NV', 'AR', 'MS', 'KS', 'NM', 'NE', 'WV', 'ID', 'HI', 'NH', 'ME', 'RI', 'MT', 'DE', 'SD', 'ND', 'AK', 'DC', 'VT', 'WY'].map(st => <option key={st} value={st}>{st}</option>)}
        </select>
        <input
          type="text"
          placeholder={t('businessLaunchAdmin.countryPlaceholder', { defaultValue: 'Country code' })}
          value={filters.country}
          onChange={e => { setFilters(f => ({ ...f, country: e.target.value.toUpperCase() })); setPage(1); }}
          style={{ ...inputStyle, minWidth: '120px' }}
        />
        {(search || filters.status || filters.package || filters.urgency || filters.state || filters.country) && (
          <button onClick={() => { setSearch(''); setFilters({ status: '', package: '', urgency: '', state: '', country: '' }); setPage(1); }} style={{ ...inputStyle, background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
            {t('businessLaunchAdmin.clearAll', { defaultValue: 'Clear All' })}
          </button>
        )}
      </div>

      {/* Table */}
      {loading && page === 1 ? (
        <div style={{ color: 'var(--color-text-muted)' }}>{t('common.loading')}</div>
      ) : error ? (
        <AdminErrorState onRetry={reload} />
      ) : requests.length === 0 ? (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '10px', padding: '3rem', textAlign: 'center' }}>
          <p style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>{t('businessLaunchAdmin.emptyTitle', { defaultValue: 'No requests found' })}</p>
          <p style={{ color: 'var(--color-text-muted)' }}>{t('businessLaunchAdmin.emptyBody', { defaultValue: 'Try adjusting your filters or search terms.' })}</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', marginBottom: '2rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--color-surface)', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <thead>
              <tr>
                {[['businessLaunchAdmin.thName','Name'],['businessLaunchAdmin.thEmail','Email'],['businessLaunchAdmin.thPhone','Phone'],['businessLaunchAdmin.thPackage','Package'],['businessLaunchAdmin.thMarket','Market'],['businessLaunchAdmin.thConsultant','Consultant'],['businessLaunchAdmin.thUrgency','Urgency'],['businessLaunchAdmin.thStatus','Status'],['businessLaunchAdmin.thSubmitted','Submitted'],['businessLaunchAdmin.thActions','Actions']].map(([hk, h]) => (
                  <th key={h} style={{ background: 'var(--color-bg)', padding: '0.85rem 1rem', textAlign: 'left', borderBottom: '2px solid var(--color-border)', fontWeight: 600, fontSize: '0.85rem', whiteSpace: 'nowrap' }}>{t(hk, { defaultValue: h })}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {requests.map(req => (
                <tr key={req.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <button onClick={() => setSelectedRequest(req)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontWeight: 700, color: 'var(--color-primary)', fontSize: '0.9rem', textAlign: 'left' }}>
                      {req.first_name} {req.last_name}
                    </button>
                  </td>
                  <td style={{ padding: '0.85rem 1rem', fontSize: '0.85rem' }}>{req.email}</td>
                  <td style={{ padding: '0.85rem 1rem', fontSize: '0.85rem' }}>{req.phone || '-'}</td>
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <Badge color="#8B5CF6">{req.package_selected}</Badge>
                  </td>
                  <td style={{ padding: '0.85rem 1rem', fontSize: '0.85rem' }}>
                    {(req.operating_country || '-')} / {(req.operating_state || '-')}
                  </td>
                  <td style={{ padding: '0.85rem 1rem', fontSize: '0.82rem' }}>
                    {req.consultant_first_name ? (
                      <div>
                        <div style={{ fontWeight: 600 }}>{req.consultant_first_name} {req.consultant_last_name}</div>
                        <div style={{ color: 'var(--color-text-muted)' }}>{req.consultant_assignment_status || 'assigned'}</div>
                      </div>
                    ) : (
                      <span style={{ color: 'var(--color-text-muted)' }}>{t('businessLaunchAdmin.unassigned', { defaultValue: 'Unassigned' })}</span>
                    )}
                  </td>
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <UrgencyBadge urgency={req.urgency} />
                  </td>
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <StatusBadge status={req.status} />
                  </td>
                  <td style={{ padding: '0.85rem 1rem', fontSize: '0.82rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                    {req.created_at ? new Date(req.created_at).toLocaleDateString() : '-'}
                  </td>
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                      <button onClick={() => setSelectedRequest(req)} style={{ padding: '0.3rem 0.6rem', borderRadius: '5px', border: '1px solid var(--color-primary)', background: 'none', color: 'var(--color-primary)', fontSize: '0.78rem', cursor: 'pointer', fontWeight: 600 }}>
                        {t('businessLaunchAdmin.view', { defaultValue: 'View' })}
                      </button>
                      <QuickStatusMenu request={req} onStatusRequest={(request, newStatus) => setStatusTarget({ request, newStatus })} />
                      <button onClick={() => archiveRequest(req)} aria-label={t('businessLaunchAdmin.archiveLabel')} style={{ padding: '0.3rem 0.6rem', borderRadius: '5px', border: '1px solid #EF4444', background: 'none', color: '#EF4444', fontSize: '0.78rem', cursor: 'pointer' }}>
                        {t('businessLaunchAdmin.archive', { defaultValue: 'Archive' })}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginBottom: '2rem', alignItems: 'center' }}>
          <button style={btnStyle} disabled={page === 1} onClick={() => setPage(p => p - 1)}>{'← '}{t('businessLaunchAdmin.previousPage', { defaultValue: 'Previous' })}</button>
          <span style={{ padding: '0.5rem 1rem', color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
            {t('businessLaunchAdmin.pageOf', { defaultValue: 'Page {{page}} of {{pages}}', page, pages: pagination.pages })}
          </span>
          <button style={btnStyle} disabled={page === pagination.pages} onClick={() => setPage(p => p + 1)}>{t('businessLaunchAdmin.nextPage', { defaultValue: 'Next' })} {'→'}</button>
        </div>
      )}

      {selectedRequest && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <BusinessLaunchRequestDetail
            request={selectedRequest}
            onClose={() => setSelectedRequest(null)}
            onStatusUpdate={() => { reload(); setSelectedRequest(null); }}
          />
        </div>
      )}

      <ConfirmDialog
        open={!!statusTarget}
        title={t('businessLaunchAdmin.confirmStatusTitle')}
        message={t('businessLaunchAdmin.confirmStatusMessage', {
          status: statusTarget?.newStatus ? t((STATUS_PIPELINE.find(s => s.key === statusTarget.newStatus) || {}).labelKey || 'businessLaunchAdmin.statusUnknown', { defaultValue: (STATUS_PIPELINE.find(s => s.key === statusTarget.newStatus) || {}).defaultLabel || statusTarget.newStatus }) : '',
        })}
        onConfirm={confirmStatusChange}
        onClose={() => setStatusTarget(null)}
      />
      <ConfirmDialog
        open={!!archiveTarget}
        danger
        title={t('businessLaunchAdmin.confirmArchiveTitle')}
        message={t('businessLaunchAdmin.confirmArchiveMessage')}
        onConfirm={confirmArchive}
        onClose={() => setArchiveTarget(null)}
      />
    </div>
  );
}
