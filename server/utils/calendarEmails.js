// server/utils/calendarEmails.js
//
// Tiny inline email-body renderer for calendar notifications.
// We intentionally avoid a templating engine: emailService.send() takes a
// raw `html` string, and the calendar emails are simple, so an inline
// renderer keeps the dependency footprint flat.

'use strict';

function escape(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleString('en-US', {
      weekday: 'short', year: 'numeric', month: 'short',
      day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return String(d);
  }
}

function wrap(title, bodyHtml) {
  return `<!doctype html><html><body style="font-family: system-ui, -apple-system, Segoe UI, sans-serif; color: #111; max-width: 560px; margin: 0 auto; padding: 24px;">
    <h2 style="margin-top:0">${escape(title)}</h2>
    ${bodyHtml}
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
    <p style="font-size:12px;color:#666">OxSteed — local trades marketplace</p>
  </body></html>`;
}

/**
 * Render an HTML email body for a calendar notification.
 *
 * @param {('appointment_requested'|'appointment_confirmed'|'appointment_cancelled'|'reminder_24h'|'reminder_2h'|'reminder_same_day'|'appointment_completed')} type
 * @param {object} data
 * @param {string} [data.recipientName]
 * @param {string} [data.otherName]
 * @param {string} [data.service]
 * @param {Date|string} [data.when]
 * @param {string} [data.location]
 * @param {string} [data.reason]
 */
function renderAppointmentEmail(type, data = {}) {
  const name = escape(data.recipientName || 'there');
  const other = escape(data.otherName || '');
  const service = escape(data.service || '');
  const when = fmtDate(data.when);
  const location = escape(data.location || '');
  const reason = escape(data.reason || '');

  switch (type) {
    case 'appointment_requested':
      return wrap('New appointment request',
        `<p>Hi ${name},</p>
         <p>${other ? `<strong>${other}</strong>` : 'A customer'} has requested an appointment${service ? ` for <em>${service}</em>` : ''}${when ? ` on <strong>${escape(when)}</strong>` : ''}.</p>
         <p>Open your dashboard to confirm or decline.</p>`
      );
    case 'appointment_confirmed':
      return wrap('Appointment confirmed',
        `<p>Hi ${name},</p>
         <p>Your appointment${when ? ` on <strong>${escape(when)}</strong>` : ''} has been confirmed.</p>
         ${location ? `<p>Location: ${location}</p>` : ''}`
      );
    case 'appointment_cancelled':
      return wrap('Appointment cancelled',
        `<p>Hi ${name},</p>
         <p>The appointment${when ? ` scheduled for <strong>${escape(when)}</strong>` : ''} has been cancelled.</p>
         ${reason ? `<p>Reason: ${reason}</p>` : ''}`
      );
    case 'reminder_24h':
      return wrap('Reminder: appointment tomorrow',
        `<p>Hi ${name},</p>
         <p>Reminder — your appointment${when ? ` is on <strong>${escape(when)}</strong>` : ''}.</p>`
      );
    case 'reminder_same_day':
      return wrap('Reminder: appointment today',
        `<p>Hi ${name},</p>
         <p>Your appointment is today${when ? ` at <strong>${escape(when)}</strong>` : ''}.</p>`
      );
    case 'reminder_2h':
      return wrap('Your appointment is in 2 hours',
        `<p>Hi ${name},</p>
         <p>Your appointment starts in about 2 hours${when ? ` (<strong>${escape(when)}</strong>)` : ''}.</p>`
      );
    case 'appointment_completed':
      return wrap('Appointment completed',
        `<p>Hi ${name},</p>
         <p>Your appointment has been marked complete. Thanks for using OxSteed.</p>`
      );
    default:
      return wrap('Appointment notification',
        `<p>Hi ${name},</p><p>Update for your appointment${when ? ` on <strong>${escape(when)}</strong>` : ''}.</p>`
      );
  }
}

function renderAppointmentSms(type, data = {}) {
  const name = data.recipientName || '';
  const when = fmtDate(data.when);
  switch (type) {
    case 'reminder_24h':
      return `Hi ${name}, reminder: your appointment is on ${when}. — OxSteed`;
    case 'reminder_same_day':
      return `Hi ${name}, your appointment is today at ${when}. — OxSteed`;
    case 'reminder_2h':
      return `Hi ${name}, your appointment is in ~2 hours (${when}). — OxSteed`;
    case 'appointment_confirmed':
      return `Your OxSteed appointment is confirmed for ${when}.`;
    case 'appointment_cancelled':
      return `Your OxSteed appointment for ${when} has been cancelled.`;
    default:
      return `OxSteed appointment update${when ? ` (${when})` : ''}.`;
  }
}

module.exports = { renderAppointmentEmail, renderAppointmentSms };
