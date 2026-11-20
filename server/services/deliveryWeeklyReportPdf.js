'use strict';

// Group 9 Slice F (item 495): the weekly report as a downloadable PDF.
// Read-only rendering of a stored delivery_driver_weekly_reports row
// (its payload JSONB is the report). PDFKit is already a server
// dependency; no new renderer.

const PDFDocument = require('pdfkit');

function money(cents, currency = 'USD') {
  const value = Number(cents || 0);
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value / 100);
  } catch {
    return `${(value / 100).toFixed(2)} ${currency}`;
  }
}

function date(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '—';
}

function renderWeeklyReportPdf(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `OxSteed weekly delivery report ${report.week_start}` } });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const payload = report.payload || {};
    doc.fontSize(20).text('OxSteed Weekly Delivery Report');
    doc.moveDown(0.5);
    doc.fontSize(11).text(`Week: ${report.week_start} to ${report.week_end} (${report.timezone || 'UTC'})`);
    doc.text(`Generated: ${date(report.generated_at)}`);
    doc.moveDown();
    doc.fontSize(13).text('Summary');
    doc.fontSize(11).text(`Jobs completed: ${report.jobs_completed}`);
    doc.text(`Jobs cancelled: ${report.jobs_cancelled}`);
    doc.text(`Distance: ${Number(report.distance_miles || 0)} miles`);
    doc.text(`Pieces: ${report.pieces}`);
    doc.text(`Worked time (pickup to delivery): ${report.worked_minutes} minutes`);
    doc.text(`Earnings accrued: ${money(report.earnings_accrued_cents)}`);
    doc.text(`Earnings paid: ${money(report.earnings_paid_cents)}`);
    doc.text(`Adjustments: ${report.adjustments_count}`);
    doc.text(`Exceptions: ${report.exceptions_count}`);
    if (Array.isArray(payload.exceptionsByCode) && payload.exceptionsByCode.length) {
      doc.text(`Exceptions by type: ${payload.exceptionsByCode.map((entry) => `${entry.code} (${entry.count})`).join(', ')}`);
    }
    doc.moveDown();
    doc.fontSize(13).text('Jobs');
    const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
    if (!jobs.length) {
      doc.fontSize(11).text('No completed jobs this week.');
    } else {
      doc.fontSize(11);
      for (const job of jobs) {
        doc.text(`${job.reference} · ${job.originCity || ''} to ${job.destinationCity || ''} · ${job.distanceMiles ?? '—'} miles · ${job.pieces} pieces · payout ${money(job.driverPayoutCents)} · delivered ${date(job.deliveredAt)}`);
      }
    }
    doc.moveDown();
    doc.fontSize(10).fillColor('#536475')
      .text('Earnings accrued are payouts recorded in this week; earnings paid are payouts whose payment reference was recorded in this week. Adjustments and exceptions are listed on the payout history and delivery detail pages.');
    doc.end();
  });
}

module.exports = { renderWeeklyReportPdf };
