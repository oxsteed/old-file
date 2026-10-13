'use strict';

// Review P2-653 / P2-654: public intake endpoints are unauthenticated, so
// callers must not choose the workflow status or stage of the record they
// create. Every public intake starts as 'new'. Mount this after any body
// parser (multer), directly before the controller.
const PRIVILEGED_FIELDS = ['status', 'workflow_stage', 'stage', 'assigned_to', 'owner_notes', 'internal_notes'];

function stripPrivilegedIntakeFields(req, _res, next) {
  if (req.body && typeof req.body === 'object') {
    for (const field of PRIVILEGED_FIELDS) delete req.body[field];
  }
  next();
}

module.exports = { stripPrivilegedIntakeFields, PRIVILEGED_FIELDS };
