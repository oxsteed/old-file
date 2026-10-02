import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Activity, AlertCircle, BookOpen, ExternalLink, Gauge, Loader2,
  Pencil, Plus, ShieldAlert, Trash2, X,
} from 'lucide-react';
import adminApi from '../../../lib/adminApi';
import { adminRoute } from '../../../adminRouteManifest';
import { useAbortableFetch } from '../../../lib/useAbortableFetch';
import AdminErrorState from '../../../lib/AdminErrorState';
import { adminDate } from '../../../lib/formatters';
import useDestructiveConfirm from '../../../hooks/useDestructiveConfirm';

// M3 — Service Operations workspace: Capacity, Safety, Runbooks tabs plus a
// Links card into the authoritative dispatch/incident modules. This page
// extends those modules; it never duplicates their workflows.

const CATEGORIES = ['incident', 'deployment', 'safety', 'vendor', 'compliance'];
const WINDOW_OPTIONS = [7, 14, 30, 60, 90];

const CATEGORY_TONES = {
  incident: 'bg-red-900 text-red-300',
  deployment: 'bg-blue-900 text-blue-300',
  safety: 'bg-amber-900 text-amber-300',
  vendor: 'bg-purple-900 text-purple-300',
  compliance: 'bg-green-900 text-green-300',
};

