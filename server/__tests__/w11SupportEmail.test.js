'use strict';

const fs = require('fs');
const path = require('path');
const { ticketEmail } = require('../utils/supportTicketEmail');
const copy = require('../utils/reviewW11SupportCopy');

test.each(['en', 'es', 'fr', 'ht', 'ar'])('ticket email copy, live destination and locale parity: %s', language => {
  const ticket = { id: '11111111-1111-4111-8111-111111111111', user_id: 'fixture-owner', ticket_number: 42, preferred_language: language };
  for (const kind of ['reply', 'resolved']) {
    const email = ticketEmail(ticket, kind, '<script>synthetic</script>');
    expect(email.html).toContain(copy[language][kind === 'reply' ? 'replyInstruction' : 'resolvedInstruction']);
    expect(email.html).toContain(`/support/my-tickets/${ticket.id}`);
    expect(email.text).toContain(copy[language].openTicket);
    expect(email.html).not.toContain('<script>synthetic</script>');
    expect(email.html).toContain('&lt;script&gt;synthetic&lt;/script&gt;');
    expect(email.html).toContain(`dir="${language === 'ar' ? 'rtl' : 'ltr'}"`);
  }
  const root = path.join(__dirname, '../../client/src');
  const legacy = JSON.parse(fs.readFileSync(path.join(root, `locales/${language}.json`), 'utf8'));
  const common = JSON.parse(fs.readFileSync(path.join(root, `i18n/locales/${language}/common.json`), 'utf8'));
  expect(legacy.reviewW11).toEqual(copy[language]);
  expect(common.reviewW11).toEqual(copy[language]);
});

test.each(['en', 'es', 'fr', 'ht', 'ar'])('guest follow-up uses public support instead of an inaccessible account ticket: %s', language => {
  for (const kind of ['reply', 'resolved']) {
    const email = ticketEmail({ id: 'guest-ticket', ticket_number: 42, user_id: null, preferred_language: language }, kind);
    expect(email.html).toContain(copy[language][kind === 'reply' ? 'guestReplyInstruction' : 'guestResolvedInstruction']);
    expect(email.text).toContain(copy[language].openSupport);
    expect(email.text).toContain('#42');
    expect(email.html).toMatch(/href="https?:\/\/[^\"]+\/support"/);
    expect(email.html).not.toContain('/support/my-tickets/');
  }
});
