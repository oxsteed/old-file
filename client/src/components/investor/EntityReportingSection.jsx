import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import api from '../../api/axios';

// Slice 5f, item 726 (D-769): the entity summary for the investor
// reporting dashboard. One card per entity in the viewer's audience
// scope: the business identity, its live/total raises, and the viewer's
// own live stakes in it. A position holder sees exactly their audience
// entities; an admin sees the platform-wide list, labeled as such.
// The section is best-effort like the rest of the dashboard: a load
// failure shows a line, never a page error.
//
// Item 727 (D-770) lives in the same section: the authorized dataset
// list, so a holder can tell a withheld dataset from a broken one.

const BUSINESS_TYPES = ['llc', 'sole_prop', 'corp', 'partnership'];

// 730 (D-773): the reporting contact for one entity card, loaded on
// demand so the section does not fire one request per card on load.
// The contact names a person for entity questions (the business owner)
// and, for holders, the admin who granted the audience (for audience
// and dataset questions). No email is shown, and the messages link opens
// the inbox — there is no deep link to a thread with this person, so the
// card never promises one.
function EntityContact({ entityId }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [contact, setContact] = useState({ status: 'idle', data: null });

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (contact.status !== 'idle') return;
    setContact({ status: 'loading', data: null });
    api.get(`/investor/reporting/entities/${entityId}/contact`)
      .then(({ data }) => setContact({ status: 'ready', data }))
      .catch(() => setContact({ status: 'error', data: null }));
  };

  return (
    <div className="mt-3">
      <button type="button" onClick={toggle} className="text-xs text-emerald-300 hover:text-emerald-200" data-track="ui.064018e3ca.1">
        {open ? t('investorDashboard.entityReporting.contact.hide') : t('investorDashboard.entityReporting.contact.show')}
      </button>
      {open && contact.status === 'loading' && <p role="status" className="text-xs text-gray-500 mt-1">{t('investorDashboard.entityReporting.contact.loading')}</p>}
      {open && contact.status === 'error' && <p role="alert" className="text-xs text-red-400 mt-1">{t('investorDashboard.entityReporting.contact.loadError')}</p>}
      {open && contact.status === 'ready' && (
        <ul className="mt-2 space-y-1">
          {(contact.data?.contacts ?? []).map((c) => (
            <li key={c.kind} className="text-xs text-gray-400">
              {c.displayName && <span className="text-gray-200">{c.displayName}</span>}
              {c.displayName && ' — '}
              {t(`investorDashboard.entityReporting.contact.${c.kind === 'business_owner' ? 'ownerRole' : 'adminRole'}`)}
            </li>
          ))}
        </ul>
      )}
      {open && contact.status === 'ready' && (
        <Link to="/messages" className="text-xs text-emerald-300 hover:text-emerald-200 mt-2 inline-block">
          {t('investorDashboard.entityReporting.contact.openMessages')}
        </Link>
      )}
    </div>
  );
}

