import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, FileText, Mail, Phone, RefreshCw, Search, User, MessageSquare, CalendarDays, MapPin, Tag } from 'lucide-react';
import toast from 'react-hot-toast';
import adminApi from '../../lib/adminApi';
import { useAbortableFetch } from '../lib/useAbortableFetch';

const STATUS_VALUES = ['new', 'reviewing', 'quoted', 'contacted', 'closed', 'cancelled'];

const STATUS_KEY_SUFFIX = {
  new: 'New',
  reviewing: 'Reviewing',
  quoted: 'Quoted',
  contacted: 'Contacted',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

const STATUS_BADGES = {
  new: 'bg-blue-500/15 text-blue-300 border-blue-500/25',
  reviewing: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/25',
  quoted: 'bg-orange-500/15 text-orange-300 border-orange-500/25',
  contacted: 'bg-purple-500/15 text-purple-300 border-purple-500/25',
  closed: 'bg-green-500/15 text-green-300 border-green-500/25',
  cancelled: 'bg-gray-500/15 text-gray-300 border-gray-500/20',
};

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function FieldCard({ icon: Icon, label, value, href }) {
  const content = (
    <div className="flex items-start gap-3 rounded-2xl border border-gray-800 bg-gray-950/60 p-4">
      <div className="rounded-xl bg-gray-800 p-2 text-gray-300">
        <Icon size={15} />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-[0.2em] text-gray-500">{label}</div>
        <div className="mt-1 break-words text-sm text-white">{value || '—'}</div>
      </div>
    </div>
  );

  if (!href) return content;
  return (
    <a href={href} className="block transition hover:border-orange-500/40">
      {content}
    </a>
  );
}

export default function QuoteRequestsInbox() {
  const { t } = useTranslation();
  const [requests, setRequests] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [draft, setDraft] = useState({ status: 'new', admin_notes: '' });

  const pageSize = 20;
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);

  const STATUS_OPTIONS = STATUS_VALUES.map((value) => ({
    value,
    label: t(`adminQuoteRequests.status${STATUS_KEY_SUFFIX[value]}`),
  }));

  // Detail fetch is sequence-guarded + abortable: a slow response for a
  // previously selected request can never populate the pane (or the editable
  // notes) with the wrong request's data.
  const {
    data: detail,
    loading: detailLoading,
    error: detailError,
    reload: reloadDetail,
  } = useAbortableFetch(async (signal) => {
    if (!selectedId) return null;
    const { data } = await adminApi.get(`/quote-requests/admin/${selectedId}`, { signal });
    return data;
  }, [selectedId]);

  // Keep the editable draft in sync with the request the pane is showing.
  useEffect(() => {
    if (detail) {
      setDraft({ status: detail.status || 'new', admin_notes: detail.admin_notes || '' });
    }
  }, [detail]);

  // Clear the draft while a newly selected request loads, so the previous
  // request's notes are never shown as the new request's.
  useEffect(() => {
    setDraft({ status: 'new', admin_notes: '' });
  }, [selectedId]);

  useEffect(() => {
    if (detailError) {
      toast.error(detailError?.response?.data?.error || t('adminQuoteRequests.loadDetailFailed'));
    }
  }, [detailError, t]);

  const selectedRequest = useMemo(
    () => detail || requests.find((item) => String(item.id) === String(selectedId)) || null,
    [detail, requests, selectedId]
  );

  const loadRequests = async (nextPage = page, overrides = {}) => {
    setLoading(true);
    try {
      const effectiveSearch = overrides.search !== undefined ? overrides.search : search.trim();
      const effectiveStatus = overrides.status !== undefined ? overrides.status : statusFilter;
      const { data } = await adminApi.get('/quote-requests/admin/list', {
        params: {
          page: nextPage,
          limit: pageSize,
          status: effectiveStatus || undefined,
          search: effectiveSearch || undefined,
        },
      });
      const nextRequests = data.requests || [];
      setRequests(nextRequests);
      setTotal(Number(data.total || 0));
      setPage(Number(data.page || nextPage));
      if (nextRequests.length === 0) {
        setSelectedId(null);
      } else if (!selectedId || !nextRequests.some((item) => String(item.id) === String(selectedId))) {
        setSelectedId(nextRequests[0].id);
      }
    } catch (error) {
      toast.error(error?.response?.data?.error || t('adminQuoteRequests.loadListFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRequests(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const handleSearch = (event) => {
    event.preventDefault();
    loadRequests(1);
  };

  const handleRefresh = () => loadRequests(page);

  const handleSave = async () => {
    if (!selectedRequest) return;
    setSaving(true);
    try {
      const { data } = await adminApi.patch(`/quote-requests/admin/${selectedRequest.id}`, draft);
      setRequests((current) => current.map((item) => (
        String(item.id) === String(selectedRequest.id) ? data.request : item
      )));
      // Re-fetch the pane so the draft resyncs from the saved request.
      reloadDetail();
      toast.success(t('adminQuoteRequests.updated'));
    } catch (error) {
      toast.error(error?.response?.data?.error || t('adminQuoteRequests.updateFailed'));
    } finally {
      setSaving(false);
    }
  };

  const goToPage = (nextPage) => {
    const safePage = Math.min(Math.max(nextPage, 1), totalPages);
    loadRequests(safePage);
  };

  const visibleRequest = selectedRequest || detail;

  return (
    <div className="flex min-h-[calc(100vh-64px)] flex-col gap-4 bg-gray-950 p-4 text-white xl:h-[calc(100vh-64px)] xl:overflow-hidden">
      <div className="flex flex-col gap-4 rounded-[28px] border border-gray-800 bg-gray-900/70 p-5 shadow-2xl xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-orange-300">
            <FileText size={15} />
            {t('adminQuoteRequests.inboxLabel')}
          </div>
          <h1 className="mt-2 text-3xl font-semibold">{t('adminQuoteRequests.heading')}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-400">
            {t('adminQuoteRequests.description')}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-3">
            <div className="text-2xl font-semibold text-white">{total}</div>
            <div className="mt-1 text-xs uppercase tracking-[0.16em] text-gray-500">{t('adminQuoteRequests.statTotal')}</div>
          </div>
          <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-3">
            <div className="text-2xl font-semibold text-blue-300">
              {requests.filter((item) => item.status === 'new').length}
            </div>
            <div className="mt-1 text-xs uppercase tracking-[0.16em] text-gray-500">{t('adminQuoteRequests.statNew')}</div>
          </div>
          <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-3">
            <div className="text-2xl font-semibold text-orange-300">
              {requests.filter((item) => ['reviewing', 'quoted', 'contacted'].includes(item.status)).length}
            </div>
            <div className="mt-1 text-xs uppercase tracking-[0.16em] text-gray-500">{t('adminQuoteRequests.statActive')}</div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 xl:min-h-0 xl:flex-row">
        <aside className="flex w-full flex-col rounded-[28px] border border-gray-800 bg-gray-900/70 xl:w-[420px] xl:min-h-0">
          <form onSubmit={handleSearch} className="border-b border-gray-800 p-4">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-3">
                <Search size={16} className="text-gray-500" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t('adminQuoteRequests.searchPlaceholder')}
                  className="w-full bg-transparent text-sm text-white outline-none placeholder:text-gray-600"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="rounded-xl border border-gray-800 bg-gray-950/70 px-3 py-2 text-sm text-white outline-none"
                >
                  <option value="">{t('adminQuoteRequests.allStatuses')}</option>
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <button type="submit" className="rounded-xl border border-gray-800 bg-gray-950/70 px-3 py-2 text-sm text-gray-200 transition hover:border-orange-500/40 hover:text-white">
                  {t('common.search')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setPage(1);
                    if (statusFilter) {
                      // The statusFilter effect below fires the list reload.
                      setStatusFilter('');
                    } else {
                      // Filter already clear, so no effect fires: load once with
                      // the cleared search instead of firing a duplicate request.
                      loadRequests(1, { search: '' });
                    }
                  }}
                  className="rounded-xl border border-gray-800 bg-gray-950/70 px-3 py-2 text-sm text-gray-200 transition hover:border-gray-700 hover:text-white"
                >
                  {t('adminQuoteRequests.clear')}
                </button>
                <button
                  type="button"
                  onClick={handleRefresh}
                  className="inline-flex items-center gap-2 rounded-xl border border-gray-800 bg-gray-950/70 px-3 py-2 text-sm text-gray-200 transition hover:border-gray-700 hover:text-white"
                >
                  <RefreshCw size={14} />
                  {t('adminQuoteRequests.refresh')}
                </button>
              </div>
            </div>
          </form>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-sm text-gray-500">{t('adminQuoteRequests.loadingList')}</div>
            ) : requests.length === 0 ? (
              <div className="flex h-full items-center justify-center py-16 text-center text-sm text-gray-500">
                {t('adminQuoteRequests.noResults')}
              </div>
            ) : (
              <div className="space-y-2">
                {requests.map((request) => (
                  <button
                    key={request.id}
                    onClick={() => setSelectedId(request.id)}
                    className={`w-full rounded-2xl border p-4 text-left transition ${
                      String(selectedRequest?.id) === String(request.id)
                        ? 'border-orange-500/50 bg-orange-500/10'
                        : 'border-gray-800 bg-gray-950/40 hover:border-gray-700 hover:bg-gray-950/70'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-white">
                            {request.first_name} {request.last_name}
                          </span>
                          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGES[request.status] || STATUS_BADGES.new}`}>
                            {STATUS_KEY_SUFFIX[request.status] ? t(`adminQuoteRequests.status${STATUS_KEY_SUFFIX[request.status]}`) : request.status}
                          </span>
                        </div>
                        <div className="mt-1 truncate text-xs text-gray-500">{request.email}</div>
                        <div className="mt-1 truncate text-xs text-gray-500">{request.service_category} · {request.service_location}</div>
                      </div>
                      <div className="text-right text-[11px] text-gray-500">
                        #{request.id}
                        <div className="mt-1">{formatDate(request.created_at)}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-gray-800 p-4 text-sm text-gray-400">
            <button
              type="button"
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1}
              className="rounded-xl border border-gray-800 bg-gray-950/70 px-3 py-2 disabled:opacity-40"
            >
              {t('adminQuoteRequests.previous')}
            </button>
            <span>{t('adminQuoteRequests.pageOf', { page, total: totalPages })}</span>
            <button
              type="button"
              onClick={() => goToPage(page + 1)}
              disabled={page >= totalPages}
              className="rounded-xl border border-gray-800 bg-gray-950/70 px-3 py-2 disabled:opacity-40"
            >
              {t('adminQuoteRequests.next')}
            </button>
          </div>
        </aside>

        <main className="min-h-0 flex-1 rounded-[28px] border border-gray-800 bg-gray-900/70 p-5">
          {!visibleRequest ? (
            <div className="flex h-full items-center justify-center text-sm text-gray-500">
              {t('adminQuoteRequests.pickRequest')}
            </div>
          ) : detailLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-gray-500">
              {t('adminQuoteRequests.loadingRequest')}
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col gap-5">
              <div className="flex flex-col gap-4 border-b border-gray-800 pb-4 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium text-orange-300">
                    <User size={15} />
                    {t('adminQuoteRequests.quoteNumber', { id: selectedRequest.id })}
                  </div>
                  <h2 className="mt-2 text-2xl font-semibold text-white">
                    {selectedRequest.first_name} {selectedRequest.last_name}
                  </h2>
                  <p className="mt-2 text-sm text-gray-400">
                    {selectedRequest.company_name || t('adminQuoteRequests.noCompany')}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-3 py-1.5 text-xs font-medium ${STATUS_BADGES[selectedRequest.status] || STATUS_BADGES.new}`}>
                    {STATUS_KEY_SUFFIX[selectedRequest.status] ? t(`adminQuoteRequests.status${STATUS_KEY_SUFFIX[selectedRequest.status]}`) : selectedRequest.status}
                  </span>
                  <div className="rounded-full border border-gray-800 bg-gray-950/70 px-3 py-1.5 text-xs text-gray-400">
                    {t('adminQuoteRequests.updatedAt', { date: formatDate(selectedRequest.updated_at) })}
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <FieldCard icon={Mail} label={t('adminQuoteRequests.fieldEmail')} value={selectedRequest.email} href={`mailto:${selectedRequest.email}`} />
                <FieldCard icon={Phone} label={t('adminQuoteRequests.fieldPhone')} value={selectedRequest.phone} href={selectedRequest.phone ? `tel:${selectedRequest.phone}` : undefined} />
                <FieldCard icon={Tag} label={t('adminQuoteRequests.fieldCategory')} value={selectedRequest.service_category} />
                <FieldCard icon={MapPin} label={t('adminQuoteRequests.fieldLocation')} value={selectedRequest.service_location} />
                <FieldCard icon={CalendarDays} label={t('adminQuoteRequests.fieldBudget')} value={`${selectedRequest.budget_range || t('adminQuoteRequests.noBudget')} · ${selectedRequest.timeline || t('adminQuoteRequests.noTimeline')}`} />
                <FieldCard icon={MessageSquare} label={t('adminQuoteRequests.fieldContact')} value={selectedRequest.preferred_contact_method} />
              </div>

              <div className="grid min-h-0 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                <section className="min-h-0 rounded-2xl border border-gray-800 bg-gray-950/60 p-4">
                  <h3 className="text-sm font-semibold text-white">{t('adminQuoteRequests.requestDetails')}</h3>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-gray-300">
                    {selectedRequest.details}
                  </p>
                </section>

                <section className="min-h-0 rounded-2xl border border-gray-800 bg-gray-950/60 p-4">
                  <h3 className="text-sm font-semibold text-white">{t('adminQuoteRequests.adminActions')}</h3>
                  <div className="mt-4 grid gap-3">
                    <label className="grid gap-2 text-sm">
                      <span className="text-gray-400">{t('adminQuoteRequests.statusLabel')}</span>
                      <select
                        value={draft.status}
                        onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))}
                        className="rounded-xl border border-gray-800 bg-gray-950/70 px-3 py-2 text-white outline-none"
                      >
                        {STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>

                    <label className="grid gap-2 text-sm">
                      <span className="text-gray-400">{t('adminQuoteRequests.internalNotes')}</span>
                      <textarea
                        value={draft.admin_notes}
                        onChange={(event) => setDraft((current) => ({ ...current, admin_notes: event.target.value }))}
                        rows={10}
                        className="rounded-xl border border-gray-800 bg-gray-950/70 px-3 py-2 text-sm text-white outline-none"
                        placeholder={t('adminQuoteRequests.notesPlaceholder')}
                      />
                    </label>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving}
                        className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-orange-600 disabled:opacity-50"
                      >
                        {saving ? t('adminQuoteRequests.saving') : t('adminQuoteRequests.saveChanges')}
                      </button>
                      <a
                        href={`mailto:${selectedRequest.email}?subject=Re%3A%20OxSteed%20quote%20request%20%23${selectedRequest.id}`}
                        className="inline-flex items-center gap-2 rounded-xl border border-gray-800 bg-gray-950/70 px-4 py-2 text-sm text-gray-200 transition hover:border-gray-700 hover:text-white"
                      >
                        <ExternalLink size={14} />
                        {t('adminQuoteRequests.emailRequester')}
                      </a>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
