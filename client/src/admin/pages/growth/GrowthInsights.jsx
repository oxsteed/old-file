import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../../../lib/adminApi';

// Demand heatmap on the same MapLibre + AWS Location stack the app already
// uses (see components/AwsLocationMap.jsx for the key handling rules: the
// key is public by construction and referer-restricted). Points are postal
// centroids only, weighted by the demand score; the accessible table view
// next to it carries the same numbers for screen readers and audits.
function DemandHeatmap({ rows, label }) {
  const ref = useRef(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let map = null;
    let cancelled = false;
    (async () => {
      const apiKey = import.meta.env.VITE_AWS_LOCATION_API_KEY;
      const region = import.meta.env.VITE_AWS_LOCATION_REGION || 'us-east-1';
      if (!apiKey || !ref.current) {
        setFailed(true);
        return;
      }
      try {
        const maplibregl = (await import('maplibre-gl')).default;
        await import('maplibre-gl/dist/maplibre-gl.css');
        if (cancelled || !ref.current) return;
        const features = rows
          .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng))
          .map((r) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
            properties: {
              demand: Number(r.demand) || 0,
              people: Number(r.people) || 0,
            },
          }));
        const theme =
          document.documentElement.getAttribute('data-theme') || 'dark';
        map = new maplibregl.Map({
          container: ref.current,
          center: features.length
            ? features[0].geometry.coordinates
            : [-98, 39],
          zoom: features.length ? 4 : 2,
          style: `https://maps.geo.${region}.amazonaws.com/v2/styles/Standard/descriptor?color-scheme=${theme === 'light' ? 'Light' : 'Dark'}`,
          transformRequest: (url) => ({
            url:
              url.startsWith('https://maps.geo.') ||
              url.startsWith('https://tiles.geo.')
                ? `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(apiKey)}`
                : url,
          }),
          attributionControl: true,
        });
        map.addControl(
          new maplibregl.NavigationControl({ showCompass: false }),
          'top-right',
        );
        map.on('load', () => {
          map.addSource('demand', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features },
          });
          map.addLayer({
            id: 'demand-heat',
            type: 'heatmap',
            source: 'demand',
            paint: {
              'heatmap-weight': [
                'interpolate',
                ['linear'],
                ['get', 'demand'],
                0,
                0,
                50,
                1,
              ],
              'heatmap-intensity': 0.8,
              'heatmap-radius': 42,
              'heatmap-opacity': 0.75,
              'heatmap-color': [
                'interpolate',
                ['linear'],
                ['heatmap-density'],
                0,
                'rgba(33,102,172,0)',
                0.2,
                'rgb(103,169,207)',
                0.4,
                'rgb(209,229,240)',
                0.6,
                'rgb(253,219,199)',
                0.8,
                'rgb(239,138,98)',
                1,
                'rgb(178,24,43)',
              ],
            },
          });
          map.addLayer({
            id: 'demand-points',
            type: 'circle',
            source: 'demand',
            paint: {
              'circle-radius': [
                'interpolate',
                ['linear'],
                ['get', 'people'],
                5,
                4,
                100,
                14,
              ],
              'circle-color': '#ea580c',
              'circle-opacity': 0.65,
              'circle-stroke-width': 1,
              'circle-stroke-color': '#ffffff',
            },
          });
        });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (map) map.remove();
    };
  }, [rows]);
  if (failed) return null;
  return (
    <div
      ref={ref}
      className="h-96 w-full overflow-hidden rounded border"
      role="img"
      aria-label={label}
    />
  );
}
const LOCALES = ['en', 'es', 'fr', 'ht', 'ar'];
const SECTIONS = [
  'overview',
  'demand',
  'clusters',
  'segments',
  'suggestions',
  'campaigns',
  'partners',
  'taxonomy',
  'settings',
];
const input =
  'w-full rounded border border-gray-300 bg-white p-2 text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100';
