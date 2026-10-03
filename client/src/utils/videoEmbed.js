// Shared YouTube/Vimeo URL helpers.
//
// Convert a YouTube watch/shorts or Vimeo URL to its embed form for a
// sandboxed iframe. Returns null for anything else (including non-https
// URLs) so the caller falls back to a placeholder. video_provider
// ('youtube'|'vimeo'|null) is a hint; the URL host is also sniffed so
// provider-less rows still resolve.

// Parse a video URL into { provider: 'youtube'|'vimeo', id } or null.
// Accepts YouTube watch/shorts/embed/live links, youtu.be links, and
// Vimeo watch/player links. Provider hint wins over host sniffing.
export const parseVideoUrl = (url, provider) => {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!/^https:\/\//i.test(trimmed)) return null;
  let host = '';
  try {
    host = new URL(trimmed).hostname.toLowerCase();
  } catch (_) {
    return null;
  }
  const isYouTube = provider === 'youtube'
    || host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be';
  if (isYouTube) {
    const m = trimmed.match(/(?:youtube\.com\/(?:watch\?[^#\s]*v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    return m ? { provider: 'youtube', id: m[1] } : null;
  }
  const isVimeo = provider === 'vimeo'
    || host === 'vimeo.com' || host.endsWith('.vimeo.com') || host === 'player.vimeo.com';
  if (isVimeo) {
    const m = trimmed.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    return m ? { provider: 'vimeo', id: m[1] } : null;
  }
  return null;
};

// Base embed URL (paused). Identical semantics to the Learn page's old
// local helper so existing callers behave exactly as before.
export const toEmbedUrl = (url, provider) => {
  const parsed = parseVideoUrl(url, provider);
  if (!parsed) return null;
  return parsed.provider === 'youtube'
    ? `https://www.youtube.com/embed/${parsed.id}`
    : `https://player.vimeo.com/video/${parsed.id}`;
};

// Embed URL with autoplay+muted params for the in-view feed slot.
// YouTube: https://www.youtube.com/embed/ID?autoplay=1&mute=1&playsinline=1&rel=0
// Vimeo:   https://player.vimeo.com/video/ID?autoplay=1&muted=1&playsinline=1
export const toAutoplayEmbedUrl = (url, provider) => {
  const parsed = parseVideoUrl(url, provider);
  if (!parsed) return null;
  return parsed.provider === 'youtube'
    ? `https://www.youtube.com/embed/${parsed.id}?autoplay=1&mute=1&playsinline=1&rel=0`
    : `https://player.vimeo.com/video/${parsed.id}?autoplay=1&muted=1&playsinline=1`;
};

// Detect the provider from a pasted URL for live form feedback.
// Returns 'youtube' | 'vimeo' | null (null = not a usable video link).
export const detectVideoProvider = (url) => {
  const parsed = parseVideoUrl(url, null);
  return parsed ? parsed.provider : null;
};

// Poster image for the tap-to-play fallback. YouTube exposes static
// thumbnails; Vimeo thumbnails need oEmbed, so we return null and the
// caller renders a gradient placeholder.
export const toPosterImageUrl = (url, provider) => {
  const parsed = parseVideoUrl(url, provider);
  if (!parsed) return null;
  if (parsed.provider === 'youtube') return `https://i.ytimg.com/vi/${parsed.id}/hqdefault.jpg`;
  return null;
};
