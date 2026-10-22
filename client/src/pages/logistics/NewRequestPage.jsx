import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { createSourcingRequest } from '../../api/logistics';
import { listLanes, checkLaneAccess } from '../../api/logistics';
import PageShell from '../../components/PageShell';
import LogisticsLayout from '../../components/logistics/LogisticsLayout';
import UnsavedChangesGuard from '../../components/logistics/UnsavedChangesGuard';
import toast from 'react-hot-toast';
import '../../styles/logistics/LogisticsHomePage.css';
import '../../styles/logistics/LogisticsWorkspaces.css';

const CATEGORIES = [
  ['Electronics', 'electronics'],
  ['Apparel & Clothing', 'apparelClothing'],
  ['Food & Beverage', 'foodBeverage'],
  ['Building Materials', 'buildingMaterials'],
  ['Tools & Hardware', 'toolsHardware'],
  ['Health & Beauty', 'healthBeauty'],
  ['Home Goods', 'homeGoods'],
  ['Agricultural Products', 'agriculturalProducts'],
  ['Auto Parts', 'autoParts'],
  ['Packaging', 'packaging'],
  ['Machinery', 'machinery'],
  ['Medical Supplies', 'medicalSupplies'],
  ['Other', 'other'],
];

const UNIT_OPTIONS = [
  ['unit', 'unit'],
  ['pair', 'pair'],
  ['set', 'set'],
  ['box', 'box'],
  ['carton', 'carton'],
  ['pallet', 'pallet'],
  ['kg', 'kg'],
  ['liter', 'liter'],
  ['meter', 'meter'],
];

const FREIGHT_OPTIONS = [
  ['air', 'air'],
  ['sea_fcl', 'seaFcl'],
  ['sea_lcl', 'seaLcl'],
  ['road', 'road'],
  ['rail', 'rail'],
  ['courier', 'courier'],
  ['express', 'express'],
];

/**
 * NewRequestPage - multi-step sourcing request form (Phase 2 refactor).
 *
 * Shared LogisticsLayout for navigation; the step indicator is now
 * keyboard-operable native buttons; leaving a dirty form asks for
 * confirmation (unsaved-change guard). Longer form stays on a full page.
 */
