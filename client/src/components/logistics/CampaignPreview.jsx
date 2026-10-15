import LogisticsStatusPill from './LogisticsStatusPill';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getCampaign } from '../../api/logistics';
import LogisticsModal, { LogisticsModalLoading, LogisticsModalError } from './LogisticsModal';


/**
 * Campaign preview modal. Fetches the full campaign record and renders a
 * summary; "Open full page" navigates to /logistics/campaigns/:id where the
 * CampaignDetailPage renders the complete view. Direct URLs are untouched.
 */
export default function CampaignPreview({ id, open, onClose }) {
  const { t } = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  const [campaign, setCampaign] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    getCampaign(id)
      .then((r) => setCampaign(r.data || null))
      .catch((err) => setError(err.response?.data?.error || tx('logistics.modal.loadError', "Couldn't load this preview.")))
      .finally(() => setLoading(false));
  }, [id, t]);

  useEffect(() => {
    if (open) {
      setCampaign(null);
      load();
    }
  }, [open, load]);

  const moqPct = campaign
    ? Math.min(100, Math.round(((campaign.current_committed_qty || 0) / Math.max(1, campaign.target_moq || 1)) * 100))
    : 0;

  return (
    <LogisticsModal
      open={open}
      onClose={onClose}
      title={campaign?.title || tx('logistics.modal.campaignPreviewTitle', 'Campaign preview')}
      fullPageHref={id ? `/logistics/campaigns/${id}` : null}
    >
      {loading && <LogisticsModalLoading />}
      {!loading && error && <LogisticsModalError message={error} onRetry={load} />}
      {!loading && !error && !campaign && (
        <LogisticsModalError message={tx('logistics.modal.notFound', 'This item could not be found.')} />
      )}
      {!loading && !error && campaign && (
        <div className="lxm-summary">
          <div className="lxm-summary-row">
            <span className="lxm-summary-label">{tx('logistics.modal.campaign.lane', 'Lane')}</span>
            <span className="lxm-summary-value">
              {[campaign.origin_country, campaign.destination_country].filter(Boolean).join(' → ') || campaign.lane_name || '—'}
            </span>
          </div>
          <div className="lxm-summary-row">
            <span className="lxm-summary-label">{tx('logistics.modal.campaign.status', 'Status')}</span>
            <span className="lxm-summary-value">
              <LogisticsStatusPill status={campaign.status} />
            </span>
          </div>
          <div className="lxm-summary-row">
            <span className="lxm-summary-label">{tx('logistics.modal.campaign.participants', 'Participants')}</span>
            <span className="lxm-summary-value">{campaign.participant_count ?? '—'}</span>
          </div>
          <div>
            <div className="lxm-summary-row">
              <span className="lxm-summary-label">{tx('logistics.modal.campaign.moqProgress', 'MOQ progress')}</span>
              <span className="lxm-summary-value">{moqPct}%</span>
            </div>
            <div className="lxm-moq-bar-wrap" role="progressbar" aria-valuenow={moqPct} aria-valuemin={0} aria-valuemax={100}>
              <div className="lxm-moq-bar" style={{ width: `${moqPct}%` }} />
            </div>
            <div style={{ fontSize: '.8rem', color: 'var(--color-text-muted)', marginTop: '.35rem' }}>
              {tx('logistics.modal.campaign.committedUnits', 'Committed')}: {campaign.current_committed_qty || 0}
              {' · '}
              {tx('logistics.modal.campaign.targetUnits', 'Target')}: {campaign.target_moq || '—'}
            </div>
          </div>
        </div>
      )}
    </LogisticsModal>
  );
}
