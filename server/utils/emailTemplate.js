'use strict';

const escapeHtml = require('./escapeHtml');
const { absoluteUrl } = require('./publicSiteUrl');

const SUPPORTED_LANGUAGES = new Set(['en', 'es', 'fr', 'ht', 'ar']);

function normalizeEmailLanguage(language) {
  const normalized = String(language || 'en')
    .split(',')[0]
    .trim()
    .split(/[-_]/)[0]
    .toLowerCase();
  return SUPPORTED_LANGUAGES.has(normalized) ? normalized : 'en';
}

function textSafe(value) {
  return value === null || value === undefined ? '' : String(value);
}

function htmlParagraph(value) {
  const text = textSafe(value).trim();
  if (!text) return '';
  return `<p style="margin:0 0 16px;color:#334155;font-size:16px;line-height:1.65;">${escapeHtml(text).replace(/\n/g, '<br>')}</p>`;
}

function textFromHtml(value) {
  return textSafe(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function renderCodeBlock({ label, code, note, tone = 'orange' }) {
  const accent = tone === 'blue' ? '#1d4ed8' : '#c2410c';
  const background = tone === 'blue' ? '#eff6ff' : '#fff7ed';
  const border = tone === 'blue' ? '#bfdbfe' : '#fed7aa';
  const safeCode = escapeHtml(textSafe(code));
  const safeLabel = escapeHtml(textSafe(label));
  const safeNote = escapeHtml(textSafe(note));
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border:1px solid ${border};border-radius:12px;background:${background};"><tr><td style="padding:16px;text-align:center;"><p style="margin:0 0 8px;color:${accent};font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;">${safeLabel}</p><p style="margin:0;color:${accent};font-size:30px;font-weight:800;letter-spacing:5px;line-height:1.2;word-break:break-word;">${safeCode}</p>${safeNote ? `<p style="margin:10px 0 0;color:#475569;font-size:13px;line-height:1.5;">${safeNote}</p>` : ''}</td></tr></table>`,
    text: `${textSafe(label)}: ${textSafe(code)}${note ? `\n${textSafe(note)}` : ''}`,
  };
}

function renderCallout({ title, body, tone = 'neutral' }) {
  const colors = {
    neutral: { background: '#f8fafc', border: '#cbd5e1', title: '#334155' },
    warning: { background: '#fff7ed', border: '#fed7aa', title: '#9a3412' },
    success: { background: '#ecfdf5', border: '#a7f3d0', title: '#047857' },
    danger: { background: '#fef2f2', border: '#fecaca', title: '#b91c1c' },
  };
  const palette = colors[tone] || colors.neutral;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border:1px solid ${palette.border};border-radius:12px;background:${palette.background};"><tr><td style="padding:16px;"><p style="margin:0 0 6px;color:${palette.title};font-size:14px;font-weight:700;">${escapeHtml(textSafe(title))}</p><p style="margin:0;color:#475569;font-size:14px;line-height:1.55;">${escapeHtml(textSafe(body)).replace(/\n/g, '<br>')}</p></td></tr></table>`;
}

function renderDetails(details = []) {
  const rows = details
    .filter((detail) => detail && detail.label && detail.value !== undefined && detail.value !== null)
    .map((detail) => `<tr><td style="padding:8px 0;color:#64748b;font-size:14px;vertical-align:top;">${escapeHtml(textSafe(detail.label))}</td><td style="padding:8px 0;color:#0f172a;font-size:14px;text-align:right;vertical-align:top;word-break:break-word;">${escapeHtml(textSafe(detail.value))}</td></tr>`)
    .join('');
  return rows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">${rows}</table>` : '';
}

function renderOxSteedEmail(options = {}) {
  const language = normalizeEmailLanguage(options.language);
  const direction = language === 'ar' ? 'rtl' : 'ltr';
  const title = textSafe(options.title || 'A message from OxSteed');
  const preheader = textSafe(options.preheader || title);
  const eyebrow = textSafe(options.eyebrow || 'OXSTEED');
  const intro = textSafe(options.intro);
  const bodyHtml = textSafe(options.bodyHtml);
  const bodyText = textSafe(options.bodyText || textFromHtml(bodyHtml));
  const cta = options.cta && options.cta.url && options.cta.label ? options.cta : null;
  const ctaUrl = cta ? absoluteUrl(cta.url) : '';
  const noticeHtml = options.notice ? renderCallout(options.notice) : '';
  const detailsHtml = renderDetails(options.details);
  const codeBlocks = Array.isArray(options.codeBlocks) ? options.codeBlocks : [];
  const codeHtml = codeBlocks.map((block) => renderCodeBlock(block).html).join('');
  const codeText = codeBlocks.map((block) => renderCodeBlock(block).text).join('\n\n');
  const footerText = textSafe(options.footerText || 'You are receiving this message because you have an OxSteed account or requested an OxSteed service.');
  const supportUrl = absoluteUrl('/support');
  const privacyUrl = absoluteUrl('/privacy');
  const logoUrl = process.env.EMAIL_LOGO_URL ? String(process.env.EMAIL_LOGO_URL) : '';
  const logoHtml = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="OxSteed" width="40" height="40" style="display:block;border:0;border-radius:10px;">`
    : `<span style="display:inline-block;width:40px;height:40px;border-radius:10px;background:#f97316;color:#ffffff;font-size:17px;font-weight:800;line-height:40px;text-align:center;">Ox</span>`;
  const bodyContent = [
    intro ? htmlParagraph(intro) : '',
    bodyHtml,
    detailsHtml,
    codeHtml,
    noticeHtml,
    cta ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;"><tr><td style="border-radius:10px;background:#f97316;"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:14px 24px;border-radius:10px;color:#ffffff;font-size:16px;font-weight:700;line-height:1.2;text-decoration:none;">${escapeHtml(textSafe(cta.label))}</a></td></tr></table><p style="margin:10px 0 0;color:#64748b;font-size:12px;line-height:1.5;word-break:break-all;">If the button does not work, copy and paste this link:<br><a href="${escapeHtml(ctaUrl)}" style="color:#c2410c;">${escapeHtml(ctaUrl)}</a></p>` : '',
  ].filter(Boolean).join('');
  const textContent = [
    intro,
    bodyText,
    options.details?.length ? options.details.filter((d) => d && d.label).map((d) => `${d.label}: ${d.value}`).join('\n') : '',
    codeText,
    options.notice ? `${options.notice.title}\n${options.notice.body}` : '',
    cta ? `${cta.label}: ${ctaUrl}` : '',
  ].filter(Boolean).join('\n\n');

  const html = `<!doctype html><html lang="${language}" dir="${direction}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><style>u + #body a{color:inherit;}@media (prefers-color-scheme:dark){.email-shell{background:#0f172a!important}.email-card{background:#111827!important}.email-title,.email-text{color:#f8fafc!important}.email-muted{color:#cbd5e1!important}.email-footer{border-color:#334155!important}}</style></head><body id="body" style="margin:0;padding:0;background:#f4f1ec;color:#0f172a;font-family:Arial,Helvetica,sans-serif;"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="email-shell" style="background:#f4f1ec;"><tr><td align="center" style="padding:28px 14px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;"><tr><td style="padding:0 8px 14px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="vertical-align:middle;">${logoHtml}</td><td style="padding-left:10px;vertical-align:middle;color:#0f172a;font-size:20px;font-weight:800;">OxSteed</td></tr></table></td></tr><tr><td class="email-card" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 4px 16px rgba(15,23,42,.06);"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:32px 30px 10px;"><p style="margin:0 0 10px;color:#c2410c;font-size:12px;font-weight:800;letter-spacing:1.6px;">${escapeHtml(eyebrow)}</p><h1 class="email-title" style="margin:0;color:#0f172a;font-size:28px;line-height:1.2;font-weight:800;">${escapeHtml(title)}</h1></td></tr><tr><td class="email-text" style="padding:10px 30px 30px;color:#334155;">${bodyContent}</td></tr><tr><td class="email-footer" style="padding:20px 30px;border-top:1px solid #e2e8f0;"><p class="email-muted" style="margin:0 0 8px;color:#64748b;font-size:12px;line-height:1.55;">${escapeHtml(footerText)}</p><p class="email-muted" style="margin:0;color:#64748b;font-size:12px;line-height:1.55;"><a href="${escapeHtml(supportUrl)}" style="color:#c2410c;text-decoration:none;">Support</a> &nbsp;·&nbsp; <a href="${escapeHtml(privacyUrl)}" style="color:#c2410c;text-decoration:none;">Privacy</a></p></td></tr></table></td></tr><tr><td style="padding:14px 8px 0;color:#64748b;font-size:11px;text-align:center;">© ${new Date().getFullYear()} OxSteed</td></tr></table></td></tr></table></body></html>`;

  return { html, text: `${title}\n\n${textContent}\n\n${footerText}\nSupport: ${supportUrl}`.trim(), language, direction };
}

module.exports = {
  normalizeEmailLanguage,
  renderOxSteedEmail,
  renderCodeBlock,
  renderCallout,
  renderDetails,
};