export default function EntityReportingSection() {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState({ status: 'loading', data: null });
  const [datasetsState, setDatasetsState] = useState({ status: 'loading', data: null });
  const [documentsState, setDocumentsState] = useState({ status: 'loading', data: null });

  useEffect(() => {
    const controller = new AbortController();
    api.get('/investor/reporting/entities', { signal: controller.signal })
      .then(({ data }) => setState({ status: 'ready', data }))
      .catch((err) => {
        if (controller.signal.aborted || err?.name === 'CanceledError') return;
        setState({ status: 'error', data: null });
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api.get('/investor/reporting/datasets', { signal: controller.signal })
      .then(({ data }) => setDatasetsState({ status: 'ready', data }))
      .catch((err) => {
        if (controller.signal.aborted || err?.name === 'CanceledError') return;
        setDatasetsState({ status: 'error', data: null });
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api.get('/investor/reporting/documents', { signal: controller.signal })
      .then(({ data }) => setDocumentsState({ status: 'ready', data }))
      .catch((err) => {
        if (controller.signal.aborted || err?.name === 'CanceledError') return;
        setDocumentsState({ status: 'error', data: null });
      });
    return () => controller.abort();
  }, []);

  const count = (n) => new Intl.NumberFormat(i18n.language).format(Number(n ?? 0));
  const date = (v) => (v ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(v)) : null);
  const data = state.data;
  const entities = data?.entities ?? [];
  const audience = data?.audience ?? null;
  const platformWide = data?.scope?.type === 'platform_wide';

  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900 p-5" aria-labelledby="entity-reporting-title">
      <div className="flex items-center justify-between mb-2">
        <h2 id="entity-reporting-title" className="font-semibold text-sm text-gray-200">{t('investorDashboard.entityReporting.title')}</h2>
        <Building2 size={15} className="text-gray-500" aria-hidden="true" />
      </div>
      <p className="text-xs text-gray-500 mb-3">{t('investorDashboard.entityReporting.help')}</p>
      {platformWide && (
        <p className="text-xs text-gray-400 mb-3">{t('investorDashboard.scope.platformWide')}</p>
      )}
      {audience && (
        <p className="text-xs text-gray-400 mb-3">
          {t('investorDashboard.entityReporting.audienceKey', { key: audience.key || '—' })}
          {' · '}
          {audience.expiresAt
            ? t('investorDashboard.entityReporting.audienceExpires', { date: date(audience.expiresAt) })
            : t('investorDashboard.entityReporting.audienceNoExpiry')}
        </p>
      )}
      {state.status === 'loading' && <p role="status" className="text-xs text-gray-500">{t('investorDashboard.entityReporting.loading')}</p>}
      {state.status === 'error' && <p role="alert" className="text-xs text-red-400">{t('investorDashboard.entityReporting.loadError')}</p>}
      {state.status === 'ready' && entities.length === 0 && (
        <p className="text-xs text-gray-500">{t('investorDashboard.entityReporting.empty')}</p>
      )}
      {state.status === 'ready' && entities.length > 0 && (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {entities.map((entity) => (
            <li key={entity.entityId} className="rounded-xl bg-gray-800/50 border border-gray-800 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-white">{entity.businessName}</p>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${entity.isActive ? 'bg-emerald-500/15 text-emerald-300' : 'bg-gray-700 text-gray-400'}`}>
                  {entity.isActive ? t('investorDashboard.entityReporting.active') : t('investorDashboard.entityReporting.inactive')}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                {entity.businessType && BUSINESS_TYPES.includes(entity.businessType)
                  ? t(`investorDashboard.entityReporting.types.${entity.businessType}`)
                  : t('investorDashboard.entityReporting.types.unknown')}
              </p>
              <p className="text-xs text-gray-400 mt-2">
                {t('investorDashboard.entityReporting.opportunities', {
                  live: count(entity.opportunities?.live),
                  total: count(entity.opportunities?.total),
                })}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {t('investorDashboard.entityReporting.stakesPositions', { count: Number(entity.stakes?.positions ?? 0) })}
                {' · '}
                {t('investorDashboard.entityReporting.stakesCommitments', { count: Number(entity.stakes?.commitments ?? 0) })}
                {' · '}
                {t('investorDashboard.entityReporting.stakesApplications', { count: Number(entity.stakes?.applications ?? 0) })}
              </p>
              <EntityContact entityId={entity.entityId} />
            </li>
          ))}
        </ul>
      )}

      {/* ── 727: authorized datasets ─────────────────────────────── */}
      <h3 className="font-semibold text-sm text-gray-200 mt-5 mb-2">{t('investorDashboard.entityReporting.datasets.title')}</h3>
      <p className="text-xs text-gray-500 mb-3">{t('investorDashboard.entityReporting.datasets.help')}</p>
      {datasetsState.status === 'loading' && <p role="status" className="text-xs text-gray-500">{t('investorDashboard.entityReporting.datasets.loading')}</p>}
      {datasetsState.status === 'error' && <p role="alert" className="text-xs text-red-400">{t('investorDashboard.entityReporting.datasets.loadError')}</p>}
      {datasetsState.status === 'ready' && (
        <ul className="space-y-2">
          {(datasetsState.data?.datasets ?? []).map((dataset) => (
            <li key={dataset.id} className="flex items-start justify-between gap-3 rounded-xl bg-gray-800/50 border border-gray-800 px-3 py-2">
              <div>
                <p className="text-sm text-gray-200">{t(`investorDashboard.entityReporting.datasets.labels.${dataset.id}`)}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {dataset.apiRoute
                    ? dataset.apiRoute
                    : t('investorDashboard.entityReporting.datasets.noRoute')}
                </p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${dataset.granted ? 'bg-emerald-500/15 text-emerald-300' : 'bg-gray-700 text-gray-400'}`}>
                {dataset.granted
                  ? t('investorDashboard.entityReporting.datasets.granted')
                  : t('investorDashboard.entityReporting.datasets.withheld')}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* ── 728: reporting document library ──────────────────────── */}
      <h3 className="font-semibold text-sm text-gray-200 mt-5 mb-2">{t('investorDashboard.entityReporting.documents.title')}</h3>
      <p className="text-xs text-gray-500 mb-3">{t('investorDashboard.entityReporting.documents.help')}</p>
      {documentsState.status === 'loading' && <p role="status" className="text-xs text-gray-500">{t('investorDashboard.entityReporting.documents.loading')}</p>}
      {documentsState.status === 'error' && <p role="alert" className="text-xs text-red-400">{t('investorDashboard.entityReporting.documents.loadError')}</p>}
      {documentsState.status === 'ready' && (documentsState.data?.documents ?? []).length === 0 && (
        <p className="text-xs text-gray-500">{t('investorDashboard.entityReporting.documents.empty')}</p>
      )}
      {documentsState.status === 'ready' && (documentsState.data?.documents ?? []).length > 0 && (
        <ul className="space-y-2">
          {(documentsState.data.documents).map((doc) => (
            <li key={`${doc.kind}:${doc.id}`} className="rounded-xl bg-gray-800/50 border border-gray-800 px-3 py-2">
              <Link to={doc.url} className="text-sm text-emerald-300 hover:text-emerald-200">
                {doc.kind === 'evidence_share'
                  ? doc.title
                  : t('investorDashboard.entityReporting.documents.exportTitle', {
                      product: t(`investorDashboard.entityReporting.documents.products.${doc.product}`),
                      format: doc.format,
                    })}
              </Link>
              <p className="text-xs text-gray-500 mt-0.5">
                {doc.kind === 'evidence_share'
                  ? t('investorDashboard.entityReporting.documents.shareExpires', { date: date(doc.expiresAt) })
                  : t(`investorDashboard.entityReporting.documents.exportStates.${doc.state}`, { date: date(doc.completedAt || doc.createdAt) })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