function ts(d) {
  if (!d) return '-';
  return adminDate(d, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function TabButton({ id, label, icon: Icon, active, onClick }) {
  return (
    <button
      type="button"
      onClick={() => onClick(id)}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium border ${
        active
          ? 'bg-blue-600 border-blue-500 text-white'
          : 'bg-gray-900/40 border-gray-700/70 text-gray-300 hover:text-white hover:border-gray-600'
      }`}
    >
      <Icon size={15} />
      {label}
    </button>
  );
}

function Metric({ label, value, tone = 'text-white' }) {
  return (
    <div className="rounded-lg border border-gray-700/70 bg-gray-900/40 px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone}`}>{value ?? '-'}</div>
    </div>
  );
}

function SectionTitle({ children }) {
  return <h3 className="text-sm font-semibold text-white">{children}</h3>;
}

// ── Capacity tab ────────────────────────────────────────────────────────────

function CapacityTab({ t }) {
  const [days, setDays] = useState(30);
  const { data, loading, error, reload } = useAbortableFetch(async (signal) => {
    const { data: payload } = await adminApi.get('/service-ops/capacity', { params: { days }, signal });
    return payload;
  }, [days]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-400">
        <Loader2 size={20} className="animate-spin mr-2" />
      </div>
    );
  }
  if (error) return <AdminErrorState message={error?.message} onRetry={reload} />;

  const totals = data?.totals || {};
  const regions = data?.regions || [];
  const byStatus = data?.by_status || [];
  const byDay = data?.by_day || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <label htmlFor="capacity-window" className="text-sm text-gray-400">
          {t('wsServiceOps.capacityWindow', 'Window')}
        </label>
        <select
          id="capacity-window"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-md bg-gray-900 border border-gray-700 text-sm text-white px-3 py-1.5"
        >
          {WINDOW_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {t('wsServiceOps.windowDays', 'Last {{count}} days', { count: d })}
            </option>
          ))}
        </select>
        {data?.source && (
          <span className="text-xs text-gray-500">
            {t('wsServiceOps.sourceNote', 'Source: {{source}}', { source: data.source })}
          </span>
        )}
      </div>

      {data?.available === false ? (
        <AdminErrorState
          title={t('wsServiceOps.noCapacityData', 'No demand data')}
          message={t('wsServiceOps.notConfigured', 'No demand table is configured in this environment.')}
        />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Metric label={t('wsServiceOps.totalBookings', 'Total')} value={totals.bookings_total} />
            <Metric label={t('wsServiceOps.activeBookings', 'Active')} value={totals.bookings_active} tone="text-green-400" />
            <Metric label={t('wsServiceOps.completedBookings', 'Completed')} value={totals.bookings_completed} tone="text-blue-400" />
          </div>

          {data?.attribution_note && (
            <div className="flex gap-2 rounded-lg border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{data.attribution_note}</span>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-lg border border-gray-700/70 bg-gray-900/40 p-4">
              <SectionTitle>{t('wsServiceOps.byRegion', 'Load by region')}</SectionTitle>
              {regions.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">
                  {t('wsServiceOps.noRegions', 'No region attribution is available for demand records, so no regional breakdown is shown.')}
                </p>
              ) : (
                <table className="mt-2 w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                      <th className="py-1 pr-2">{t('wsServiceOps.colRegion', 'Region')}</th>
                      <th className="py-1 pr-2 text-right">{t('wsServiceOps.totalBookings', 'Total')}</th>
                      <th className="py-1 pr-2 text-right">{t('wsServiceOps.activeBookings', 'Active')}</th>
                      <th className="py-1 text-right">{t('wsServiceOps.completedBookings', 'Completed')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {regions.map((r) => (
                      <tr key={r.region} className="border-t border-gray-800 text-gray-300">
                        <td className="py-1.5 pr-2 text-white">{r.region}</td>
                        <td className="py-1.5 pr-2 text-right">{r.bookings_total}</td>
                        <td className="py-1.5 pr-2 text-right text-green-400">{r.bookings_active}</td>
                        <td className="py-1.5 text-right text-blue-400">{r.bookings_completed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="rounded-lg border border-gray-700/70 bg-gray-900/40 p-4">
              <SectionTitle>{t('wsServiceOps.byStatus', 'Load by status')}</SectionTitle>
              {byStatus.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">{t('wsServiceOps.noCapacityData', 'No demand data in this window.')}</p>
              ) : (
                <table className="mt-2 w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                      <th className="py-1 pr-2">{t('wsServiceOps.colStatus', 'Status')}</th>
                      <th className="py-1 text-right">{t('wsServiceOps.colCount', 'Count')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byStatus.map((s) => (
                      <tr key={s.status} className="border-t border-gray-800 text-gray-300">
                        <td className="py-1.5 pr-2 capitalize">{String(s.status).replaceAll('_', ' ')}</td>
                        <td className="py-1.5 text-right text-white">{s.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-gray-700/70 bg-gray-900/40 p-4">
            <SectionTitle>{t('wsServiceOps.byDay', 'Daily volume')}</SectionTitle>
            {byDay.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">{t('wsServiceOps.noCapacityData', 'No demand data in this window.')}</p>
            ) : (
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="py-1 pr-2">{t('wsServiceOps.colDay', 'Day')}</th>
                    <th className="py-1 text-right">{t('wsServiceOps.colCount', 'Count')}</th>
                  </tr>
                </thead>
                <tbody>
                  {byDay.map((d) => (
                    <tr key={d.day} className="border-t border-gray-800 text-gray-300">
                      <td className="py-1.5 pr-2 text-white">{d.day}</td>
                      <td className="py-1.5 text-right text-white">{d.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Safety tab (existing admin SOS endpoint, no new API) ─────────────────────

function SafetyTab({ t }) {
  const { data, loading, error, reload } = useAbortableFetch(async (signal) => {
    const { data: payload } = await adminApi.get('/safety/sos', { signal });
    return payload?.events || [];
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-400">
        <Loader2 size={20} className="animate-spin mr-2" />
      </div>
    );
  }

  const forbidden = error && (error?.response?.status === 403 || error?.status === 403);
  if (forbidden) {
    return (
      <div className="rounded-lg border border-amber-900/60 bg-amber-950/30 p-6 text-center">
        <ShieldAlert size={28} className="mx-auto text-amber-400" />
        <p className="mt-2 text-sm text-amber-200">
          {t('wsServiceOps.safetyGrantNote', 'The SOS list requires the support grant (manage_support). Your account does not have it, so this tab is unavailable.')}
        </p>
      </div>
    );
  }
  if (error) return <AdminErrorState message={error?.message} onRetry={reload} />;

  const events = data || [];
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-400">
        {t('wsServiceOps.safetySubtitle', 'Emergency SOS events raised by users, newest first. Showing the latest 100.')}
      </p>
      {events.length === 0 ? (
        <p className="text-sm text-gray-500">{t('wsServiceOps.noSosEvents', 'No SOS events recorded.')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-700/70">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-900/60 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2">{t('wsServiceOps.colUser', 'User')}</th>
                <th className="px-3 py-2">{t('wsServiceOps.colContact', 'Emergency contact')}</th>
                <th className="px-3 py-2">{t('wsServiceOps.colLocation', 'Location')}</th>
                <th className="px-3 py-2">{t('wsServiceOps.colJob', 'Job')}</th>
                <th className="px-3 py-2">{t('wsServiceOps.colTime', 'Time')}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e, i) => (
                <tr key={e.id || i} className="border-t border-gray-800 text-gray-300">
                  <td className="px-3 py-2">
                    <div className="text-white">{[e.first_name, e.last_name].filter(Boolean).join(' ') || '-'}</div>
                    <div className="text-xs text-gray-500">{e.email || ''}</div>
                  </td>
                  <td className="px-3 py-2">
                    {e.contact_name || e.contact_phone
                      ? `${e.contact_name || ''}${e.contact_phone ? ` (${e.contact_phone})` : ''}`
                      : '-'}
                  </td>
                  <td className="px-3 py-2">
                    {e.lat != null && e.lng != null ? `${e.lat}, ${e.lng}` : '-'}
                  </td>
                  <td className="px-3 py-2">{e.job_id || '-'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{ts(e.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Runbooks tab ────────────────────────────────────────────────────────────

function RunbookFormModal({ t, initial, onClose, onSaved }) {
  const [form, setForm] = useState({
    code: initial?.code || '',
    title: initial?.title || '',
    category: initial?.category || 'incident',
    body: initial?.body || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      if (initial?.id) {
        await adminApi.put(`/service-ops/runbooks/${initial.id}`, {
          title: form.title, category: form.category, body: form.body,
        });
      } else {
        await adminApi.post('/service-ops/runbooks', form);
      }
      onSaved();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl rounded-lg border border-gray-700 bg-gray-900 p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">
            {initial?.id
              ? t('wsServiceOps.editRunbook', 'Edit runbook')
              : t('wsServiceOps.newRunbook', 'New runbook')}
          </h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="mt-3 rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="mt-4 space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="rb-code" className="text-sm text-gray-400">{t('wsServiceOps.fieldCode', 'Code')}</label>
              <input
                id="rb-code"
                value={form.code}
                onChange={set('code')}
                disabled={!!initial?.id}
                placeholder="incident-sev1"
                className="mt-1 w-full rounded-md bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white disabled:opacity-50"
              />
              {!initial?.id && (
                <p className="mt-1 text-xs text-gray-500">
                  {t('wsServiceOps.codeHint', 'Lowercase slug, e.g. incident-sev1.')}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="rb-category" className="text-sm text-gray-400">{t('wsServiceOps.fieldCategory', 'Category')}</label>
              <select
                id="rb-category"
                value={form.category}
                onChange={set('category')}
                className="mt-1 w-full rounded-md bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="rb-title" className="text-sm text-gray-400">{t('wsServiceOps.fieldTitle', 'Title')}</label>
            <input
              id="rb-title"
              value={form.title}
              onChange={set('title')}
              className="mt-1 w-full rounded-md bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label htmlFor="rb-body" className="text-sm text-gray-400">{t('wsServiceOps.fieldBody', 'Body')}</label>
            <textarea
              id="rb-body"
              value={form.body}
              onChange={set('body')}
              rows={10}
              className="mt-1 w-full rounded-md bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white font-mono"
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-md text-sm font-medium text-gray-300 border border-gray-700 hover:text-white"
          >
            {t('wsServiceOps.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50"
          >
            {saving && <Loader2 size={15} className="animate-spin" />}
            {t('wsServiceOps.save', 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function RunbooksTab({ t }) {
  const { confirmDestructive, dialog } = useDestructiveConfirm();
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const { data, loading, error, reload } = useAbortableFetch(async (signal) => {
    const { data: payload } = await adminApi.get('/service-ops/runbooks', { signal });
    return payload?.runbooks || [];
  }, []);

  async function handleDelete(runbook) {
    const confirmed = await confirmDestructive({
      title: t('wsServiceOps.deleteTitle', 'Delete runbook'),
      description: t('wsServiceOps.deleteDesc', 'Archive "{{code}}"? It will be hidden from the active list but kept in history.', { code: runbook.code }),
      confirmLabel: t('wsServiceOps.delete', 'Delete'),
    });
    if (!confirmed) return;
    await adminApi.delete(`/service-ops/runbooks/${runbook.id}`);
    reload();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-400">
        <Loader2 size={20} className="animate-spin mr-2" />
      </div>
    );
  }
  if (error) return <AdminErrorState message={error?.message} onRetry={reload} />;

  const runbooks = data || [];
  return (
    <div className="space-y-4">
      {dialog}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">
          {t('wsServiceOps.runbooksSubtitle', 'Step-by-step procedures for incidents, deployments, safety, vendors, and compliance. Editing a runbook bumps its version.')}
        </p>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-500"
        >
          <Plus size={15} />
          {t('wsServiceOps.newRunbook', 'New runbook')}
        </button>
      </div>

      {runbooks.length === 0 ? (
        <p className="text-sm text-gray-500">{t('wsServiceOps.noRunbooks', 'No runbooks yet. Create the first one.')}</p>
      ) : (
        <div className="space-y-3">
          {runbooks.map((rb) => (
            <div key={rb.id} className="rounded-lg border border-gray-700/70 bg-gray-900/40 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${CATEGORY_TONES[rb.category] || 'bg-gray-800 text-gray-300'}`}>
                      {rb.category}
                    </span>
                    <span className="text-xs text-gray-500 font-mono">{rb.code}</span>
                    <span className="text-xs text-gray-500">
                      {t('wsServiceOps.colVersion', 'Version')} {rb.version}
                    </span>
                  </div>
                  <h4 className="mt-1 text-base font-semibold text-white">{rb.title}</h4>
                  <p className="mt-1 text-xs text-gray-500">
                    {t('wsServiceOps.colUpdated', 'Updated')} {ts(rb.updated_at)}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setEditing(rb)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium text-gray-300 border border-gray-700 hover:text-white"
                  >
                    <Pencil size={13} />
                    {t('wsServiceOps.edit', 'Edit')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(rb)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium text-red-300 border border-red-900/60 hover:bg-red-950/40"
                  >
                    <Trash2 size={13} />
                    {t('wsServiceOps.delete', 'Delete')}
                  </button>
                </div>
              </div>
              <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-gray-950/60 border border-gray-800 p-3 text-xs text-gray-300 font-mono">
                {rb.body}
              </pre>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <RunbookFormModal
          t={t}
          initial={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); reload(); }}
        />
      )}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function ServiceOpsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('capacity');

  const tabs = [
    { id: 'capacity', label: t('wsServiceOps.tabCapacity', 'Capacity'), icon: Gauge },
    { id: 'safety', label: t('wsServiceOps.tabSafety', 'Safety'), icon: ShieldAlert },
    { id: 'runbooks', label: t('wsServiceOps.tabRunbooks', 'Runbooks'), icon: BookOpen },
  ];

  const links = [
    {
      to: adminRoute('operations').path,
      label: t('wsServiceOps.linkDispatch', 'Dispatch overview'),
      desc: t('wsServiceOps.linkDispatchDesc', 'Live operational sections with correlation IDs.'),
    },
    {
      to: adminRoute('incidents').path,
      label: t('wsServiceOps.linkIncidents', 'Incident management'),
      desc: t('wsServiceOps.linkIncidentsDesc', 'Acknowledge and resolve platform incidents.'),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white flex items-center gap-2">
          <Activity size={20} />
          {t('wsServiceOps.title', 'Service Operations')}
        </h1>
        <p className="mt-1 text-sm text-gray-400">
          {t('wsServiceOps.subtitle', 'Capacity, safety, and runbooks in one workspace.')}
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {tabs.map(({ id, label, icon }) => (
          <TabButton key={id} id={id} label={label} icon={icon} active={tab === id} onClick={setTab} />
        ))}
      </div>

      {tab === 'capacity' && <CapacityTab t={t} />}
      {tab === 'safety' && <SafetyTab t={t} />}
      {tab === 'runbooks' && <RunbooksTab t={t} />}

      <div className="rounded-lg border border-gray-700/70 bg-gray-900/40 p-4">
        <h3 className="text-sm font-semibold text-white">{t('wsServiceOps.linksTitle', 'Linked workspaces')}</h3>
        <p className="mt-1 text-xs text-gray-500">
          {t('wsServiceOps.linksSubtitle', 'Deep links into the authoritative modules. This page extends them, it does not replace them.')}
        </p>
        <div className="mt-3 grid md:grid-cols-2 gap-3">
          {links.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="flex items-center justify-between rounded-md border border-gray-700/70 bg-gray-950/40 px-4 py-3 hover:border-gray-600"
            >
              <div>
                <div className="text-sm font-medium text-white">{link.label}</div>
                <div className="text-xs text-gray-500">{link.desc}</div>
              </div>
              <ExternalLink size={16} className="text-gray-500 shrink-0" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
