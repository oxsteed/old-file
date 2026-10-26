import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../../lib/adminApi';
import { useHasGrant } from '../../lib/GrantGuard';
import AmazonAssociatesPanel from './AmazonAssociatesPanel';

// Partner operations for the Demand & Sales Engine (spec 13/15.1): partner
// creation, feed management and manual runs, reviewed category mapping with
// the unmapped queue, and finance-gated conversions. The server enforces
// every grant again; buttons hide here only to keep the UI honest.
const LOCALES = ['en', 'es', 'fr', 'ht', 'ar'];
const input =
  'w-full rounded border border-gray-300 bg-white p-2 text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100';
const button = 'rounded bg-orange-700 px-4 py-2 text-white disabled:opacity-50';
const csv = (value) =>
  String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export default function PartnerManager() {
  const { t } = useTranslation();
  const label = (key) => t(`growthInsights.${key}`);
  const canPartners = useHasGrant('manage_affiliate_partners');
  const canFinance = useHasGrant('view_financials');
  const canExport = useHasGrant('export_data');
  const [partners, setPartners] = useState([]),
    [partnerId, setPartnerId] = useState(''),
    [feeds, setFeeds] = useState([]),
    [mappings, setMappings] = useState([]),
    [unmapped, setUnmapped] = useState([]),
    [conversions, setConversions] = useState(null),
    [nodes, setNodes] = useState([]),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    code: '',
    name: '',
    network: '',
    countries: 'US',
    currencies: 'USD',
    channels: 'in_app',
    domains: '',
    disclosure: Object.fromEntries(LOCALES.map((l) => [l, ''])),
  });
  const [feedForm, setFeedForm] = useState({
    url: '',
    format: 'csv',
    schedule_hours: 24,
    field_mapping: '{}',
  });
  const [mapForm, setMapForm] = useState({ category_path: '', node_id: '' });
  const [reviewRef, setReviewRef] = useState('');

  const loadPartners = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/growth/partners');
      setPartners(data.rows || []);
    } catch {
      setError(true);
    }
  }, []);
  useEffect(() => {
    loadPartners();
    api
      .get('/admin/growth/taxonomy')
      .then((r) => setNodes(r.data.rows || []))
      .catch(() => {});
  }, [loadPartners]);
  const loadPartnerData = useCallback(async () => {
    if (!partnerId) return;
    try {
      const [f, m, u, c] = await Promise.all([
        api.get(`/admin/growth/partners/${partnerId}/feeds`),
        api.get(`/admin/growth/partners/category-map?partner_id=${partnerId}`),
        api.get(
          `/admin/growth/partners/unmapped-categories?partner_id=${partnerId}`,
        ),
        api.get(`/admin/growth/conversions?partner_id=${partnerId}`),
      ]);
      setFeeds(f.data.rows || []);
      setMappings(m.data.rows || []);
      setUnmapped(u.data.rows || []);
      setConversions(c.data);
    } catch {
      setError(true);
    }
  }, [partnerId]);
  useEffect(() => {
    loadPartnerData();
  }, [loadPartnerData]);

  const act = async (fn) => {
    setBusy(true);
    setError(false);
    try {
      await fn();
      await loadPartners();
      await loadPartnerData();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const createPartner = () =>
    act(async () => {
      const { data } = await api.post('/admin/growth/partners', {
        code: form.code,
        name: form.name,
        network: form.network,
        countries_allowed: csv(form.countries).map((c) => c.toUpperCase()),
        currencies: csv(form.currencies).map((c) => c.toUpperCase()),
        allowed_channels: csv(form.channels),
        link_domains_allowlist: csv(form.domains).map((d) => d.toLowerCase()),
        disclosure: form.disclosure,
      });
      setPartnerId(String(data.id));
    });
  const activatePartner = () =>
    act(() =>
      api.post(`/admin/growth/partners/${partnerId}/activate`, {
        review_ref: reviewRef,
      }),
    );
  const createFeed = () =>
    act(async () => {
      await api.post(`/admin/growth/partners/${partnerId}/feeds`, {
        url: feedForm.url,
        format: feedForm.format,
        schedule_hours: Number(feedForm.schedule_hours),
        field_mapping: JSON.parse(feedForm.field_mapping || '{}'),
      });
    });
  const runFeed = (feedId) =>
    act(() => api.post(`/admin/growth/partners/feeds/${feedId}/run`));
  const createMapping = () =>
    act(async () => {
      await api.post('/admin/growth/partners/category-map', {
        partner_id: partnerId,
        category_path: mapForm.category_path,
        node_id: mapForm.node_id,
      });
      setMapForm({ category_path: '', node_id: '' });
    });
  const exportCsv = () => {
    window.location.href = `/api/admin/growth/conversions/export?partner_id=${partnerId}`;
  };
  const partner = partners.find((p) => String(p.id) === String(partnerId));

  return (
    <div className="space-y-8 p-6 text-gray-900 dark:text-gray-100">
      <h1 className="text-2xl font-semibold">{label('partners')}</h1>
      {error && <p role="alert">{label('error')}</p>}

      <AmazonAssociatesPanel canPartners={canPartners} />

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{label('create')}</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <input
            className={input}
            aria-label={label('partnerCode')}
            placeholder={label('partnerCode')}
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
          />
          <input
            className={input}
            aria-label={label('name')}
            placeholder={label('name')}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            className={input}
            aria-label={label('network')}
            placeholder={label('network')}
            value={form.network}
            onChange={(e) => setForm({ ...form, network: e.target.value })}
          />
          <input
            className={input}
            aria-label={label('country')}
            placeholder="US, CA"
            value={form.countries}
            onChange={(e) => setForm({ ...form, countries: e.target.value })}
          />
          <input
            className={input}
            aria-label={label('currencies')}
            placeholder="USD"
            value={form.currencies}
            onChange={(e) => setForm({ ...form, currencies: e.target.value })}
          />
          <input
            className={input}
            aria-label={label('channels')}
            placeholder="in_app, push"
            value={form.channels}
            onChange={(e) => setForm({ ...form, channels: e.target.value })}
          />
          <input
            className={input}
            aria-label={label('domains')}
            placeholder="shop.example.com"
            value={form.domains}
            onChange={(e) => setForm({ ...form, domains: e.target.value })}
          />
        </div>
        {LOCALES.map((l) => (
          <input
            key={l}
            className={input}
            aria-label={`${label('disclosure')} ${l}`}
            placeholder={`${label('disclosure')} (${l})`}
            value={form.disclosure[l]}
            onChange={(e) =>
              setForm({
                ...form,
                disclosure: { ...form.disclosure, [l]: e.target.value },
              })
            }
          />
        ))}
        {canPartners && (
          <button className={button} disabled={busy} onClick={createPartner}>
            {label('create')}
          </button>
        )}
      </section>

      <section className="space-y-3">
        <label className="block">
          {label('partners')}
          <select
            className={input}
            value={partnerId}
            onChange={(e) => setPartnerId(e.target.value)}
          >
            <option value="">-</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} ({p.status})
              </option>
            ))}
          </select>
        </label>
        {partner && partner.status !== 'active' && canPartners && (
          <div className="flex gap-2">
            <input
              className={input}
              aria-label="review_ref"
              placeholder="review_ref"
              value={reviewRef}
              onChange={(e) => setReviewRef(e.target.value)}
            />
            <button
              className={button}
              disabled={busy || reviewRef.length < 5}
              onClick={activatePartner}
            >
              {label('approve')}
            </button>
          </div>
        )}
      </section>

      {partnerId && (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-medium">{label('feeds')}</h2>
            <ul className="space-y-1">
              {feeds.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-2">
                  <span>
                    {f.format} · {f.url} · {label('scheduleHours')}:{' '}
                    {f.schedule_hours}
                    {f.last_run
                      ? ` · ${label('feedLastRun')}: ${f.last_run.status}`
                      : ''}
                    {f.last_error ? ` · ${f.last_error}` : ''}
                  </span>
                  {canPartners && (
                    <button
                      className={button}
                      disabled={busy}
                      onClick={() => runFeed(f.id)}
                    >
                      {label('runNow')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <div className="grid gap-3 md:grid-cols-2">
              <input
                className={input}
                aria-label={label('feedUrl')}
                placeholder="https://..."
                value={feedForm.url}
                onChange={(e) =>
                  setFeedForm({ ...feedForm, url: e.target.value })
                }
              />
              <select
                className={input}
                aria-label={label('format')}
                value={feedForm.format}
                onChange={(e) =>
                  setFeedForm({ ...feedForm, format: e.target.value })
                }
              >
                {['csv', 'json', 'xml', 'google_merchant'].map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <input
                className={input}
                type="number"
                min="1"
                max="168"
                aria-label={label('scheduleHours')}
                value={feedForm.schedule_hours}
                onChange={(e) =>
                  setFeedForm({ ...feedForm, schedule_hours: e.target.value })
                }
              />
              <textarea
                className={input}
                aria-label={label('fieldMapping')}
                rows="3"
                value={feedForm.field_mapping}
                onChange={(e) =>
                  setFeedForm({ ...feedForm, field_mapping: e.target.value })
                }
              />
            </div>
            {canPartners && (
              <button className={button} disabled={busy} onClick={createFeed}>
                {label('create')}
              </button>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium">{label('categoryMapping')}</h2>
            <ul className="space-y-1">
              {mappings.map((m) => (
                <li key={`${m.category_path}-${m.node_id}`}>
                  {m.category_path} → {m.node_code}
                </li>
              ))}
            </ul>
            <div className="grid gap-3 md:grid-cols-3">
              <input
                className={input}
                aria-label={label('categoryPath')}
                placeholder={label('categoryPath')}
                value={mapForm.category_path}
                onChange={(e) =>
                  setMapForm({ ...mapForm, category_path: e.target.value })
                }
              />
              <select
                className={input}
                aria-label={label('taxonomyNode')}
                value={mapForm.node_id}
                onChange={(e) =>
                  setMapForm({ ...mapForm, node_id: e.target.value })
                }
              >
                <option value="">-</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.code}
                  </option>
                ))}
              </select>
              {canPartners && (
                <button
                  className={button}
                  disabled={busy || !mapForm.category_path || !mapForm.node_id}
                  onClick={createMapping}
                >
                  {label('save')}
                </button>
              )}
            </div>
            <h3 className="font-medium">{label('unmapped')}</h3>
            <ul className="space-y-1">
              {unmapped.map((u) => (
                <li key={u.category_path}>
                  <button
                    type="button"
                    className="underline"
                    onClick={() =>
                      setMapForm({ ...mapForm, category_path: u.category_path })
                    }
                  >
                    {u.category_path}
                  </button>{' '}
                  ({u.products})
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium">{label('conversions')}</h2>
            {!conversions?.finance && <p>{label('moneyHidden')}</p>}
            {canFinance && canExport && (
              <button className={button} disabled={busy} onClick={exportCsv}>
                {label('exportCsv')}
              </button>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th>{label('status')}</th>
                    <th>{label('assisted')}</th>
                    {conversions?.finance && <th>{label('gross')}</th>}
                    {conversions?.finance && <th>{label('net')}</th>}
                    <th>{label('changedOn')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(conversions?.rows || []).map((r) => (
                    <tr key={r.id}>
                      <td>{r.status}</td>
                      <td>{r.assisted ? 'yes' : 'no'}</td>
                      {conversions?.finance && <td>{r.sale_minor}</td>}
                      {conversions?.finance && <td>{r.commission_minor}</td>}
                      <td>{r.updated_at}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
