import { useTranslation } from 'react-i18next';
import '../../styles/logistics/LogisticsStatusPill.css';

/**
 * Maps every logistics domain status to a semantic tone.
 *
 * Replaces the per-page STATUS_COLOR / *_COLOR maps and their hardcoded
 * hex inline styles with theme-token CSS classes (see LogisticsStatusPill.css).
 * Unknown statuses fall back to the neutral tone.
 */
const STATUS_TONE = {
  // ── neutral: not started, dormant, or terminal-without-alarm ──
  draft: 'neutral',
  planned: 'neutral',
  expected: 'neutral',
  pending: 'neutral',
  invited: 'neutral',
  closed: 'neutral',
  cancelled: 'neutral',
  paused: 'neutral',
  refunded: 'neutral',
  expired: 'neutral',

  // ── success: healthy / completed / good standing ──
  open: 'success',
  approved: 'success',
  reconciled: 'success',
  released: 'success',
  delivered: 'success',
  completed: 'success',
  fulfilled: 'success',
  cleared: 'success',
  processed: 'success',
  customs_cleared: 'success',
  deposit_collected: 'success',
  deposit_paid: 'success',
  final_paid: 'success',
  low: 'success',
  active: 'success',
  ready: 'success',
  confirmed: 'success',
  allocated: 'success',
  warehoused: 'success',
  delivered_to_warehouse: 'success',
  allocation_ready: 'success',
  resolved: 'success',

  // ── warning: in progress and needs watching / recruiting / payment ──
  quoted: 'warning',
  quoting: 'warning',
  pledging: 'warning',
  deposit_phase: 'warning',
  awaiting_deposit: 'warning',
  consolidating: 'warning',
  origin_received: 'warning',
  under_review: 'warning',
  managed: 'warning',
  pledged: 'warning',
  proposed: 'warning',

  // ── info: operational movement / coordination state ──
  booked: 'info',
  placed: 'info',
  placed_with_supplier: 'info',
  in_production: 'info',
  production_complete: 'info',
  ready_for_pickup: 'info',
  direct_order: 'info',
  pooled: 'info',
  procurement: 'info',
  converting: 'info',
  departed_origin: 'info',
  transshipment: 'info',
  arrived_destination: 'info',
  receiving: 'info',
  distributing: 'info',
  scheduled: 'info',
  assigned: 'info',
  locked: 'info',
  submitted: 'info',
  in_transit: 'info',
  executing: 'info',

  // ── danger: blocked / failed / violating ──
  customs_review: 'danger',
  customs_hold: 'danger',
  exception: 'danger',
  failed: 'danger',
  disputed: 'danger',
  discrepancy: 'danger',
  rejected: 'danger',
  restricted: 'danger',
  prohibited: 'danger',
  escalated: 'danger',
};

export function statusTone(status) {
  return STATUS_TONE[status] || 'neutral';
}

/**
 * LogisticsStatusPill - theme-token status pill for all Logistics surfaces.
 *
 * Props:
 *  - status: the raw status string (drives the tone)
 *  - label: optional display label; defaults to the pretty-printed status
 *  - className: optional extra classes
 */
export default function LogisticsStatusPill({ status, label, className = '' }) {
  const { t } = useTranslation();
  const tone = statusTone(status);
  // Dynamic key (skipped by the static i18n gate on purpose): resolves when a
  // logistics.status.* key exists, otherwise falls back to pretty text.
  const text =
    label ||
    t(`logistics.status.${status}`, { defaultValue: (status || '').replace(/_/g, ' ') });
  return (
    <span className={`lx-status-pill lx-status-pill--${tone} ${className}`.trim()}>
      {text}
    </span>
  );
}