export default function NewRequestPage() {
  const { t }    = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  const { user } = useAuth();
  const navigate = useNavigate();
  const [lanes, setLanes]     = useState([]);
  const [laneAccess, setLaneAccess] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep]       = useState(1);
  const [form, setForm]       = useState({
    title: '', category: '', description: '', specs: '',
    target_qty: '', target_unit: 'unit', target_price_usd: '',
    budget_max_usd: '', destination_country: '', destination_city: '',
    lane_id: '', preferred_freight: '', private_label: false,
    custom_mfg: false, deadline: '', notes: '',
  });

  useEffect(() => {
    listLanes().then((r) => setLanes(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!form.lane_id || !user) {
      setLaneAccess(null);
      return;
    }
    checkLaneAccess(form.lane_id, {
      role: user.role,
      country: form.destination_country || user.country_code || '',
      business_verified: String(Boolean(user.business_verified || user.is_business_verified)),
    }).then((res) => setLaneAccess(res.data || null)).catch(() => setLaneAccess(null));
  }, [form.lane_id, form.destination_country, user]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const formDirty = !submitting && (
    form.title !== '' || form.category !== '' || form.description !== '' || form.specs !== '' ||
    form.target_qty !== '' || form.target_price_usd !== '' || form.budget_max_usd !== '' ||
    form.destination_country !== '' || form.destination_city !== '' || form.lane_id !== '' ||
    form.preferred_freight !== '' || form.private_label || form.custom_mfg || form.deadline !== '' ||
    form.notes !== ''
  );

  const handleSubmit = async () => {
    if (!form.title || !form.category) {
      toast.error(tx('logistics.requests.requiredFields', 'Title and category are required'));
      return;
    }
    setSubmitting(true);
    try {
      const data = { ...form };
      if (data.specs) { try { data.specs = JSON.parse(data.specs); } catch { data.specs = { notes: data.specs }; } }
      const r = await createSourcingRequest(data);
      toast.success(tx('logistics.requests.created', 'Sourcing request submitted!'));
      navigate(`/logistics/requests/${r.data.id}`);
    } catch (err) {
      toast.error(err.response?.data?.message || err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const lane = lanes.find((row) => String(row.id) === String(form.lane_id)) || null;

  return (
    <PageShell>
      <LogisticsLayout
        title={tx('logistics.requests.newTitle', 'New Sourcing Request')}
        subtitle={tx('logistics.requests.newSub', 'Tell us what you need. OxSteed will find suppliers and return quotes.')}
        showNav={false}
      >
        <UnsavedChangesGuard when={formDirty} />
        <div className="lx-workspaces" style={{ maxWidth: '45rem' }}>
          <div className="lx-back-row">
            <Link to="/logistics/sourcing" className="lx-link">← {tx('logistics.requests.back', 'Back to Sourcing')}</Link>
          </div>

          {/* Step indicator: completed steps are buttons (keyboard-operable). */}
          <div className="lx-stepper" role="group" aria-label={tx('logistics.requests.stepsLabel', 'Request progress')}>
            {[1, 2, 3].map((s) => {
              const done = s < step;
              const current = s === step;
              const label = tx(`logistics.requests.step${s}Short`, `Step ${s}`);
              return done ? (
                <button
                  key={s}
                  type="button"
                  className="lx-step lx-step--done"
                  onClick={() => setStep(s)}
                  aria-label={tx('logistics.requests.goToStep', 'Go to {{label}}', { label })} data-track="ui.7c5201362b.1"
                >
                  <span className="lx-visually-hidden">{label}</span>
                </button>
              ) : (
                <div
                  key={s}
                  className={`lx-step${current ? ' lx-step--current' : ''}`}
                  aria-current={current ? 'step' : undefined}
                  aria-label={label}
                />
              );
            })}
          </div>

          <div className="lx-card">
            {step === 1 && (
              <>
                <h2 className="lx-section-title lx-mb-4">
                  {tx('logistics.requests.step1', 'Step 1: What do you need?')}
                </h2>
                <div className="lx-form-group">
                  <label className="lx-label" htmlFor="lx-req-title">{tx('logistics.requests.titleLabel', 'Request Title')} *</label>
                  <input id="lx-req-title" className="lx-input" value={form.title} placeholder={tx('logistics.requests.titlePlaceholder', 'e.g. 500 Units of Industrial Safety Boots')}
                    onChange={(e) => set('title', e.target.value)} />
                </div>
                <div className="lx-form-group">
                  <label className="lx-label" htmlFor="lx-req-category">{tx('logistics.requests.categoryLabel', 'Category')} *</label>
                  <select id="lx-req-category" className="lx-select" value={form.category} onChange={(e) => set('category', e.target.value)}>
                    <option value="">{tx('logistics.requests.selectOption', '— Select —')}</option>
                    {CATEGORIES.map(([value, key]) => <option key={value} value={value}>{tx(`logistics.requests.category.${key}`, value)}</option>)}
                  </select>
                </div>
                <div className="lx-form-group">
                  <label className="lx-label" htmlFor="lx-req-description">{tx('logistics.requests.description', 'Description')}</label>
                  <textarea id="lx-req-description" className="lx-textarea" value={form.description}
                    placeholder={tx('logistics.requests.descriptionPlaceholder', 'Describe the product in detail: materials, dimensions, certifications needed…')}
                    onChange={(e) => set('description', e.target.value)} />
                </div>
                <div className="lx-form-grid-2">
                  <div className="lx-form-group">
                    <label className="lx-label" htmlFor="lx-req-qty">{tx('logistics.requests.targetQty', 'Target Quantity')}</label>
                    <input id="lx-req-qty" type="number" className="lx-input" value={form.target_qty} min="1"
                      onChange={(e) => set('target_qty', e.target.value)} />
                  </div>
                  <div className="lx-form-group">
                    <label className="lx-label" htmlFor="lx-req-unit">{tx('logistics.requests.unit', 'Unit')}</label>
                    <select id="lx-req-unit" className="lx-select" value={form.target_unit} onChange={(e) => set('target_unit', e.target.value)}>
                      {UNIT_OPTIONS.map(([value, key]) => <option key={value} value={value}>{tx(`logistics.requests.unitLabel.${key}`, value)}</option>)}
                    </select>
                  </div>
                </div>
                <div className="lx-form-grid-2">
                  <div className="lx-form-group">
                    <label className="lx-label" htmlFor="lx-req-price">{tx('logistics.requests.targetPrice', 'Target Price / Unit (USD)')}</label>
                    <input id="lx-req-price" type="number" className="lx-input" value={form.target_price_usd}
                      placeholder="0.00" onChange={(e) => set('target_price_usd', e.target.value)} />
                  </div>
                  <div className="lx-form-group">
                    <label className="lx-label" htmlFor="lx-req-budget">{tx('logistics.requests.budgetMax', 'Max Budget (USD)')}</label>
                    <input id="lx-req-budget" type="number" className="lx-input" value={form.budget_max_usd}
                      placeholder="0.00" onChange={(e) => set('budget_max_usd', e.target.value)} />
                  </div>
                </div>
                <div className="lx-btn-row lx-mt-6">
                  <button type="button" className="lx-btn-primary" onClick={() => setStep(2)} data-track="ui.7c5201362b.2">
                    {tx('common.next', 'Next')} →
                  </button>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <h2 className="lx-section-title lx-mb-4">
                  {tx('logistics.requests.step2', 'Step 2: Destination & Lane')}
                </h2>
                <div className="lx-form-grid-2">
                  <div className="lx-form-group">
                    <label className="lx-label" htmlFor="lx-req-dest-country">{tx('logistics.requests.destCountry', 'Destination Country')}</label>
                    <input id="lx-req-dest-country" className="lx-input" value={form.destination_country} maxLength={2}
                      placeholder={tx('logistics.requests.destCountryPlaceholder', 'e.g. US, HT, CA')} onChange={(e) => set('destination_country', e.target.value.toUpperCase())} />
                  </div>
                  <div className="lx-form-group">
                    <label className="lx-label" htmlFor="lx-req-dest-city">{tx('logistics.requests.destCity', 'Destination City')}</label>
                    <input id="lx-req-dest-city" className="lx-input" value={form.destination_city}
                      onChange={(e) => set('destination_city', e.target.value)} />
                  </div>
                </div>
                <div className="lx-form-group">
                  <label className="lx-label" htmlFor="lx-req-lane">{tx('logistics.requests.lane', 'Logistics Lane')}</label>
                  <select id="lx-req-lane" className="lx-select" value={form.lane_id} onChange={(e) => set('lane_id', e.target.value)}>
                    <option value="">{tx('logistics.requests.letOxsteedChoose', '— Let OxSteed choose —')}</option>
                    {lanes.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} ({l.origin_country} → {l.destination_country}) · {l.risk_tier}
                      </option>
                    ))}
                  </select>
                </div>
                {lane && (
                  <div className="lx-callout lx-mb-4">
                    <strong>{tx('logistics.requests.laneChecks', 'Lane access and approval checks')}</strong>
                    <div className="lx-callout-row">
                      <div>{tx('logistics.requests.riskTier', 'Risk tier')}: <strong>{lane.risk_tier}</strong> · {tx('logistics.requests.customsComplexity', 'Customs complexity')}: <strong>{lane.customs_complexity}/5</strong></div>
                      {laneAccess?.allowed === false && (
                        <div style={{ color: 'var(--color-error)', fontWeight: 700 }}>{tx('logistics.requests.laneBlocked', 'This lane is currently blocked for your role or destination context: {{reason}}', { reason: laneAccess.reason })}</div>
                      )}
                      {lane.requires_business_verification && (
                        <div style={{ color: 'var(--color-warning)' }}>{tx('logistics.requests.laneBusinessVerification', 'Business verification is required to run this lane as a verified buyer.')}</div>
                      )}
                      {lane.requires_reseller_approval && (
                        <div style={{ color: 'var(--color-info)' }}>{tx('logistics.requests.laneResellerApproval', 'Reseller/distributor approval is required before this lane can be used for resale flows.')}</div>
                      )}
                      {(lane.requires_manual_approval || laneAccess?.requiresManualApproval) && (
                        <div style={{ color: 'var(--color-error)' }}>{tx('logistics.requests.laneManualApproval', 'Manual compliance approval is required before this request can move into quoting or procurement.')}</div>
                      )}
                    </div>
                  </div>
                )}
                <div className="lx-form-group">
                  <label className="lx-label" htmlFor="lx-req-freight">{tx('logistics.requests.freightPreference', 'Preferred Freight')}</label>
                  <select id="lx-req-freight" className="lx-select" value={form.preferred_freight} onChange={(e) => set('preferred_freight', e.target.value)}>
                    <option value="">{tx('logistics.requests.anyOption', '— Any —')}</option>
                    {FREIGHT_OPTIONS.map(([value, key]) => <option key={value} value={value}>{tx(`logistics.requests.freight.${key}`, value.replace(/_/g, ' '))}</option>)}
                  </select>
                </div>
                <div className="lx-form-group">
                  <label className="lx-label" htmlFor="lx-req-deadline">{tx('logistics.requests.deadline', 'Deadline')}</label>
                  <input id="lx-req-deadline" type="date" className="lx-input" value={form.deadline} onChange={(e) => set('deadline', e.target.value)} />
                </div>
                <div className="lx-btn-row">
                  <label className="lx-t-small lx-t-semibold" style={{ display: 'flex', gap: '.4rem', alignItems: 'center', minBlockSize: '2.75rem' }}>
                    <input type="checkbox" checked={form.private_label} onChange={(e) => set('private_label', e.target.checked)} data-track="ui.7c5201362b.3" />
                    {tx('logistics.requests.privateLabel', 'Private Label')}
                  </label>
                  <label className="lx-t-small lx-t-semibold" style={{ display: 'flex', gap: '.4rem', alignItems: 'center', minBlockSize: '2.75rem' }}>
                    <input type="checkbox" checked={form.custom_mfg} onChange={(e) => set('custom_mfg', e.target.checked)} data-track="ui.7c5201362b.4" />
                    {tx('logistics.requests.customMfg', 'Custom Manufacturing')}
                  </label>
                </div>
                <div className="lx-btn-row lx-mt-6">
                  <button type="button" className="lx-btn-secondary" onClick={() => setStep(1)} data-track="ui.7c5201362b.5">← {tx('common.back', 'Back')}</button>
                  <button type="button" className="lx-btn-primary" disabled={laneAccess?.allowed === false} onClick={() => setStep(3)} data-track="ui.7c5201362b.6">{tx('common.next', 'Next')} →</button>
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <h2 className="lx-section-title lx-mb-4">
                  {tx('logistics.requests.step3', 'Step 3: Review & Submit')}
                </h2>
                <div className="lx-review-box">
                  {[
                    [tx('logistics.requests.review.title', 'Title'), form.title],
                    [tx('logistics.requests.review.category', 'Category'), form.category],
                    [tx('logistics.requests.review.quantity', 'Quantity'), form.target_qty ? `${form.target_qty} ${form.target_unit}` : '—'],
                    [tx('logistics.requests.review.targetPrice', 'Target Price'), form.target_price_usd ? `$${form.target_price_usd}/unit` : '—'],
                    [tx('logistics.requests.review.destination', 'Destination'), [form.destination_city, form.destination_country].filter(Boolean).join(', ') || '—'],
                    [tx('logistics.requests.review.deadline', 'Deadline'), form.deadline || '—'],
                    [tx('logistics.requests.review.privateLabel', 'Private Label'), form.private_label ? tx('logistics.requests.review.yes', 'Yes') : tx('logistics.requests.review.no', 'No')],
                  ].map(([k, v]) => (
                    <div key={k} className="lx-review-row">
                      <span className="lx-kv-label">{k}</span>
                      <span className="lx-kv-value">{v}</span>
                    </div>
                  ))}
                </div>
                <div className="lx-form-group">
                  <label className="lx-label" htmlFor="lx-req-notes">{tx('logistics.requests.additionalNotes', 'Additional Notes')}</label>
                  <textarea id="lx-req-notes" className="lx-textarea" value={form.notes}
                    placeholder={tx('logistics.requests.notesPlaceholder', 'Any other context for the sourcing team…')}
                    onChange={(e) => set('notes', e.target.value)} />
                </div>
                <div className="lx-btn-row lx-mt-6">
                  <button type="button" className="lx-btn-secondary" onClick={() => setStep(2)} data-track="ui.7c5201362b.7">← {tx('common.back', 'Back')}</button>
                  <button type="button" className="lx-btn-primary" onClick={handleSubmit} disabled={submitting} data-track="ui.7c5201362b.8">
                    {submitting ? tx('common.loading', 'Submitting…') : tx('logistics.requests.submit', 'Submit Request')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </LogisticsLayout>
    </PageShell>
  );
}
