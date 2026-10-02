import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, Globe2, MapPin, MonitorSmartphone, Search, Users } from 'lucide-react';
import api from '../../api/axios';
import logger from '../../utils/logger';

// Super-admin: site visitor history with locations (in-house analytics).
// Data comes from the client pageview beacon; locations are derived from
// Cloudflare geolocation headers and raw IPs are never stored.

const PAGE_SIZE = 50;

function defaultRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

export default function VisitorHistoryPage() {
  const { t, i18n } = useTranslation();
  const copy = (key, options) => t(`adminVisitors.${key}`, options);

  const [range, setRange] = useState(defaultRange);
  const [country, setCountry] = useState('');
  const [pathFilter, setPathFilter] = useState('');
  const [device, setDevice] = useState('');
  const [includeBots, setIncludeBots] = useState(false);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [page, setPage] = useState(1);

  const [visits, setVisits] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const countryNames = useMemo(() => {
    try {
      return new Intl.DisplayNames([i18n.language || 'en'], { type: 'region' });
    } catch {
      return new Intl.DisplayNames(['en'], { type: 'region' });
    }
  }, [i18n.language]);

  const countryLabel = useCallback((code) => {
    if (!code) return copy('unknownLocation', { defaultValue: 'Unknown' });
    try { return countryNames.of(code) || code; } catch { return code; }
  }, [countryNames, copy]);

  const locationLabel = useCallback((visit) => {
    const parts = [];
    if (visit.city) parts.push(visit.city);
    else if (visit.region_name) parts.push(visit.region_name);
    parts.push(countryLabel(visit.country_code));
    return parts.join(', ');
  }, [countryLabel]);

  const params = useMemo(() => {
    const p = { from: range.from, to: range.to, page, limit: PAGE_SIZE };
    if (country.trim()) p.country = country.trim();
    if (pathFilter.trim()) p.path = pathFilter.trim();
    if (device) p.device = device;
    if (includeBots) p.includeBots = 'true';
    if (appliedSearch.trim()) p.q = appliedSearch.trim();
    return p;
  }, [range, country, pathFilter, device, includeBots, appliedSearch, page]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all([
      api.get('/analytics/admin/visitors', { params, timeout: 30000 }),
      api.get('/analytics/admin/visitors/summary', { params: { ...params, page: undefined, limit: undefined }, timeout: 30000 }),
    ])
      .then(([listRes, summaryRes]) => {
        if (cancelled) return;
        setVisits(listRes.data?.visits || []);
        setTotal(listRes.data?.total || 0);
        setSummary(summaryRes.data || null);
      })
      .catch((err) => {
        if (cancelled) return;
        logger.warn('Failed to load visitor history', { message: err?.message });
        setError(copy('loadError', { defaultValue: 'Could not load visitor history.' }));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [params, copy]);

  const resetPage = () => setPage(1);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const card = { background: 'var(--color-surface)', borderRadius: '12px', padding: '1.25rem', boxShadow: '0 2px 4px rgba(0,0,0,0.08)' };
  const input = { padding: '0.55rem 0.75rem', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.875rem' };
  const label = { display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.3rem', color: 'var(--color-text-muted)' };

  return (
    <div style={{ padding: '2rem', background: 'var(--color-bg)', minHeight: '100vh' }}>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <Eye size={26} />{copy('title', { defaultValue: 'Visitor history' })}
      </h1>
      <p style={{ color: 'var(--color-text-muted)', marginTop: '0.4rem', marginBottom: '1.5rem' }}>
        {copy('subtitle', { defaultValue: 'Every recorded site visit with visitor location. Raw IP addresses are never stored.' })}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}><Globe2 size={15} />{copy('totalVisits', { defaultValue: 'Total visits' })}</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--color-text)', marginTop: '0.3rem' }}>{loading ? '…' : (summary?.totals?.visits ?? 0).toLocaleString()}</div>
        </div>
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}><Users size={15} />{copy('uniqueVisitors', { defaultValue: 'Unique visitors' })}</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--color-text)', marginTop: '0.3rem' }}>{loading ? '…' : (summary?.totals?.unique_visitors ?? 0).toLocaleString()}</div>
        </div>
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}><MapPin size={15} />{copy('countries', { defaultValue: 'Countries' })}</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--color-text)', marginTop: '0.3rem' }}>{loading ? '…' : (summary?.byCountry?.length ?? 0)}</div>
        </div>
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}><MonitorSmartphone size={15} />{copy('topCountry', { defaultValue: 'Top country' })}</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text)', marginTop: '0.3rem' }}>
            {loading ? '…' : summary?.byCountry?.[0] ? `${countryLabel(summary.byCountry[0].country_code)} (${summary.byCountry[0].visits.toLocaleString()})` : '—'}
          </div>
        </div>
      </div>

      <div style={{ ...card, marginBottom: '1.5rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.9rem', alignItems: 'end' }}>
          <div><span style={label}>{copy('fromDate', { defaultValue: 'From' })}</span><input type="date" style={input} value={range.from} max={range.to} onChange={(e) => { setRange((r) => ({ ...r, from: e.target.value })); resetPage(); }} /></div>
          <div><span style={label}>{copy('toDate', { defaultValue: 'To' })}</span><input type="date" style={input} value={range.to} min={range.from} onChange={(e) => { setRange((r) => ({ ...r, to: e.target.value })); resetPage(); }} /></div>
          <div><span style={label}>{copy('country', { defaultValue: 'Country code' })}</span><input style={input} value={country} maxLength={2} placeholder={copy('countryPlaceholder', { defaultValue: 'e.g. US, HT, FR' })} onChange={(e) => { setCountry(e.target.value.toUpperCase()); resetPage(); }} /></div>
          <div><span style={label}>{copy('pagePath', { defaultValue: 'Page path' })}</span><input style={input} value={pathFilter} placeholder={copy('pagePathPlaceholder', { defaultValue: 'e.g. /direct' })} onChange={(e) => { setPathFilter(e.target.value); resetPage(); }} /></div>
          <div>
            <span style={label}>{copy('device', { defaultValue: 'Device' })}</span>
            <select style={input} value={device} onChange={(e) => { setDevice(e.target.value); resetPage(); }}>
              <option value="">{copy('allDevices', { defaultValue: 'All devices' })}</option>
              <option value="desktop">{copy('desktop', { defaultValue: 'Desktop' })}</option>
              <option value="mobile">{copy('mobile', { defaultValue: 'Mobile' })}</option>
              <option value="tablet">{copy('tablet', { defaultValue: 'Tablet' })}</option>
            </select>
          </div>
          <div>
            <span style={label}>{copy('search', { defaultValue: 'Search' })}</span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input style={{ ...input, flex: 1 }} value={search} placeholder={copy('searchPlaceholder', { defaultValue: 'Page, city, referrer…' })} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { setAppliedSearch(search); resetPage(); } }} />
              <button type="button" onClick={() => { setAppliedSearch(search); resetPage(); }} style={{ ...input, cursor: 'pointer' }} aria-label={copy('search', { defaultValue: 'Search' })}><Search size={16} /></button>
            </div>
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.9rem', fontSize: '0.85rem', color: 'var(--color-text)' }}>
          <input type="checkbox" checked={includeBots} onChange={(e) => { setIncludeBots(e.target.checked); resetPage(); }} />
          {copy('includeBots', { defaultValue: 'Include bots and crawlers' })}
        </label>
      </div>

      {error && (
        <div style={{ ...card, marginBottom: '1.5rem', color: '#b91c1c' }}>{error}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={card}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem', color: 'var(--color-text)' }}>{copy('topCountries', { defaultValue: 'Top countries' })}</h3>
          {(summary?.byCountry || []).slice(0, 8).map((row) => (
            <div key={row.country_code || 'unknown'} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0', fontSize: '0.85rem', color: 'var(--color-text)' }}>
              <span>{countryLabel(row.country_code)}</span><strong>{row.visits.toLocaleString()}</strong>
            </div>
          ))}
          {(!summary?.byCountry || summary.byCountry.length === 0) && !loading && <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>{copy('noData', { defaultValue: 'No data yet.' })}</p>}
        </div>
        <div style={card}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem', color: 'var(--color-text)' }}>{copy('topPages', { defaultValue: 'Top pages' })}</h3>
          {(summary?.topPages || []).slice(0, 8).map((row) => (
            <div key={row.path} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0', fontSize: '0.85rem', color: 'var(--color-text)' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{row.path}</span><strong>{row.visits.toLocaleString()}</strong>
            </div>
          ))}
          {(!summary?.topPages || summary.topPages.length === 0) && !loading && <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>{copy('noData', { defaultValue: 'No data yet.' })}</p>}
        </div>
      </div>

      <div style={{ ...card, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
              <th style={{ padding: '0.6rem' }}>{copy('colTime', { defaultValue: 'Time' })}</th>
              <th style={{ padding: '0.6rem' }}>{copy('colPage', { defaultValue: 'Page' })}</th>
              <th style={{ padding: '0.6rem' }}>{copy('colLocation', { defaultValue: 'Location' })}</th>
              <th style={{ padding: '0.6rem' }}>{copy('colDevice', { defaultValue: 'Device' })}</th>
              <th style={{ padding: '0.6rem' }}>{copy('colVisitor', { defaultValue: 'Visitor' })}</th>
            </tr>
          </thead>
          <tbody>
            {visits.map((visit) => (
              <tr key={visit.id} style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                <td style={{ padding: '0.6rem', whiteSpace: 'nowrap' }}>{new Date(visit.visited_at).toLocaleString()}</td>
                <td style={{ padding: '0.6rem', maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{visit.path}</td>
                <td style={{ padding: '0.6rem' }}>{locationLabel(visit)}</td>
                <td style={{ padding: '0.6rem', textTransform: 'capitalize' }}>{visit.device_type}{visit.is_bot ? ` (${copy('bot', { defaultValue: 'bot' })})` : ''}</td>
                <td style={{ padding: '0.6rem' }}>{visit.user_name || visit.user_email || copy('anonymous', { defaultValue: 'Anonymous' })}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && visits.length === 0 && (
          <p style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
            {copy('noResults', { defaultValue: 'No visits match these filters yet.' })}
          </p>
        )}
        {loading && <p style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>{copy('loading', { defaultValue: 'Loading…' })}</p>}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '1rem', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
          <span>{copy('showing', { defaultValue: 'Showing {{count}} of {{total}}', count: visits.length, total })}</span>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} style={{ ...input, cursor: page <= 1 ? 'default' : 'pointer', opacity: page <= 1 ? 0.5 : 1 }}>{copy('prev', { defaultValue: 'Previous' })}</button>
            <span>{page} / {totalPages}</span>
            <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} style={{ ...input, cursor: page >= totalPages ? 'default' : 'pointer', opacity: page >= totalPages ? 0.5 : 1 }}>{copy('next', { defaultValue: 'Next' })}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
