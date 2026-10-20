import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../../../lib/adminApi';
import { useHasGrant } from '../../lib/GrantGuard';

// Campaign operations for the Demand & Sales Engine (spec 15.2): editing
// (changes after approval force re-approval), scheduling, the review-time
// caps/overlap preview, approval with fresh TOTP and the review checklist,
// and results with holdout lift. The server enforces every grant again.
const LOCALES = ['en', 'es', 'fr', 'ht', 'ar'];
const input =
  'w-full rounded border border-gray-300 bg-white p-2 text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100';
const button = 'rounded bg-orange-700 px-4 py-2 text-white disabled:opacity-50';
const CHECKLIST = ['audience', 'caps', 'channels', 'disclosures', 'locales', 'rtl'];

export default function CampaignManager() {
  const { id } = useParams();
  const { t } = useTranslation();
  const label = (key) => t(`growthInsights.${key}`);
  const canManage = useHasGrant('manage_marketing');
  const canApprove = useHasGrant('approve_growth_campaigns');
  const [campaign, setCampaign] = useState(null),
    [results, setResults] = useState(null),
    [preview, setPreview] = useState(null),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null);
  const [scheduleAt, setScheduleAt] = useState(''),
    [totp, setTotp] = useState(''),
    [checklist, setChecklist] = useState({});

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/growth/campaigns');
      const found = (data.rows || []).find((c) => String(c.id) === String(id));
      setCampaign(found || null);
      if (found) {
        setForm({
          name: found.name,
          channels: (found.channels || []).join(', '),
          holdout_pct: found.holdout_pct,
          copy: Object.fromEntries(
            LOCALES.map((l) => [
              l,
              {
                title: found.copy?.[l]?.title || '',
                body: found.copy?.[l]?.body || '',
                button: found.copy?.[l]?.button || '',
                push_title: found.copy?.[l]?.push_title || '',
                push_body: found.copy?.[l]?.push_body || '',
                disclosure: found.copy?.[l]?.disclosure || '',
              },
            ]),
          ),
        });
        const r = await api.get(`/admin/growth/campaigns/${id}/results`);
        setResults(r.data);
      }
    } catch {
      setError(true);
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn) => {
    setBusy(true);
    setError(false);
    try {
      await fn();
      await load();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const action = (name, body = {}) =>
    act(() => api.post(`/admin/growth/campaigns/${id}/${name}`, body));
  const saveEdit = () =>
    act(() =>
      api.patch(`/admin/growth/campaigns/${id}`, {
        name: form.name,
        channels: form.channels
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        holdout_pct: Number(form.holdout_pct),
        copy: form.copy,
      }),
    );
  const loadPreview = () =>
    act(async () => {
      const { data } = await api.get(
        `/admin/growth/campaigns/${id}/review-preview`,
      );
      setPreview(data);
    });

  if (!campaign)
    return (
      <div className="p-6 text-gray-900 dark:text-gray-100">
        {error ? label('error') : label('loading')}
      </div>
    );
  const editable = ['draft', 'changes_requested', 'approved', 'scheduled'].includes(
    campaign.status,
  );
  return (
    <div className="space-y-8 p-6 text-gray-900 dark:text-gray-100">
      <Link className="underline" to="/admin/growth/campaigns">
        {label('campaigns')}
      </Link>
      <h1 className="text-2xl font-semibold">
        {campaign.name} ({label('status')}: {campaign.status})
      </h1>
      {error && <p role="alert">{label('error')}</p>}

      {form && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">{label('editCampaign')}</h2>
          <div className="grid gap-3 md:grid-cols-3">
            <input
              className={input}
              aria-label={label('name')}
              value={form.name}
              disabled={!editable}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <input
              className={input}
              aria-label={label('channels')}
              value={form.channels}
              disabled={!editable}
              onChange={(e) => setForm({ ...form, channels: e.target.value })}
            />
            <input
              className={input}
              type="number"
              min="0"
              max="50"
              aria-label={label('holdoutPct')}
              value={form.holdout_pct}
              disabled={!editable}
              onChange={(e) =>
                setForm({ ...form, holdout_pct: e.target.value })
              }
            />
          </div>
          {LOCALES.map((l) => (
            <div key={l} className="grid gap-2 md:grid-cols-3">
              {['title', 'body', 'button', 'push_title', 'push_body', 'disclosure'].map(
                (field) => (
                  <input
                    key={field}
                    className={input}
                    aria-label={`${field} ${l}`}
                    placeholder={`${field} (${l})`}
                    value={form.copy[l][field]}
                    disabled={!editable}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        copy: {
                          ...form.copy,
                          [l]: { ...form.copy[l], [field]: e.target.value },
                        },
                      })
                    }
                  />
                ),
              )}
            </div>
          ))}
          {canManage && editable && (
            <button className={button} disabled={busy} onClick={saveEdit}>
              {label('save')}
            </button>
          )}
        </section>
      )}

      <section className="flex flex-wrap gap-2">
        {canManage && ['draft', 'changes_requested'].includes(campaign.status) && (
          <button className={button} disabled={busy} onClick={() => action('review')}>
            {label('review')}
          </button>
        )}
        {canManage && campaign.status === 'in_review' && (
          <button className={button} disabled={busy} onClick={() => action('changes')}>
            {label('review')}
          </button>
        )}
        {canApprove && campaign.status === 'approved' && (
          <>
            <input
              className={input}
              style={{ maxWidth: 260 }}
              type="datetime-local"
              aria-label={label('scheduledAt')}
              value={scheduleAt}
              onChange={(e) => setScheduleAt(e.target.value)}
            />
            <button
              className={button}
              disabled={busy || !scheduleAt}
              onClick={() =>
                action('schedule', {
                  scheduled_at: new Date(scheduleAt).toISOString(),
                })
              }
            >
              {label('scheduleCampaign')}
            </button>
            <button className={button} disabled={busy} onClick={() => action('queue')}>
              {label('queue')}
            </button>
          </>
        )}
        {canApprove && campaign.status === 'scheduled' && (
          <button className={button} disabled={busy} onClick={() => action('queue')}>
            {label('queue')}
          </button>
        )}
        {canManage && campaign.status === 'sending' && (
          <button className={button} disabled={busy} onClick={() => action('pause')}>
            {label('pause')}
          </button>
        )}
        {canManage && !['sent', 'cancelled'].includes(campaign.status) && (
          <button className={button} disabled={busy} onClick={() => action('cancel')}>
            {label('cancel')}
          </button>
        )}
        <button className={button} disabled={busy} onClick={loadPreview}>
          {label('reviewPreview')}
        </button>
      </section>

      {campaign.status === 'in_review' && canApprove && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">{label('reviewChecklist')}</h2>
          {CHECKLIST.map((key) => (
            <label key={key} className="flex gap-2">
              <input
                type="checkbox"
                checked={checklist[key] === true}
                onChange={(e) =>
                  setChecklist({ ...checklist, [key]: e.target.checked })
                }
              />
              {label(`review${key[0].toUpperCase()}${key.slice(1)}`)}
            </label>
          ))}
          <input
            className={input}
            style={{ maxWidth: 200 }}
            aria-label={label('totp')}
            placeholder={label('totp')}
            value={totp}
            onChange={(e) => setTotp(e.target.value)}
          />
          <button
            className={button}
            disabled={busy || !/^\d{6}$/.test(totp)}
            onClick={() => action('approve', { totp, checklist })}
          >
            {label('approve')}
          </button>
        </section>
      )}

      {preview && (
        <section className="space-y-2">
          <h2 className="text-lg font-medium">{label('reviewPreview')}</h2>
          <p>
            {label('audience')}: {preview.audience}
          </p>
          {Object.entries(preview.caps_skipped || {}).map(([channel, n]) => (
            <p key={channel}>
              {label('capsSkipped')} ({channel}): {n}
            </p>
          ))}
          <p>
            {label('quietHeld')}: {preview.quiet_hours_held}
          </p>
          <p>
            {label('noPushDevice')}: {preview.no_push_device}
          </p>
          <p>{label('overlap')}:</p>
          <ul>
            {(preview.overlap || []).map((o) => (
              <li key={o.campaign_id}>
                {o.name} ({o.status}): {o.shared_recipients}
              </li>
            ))}
          </ul>
        </section>
      )}

      {results && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">{label('results')}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th>{label('channels')}</th>
                  <th>{label('delivered')}</th>
                  <th>{label('opened')}</th>
                  <th>{label('clicked')}</th>
                  <th>{label('count')}</th>
                </tr>
              </thead>
              <tbody>
                {(results.channels || []).map((c) => (
                  <tr key={c.channel}>
                    <td>{c.channel}</td>
                    <td>{c.delivered}</td>
                    <td>
                      {c.opened}
                      {c.native_push_opens_partial
                        ? ` (${label('nativePartial')})`
                        : ''}
                    </td>
                    <td>{c.clicked}</td>
                    <td>{c.attempted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            {label('gross')}: {results.conversions?.gross} · {label('net')}:{' '}
            {results.conversions?.net} · {label('reversed')}:{' '}
            {results.conversions?.reversed}
          </p>
          {(results.conversions?.by_currency || []).map((c) => (
            <p key={`${c.currency}-${c.status}`}>
              {c.currency} {c.status}: {c.n}
              {c.commission_minor !== undefined
                ? ` · ${c.commission_minor}`
                : ''}
            </p>
          ))}
          <p>
            {label('holdout')}: {results.holdout?.control_recipients} /{' '}
            {results.holdout?.treated_recipients} · {label('lift')}:{' '}
            {results.holdout?.lift === null || results.holdout?.lift === undefined
              ? label('empty')
              : `${(results.holdout.lift * 100).toFixed(2)}% [${(
                  results.holdout.low * 100
                ).toFixed(2)}, ${(results.holdout.high * 100).toFixed(2)}]`}
          </p>
        </section>
      )}
    </div>
  );
}
