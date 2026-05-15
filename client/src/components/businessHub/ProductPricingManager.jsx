/**
 * Product Pricing Manager Tab
 * Business owner UI for managing dynamic pricing rules on products.
 * Used as a tab inside BusinessHubPage alongside PricingRulesManager (services).
 */

import React, { useState, useEffect, useCallback } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import '../../styles/ProductPricingManager.css';

const RULE_TYPES = ['volume', 'promotion', 'bundle', 'segment', 'seasonal'];

export function ProductPricingManager({ businessId }) {
  const { t } = useTranslation();
  const [rules, setRules]                 = useState([]);
  const [loading, setLoading]             = useState(false);
  const [showModal, setShowModal]         = useState(false);
  const [selectedRule, setSelectedRule]   = useState(null);

  const [form, setForm] = useState({
    name: '', type: 'volume', description: '', priority: 50,
    appliesToType: 'all',
    adjustment: { type: 'percentage', value: 0 },
    startDate: '', endDate: '',
  });

  const loadRules = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get(`/api/businesses/${businessId}/product-pricing/rules`);
      setRules(res.data.data || []);
    } catch {
      toast.error(t('common.failedToLoad'));
    } finally {
      setLoading(false);
    }
  }, [businessId, t]);

  useEffect(() => { loadRules(); }, [loadRules]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.name || !form.type) { toast.error(t('common.fillRequiredFields')); return; }
    try {
      await api.post(`/api/businesses/${businessId}/product-pricing/rules`, {
        name:          form.name,
        type:          form.type,
        description:   form.description,
        priority:      parseInt(form.priority),
        appliesToType: form.appliesToType,
        adjustment:    form.adjustment,
        startDate:     form.startDate || null,
        endDate:       form.endDate   || null,
      });
      setForm({ name: '', type: 'volume', description: '', priority: 50, appliesToType: 'all', adjustment: { type: 'percentage', value: 0 }, startDate: '', endDate: '' });
      setShowModal(false);
      loadRules();
      toast.success(t('pricing.ruleCreated', { defaultValue: 'Pricing rule created' }));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('common.errorCreating'));
    }
  };

  const handleDelete = async (ruleId) => {
    if (!window.confirm(t('common.confirmDelete', { defaultValue: 'Delete this rule?' }))) return;
    try {
      await api.delete(`/api/businesses/${businessId}/product-pricing/rules/${ruleId}`);
      setRules(rules.filter(r => r.id !== ruleId));
      if (selectedRule?.id === ruleId) setSelectedRule(null);
      toast.success(t('common.deleted', { defaultValue: 'Deleted' }));
    } catch {
      toast.error(t('common.failedToDelete', { defaultValue: 'Failed to delete' }));
    }
  };

  const handleToggle = async (ruleId, currentActive) => {
    try {
      await api.put(`/api/businesses/${businessId}/product-pricing/rules/${ruleId}`, { isActive: !currentActive });
      loadRules();
    } catch {
      toast.error(t('common.failedToUpdate'));
    }
  };

  const adjLabel = (rule) => {
    const adj = rule.adjustment || {};
    if (adj.type === 'percentage') return `${adj.value}% off`;
    if (adj.type === 'fixed')      return `-$${adj.value}`;
    if (adj.type === 'multiplier') return `× ${adj.value}`;
    return '-';
  };

  const typeLabel = (type) => ({
    volume:    t('pricing.volumeBased',      { defaultValue: 'Volume-Based' }),
    promotion: t('pricing.timeLimited',      { defaultValue: 'Promotion' }),
    bundle:    t('pricing.bundleOffer',      { defaultValue: 'Bundle' }),
    segment:   t('pricing.customerSegment', { defaultValue: 'Customer Segment' }),
    seasonal:  t('pricing.seasonal',        { defaultValue: 'Seasonal' }),
  }[type] || type);

  return (
    <div className="product-pricing-manager">
      <div className="ppm-header">
        <div>
          <h2>{t('pricing.productRulesTitle', { defaultValue: 'Product Pricing Rules' })}</h2>
          <p className="ppm-desc">{t('pricing.productRulesDesc', { defaultValue: 'Volume discounts, promotions, bundles, and seasonal pricing for your products.' })}</p>
        </div>
        <button className="ppm-btn-primary" onClick={() => setShowModal(true)}>
          + {t('pricing.addRule', { defaultValue: 'Add Rule' })}
        </button>
      </div>

      {loading ? (
        <p className="ppm-loading">{t('common.loading')}</p>
      ) : rules.length === 0 ? (
        <div className="ppm-empty">
          <p>{t('pricing.noRules', { defaultValue: 'No pricing rules yet' })}</p>
          <button className="ppm-btn-secondary" onClick={() => setShowModal(true)}>
            {t('pricing.createFirst', { defaultValue: 'Create your first rule' })}
          </button>
        </div>
      ) : (
        <div className="ppm-grid">
          {rules.map(rule => (
            <div key={rule.id} className={`ppm-card${rule.isActive ? '' : ' disabled'}`} onClick={() => setSelectedRule(rule)}>
              <div className="ppm-card-head">
                <div>
                  <span className="ppm-type-badge">{typeLabel(rule.type)}</span>
                  <h4>{rule.name}</h4>
                </div>
                <label className="ppm-toggle" onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={rule.isActive} onChange={() => handleToggle(rule.id, rule.isActive)} />
                  <span className="ppm-slider" />
                </label>
              </div>
              {rule.description && <p className="ppm-card-desc">{rule.description}</p>}
              <div className="ppm-card-meta">
                <span className="ppm-adj">{adjLabel(rule)}</span>
                <span className="ppm-priority">P{rule.priority}</span>
              </div>
              {rule.startDate && (
                <p className="ppm-dates">
                  {new Date(rule.startDate).toLocaleDateString()} –{' '}
                  {rule.endDate ? new Date(rule.endDate).toLocaleDateString() : t('common.ongoing', { defaultValue: 'ongoing' })}
                </p>
              )}
              <button
                className="ppm-delete-btn"
                onClick={e => { e.stopPropagation(); handleDelete(rule.id); }}
                title={t('common.delete')}
              >
                🗑️
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showModal && (
        <div className="ppm-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="ppm-modal" onClick={e => e.stopPropagation()}>
            <h3>{t('pricing.createNewRule', { defaultValue: 'New Pricing Rule' })}</h3>
            <form onSubmit={handleCreate}>
              <label>{t('common.name')} *</label>
              <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />

              <label>{t('pricing.type', { defaultValue: 'Type' })} *</label>
              <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                {RULE_TYPES.map(rt => <option key={rt} value={rt}>{typeLabel(rt)}</option>)}
              </select>

              <label>{t('common.description')}</label>
              <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows="2" />

              <label>{t('pricing.priority', { defaultValue: 'Priority' })} (1–100, lower fires first)</label>
              <input type="number" min="1" max="100" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} />

              <label>{t('pricing.adjustment', { defaultValue: 'Discount / Adjustment' })}</label>
              <div className="ppm-adj-row">
                <select value={form.adjustment.type} onChange={e => setForm({ ...form, adjustment: { ...form.adjustment, type: e.target.value } })}>
                  <option value="percentage">{t('pricing.percentage', { defaultValue: 'Percentage off' })}</option>
                  <option value="fixed">{t('pricing.fixedAmount', { defaultValue: 'Fixed amount off ($)' })}</option>
                  <option value="multiplier">{t('pricing.multiplier', { defaultValue: 'Price multiplier' })}</option>
                </select>
                <input type="number" step="0.01" min="0" value={form.adjustment.value} onChange={e => setForm({ ...form, adjustment: { ...form.adjustment, value: parseFloat(e.target.value) } })} />
              </div>

              <label>{t('pricing.validFrom', { defaultValue: 'Valid from' })}</label>
              <input type="datetime-local" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} />

              <label>{t('pricing.validUntil', { defaultValue: 'Valid until' })}</label>
              <input type="datetime-local" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} />

              <div className="ppm-modal-actions">
                <button type="button" onClick={() => setShowModal(false)}>{t('common.cancel')}</button>
                <button type="submit" className="ppm-btn-primary">{t('common.create')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rule Detail */}
      {selectedRule && (
        <div className="ppm-detail">
          <div className="ppm-detail-head">
            <h3>{selectedRule.name}</h3>
            <button className="ppm-close-btn" onClick={() => setSelectedRule(null)}>✕</button>
          </div>
          <p><strong>{t('pricing.type', { defaultValue: 'Type' })}:</strong> {typeLabel(selectedRule.type)}</p>
          <p><strong>{t('pricing.priority', { defaultValue: 'Priority' })}:</strong> {selectedRule.priority}</p>
          <p><strong>{t('pricing.adjustment', { defaultValue: 'Adjustment' })}:</strong> {adjLabel(selectedRule)}</p>
          <p><strong>{t('common.status')}:</strong> {selectedRule.isActive ? '🟢 Active' : '🔴 Inactive'}</p>
          {selectedRule.description && <p>{selectedRule.description}</p>}
        </div>
      )}
    </div>
  );
}

export default ProductPricingManager;
