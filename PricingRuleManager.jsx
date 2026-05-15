/**
 * Pricing Rule Manager Component
 * Business owner interface for managing dynamic pricing rules and promotions
 */

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import './PricingRuleManager.css';

export default function PricingRuleManager({ businessId }) {
  const { t } = useTranslation();
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showNewRuleModal, setShowNewRuleModal] = useState(false);
  const [selectedRule, setSelectedRule] = useState(null);

  // Form state
  const [ruleForm, setRuleForm] = useState({
    name: '',
    type: 'volume',
    description: '',
    priority: 50,
    appliesToType: 'all',
    adjustment: { type: 'percentage', value: 0 },
    startDate: '',
    endDate: '',
  });

  // Load rules on mount
  useEffect(() => {
    loadRules();
  }, [businessId]);

  const loadRules = async () => {
    try {
      setLoading(true);
      const response = await axios.get(
        `/api/businesses/${businessId}/product-pricing/rules`
      );
      setRules(response.data.data);
    } catch (error) {
      console.error('Failed to load rules:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateRule = async (e) => {
    e.preventDefault();
    if (!ruleForm.name || !ruleForm.type) {
      alert(t('common.fillRequiredFields'));
      return;
    }

    try {
      const response = await axios.post(
        `/api/businesses/${businessId}/product-pricing/rules`,
        {
          name: ruleForm.name,
          type: ruleForm.type,
          description: ruleForm.description,
          priority: parseInt(ruleForm.priority),
          appliesToType: ruleForm.appliesToType,
          adjustment: ruleForm.adjustment,
          startDate: ruleForm.startDate || null,
          endDate: ruleForm.endDate || null,
        }
      );

      setRules([response.data.data, ...rules]);
      setRuleForm({
        name: '',
        type: 'volume',
        description: '',
        priority: 50,
        appliesToType: 'all',
        adjustment: { type: 'percentage', value: 0 },
        startDate: '',
        endDate: '',
      });
      setShowNewRuleModal(false);
      alert(t('pricing.ruleCreated'));
    } catch (error) {
      console.error('Failed to create rule:', error);
      alert(t('common.errorCreating'));
    }
  };

  const handleDeleteRule = async (ruleId) => {
    if (!window.confirm(t('common.confirmDelete'))) return;

    try {
      await axios.delete(
        `/api/businesses/${businessId}/product-pricing/rules/${ruleId}`
      );
      setRules(rules.filter(r => r.id !== ruleId));
      setSelectedRule(null);
      alert(t('common.deleted'));
    } catch (error) {
      console.error('Failed to delete rule:', error);
      alert(t('common.failedToDelete'));
    }
  };

  const handleToggleRuleActive = async (ruleId, currentActive) => {
    try {
      await axios.put(
        `/api/businesses/${businessId}/product-pricing/rules/${ruleId}`,
        { isActive: !currentActive }
      );
      loadRules();
    } catch (error) {
      console.error('Failed to toggle rule:', error);
    }
  };

  const getAdjustmentDisplay = (rule) => {
    const adj = rule.adjustment;
    if (adj.type === 'percentage') {
      return `${adj.value}% off`;
    } else if (adj.type === 'fixed') {
      return `-$${adj.value}`;
    } else if (adj.type === 'multiplier') {
      return `× ${adj.value}`;
    }
    return '-';
  };

  const getTypeLabel = (type) => {
    const labels = {
      volume: t('pricing.volumeBased'),
      promotion: t('pricing.timeLimited'),
      bundle: t('pricing.bundleOffer'),
      segment: t('pricing.customerSegment'),
      seasonal: t('pricing.seasonal'),
    };
    return labels[type] || type;
  };

  return (
    <div className="pricing-rule-manager">
      {/* Header */}
      <div className="prm-header">
        <h2>{t('pricing.rulesManagement')}</h2>
        <button
          className="prm-btn-primary"
          onClick={() => setShowNewRuleModal(true)}
        >
          + {t('pricing.addRule')}
        </button>
      </div>

      {/* Rules List */}
      <div className="prm-rules">
        {loading ? (
          <p>{t('common.loading')}</p>
        ) : rules.length === 0 ? (
          <div className="prm-empty">
            <p>{t('pricing.noRules')}</p>
            <button
              className="prm-btn-secondary"
              onClick={() => setShowNewRuleModal(true)}
            >
              {t('pricing.createFirst')}
            </button>
          </div>
        ) : (
          <div className="prm-grid">
            {rules.map(rule => (
              <div
                key={rule.id}
                className={`prm-card ${rule.isActive ? '' : 'disabled'}`}
                onClick={() => setSelectedRule(rule)}
              >
                <div className="prm-card-header">
                  <div>
                    <h4>{rule.name}</h4>
                    <p className="prm-type">{getTypeLabel(rule.type)}</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={rule.isActive}
                    onChange={e => {
                      e.stopPropagation();
                      handleToggleRuleActive(rule.id, rule.isActive);
                    }}
                    title={t('common.active')}
                  />
                </div>

                <div className="prm-card-body">
                  {rule.description && <p className="prm-desc">{rule.description}</p>}

                  <div className="prm-meta">
                    <span className="prm-priority">
                      {t('pricing.priority')}: {rule.priority}
                    </span>
                    <span className="prm-adjustment">
                      {getAdjustmentDisplay(rule)}
                    </span>
                  </div>

                  {rule.startDate && (
                    <div className="prm-dates">
                      <small>
                        {new Date(rule.startDate).toLocaleDateString()} -{' '}
                        {rule.endDate ? new Date(rule.endDate).toLocaleDateString() : t('common.ongoing')}
                      </small>
                    </div>
                  )}
                </div>

                <div className="prm-card-actions">
                  <button
                    className="prm-btn-small prm-btn-delete"
                    onClick={e => {
                      e.stopPropagation();
                      handleDeleteRule(rule.id);
                    }}
                    title={t('common.delete')}
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* New Rule Modal */}
      {showNewRuleModal && (
        <div className="prm-modal-overlay" onClick={() => setShowNewRuleModal(false)}>
          <div className="prm-modal" onClick={e => e.stopPropagation()}>
            <h3>{t('pricing.createNewRule')}</h3>
            <form onSubmit={handleCreateRule}>
              <input
                type="text"
                placeholder={t('common.name')}
                value={ruleForm.name}
                onChange={e => setRuleForm({ ...ruleForm, name: e.target.value })}
                required
              />

              <select
                value={ruleForm.type}
                onChange={e => setRuleForm({ ...ruleForm, type: e.target.value })}
              >
                <option value="volume">{t('pricing.volumeBased')}</option>
                <option value="promotion">{t('pricing.timeLimited')}</option>
                <option value="bundle">{t('pricing.bundleOffer')}</option>
                <option value="segment">{t('pricing.customerSegment')}</option>
                <option value="seasonal">{t('pricing.seasonal')}</option>
              </select>

              <textarea
                placeholder={t('common.description')}
                value={ruleForm.description}
                onChange={e => setRuleForm({ ...ruleForm, description: e.target.value })}
                rows="2"
              />

              <div className="prm-form-group">
                <label>{t('pricing.priority')} (1-100)</label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={ruleForm.priority}
                  onChange={e => setRuleForm({ ...ruleForm, priority: e.target.value })}
                />
                <small>{t('pricing.lowerPriorityFirst')}</small>
              </div>

              <div className="prm-form-group">
                <label>{t('pricing.adjustment')}</label>
                <select
                  value={ruleForm.adjustment.type}
                  onChange={e =>
                    setRuleForm({
                      ...ruleForm,
                      adjustment: { ...ruleForm.adjustment, type: e.target.value },
                    })
                  }
                >
                  <option value="percentage">{t('pricing.percentage')}</option>
                  <option value="fixed">{t('pricing.fixedAmount')}</option>
                  <option value="multiplier">{t('pricing.multiplier')}</option>
                </select>
                <input
                  type="number"
                  placeholder={t('pricing.value')}
                  value={ruleForm.adjustment.value}
                  onChange={e =>
                    setRuleForm({
                      ...ruleForm,
                      adjustment: {
                        ...ruleForm.adjustment,
                        value: parseFloat(e.target.value),
                      },
                    })
                  }
                  step="0.01"
                />
              </div>

              <div className="prm-form-group">
                <label>{t('pricing.validFrom')}</label>
                <input
                  type="datetime-local"
                  value={ruleForm.startDate}
                  onChange={e => setRuleForm({ ...ruleForm, startDate: e.target.value })}
                />
              </div>

              <div className="prm-form-group">
                <label>{t('pricing.validUntil')}</label>
                <input
                  type="datetime-local"
                  value={ruleForm.endDate}
                  onChange={e => setRuleForm({ ...ruleForm, endDate: e.target.value })}
                />
              </div>

              <div className="prm-modal-actions">
                <button type="button" onClick={() => setShowNewRuleModal(false)}>
                  {t('common.cancel')}
                </button>
                <button type="submit" className="prm-btn-primary">
                  {t('common.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rule Detail Panel */}
      {selectedRule && (
        <div className="prm-detail">
          <div className="prm-detail-header">
            <h3>{selectedRule.name}</h3>
            <button
              className="prm-btn-close"
              onClick={() => setSelectedRule(null)}
            >
              ✕
            </button>
          </div>

          <div className="prm-detail-body">
            <div className="prm-detail-section">
              <h4>{t('common.details')}</h4>
              <p>
                <strong>{t('pricing.type')}:</strong> {getTypeLabel(selectedRule.type)}
              </p>
              <p>
                <strong>{t('pricing.priority')}:</strong> {selectedRule.priority}
              </p>
              <p>
                <strong>{t('common.status')}:</strong>{' '}
                {selectedRule.isActive ? '🟢 Active' : '🔴 Inactive'}
              </p>
              {selectedRule.description && (
                <p>
                  <strong>{t('common.description')}:</strong> {selectedRule.description}
                </p>
              )}
            </div>

            {selectedRule.startDate && (
              <div className="prm-detail-section">
                <h4>{t('pricing.validity')}</h4>
                <p>
                  {new Date(selectedRule.startDate).toLocaleString()} -{' '}
                  {selectedRule.endDate
                    ? new Date(selectedRule.endDate).toLocaleString()
                    : t('common.ongoing')}
                </p>
              </div>
            )}

            <div className="prm-detail-section">
              <h4>{t('pricing.adjustment')}</h4>
              <p>{getAdjustmentDisplay(selectedRule)}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
