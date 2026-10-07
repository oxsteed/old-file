// Pure helpers for restaurant Media device uploads (photos + quarantined
// videos). Kept free of JSX and bundler globals so the client scripts
// tests can import them directly from node.
//
// Server contract (subagents A/B):
//   POST /restaurants/:id/media/photo-uploads  (multipart: file, caption,
//     dishIds as a JSON array) -> 201 with the media item
//     (media_type 'photo_upload', processing_status 'ready').
//   POST /restaurants/:id/media/video-uploads  (same fields) -> 202
//     { id, media_type 'video_upload', processing_status 'quarantine' }.
//   POST /restaurants/:id/media/:mediaId/retry
// The public list only ever contains visible + ready rows, so quarantined
// videos never appear there; the uploader gets a processing notice instead.

export const MEDIA_UPLOAD_TABS = ['link', 'photo', 'video'];

export const PHOTO_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
export const VIDEO_MAX_BYTES = 200 * 1024 * 1024; // 200 MB

export const PHOTO_MIME_ALLOWLIST = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const VIDEO_MIME_ALLOWLIST = ['video/mp4', 'video/webm', 'video/quicktime'];

// Multipart upload endpoints, relative to /restaurants/:id/media.
export const UPLOAD_ENDPOINTS = { photo: 'photo-uploads', video: 'video-uploads' };

// validateUploadFile(file, kind)
// file: a File-like { size, type }. kind: 'photo' | 'video'.
// Returns { ok: true } or { ok: false, error } where error is a leaf under
// food.restaurant.media.upload ('fileTooLarge' | 'fileTypeNotAllowed').
export const validateUploadFile = (file, kind) => {
  const maxBytes = kind === 'video' ? VIDEO_MAX_BYTES : PHOTO_MAX_BYTES;
  const allowlist = kind === 'video' ? VIDEO_MIME_ALLOWLIST : PHOTO_MIME_ALLOWLIST;
  const type = typeof file?.type === 'string' ? file.type.toLowerCase() : '';
  if (!type || !allowlist.includes(type)) return { ok: false, error: 'fileTypeNotAllowed' };
  const size = Number(file?.size);
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: 'fileTypeNotAllowed' };
  if (size > maxBytes) return { ok: false, error: 'fileTooLarge' };
  return { ok: true };
};

export const isPhotoUpload = (media) => media?.media_type === 'photo_upload';
export const isVideoUpload = (media) => media?.media_type === 'video_upload';
export const isUploadItem = (media) => isPhotoUpload(media) || isVideoUpload(media);

// pickBestRendition(renditions): prefer 720p, otherwise the height closest
// to 720 (ties go to the smaller rendition, less bandwidth). Renditions are
// { url, width, height }. Returns the rendition object, or null.
export const pickBestRendition = (renditions) => {
  if (!Array.isArray(renditions) || renditions.length === 0) return null;
  const usable = renditions.filter((r) => r && r.url && Number.isFinite(Number(r.height)));
  if (usable.length === 0) return null;
  return usable
    .map((r) => ({ r, h: Number(r.height) }))
    .sort((a, b) => (Math.abs(a.h - 720) - Math.abs(b.h - 720)) || (a.h - b.h))[0].r;
};

// uploadedMediaUrl(media): the display URL for upload items.
// Photo -> url (full size), falling back to thumbnail_url.
// Video -> best rendition url, falling back to url.
// Link rows (or anything without a URL) -> null.
export const uploadedMediaUrl = (media) => {
  if (isPhotoUpload(media)) return media.url || media.thumbnail_url || null;
  if (isVideoUpload(media)) {
    const best = pickBestRendition(media.renditions);
    return (best && best.url) || media.url || null;
  }
  return null;
};

// uploadOutcome(status): 201 -> 'ready' (photos land ready synchronously),
// 202 -> 'processing' (videos start in quarantine), else 'unknown'.
export const uploadOutcome = (status) => {
  if (status === 201) return 'ready';
  if (status === 202) return 'processing';
  return 'unknown';
};

// formatFileSize(bytes): short "4.2 MB" style label for the picker.
export const formatFileSize = (bytes) => {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '';
  const mb = n / (1024 * 1024);
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
};

// uploadMediaWithProgress({ url, formData, headers, onProgress, XHR })
//
// XHR-based multipart POST. fetch cannot report upload progress, so device
// uploads go through raw XMLHttpRequest. The XHR constructor is injectable
// (and defaults to globalThis.XMLHttpRequest) so tests can drive it.
//
// Resolves { status, outcome, item } on 201/202. Rejects on network failure
// or any other status with an axios-shaped error (err.response.data, err.code)
// so the existing mediaErrorCode mapper keeps working.
export const uploadMediaWithProgress = ({ url, formData, headers = {}, onProgress, XHR }) =>
  new Promise((resolve, reject) => {
    const XHRCtor = XHR || globalThis.XMLHttpRequest;
    if (typeof XHRCtor !== 'function') {
      reject(Object.assign(new Error('upload not supported in this environment'), { code: 'upload_unsupported' }));
      return;
    }
    const xhr = new XHRCtor();
    xhr.open('POST', url);
    // Send the httpOnly session cookies (the access token is no longer in
    // localStorage).
    xhr.withCredentials = true;
    for (const [name, value] of Object.entries(headers || {})) xhr.setRequestHeader(name, value);
    if (xhr.upload && typeof onProgress === 'function') {
      xhr.upload.onprogress = (event) => {
        if (event && event.lengthComputable && Number(event.total) > 0) {
          onProgress(Number(event.loaded) / Number(event.total));
        }
      };
    }
    xhr.onload = () => {
      let body = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        body = null;
      }
      if (xhr.status === 201 || xhr.status === 202) {
        const item = body?.media || body?.item || body;
        resolve({ status: xhr.status, outcome: uploadOutcome(xhr.status), item });
        return;
      }
      const serverCode = body?.code
        || body?.error?.code
        || (typeof body?.error === 'string' ? body.error : null);
      const err = new Error(serverCode || `upload failed (status ${xhr.status})`);
      err.code = serverCode || 'uploadFailed';
      err.response = { data: body, status: xhr.status };
      reject(err);
    };
    xhr.onerror = () => {
      const err = new Error('network error during upload');
      err.code = 'network';
      reject(err);
    };
    xhr.send(formData);
  });
