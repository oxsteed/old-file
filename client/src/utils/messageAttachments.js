/**
 * Map an upload response or composer payload onto the shape the messages API stores.
 */
export function toStoredAttachment(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const url = typeof meta.url === 'string' ? meta.url.trim() : '';
  if (!url) return null;
  return {
    url,
    type: meta.type || meta.mimeType || null,
    filename: meta.filename || meta.name || null,
  };
}

export function attachmentLabel(att) {
  return att?.filename || att?.name || 'Attachment';
}

export function isImageAttachment(att) {
  const type = att?.type || att?.mimeType || '';
  if (typeof type === 'string' && type.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|heic|svg)(\?|$)/i.test(att?.filename || att?.name || att?.url || '');
}

/**
 * Profile live-chat historically encoded files in message text.
 * Render those as attachments when the JSON column is empty.
 */
export function parseInlineAttachments(content) {
  if (!content || typeof content !== 'string') {
    return { text: content || '', attachments: [] };
  }
  const attachments = [];
  const text = content.replace(/\[attachment:([^|\]]+)\|([^|\]]*)\|([^\]]*)\]/g, (_match, url, name, mimeType) => {
    attachments.push({
      url: url.trim(),
      filename: (name || '').trim() || null,
      type: (mimeType || '').trim() || null,
    });
    return '';
  }).trim();
  return { text, attachments };
}
