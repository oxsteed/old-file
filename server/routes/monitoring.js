// Enterprise monitoring endpoints
// Requires admin role for access

const express = require('express');
const { requireAdmin } = require('../middleware/adminAuth');
const monitoringController = require('../controllers/monitoringController');

const router = express.Router();

// All monitoring endpoints require admin authentication
router.use(requireAdmin);

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

// Compliance report (SOC 2, ISO 27001, GDPR)
router.get('/compliance-report', monitoringController.getComplianceReport);

// Recent incidents and anomalies
router.get('/incident-summary', monitoringController.getIncidentSummary);

// Incident state is admin-controlled and audited; the public app never sees
// operational alert details.
router.post('/incidents/:incidentId/acknowledge', monitoringController.acknowledgeIncident);
router.post('/incidents/:incidentId/resolve', monitoringController.resolveIncident);

// Authenticated operational release gate: audit integrity, backup freshness,
// webhook/delivery failures, queue backlog, reconciliation backlog.
router.get('/release-gate', monitoringController.getReleaseGate);

module.exports = router;
