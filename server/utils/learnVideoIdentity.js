'use strict';
const hosts = new Set(['youtube.com','www.youtube.com','m.youtube.com','youtu.be','vimeo.com','www.vimeo.com','player.vimeo.com']);

function normalizeSubmittedVideoUrl(raw) {
  if (typeof raw !== 'string' || raw.trim().length > 500) return null;
  let parsed;
  try { parsed = new URL(raw.trim()); } catch { return null; }
  if (!['https:', 'http:'].includes(parsed.protocol) || !hosts.has(parsed.hostname)) return null;
  if (parsed.hostname.includes('vimeo.com')) {
    const id = parsed.pathname.match(/\/(\d+)(?:\/|$)/)?.[1];
    return id ? { url: `https://vimeo.com/${id}`, provider: 'vimeo', identity: `vimeo:${id}` } : null;
  }
  let id = parsed.searchParams.get('v');
  if (parsed.hostname === 'youtu.be' || !id) {
    const rawId = parsed.hostname === 'youtu.be' ? parsed.pathname.split('/').filter(Boolean)[0]
      : parsed.pathname.match(/\/(?:embed|shorts)\/([^/?]+)/)?.[1];
    try { id = rawId && decodeURIComponent(rawId); } catch { return null; }
  }
  return id && /^[A-Za-z0-9_-]{3,}$/.test(id)
    ? { url: `https://www.youtube.com/watch?v=${id}`, provider: 'youtube', identity: `youtube:${id}` } : null;
}

async function lockVideoIdentity(client, rawUrl) {
  const normalized = normalizeSubmittedVideoUrl(rawUrl);
  const identity = normalized?.identity || `raw:${rawUrl}`;
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`learn-video:${identity}`]);
  return { normalized, identity };
}

module.exports = { normalizeSubmittedVideoUrl, lockVideoIdentity };
