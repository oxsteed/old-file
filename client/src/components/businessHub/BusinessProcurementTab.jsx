import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import {
  listSourcingRequests,
  listRecurringPrograms,
  createRecurringProgram,
  updateRecurringProgramStatus,
  listLanes,
} from '../../api/logistics';

const CADENCE_OPTIONS = ['weekly', 'biweekly', 'monthly', 'quarterly', 'custom'];

const STATUS_COLOR = {
  active:   '#22c55e',
  paused:   '#f59e0b',
  draft:    '#64748b',
  archived: '#475569',
};

/**
 * BusinessProcurementTab
 * Embedded version of BusinessProcurementPage scoped to a single businessId.
 * Rendered inside BusinessHubComplete — no PageShell or workspace switcher needed.
 */
export function BusinessProcurementTab({ businessId }) {
  const { t, i18n } = useTranslation();
  const [requests,  setRequests]  = useState([]);
  const [programs,  setPrograms]  = useState([]);
  const [lanes,     setLanes]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [showForm,  setShowForm]  = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [form, setForm] = useState({
    title: '',
    category: '',
    cadence: 'monthly',
    lane_id: '',
    target_qty: '',
    target_unit: 'unit',
    destination_country: '',
    destination_city: '',
    budget_max_usd: '',
    next_run_date: '',
    notes: '',
    sourcing_request_id: '',
  });

  const load = () => {
    setLoading(true);
    Promise.all([
      listSourcingRequests({ business_id: businessId, limit: 50 }),
      listRecurringPrograms({ business_id: businessId }),
      listLanes(),
    ])
      .then(([reqRes, progRes, laneRes]) => {
        setRequests(reqRes.requests || []);
        setPrograms(progRes.data || []);
        setLanes(laneRes.data || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [businessId]);

  const activePrograms  = programs.filter(p => p.status === 'active').length;
  const upcomingRuns    = programs.filter(p => {
    if (!p.next_run_date) return false;
    const d = new Date(p.next_run_date);
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 21);
    return d >= new Date() && d <= horizon;
  }).length;
  const linkedRequests = useMemo(
    () => requests.filter(r => r.business_id === businessId || r.business_id === Number(businessId)),
    [requests, businessId],
  );

  const createProgramFromForm = async () => {
    if (!form.title) { toast.error(t('businessHub.procurement.titleRequired')); return; }
    setSaving(true);
    try {
      await createRecurringProgram({
        ...form,
        business_id:           businessId,
        lane_id:               form.lane_id            || null,
        target_qty:            form.target_qty         || null,
        budget_max_usd:        form.budget_max_usd     || null,
        sourcing_request_id:   form.sourcing_request_id || null,
        status: 'active',
      });
      toast.success(t('businessHub.procurement.programCreated'));
      setShowForm(false);
      setForm({
        title: '', category: '', cadence: 'monthly', lane_id: '', target_qty: '',
        target_unit: 'unit', destination_country: '', destination_city: '',
        budget_max_usd: '', next_run_date: '', notes: '', sourcing_request_id: '',
      });
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleProgram = async (program) => {
    const next = program.status === 'active' ? 'paused' : 'active';
    try {
      await updateRecurringProgramStatus(program.id, next);
      toast.success(t('businessHub.procurement.programStatusChanged', { status: t(`businessHub.procurement.statuses.${next}`) }));
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
        {t('businessHub.procurement.loading')}
      </div>
    );
  }

  return (
    <div style={{ padding: '0.5rem 0' }}>

      {/* ── Top bar ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700 }}>{t('businessHub.procurement.title')}</h2>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem', color: '#64748b' }}>
            {t('businessHub.procurement.subtitle')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.625rem', flexWrap: 'wrap' }}>
          <button
            onClick={() => setShowForm(s => !s)}
            style={{
              padding: '0.5rem 1rem', borderRadius: '0.5rem', border: 'none',
              background: '#f97316', color: '#fff', fontWeight: 600, fontSize: '0.8125rem', cursor: 'pointer',
            }}
          >
            {showForm ? t('common.close') : `+ ${t('businessHub.procurement.newProgram')}`}
          </button>
          <Link
            to={`/logistics/requests/new?business_id=${businessId}`}
            style={{
              padding: '0.5rem 1rem', borderRadius: '0.5rem',
              border: '1px solid rgba(249,115,22,.35)', color: '#f97316',
              fontWeight: 600, fontSize: '0.8125rem', textDecoration: 'none',
            }}
          >
            {t('businessHub.procurement.newSourcingRequest')}
          </Link>
          <Link
            to="/logistics/procurement"
            style={{
              padding: '0.5rem 1rem', borderRadius: '0.5rem',
              border: '1px solid #334155', color: '#94a3b8',
              fontWeight: 500, fontSize: '0.8125rem', textDecoration: 'none',
            }}
          >
            {t('businessHub.procurement.fullPortal')} ↗
          </Link>
        </div>
      </div>

      {/* ── Stats row ───────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: '1.5rem' }}>
        {[
          { label: t('businessHub.procurement.activePrograms'), value: activePrograms },
          { label: t('businessHub.procurement.upcomingRuns'), value: upcomingRuns },
          { label: t('businessHub.procurement.businessRequests'), value: linkedRequests.length },
        ].map(({ label, value }) => (
          <div
            key={label}
            style={{
              background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)',
              borderRadius: '0.75rem', padding: '0.875rem 1rem',
            }}
          >
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#f97316' }}>{value}</div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.125rem' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* ── Create program form ─────────────────────────────────── */}
      {showForm && (
        <div style={{
          background: 'rgba(249,115,22,.04)', border: '1.5px solid rgba(249,115,22,.25)',
          borderRadius: '0.875rem', padding: '1.25rem', marginBottom: '1.5rem',
        }}>
          <h3 style={{ margin: '0 0 1rem', fontSize: '0.9375rem', fontWeight: 700 }}>
            {t('businessHub.procurement.plannerTitle')}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.875rem' }}>
            {[
              { label: t('businessHub.procurement.programTitle'), key: 'title', type: 'text' },
              { label: t('businessHub.procurement.category'), key: 'category', type: 'text' },
              { label: t('businessHub.procurement.targetQuantity'), key: 'target_qty', type: 'number' },
              { label: t('businessHub.procurement.unit'), key: 'target_unit', type: 'text' },
              { label: t('businessHub.procurement.destinationCountry'), key: 'destination_country', type: 'text' },
              { label: t('businessHub.procurement.destinationCity'), key: 'destination_city', type: 'text' },
              { label: t('businessHub.procurement.budgetMax'), key: 'budget_max_usd', type: 'number' },
              { label: t('businessHub.procurement.nextRunDate'), key: 'next_run_date', type: 'date' },
            ].map(({ label, key, type }) => (
              <div key={key}>
                <label style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.375rem' }}>{label}</label>
                <input
                  type={type}
                  value={form[key]}
                  maxLength={key === 'destination_country' ? 2 : undefined}
                  onChange={e => setForm(f => ({ ...f, [key]: key === 'destination_country' ? e.target.value.toUpperCase() : e.target.value }))}
                  style={{
                    width: '100%', padding: '0.5rem 0.75rem', borderRadius: '0.5rem',
                    border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0',
                    fontSize: '0.875rem', boxSizing: 'border-box',
                  }}
                />
              </div>
            ))}
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.375rem' }}>{t('businessHub.procurement.cadence')}</label>
              <select
                value={form.cadence}
                onChange={e => setForm(f => ({ ...f, cadence: e.target.value }))}
                style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '0.5rem', border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', fontSize: '0.875rem' }}
              >
                {CADENCE_OPTIONS.map(o => <option key={o} value={o}>{t(`businessHub.procurement.cadences.${o}`)}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.375rem' }}>{t('businessHub.procurement.preferredLane')}</label>
              <select
                value={form.lane_id}
                onChange={e => setForm(f => ({ ...f, lane_id: e.target.value }))}
                style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '0.5rem', border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', fontSize: '0.875rem' }}
              >
                <option value="">{t('businessHub.procurement.anyLane')}</option>
                {lanes.map(l => (
                  <option key={l.id} value={l.id}>{l.name} ({l.origin_country} → {l.destination_country})</option>
                ))}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.375rem' }}>{t('businessHub.procurement.linkRequest')}</label>
              <select
                value={form.sourcing_request_id}
                onChange={e => setForm(f => ({ ...f, sourcing_request_id: e.target.value }))}
                style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '0.5rem', border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', fontSize: '0.875rem' }}
              >
                <option value="">{t('businessHub.procurement.noLinkedRequest')}</option>
                {linkedRequests.map(r => (
                  <option key={r.id} value={r.id}>{r.reference} · {r.title}</option>
                ))}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.375rem' }}>{t('businessHub.procurement.notes')}</label>
              <textarea
                rows={2}
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                style={{
                  width: '100%', padding: '0.5rem 0.75rem', borderRadius: '0.5rem',
                  border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0',
                  fontSize: '0.875rem', resize: 'vertical', boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.625rem', marginTop: '1rem' }}>
            <button
              onClick={createProgramFromForm}
              disabled={saving}
              style={{
                padding: '0.5rem 1.25rem', borderRadius: '0.5rem', border: 'none',
                background: '#f97316', color: '#fff', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer',
              }}
            >
              {saving ? t('common.saving') : t('businessHub.procurement.createProgram')}
            </button>
            <button
              onClick={() => setShowForm(false)}
              style={{
                padding: '0.5rem 1.25rem', borderRadius: '0.5rem',
                border: '1px solid #334155', background: 'transparent', color: '#94a3b8',
                fontWeight: 500, fontSize: '0.875rem', cursor: 'pointer',
              }}
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* ── Recurring programs table ────────────────────────────── */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600 }}>{t('businessHub.procurement.recurringPrograms')}</h3>
          <Link to="/logistics/procurement" style={{ fontSize: '0.8125rem', color: '#f97316', textDecoration: 'none' }}>
            {t('businessHub.procurement.seeAll')} ↗
          </Link>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,.07)' }}>
                {[t('businessHub.procurement.program'), t('businessHub.procurement.cadence'), t('businessHub.procurement.nextRun'), t('businessHub.procurement.status'), ''].map(h => (
                  <th key={h} style={{ padding: '0.5rem 0.625rem', textAlign: 'left', color: '#64748b', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {programs.map(p => (
                <tr key={p.id} style={{ borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                  <td style={{ padding: '0.625rem 0.625rem' }}>
                    <div style={{ fontWeight: 600, color: '#e2e8f0' }}>{p.title}</div>
                    {p.category && <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{p.category}</div>}
                  </td>
                  <td style={{ padding: '0.625rem 0.625rem', color: '#94a3b8' }}>{p.cadence}</td>
                  <td style={{ padding: '0.625rem 0.625rem', color: '#94a3b8' }}>
                    {p.next_run_date ? new Date(p.next_run_date).toLocaleDateString(i18n.resolvedLanguage) : '—'}
                  </td>
                  <td style={{ padding: '0.625rem 0.625rem' }}>
                    <span style={{
                      display: 'inline-block', padding: '0.125rem 0.5rem', borderRadius: '9999px',
                      fontSize: '0.7rem', fontWeight: 600, background: STATUS_COLOR[p.status] || '#64748b', color: '#fff',
                    }}>
                      {t(`businessHub.procurement.statuses.${p.status}`, p.status)}
                    </span>
                  </td>
                  <td style={{ padding: '0.625rem 0.625rem' }}>
                    <button
                      onClick={() => toggleProgram(p)}
                      style={{
                        padding: '0.2rem 0.625rem', borderRadius: '0.375rem',
                        border: '1px solid #334155', background: 'transparent',
                        color: '#94a3b8', fontSize: '0.72rem', cursor: 'pointer',
                      }}
                    >
                      {p.status === 'active' ? t('businessHub.procurement.pause') : t('businessHub.procurement.activate')}
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && programs.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: '1.5rem', textAlign: 'center', color: '#64748b' }}>
                    {t('businessHub.procurement.noPrograms')}{' '}
                    <button
                      onClick={() => setShowForm(true)}
                      style={{ background: 'none', border: 'none', color: '#f97316', cursor: 'pointer', textDecoration: 'underline', fontSize: 'inherit' }}
                    >
                      {t('businessHub.procurement.createOne')}
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Business-linked sourcing requests ───────────────────── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600 }}>{t('businessHub.procurement.sourcingRequests')}</h3>
          <Link
            to={`/logistics/requests/new?business_id=${businessId}`}
            style={{ fontSize: '0.8125rem', color: '#f97316', textDecoration: 'none' }}
          >
            + {t('businessHub.procurement.newRequest')}
          </Link>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,.07)' }}>
                {[t('businessHub.procurement.reference'), t('businessHub.procurement.programTitle'), t('businessHub.procurement.status'), t('businessHub.procurement.convertedTo')].map(h => (
                  <th key={h} style={{ padding: '0.5rem 0.625rem', textAlign: 'left', color: '#64748b', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linkedRequests.slice(0, 10).map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                  <td style={{ padding: '0.625rem 0.625rem' }}>
                    <Link to={`/logistics/requests/${r.id}`} style={{ color: '#f97316', textDecoration: 'none', fontWeight: 600 }}>
                      {r.reference}
                    </Link>
                  </td>
                  <td style={{ padding: '0.625rem 0.625rem', color: '#e2e8f0' }}>{r.title}</td>
                  <td style={{ padding: '0.625rem 0.625rem' }}>
                    <span style={{
                      display: 'inline-block', padding: '0.125rem 0.5rem', borderRadius: '9999px',
                      fontSize: '0.7rem', fontWeight: 600, background: '#64748b', color: '#fff',
                    }}>
                      {t(`businessHub.procurement.statuses.${r.status}`, r.status)}
                    </span>
                  </td>
                  <td style={{ padding: '0.625rem 0.625rem', color: '#94a3b8' }}>{r.converted_to || '—'}</td>
                </tr>
              ))}
              {!loading && linkedRequests.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: '1.5rem', textAlign: 'center', color: '#64748b' }}>
                    {t('businessHub.procurement.noRequests')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
