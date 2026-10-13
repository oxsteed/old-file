'use strict';

const copy = require('./reviewW11SupportCopy');
const { renderOxSteedEmail } = require('./emailTemplate');
const { absoluteUrl } = require('./publicSiteUrl');
const escapeHtml = require('./escapeHtml');

function ticketEmail(ticket, kind, content = '') {
  const language = Object.hasOwn(copy, ticket.preferred_language) ? ticket.preferred_language : 'en';
  const labels = copy[language];
  const title = kind === 'resolved' ? labels.resolvedTitle : labels.replyTitle;
  const signedInTicket = Boolean(ticket.user_id);
  const instruction = signedInTicket
    ? (kind === 'resolved' ? labels.resolvedInstruction : labels.replyInstruction)
    : (kind === 'resolved' ? labels.guestResolvedInstruction : labels.guestReplyInstruction);
  const ticketNumber = `#${ticket.ticket_number}`;
  const body = [ticketNumber, content, instruction].filter(Boolean);
  const rendered = renderOxSteedEmail({
    language, title, bodyText: body.join('\n\n'),
    bodyHtml: body.map(value => `<p>${escapeHtml(value).replace(/\n/g, '<br>')}</p>`).join(''),
    cta: { label: signedInTicket ? labels.openTicket : labels.openSupport,
      url: absoluteUrl(signedInTicket ? `/support/my-tickets/${encodeURIComponent(ticket.id)}` : '/support') },
  });
  return { subject: `[${ticket.ticket_number}] ${title}`, html: rendered.html, text: rendered.text };
}

module.exports = { ticketEmail };
