import UnsavedChangesGuard from './UnsavedChangesGuard';
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { listLanes } from '../../api/logistics';
import toast from 'react-hot-toast';
import '../../styles/logistics/LogisticsHomePage.css';

const EMPTY_FORM = {
  title: '',
  description: '',
  lane_id: '',
  target_moq: '',
  close_date: '',
  lock_date: '',
  expected_ship_date: '',
  expected_arrival_date: '',
  unit_product_cost_usd: '',
  unit_freight_est_usd: '',
  deposit_pct: '0.30',
  cancellation_policy: '',
  max_participants: '',
};

// DB ISO timestamps (or date strings) -> yyyy-mm-dd for <input type="date">.
function toDateInput(value) {
  if (!value) return '';
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

const asString = (value) => (value === null || value === undefined || value === '' ? '' : String(value));

function buildInitialForm(campaign) {
  if (!campaign) return { ...EMPTY_FORM };
  return {
    title: campaign.title || '',
    description: campaign.description || '',
    lane_id: campaign.lane_id ? String(campaign.lane_id) : '',
    target_moq: asString(campaign.target_moq),
    close_date: toDateInput(campaign.close_date),
    lock_date: toDateInput(campaign.lock_date),
    expected_ship_date: toDateInput(campaign.expected_ship_date),
    expected_arrival_date: toDateInput(campaign.expected_arrival_date),
    unit_product_cost_usd: asString(campaign.unit_product_cost_usd),
    unit_freight_est_usd: asString(campaign.unit_freight_est_usd),
    deposit_pct: asString(campaign.deposit_pct) === '' ? '0.30' : asString(campaign.deposit_pct),
    cancellation_policy: campaign.cancellation_policy || '',
    max_participants: asString(campaign.max_participants),
  };
}

/**
 * CampaignDraftForm - shared create/edit form for pooled campaign drafts
 * (per spec: longer forms use full pages, not modals).
 *
 * Props:
 *  - mode: 'create' | 'edit'
 *  - initialCampaign: raw campaign object used to pre-fill in edit mode
 *    (the form only mounts once it is loaded, so the initial state is final)
 *  - onSubmit: async (payload) => responseData
 *  - onSuccess: (responseData) => void — e.g. navigate to the detail page
 *  - submitLabel, heading, subheading, backTo, backLabel,
 *    successMessage, errorMessage: localized page/form copy
 */
export default function CampaignDraftForm({
  mode = 'create',
  initialCampaign = null,
  onSubmit,
  onSuccess,
  submitLabel,
  heading,
  subheading,
  backTo,
  backLabel,
  successMessage,
  errorMessage,
}) {
  const { t } = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });

  const [lanes, setLanes] = useState([]);
  const [lanesError, setLanesError] = useState(false);
  const [baseline] = useState(() => buildInitialForm(initialCampaign));
  const [form, setForm] = useState(() => buildInitialForm(initialCampaign));
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listLanes({ limit: 200 })
      .then((r) => setLanes(r.data || r.lanes || []))
      .catch(() => setLanesError(true));
  }, []);

  const set = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
    setFieldErrors((e) => ({ ...e, [k]: undefined }));
  };

  // Create mode: dirty once anything is entered. Edit mode: dirty once any
  // field differs from the loaded draft.
  const dirty = mode === 'create'
    ? Object.values(form).some((v) => String(v).trim() !== '' && v !== '0.30')
    : Object.keys(form).some((k) => String(form[k] ?? '') !== String(baseline[k] ?? ''));

  const selectedLane = lanes.find((l) => String(l.id) === String(form.lane_id));

  const validate = () => {
    const errors = {};
    if (!form.title.trim()) errors.title = tx('logistics.campaigns.new.titleRequired', 'A title is required.');
    if (!form.lane_id) errors.lane_id = tx('logistics.campaigns.new.laneRequired', 'Choose a trade lane.');
    if (!form.target_moq || Number(form.target_moq) < 1) {
      errors.target_moq = tx('logistics.campaigns.new.moqRequired', 'Enter a minimum quantity of at least 1.');
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        lane_id: Number(form.lane_id),
        target_moq: Number(form.target_moq),
        close_date: form.close_date || null,
        lock_date: form.lock_date || null,
        expected_ship_date: form.expected_ship_date || null,
        expected_arrival_date: form.expected_arrival_date || null,
        unit_product_cost_usd: form.unit_product_cost_usd === '' ? null : Number(form.unit_product_cost_usd),
        unit_freight_est_usd: form.unit_freight_est_usd === '' ? null : Number(form.unit_freight_est_usd),
        deposit_pct: form.deposit_pct === '' ? 0.30 : Number(form.deposit_pct),
        cancellation_policy: form.cancellation_policy.trim() || null,
        max_participants: form.max_participants === '' ? null : Number(form.max_participants),
      };
      const res = await onSubmit(payload);
      toast.success(successMessage);
      if (onSuccess) onSuccess(res);
    } catch (err) {
      const data = err.response?.data;
      const msg = data?.error || data?.message || err.message;
      const blockerCodes = data?.fields?.blockers || [];
      toast.error(
        blockerCodes.length
          ? `${msg}: ${blockerCodes.map((b) => b.code?.replace(/_/g, ' ')).join('; ')}`
          : (msg || errorMessage)
      );
    } finally {
      setSaving(false);
    }
  };

  const err = (key) => fieldErrors[key] && (
    <div role="alert" style={{ color: 'var(--color-error)', fontSize: '.8rem', marginTop: '.25rem', fontWeight: 600 }}>
      {fieldErrors[key]}
    </div>
  );

  return (
    <div className="lx-page" style={{ maxWidth: 720 }}>
      <UnsavedChangesGuard when={dirty && !saving} />
      <div style={{ marginBottom: '1rem' }}>
        <Link to={backTo} className="lx-link"
          >
          ← {backLabel}
        </Link>
      </div>

      <div className="lx-page-header">
        <h1 className="lx-page-title">{heading}</h1>
        <p className="lx-page-sub">{subheading}</p>
      </div>

      <form className="lx-card" onSubmit={handleSubmit}>
        <div className="lx-form-group">
          <label className="lx-label">{tx('logistics.campaigns.new.fieldTitle', 'Campaign title')} *</label>
          <input className="lx-input" value={form.title} maxLength={300}
            placeholder={tx('logistics.campaigns.new.titlePlaceholder', 'e.g. 2,000 units of solar lanterns')}
            onChange={(e) => set('title', e.target.value)} />
          {err('title')}
        </div>

        <div className="lx-form-group">
          <label className="lx-label">{tx('logistics.campaigns.new.fieldDescription', 'Description')}</label>
          <textarea className="lx-textarea" value={form.description} rows={4}
            placeholder={tx('logistics.campaigns.new.descriptionPlaceholder',
              'What are buyers getting? Key specs, quantities, and what makes this campaign worth joining.')}
            onChange={(e) => set('description', e.target.value)} />
        </div>

        <div className="lx-form-group">
          <label className="lx-label">{tx('logistics.campaigns.new.fieldLane', 'Trade lane')} *</label>
          <select className="lx-select" value={form.lane_id} onChange={(e) => set('lane_id', e.target.value)}>
            <option value="">{tx('logistics.campaigns.new.lanePlaceholder', 'Select a trade lane')}</option>
            {lanes.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.origin_country} → {l.destination_country}){l.risk_tier ? ` · ${l.risk_tier}` : ''}
              </option>
            ))}
          </select>
          {lanesError && <div role="alert" style={{ color: 'var(--color-error)', fontSize: '.8rem', marginTop: '.25rem', fontWeight: 600 }}>{tx('logistics.campaigns.new.lanesFailed', 'Could not load trade lanes.')}</div>}
          {err('lane_id')}
        </div>

        {selectedLane && (
          <div className="lx-lane-notes" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: '.75rem', padding: '1rem', marginBottom: '1rem', fontSize: '.85rem', lineHeight: 1.7 }}>
            <strong>{tx('logistics.campaigns.new.laneChecks', 'Lane checks')}</strong>
            <div>{tx('logistics.campaigns.new.riskTier', 'Risk tier')}: <strong>{selectedLane.risk_tier || '—'}</strong></div>
            {selectedLane.requires_business_verification && (
              <div style={{ color: 'var(--color-primary)' }}>{tx('logistics.campaigns.new.laneNeedsBusiness',
                'Business verification is required to run a campaign on this lane.')}</div>
            )}
            {selectedLane.requires_manual_approval && (
              <div style={{ color: 'var(--color-error)' }}>{tx('logistics.campaigns.new.laneNeedsManual',
                'Manual compliance approval is required before this campaign can be published.')}</div>
            )}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div className="lx-form-group">
            <label className="lx-label">{tx('logistics.campaigns.new.fieldTargetMoq', 'Minimum quantity (MOQ)')} *</label>
            <input type="number" min="1" step="1" className="lx-input" value={form.target_moq}
              onChange={(e) => set('target_moq', e.target.value)} />
            {err('target_moq')}
          </div>
          <div className="lx-form-group">
            <label className="lx-label">{tx('logistics.campaigns.new.fieldMaxParticipants', 'Max participants (optional)')}</label>
            <input type="number" min="1" step="1" className="lx-input" value={form.max_participants}
              onChange={(e) => set('max_participants', e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div className="lx-form-group">
            <label className="lx-label">{tx('logistics.campaigns.new.fieldCloseDate', 'Pledge close date')}</label>
            <input type="date" className="lx-input" value={form.close_date}
              onChange={(e) => set('close_date', e.target.value)} />
          </div>
          <div className="lx-form-group">
            <label className="lx-label">{tx('logistics.campaigns.new.fieldLockDate', 'Lock date')}</label>
            <input type="date" className="lx-input" value={form.lock_date}
              onChange={(e) => set('lock_date', e.target.value)} />
          </div>
          <div className="lx-form-group">
            <label className="lx-label">{tx('logistics.campaigns.new.fieldShipDate', 'Expected ship date')}</label>
            <input type="date" className="lx-input" value={form.expected_ship_date}
              onChange={(e) => set('expected_ship_date', e.target.value)} />
          </div>
          <div className="lx-form-group">
            <label className="lx-label">{tx('logistics.campaigns.new.fieldArrivalDate', 'Expected arrival date')}</label>
            <input type="date" className="lx-input" value={form.expected_arrival_date}
              onChange={(e) => set('expected_arrival_date', e.target.value)} />
          </div>
        </div>

        <h2 style={{ fontWeight: 700, margin: '1.25rem 0 .75rem', fontSize: '1rem' }}>
          {tx('logistics.campaigns.new.pricingHeading', 'Pricing sketch')}
        </h2>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '.85rem', marginBottom: '1rem' }}>
          {tx('logistics.campaigns.new.pricingHint',
            'A rough sketch is enough for the draft. OxSteed computes the landed cost; Operations confirms pricing at review.')}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div className="lx-form-group">
            <label className="lx-label">{tx('logistics.campaigns.new.fieldUnitCost', 'Unit product cost (USD)')}</label>
            <input type="number" min="0" step="0.01" className="lx-input" value={form.unit_product_cost_usd}
              onChange={(e) => set('unit_product_cost_usd', e.target.value)} />
          </div>
          <div className="lx-form-group">
            <label className="lx-label">{tx('logistics.campaigns.new.fieldFreight', 'Unit freight estimate (USD)')}</label>
            <input type="number" min="0" step="0.01" className="lx-input" value={form.unit_freight_est_usd}
              onChange={(e) => set('unit_freight_est_usd', e.target.value)} />
          </div>
          <div className="lx-form-group">
            <label className="lx-label">{tx('logistics.campaigns.new.fieldDepositPct', 'Deposit percentage')}</label>
            <input type="number" min="0" max="1" step="0.01" className="lx-input" value={form.deposit_pct}
              onChange={(e) => set('deposit_pct', e.target.value)} />
          </div>
        </div>

        <div className="lx-form-group">
          <label className="lx-label">{tx('logistics.campaigns.new.fieldCancellationPolicy', 'Cancellation policy')}</label>
          <textarea className="lx-textarea" value={form.cancellation_policy} rows={3}
            onChange={(e) => set('cancellation_policy', e.target.value)} />
        </div>

        <div style={{ display: 'flex', gap: '.75rem', marginTop: '1rem' }}>
          <button type="submit" className="lx-btn-primary" disabled={saving}>
            {saving
              ? tx('logistics.campaigns.new.saving', 'Saving…')
              : submitLabel}
          </button>
          <Link to={backTo} className="lx-btn-secondary"
            >
            {tx('common.cancel', 'Cancel')}
          </Link>
        </div>
      </form>
    </div>
  );
}
