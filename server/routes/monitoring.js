// Enterprise monitoring endpoints
// Requires admin role for access

const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const monitoringController = require('../controllers/monitoringController');

const router = express.Router();

// All monitoring endpoints require admin authentication
router.use(requireAuth, requireAdmin);

// System health overview
router.get('/health', monitoringController.getSystemHealth);

// Security events (last 1-24 hours)
router.get('/security-events', monitoringController.getSecurityEvents);

// User's audit trail
router.get('/audit-trail', monitoringController.getAuditTrail);

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

module.exports = router;
