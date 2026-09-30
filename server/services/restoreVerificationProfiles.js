'use strict';
// New contracts require a new profile version, not edits to an accepted proof.
module.exports = Object.freeze({
  'legacy-exact-v1': Object.freeze(['migrations', 'creditTables', 'creditIntegrityTriggers', 'directServices', 'directTools', 'immutableTriggerProbe']),
});