const button = 'rounded bg-orange-700 px-4 py-2 text-white disabled:opacity-50';
const emptyCopy = () =>
  Object.fromEntries(
    LOCALES.map((l) => [
      l,
      {
        title: '',
        body: '',
        button: '',
        push_title: '',
        push_body: '',
        disclosure: '',
      },
    ]),
  );
export default function GrowthInsights({ section = 'overview' }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState(null),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false);
  const [classificationDrafts, setClassificationDrafts] = useState({});
  const [name, setName] = useState(''),
    [role, setRole] = useState('helper'),
    [country, setCountry] = useState('US'),
    [intent, setIntent] = useState('');
  const [preview, setPreview] = useState(null),
    [options, setOptions] = useState({ segments: [], offers: [] });
  const [segment, setSegment] = useState(''),
    [offer, setOffer] = useState(''),
    [push, setPush] = useState(false),
    [copy, setCopy] = useState(emptyCopy);
  const [review, setReview] = useState(null),
    [totp, setTotp] = useState(''),
    [checklist, setChecklist] = useState({});
  const [miles, setMiles] = useState(35),
    [minimum, setMinimum] = useState(5);
  const [view, setView] = useState('map'),
    [snapshots, setSnapshots] = useState(null);
  const [rejecting, setRejecting] = useState(null),
    [reason, setReason] = useState('');
  const load = useCallback(async () => {
    setError(false);
    setData(null);
    try {
      const path = `/admin/growth/${section === 'overview' ? 'overview' : section === 'clusters' ? 'clusters/options' : section}`;
      const response = await api.get(path);
      const result = response.data;
      if (section === 'taxonomy') {
        const queue = await api.get('/admin/growth/taxonomy/review-queue');
        result.reviewQueue = queue.data.rows || [];
      }
      setData(result);
    } catch {
      setError(true);
    }
  }, [section]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (section !== 'demand') return;
    let active = true;
    const lastValue = (payload) => {
      const points = payload?.points || payload?.rows || [];
      const values = points
        .map((p) => p.value)
        .filter((v) => v != null && Number.isFinite(Number(v)));
      return values.length ? Number(values[values.length - 1]) : null;
    };
    Promise.all([
      api.get('/admin/analytics/query-builder/trend', {
        params: { metric: 'demand_gap_index', days: 30 },
      }),
      api.get('/admin/analytics/query-builder/trend', {
        params: { metric: 'demand_unfilled_rate_pct', days: 30 },
      }),
    ])
      .then(([g, u]) => {
        if (active)
          setSnapshots({ gap: lastValue(g.data), unfilled: lastValue(u.data) });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [section]);
  useEffect(() => {
    if (section !== 'campaigns') return;
    let active = true;
    Promise.all([
      api.get('/admin/growth/segments'),
      api.get('/admin/growth/offers'),
    ])
      .then(([s, o]) => {
        if (active) setOptions({ segments: s.data.rows, offers: o.data.rows });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [section]);
  const run = async (action) => {
    setBusy(true);
    setError(false);
    try {
      await action();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const definition = () => ({
    roles: [role],
    area: { type: 'country', country: country.toUpperCase() },
    ...(intent
      ? { intents: [{ code: intent, min_score: 0.5, window_days: 60 }] }
      : {}),
  });
  const createSegment = async (event) => {
    event.preventDefault();
    await run(async () => {
      await api.post('/admin/growth/segments', {
        name,
        definition: definition(),
      });
      setName('');
      await load();
    });
  };
  const createCampaign = async (event) => {
    event.preventDefault();
    await run(async () => {
      await api.post('/admin/growth/campaigns', {
        name,
        offer_id: offer,
        segment_version_id: segment,
        channels: push ? ['in_app', 'push'] : ['in_app'],
        copy,
      });
      setName('');
      setCopy(emptyCopy());
      await load();
    });
  };
  const transition = async (id, action, extra = {}) =>
    run(async () => {
      await api.post(`/admin/growth/campaigns/${id}/${action}`, extra);
      setReview(null);
      setTotp('');
      setChecklist({});
      await load();
    });
  const reviewClassification = async (row, decision) => {
    const draft = classificationDrafts[row.id] || {};
    await run(async () => {
      await api.post(`/admin/growth/taxonomy/review-queue/${row.id}/review`, {
        decision,
        node_code: decision === 'approve' ? (draft.node_code || row.proposed_code) : undefined,
        review_note: draft.review_note || undefined,
        keyword_rule:
          decision === 'approve' && draft.pattern
            ? { locale: draft.locale || 'en', pattern: draft.pattern }
            : undefined,
      });
      setClassificationDrafts((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      await load();
    });
  };
  const label = (key) => t(`growthInsights.${key}`);
  const renderRow = (row) => {
    if (section === 'demand')
      return (
        <>
          <th scope="row" className="p-3 text-start">
            {row.place_name}
          </th>
          <td className="p-3">{row.country}</td>
          <td className="p-3">
            {row.labels?.[i18n.resolvedLanguage] || row.labels?.en}
          </td>
          <td className="p-3">{row.people}</td>
          <td className="p-3">
            {Number(row.demand).toLocaleString(i18n.resolvedLanguage, {
              maximumFractionDigits: 1,
            })}
          </td>
          <td className="p-3">{row.supply ?? '—'}</td>
          <td className="p-3">
            {row.gap == null
              ? '—'
              : Number(row.gap).toLocaleString(i18n.resolvedLanguage, {
                  maximumFractionDigits: 2,
                })}
          </td>
          <td className="p-3">
            {row.trend_state === 'new'
              ? label('trendNew')
              : row.trend_pct == null
                ? '—'
                : `${row.trend_pct > 0 ? '+' : ''}${row.trend_pct}%`}
          </td>
          <td className="p-3">
            {row.anomaly
              ? `${label('anomalyFlag')} x${Number(row.anomaly.ratio).toFixed(1)}`
              : '—'}
          </td>
        </>
      );
    return (
      <>
        <th scope="row" className="p-3 text-start">
          {row.name ||
            row.title ||
            row.labels?.[i18n.resolvedLanguage] ||
            row.labels?.en ||
            row.code ||
            row.id}
        </th>
        <td className="p-3">{row.status || ''}</td>
        <td className="p-3">
          {section === 'suggestions' && row.rationale}
          {section === 'suggestions' && row.status === 'pending_review' && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                className={button}
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api.post(
                      `/admin/growth/suggestions/${row.id}/accept`,
                    );
                    await load();
                  })
                }
              >
                {label('accept')}
              </button>
              <button
                className="rounded border px-3 py-2"
                disabled={busy}
                onClick={() => {
                  setRejecting(row);
                  setReason('');
                }}
              >
                {label('reject')}
              </button>
            </div>
          )}
          {section === 'segments' && row.version}
          {section === 'campaigns' && (
            <div className="flex flex-wrap gap-2">
              {['draft', 'changes_requested'].includes(row.status) && (
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => transition(row.id, 'review')}
                >
                  {label('review')}
                </button>
              )}
              {row.status === 'in_review' && (
                <button className={button} onClick={() => setReview(row)}>
                  {label('approve')}
                </button>
              )}
              {row.status === 'approved' && (
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => transition(row.id, 'queue')}
                >
                  {label('queue')}
                </button>
              )}
              {!['sent', 'cancelled'].includes(row.status) && (
                <button
                  className="rounded border p-2"
                  disabled={busy}
                  onClick={() => transition(row.id, 'cancel')}
                >
                  {label('cancel')}
                </button>
              )}
            </div>
          )}
        </td>
      </>
    );
  };
  return (
    <main
      className="space-y-6 p-4 text-gray-900 dark:text-gray-100 sm:p-6"
      dir={i18n.dir()}
      data-track-private
    >
      <h1 className="text-2xl font-semibold">{label('title')}</h1>
      <nav aria-label={label('title')} className="flex flex-wrap gap-3">
        {SECTIONS.map((s) => (
          <Link
            key={s}
            to={s === 'overview' ? '/admin/growth' : `/admin/growth/${s}`}
            aria-current={s === section ? 'page' : undefined}
            className="rounded border border-gray-300 px-3 py-2 dark:border-gray-600"
          >
            {label(s)}
          </Link>
        ))}
      </nav>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">{label(section)}</h2>
        <button className="rounded border px-3 py-2" onClick={load}>
          {label('refresh')}
        </button>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded bg-red-50 p-3 text-red-800 dark:bg-red-950 dark:text-red-100"
        >
          {label('error')}
        </p>
      )}
      {!data && !error && <p role="status">{label('loading')}</p>}
      {data?.rollout && (
        <section className="space-y-3 rounded border p-4">
          <p>{label('trackingOff')}</p>
          <dl className="grid gap-3 sm:grid-cols-3">
            <div>
              <dt>{label('status')}</dt>
              <dd>{data.rollout.state}</dd>
            </div>
            {[
              ['planned_effective_at', 'plannedDate'],
              ['effective_at', 'effectiveDate'],
            ].map(([field, key]) => (
              <div key={field}>
                <dt>{label(key)}</dt>
                <dd>
                  {data.rollout[field]
                    ? new Date(data.rollout[field]).toLocaleString(
                        i18n.resolvedLanguage,
                      )
                    : '—'}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {section === 'clusters' && (
        <form
          className="grid max-w-xl gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const r = await api.get('/admin/growth/clusters', {
                params: { role, intent, country, miles, min_n: minimum },
              });
              setPreview(r.data);
            });
          }}
        >
          <label>
            {label('intent')}
            <select
              required
              className={input}
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
            >
              <option value="">—</option>
              {data?.rows
                ?.filter((n) => !n.sensitive)
                .map((n) => (
                  <option key={n.code} value={n.code}>
                    {n.labels?.[i18n.resolvedLanguage] || n.labels?.en}
                  </option>
                ))}
            </select>
          </label>
          <label>
            {label('country')}
            <input
              className={input}
              value={country}
              maxLength={2}
              onChange={(e) => setCountry(e.target.value.toUpperCase())}
            />
          </label>
          <label>
            {label('role')}
            <select
              className={input}
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              {['customer', 'helper', 'business', 'restaurant'].map((r) => (
                <option key={r} value={r}>
                  {t(`growthInsights.roles.${r}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {label('miles')}
            <input
              type="number"
              min={1}
              max={300}
              className={input}
              value={miles}
              onChange={(e) => setMiles(Number(e.target.value))}
            />
          </label>
          <label>
            {label('minimum')}
            <input
              type="number"
              min={5}
              className={input}
              value={minimum}
              onChange={(e) => setMinimum(Number(e.target.value))}
            />
          </label>
          <button className={button} disabled={busy}>
            {label('preview')}
          </button>
        </form>
      )}
      {section === 'segments' && (
        <form onSubmit={createSegment} className="grid max-w-xl gap-3">
          <label>
            {label('name')}
            <input
              required
              maxLength={120}
              className={input}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            {label('role')}
            <select
              className={input}
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              {['customer', 'helper', 'business', 'restaurant'].map((r) => (
                <option key={r} value={r}>
                  {t(`growthInsights.roles.${r}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {label('country')}
            <input
              required
              pattern="[A-Z]{2}"
              className={input}
              maxLength={2}
              value={country}
              onChange={(e) => setCountry(e.target.value.toUpperCase())}
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <button className={button} disabled={busy}>
              {label('create')}
            </button>
            <button
              type="button"
              className="rounded border px-4 py-2"
              disabled={busy}
              onClick={() =>
                run(async () =>
                  setPreview(
                    (
                      await api.post('/admin/growth/segments/preview', {
                        definition: definition(),
                      })
                    ).data,
                  ),
                )
              }
            >
              {label('preview')}
            </button>
          </div>
        </form>
      )}
      {preview && (
        <div role="status">
          {preview.below_k
            ? label('belowK')
            : (preview.count ??
              preview.rows?.map((r, i) => (
                <p key={i}>
                  {r.place_name}: {r.member_count}
                </p>
              )))}
          {preview.overlap?.length > 0 && (
            <div className="mt-3">
              <h3 className="font-semibold">{label('overlap')}</h3>
              <ul>
                {preview.overlap.map((o) => (
                  <li key={o.campaign_id}>
                    {o.name}:{' '}
                    {o.below_k
                      ? label('belowK')
                      : `${o.shared} ${label('shared')}`}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {section === 'campaigns' && (
        <form
          onSubmit={createCampaign}
          className="space-y-4 rounded border p-4"
        >
          <label className="block">
            {label('name')}
            <input
              required
              maxLength={120}
              className={input}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              {label('segment')}
              <select
                required
                className={input}
                value={segment}
                onChange={(e) => setSegment(e.target.value)}
              >
                <option value="">—</option>
                {options.segments.map((s) => (
                  <option key={s.version_id} value={s.version_id}>
                    {s.name} · {s.version}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {label('offer')}
              <select
                required
                className={input}
                value={offer}
                onChange={(e) => setOffer(e.target.value)}
              >
                <option value="">—</option>
                {options.offers.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={push}
              onChange={(e) => setPush(e.target.checked)}
            />
            {label('pushConsent')}
          </label>
          <h3 className="font-semibold">{label('copy')}</h3>
          <div className="grid gap-4 lg:grid-cols-2">
            {LOCALES.map((l) => (
              <fieldset
                key={l}
                lang={l}
                dir={l === 'ar' ? 'rtl' : 'ltr'}
                className="space-y-2 rounded border p-3"
              >
                <legend>
                  {new Intl.DisplayNames([i18n.resolvedLanguage || 'en'], {
                    type: 'language',
                  }).of(l)}
                </legend>
                {[
                  'title',
                  'body',
                  'button',
                  ...(push ? ['push_title', 'push_body'] : []),
                  'disclosure',
                ].map((field) => (
                  <label key={field} className="block text-sm">
                    {label(
                      {
                        title: 'cardTitle',
                        body: 'body',
                        button: 'button',
                        push_title: 'pushTitle',
                        push_body: 'pushBody',
                        disclosure: 'disclosure',
                      }[field],
                    )}
                    <textarea
                      className={input}
                      required={field !== 'disclosure'}
                      rows={field === 'body' ? 3 : 1}
                      maxLength={
                        {
                          title: 120,
                          body: 2000,
                          button: 60,
                          push_title: 50,
                          push_body: 120,
                          disclosure: 500,
                        }[field]
                      }
                      value={copy[l][field]}
                      onChange={(e) =>
                        setCopy({
                          ...copy,
                          [l]: { ...copy[l], [field]: e.target.value },
                        })
                      }
                    />
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          <button className={button} disabled={busy}>
            {label('create')}
          </button>
        </form>
      )}
      {review && (
        <section
          className="space-y-4 rounded border p-4"
          aria-label={label('approve')}
        >
          <p>{label('reviewChecklist')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {LOCALES.map((l) => (
              <article
                key={l}
                lang={l}
                dir={l === 'ar' ? 'rtl' : 'ltr'}
                className="rounded border p-3"
              >
                <h3 className="font-semibold">{review.copy[l]?.title}</h3>
                <p>{review.copy[l]?.body}</p>
                <p className="text-sm">{review.copy[l]?.disclosure}</p>
                <p>{review.copy[l]?.push_title}</p>
                <p>{review.copy[l]?.push_body}</p>
              </article>
            ))}
          </div>
          {[
            'audience',
            'caps',
            'channels',
            'disclosures',
            'locales',
            'rtl',
          ].map((key, i) => (
            <label key={key} className="flex gap-2">
              <input
                type="checkbox"
                checked={checklist[key] === true}
                onChange={(e) =>
                  setChecklist({ ...checklist, [key]: e.target.checked })
                }
              />
              {label(
                [
                  'reviewAudience',
                  'reviewCaps',
                  'reviewChannels',
                  'reviewDisclosures',
                  'reviewLocales',
                  'reviewRtl',
                ][i],
              )}
            </label>
          ))}
          <label className="block">
            {label('totp')}
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              className={input}
              value={totp}
              onChange={(e) => setTotp(e.target.value)}
            />
          </label>
          <button
            className={button}
            disabled={
              busy ||
              totp.length !== 6 ||
              Object.values(checklist).filter(Boolean).length !== 6
            }
            onClick={() =>
              transition(review.id, 'approve', { totp, checklist })
            }
          >
            {label('approve')}
          </button>
        </section>
      )}
      {section === 'demand' && data?.freshness && (
        <section className="space-y-3 rounded border p-4">
          <h3 className="font-semibold">{label('freshness')}</h3>
          <dl className="grid gap-3 sm:grid-cols-3">
            <div>
              <dt>{label('demandThrough')}</dt>
              <dd>
                {data.freshness.demand_through
                  ? new Date(
                      data.freshness.demand_through,
                    ).toLocaleDateString(i18n.resolvedLanguage)
                  : '—'}
              </dd>
            </div>
            <div>
              <dt>{label('supplyThrough')}</dt>
              <dd>
                {data.freshness.supply_through
                  ? new Date(
                      data.freshness.supply_through,
                    ).toLocaleDateString(i18n.resolvedLanguage)
                  : '—'}
              </dd>
            </div>
            <div>
              <dt>{label('lastRun')}</dt>
              <dd>
                {data.freshness.last_run
                  ? `${new Date(data.freshness.last_run.day).toLocaleDateString(i18n.resolvedLanguage)} · ${data.freshness.last_run.status}`
                  : '—'}
              </dd>
            </div>
          </dl>
          <p className="text-sm">{label('anchorNote')}</p>
          {snapshots && (snapshots.gap != null || snapshots.unfilled != null) && (
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt>
                  {label('snapshots')} · {label('gapIndex')}
                </dt>
                <dd>
                  {snapshots.gap == null
                    ? '—'
                    : snapshots.gap.toLocaleString(i18n.resolvedLanguage, {
                        maximumFractionDigits: 2,
                      })}
                </dd>
              </div>
              <div>
                <dt>
                  {label('snapshots')} · {label('unfilledRate')}
                </dt>
                <dd>
                  {snapshots.unfilled == null
                    ? '—'
                    : `${snapshots.unfilled.toLocaleString(i18n.resolvedLanguage, { maximumFractionDigits: 1 })}%`}
                </dd>
              </div>
            </dl>
          )}
          <div className="flex gap-2" role="group" aria-label={label('demand')}>
            {['map', 'table'].map((v) => (
              <button
                key={v}
                className={
                  view === v ? button : 'rounded border px-4 py-2'
                }
                aria-pressed={view === v}
                onClick={() => setView(v)}
              >
                {label(v === 'map' ? 'mapView' : 'tableView')}
              </button>
            ))}
          </div>
          {view === 'map' &&
            (data.rows?.length > 0 ? (
              <DemandHeatmap rows={data.rows} label={label('mapView')} />
            ) : (
              <p>{label('empty')}</p>
            ))}
        </section>
      )}
      {section === 'suggestions' && (
        <div>
          <button
            className={button}
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api.post('/admin/growth/suggestions/produce');
                await load();
              })
            }
          >
            {label('produce')}
          </button>
        </div>
      )}
      {rejecting && (
        <form
          className="space-y-3 rounded border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api.post(
                `/admin/growth/suggestions/${rejecting.id}/reject`,
                { reason },
              );
              setRejecting(null);
              setReason('');
              await load();
            });
          }}
        >
          <label className="block">
            {label('rejectReason')}
            <input
              required
              maxLength={500}
              className={input}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <button className={button} disabled={busy || !reason.trim()}>
              {label('reject')}
            </button>
            <button
              type="button"
              className="rounded border px-4 py-2"
              onClick={() => setRejecting(null)}
            >
              {label('cancel')}
            </button>
          </div>
        </form>
      )}
      {section === 'taxonomy' && data?.reviewQueue && (
        <section className="space-y-3 rounded border p-4" aria-labelledby="classification-review-heading">
          <h3 id="classification-review-heading" className="font-semibold">
            {label('classificationReview')}
          </h3>
          {data.reviewQueue.length === 0 ? (
            <p>{label('classificationReviewEmpty')}</p>
          ) : (
            <div className="space-y-3">
              {data.reviewQueue.map((row) => {
                const draft = classificationDrafts[row.id] || {};
                const setDraft = (field, value) =>
                  setClassificationDrafts((current) => ({
                    ...current,
                    [row.id]: { ...current[row.id], [field]: value },
                  }));
                return (
                  <article key={row.id} className="space-y-3 rounded border p-3">
                    <dl className="grid gap-2 sm:grid-cols-3">
                      <div>
                        <dt className="text-sm font-semibold">{label('classificationEntity')}</dt>
                        <dd>{row.entity_type} · {row.entity_id}</dd>
                      </div>
                      <div>
                        <dt className="text-sm font-semibold">{label('classificationReason')}</dt>
                        <dd>{row.reason}</dd>
                      </div>
                      <div>
                        <dt className="text-sm font-semibold">{label('classificationProposed')}</dt>
                        <dd>{row.proposed_code || '—'}</dd>
                      </div>
                    </dl>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label>
                        {label('classificationNode')}
                        <select
                          className={input}
                          value={draft.node_code || row.proposed_code || ''}
                          onChange={(e) => setDraft('node_code', e.target.value)}
                        >
                          <option value="">—</option>
                          {(data.rows || [])
                            .filter((node) => node.status === 'active')
                            .map((node) => (
                              <option key={node.code} value={node.code}>
                                {node.code}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        {label('classificationKeyword')} ({label('classificationOptional')})
                        <input
                          className={input}
                          maxLength={120}
                          value={draft.pattern || ''}
                          onChange={(e) => setDraft('pattern', e.target.value)}
                        />
                      </label>
                      <label>
                        {label('classificationLocale')}
                        <select
                          className={input}
                          value={draft.locale || 'en'}
                          onChange={(e) => setDraft('locale', e.target.value)}
                        >
                          {LOCALES.map((locale) => <option key={locale} value={locale}>{locale}</option>)}
                        </select>
                      </label>
                      <label>
                        {label('classificationNote')} ({label('classificationOptional')})
                        <textarea
                          className={input}
                          maxLength={500}
                          rows={2}
                          value={draft.review_note || ''}
                          onChange={(e) => setDraft('review_note', e.target.value)}
                        />
                      </label>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={button}
                        disabled={busy || !(draft.node_code || row.proposed_code)}
                        onClick={() => reviewClassification(row, 'approve')}
                      >
                        {label('classificationApprove')}
                      </button>
                      <button
                        type="button"
                        className="rounded border px-4 py-2"
                        disabled={busy}
                        onClick={() => reviewClassification(row, 'reject')}
                      >
                        {label('classificationReject')}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
      {data?.rows &&
        section !== 'clusters' &&
        (section !== 'demand' || view === 'table') &&
        (data.rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  {(section === 'demand'
                    ? [
                        'place',
                        'country',
                        'intent',
                        'count',
                        'demandScore',
                        'supply',
                        'gap',
                        'trend',
                        'anomaly',
                      ]
                    : [
                        'name',
                        'status',
                        section === 'segments'
                          ? 'segment'
                          : section === 'suggestions'
                            ? 'suggestions'
                            : 'campaigns',
                      ]
                  ).map((k) => (
                    <th key={k} scope="col" className="p-3 text-start">
                      {label(k)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, i) => (
                  <tr
                    key={row.id || i}
                    className="border-t border-gray-200 dark:border-gray-700"
                  >
                    {renderRow(row)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>{label('empty')}</p>
        ))}
      {['demand', 'clusters'].includes(section) && (
        <p className="text-sm">{label('attribution')}</p>
      )}
      {section === 'campaigns' && (
        <p className="text-sm">{label('nativePartial')}</p>
      )}
    </main>
  );
}
