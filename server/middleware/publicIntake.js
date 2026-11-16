'use strict';

// Review P2-653 / P2-654: public intake endpoints are unauthenticated, so
// callers must not choose the workflow status or stage of the record they
// create. Every public intake starts as 'new'. Mount this after any body
// parser (multer), directly before the controller.
// WP-058: links to other records (quotes, appointments) and staff assignment are
// decided by the business team, never by a public submitter.
const PRIVILEGED_FIELDS = ['status', 'workflow_stage', 'stage', 'assigned_to', 'owner_notes', 'internal_notes',
  'linked_quote_id', 'linked_appointment_id', 'assigned_staff_id', 'assigned_helper_id', 'quote_id'];

function stripPrivilegedIntakeFields(req, _res, next) {
  if (req.body && typeof req.body === 'object') {
    for (const field of PRIVILEGED_FIELDS) delete req.body[field];
  }
  next();
}

module.exports = { stripPrivilegedIntakeFields, PRIVILEGED_FIELDS };
