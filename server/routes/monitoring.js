// Enterprise monitoring endpoints
// Requires admin role for access

const express = require('express');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const monitoringController = require('../controllers/monitoringController');

const router = express.Router();

// All monitoring endpoints require admin authentication + the manage_operations grant
router.use(requireAdmin, requirePermission('manage_operations'));

// System health overview
router.get('/health', monitoringController.getSystemHealth);

// Safe security posture signals; secrets and credentials are never returned.
router.get('/security-posture', monitoringController.getSecurityPosture);

// Security events (last 1-24 hours)
router.get('/security-events', monitoringController.getSecurityEvents);

// User's audit trail
router.get('/audit-trail', monitoringController.getAuditTrail);

// Tamper-evident audit chain integrity
router.get('/audit-integrity', monitoringController.getAuditIntegrity);

// Upload scanning policy and provider status
router.get('/upload-security', monitoringController.getUploadSecurity);

// Database performance metrics
router.get('/database-health', monitoringController.getDatabaseHealth);

// Backup and disaster recovery status
router.get('/backup-status', monitoringController.getBackupStatus);

// API latency percentiles
router.get('/latency-percentiles', monitoringController.getLatencyPercentiles);

// REMOVED (H7): /compliance-report derived SOC 2/ISO status from the
// writerless compliance_audit_log (always COMPLIANT); table dropped in
// migration 624. See monitoringController for the removal note.

// Recent incidents and anomalies
router.get('/incident-summary', monitoringController.getIncidentSummary);

// Incident state is admin-controlled and audited; the public app never sees
// operational alert details.
router.post('/incidents/:incidentId/acknowledge', monitoringController.acknowledgeIncident);
router.post('/incidents/:incidentId/resolve', monitoringController.resolveIncident);
router.get('/incidents/:incidentId/notes', monitoringController.listIncidentNotes);
router.post('/incidents/:incidentId/notes', monitoringController.addIncidentNote);

// Authenticated operational release gate: audit integrity, backup freshness,
// webhook/delivery failures, queue backlog, reconciliation backlog.
router.get('/release-gate', monitoringController.getReleaseGate);

module.exports = router;
