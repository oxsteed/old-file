import React, { useState, useEffect } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Edit2, Trash2, Plus, TrendingUp, Clock, Users, Zap, Calendar } from 'lucide-react';
import '../../styles/PricingRulesManager.css';

const RULE_TYPES = [
  { id: 'time_based', name: 'Time-Based', description: 'Different prices for peak/off-peak hours', icon: Clock },
  { id: 'demand_based', name: 'Demand-Based', description: 'Surge pricing based on availability', icon: Zap },
  { id: 'volume_based', name: 'Volume-Based', description: 'Discounts for bulk bookings', icon: TrendingUp },
  { id: 'customer_segment', name: 'Customer Segment', description: 'Loyalty tier discounts', icon: Users },
  { id: 'seasonal', name: 'Seasonal', description: 'Date-range pricing overrides', icon: Calendar }
];

export function PricingRulesManager({ businessId }) {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [selectedRule, setSelectedRule] = useState(null);
  const [formData, setFormData] = useState({
    type: 'time_based',
    name: '',
    description: '',
    priority: 1,
    is_active: true,
    conditions: {},
    multiplier: 1,
    discount_percent: 0,
    fixed_price: 0
  });

  useEffect(() => {
    loadRules();
  }, [businessId]);

  const loadRules = async () => {
    try {
      setLoading(true);
      const response = await api.get(
        `/api/businesses/${businessId}/pricing-rules`
      );
      setRules(response.data || []);
    } catch (error) {
      toast.error('Failed to load pricing rules');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveRule = async () => {
    if (!formData.name || !formData.type) {
      toast.error('Please fill in required fields');
      return;
    }

    try {
      if (selectedRule) {
        await api.put(
          `/api/businesses/${businessId}/pricing-rules/${selectedRule.id}`,
          formData
        );
        toast.success('Pricing rule updated');
      } else {
        await api.post(
          `/api/businesses/${businessId}/pricing-rules`,
          formData
        );
        toast.success('Pricing rule created');
      }
      setShowForm(false);
      setSelectedRule(null);
      resetForm();
      loadRules();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to save rule');
    }
  };

  const handleDeleteRule = async (ruleId) => {
    if (!window.confirm('Delete this pricing rule?')) return;

    try {
      await api.delete(
        `/api/businesses/${businessId}/pricing-rules/${ruleId}`
      );
      toast.success('Rule deleted');
      loadRules();
    } catch (error) {
      toast.error('Failed to delete rule');
    }
  };

  const handleEditRule = (rule) => {
    setSelectedRule(rule);
    setFormData(rule);
    setShowForm(true);
  };

  const resetForm = () => {
    setFormData({
      type: 'time_based',
      name: '',
      description: '',
      priority: 1,
      is_active: true,
      conditions: {},
      multiplier: 1,
      discount_percent: 0,
      fixed_price: 0
    });
  };

  const getRuleTypeIcon = (typeId) => {
    const type = RULE_TYPES.find(t => t.id === typeId);
    const Icon = type?.icon || TrendingUp;
    return <Icon size={16} />;
  };

  const getRuleTypeName = (typeId) => {
    const type = RULE_TYPES.find(t => t.id === typeId);
    return type?.name || typeId;
  };

  const renderTypeSpecificConfig = () => {
    switch (formData.type) {
      case 'time_based':
        return (
          <>
            <div className="prm-config-section">
              <h5>Time-Based Configuration</h5>
              <div className="prm-form-row">
                <div className="prm-form-group">
                  <label>Peak Hours (e.g., 18:00-22:00)</label>
                  <input
                    type="text"
                    placeholder="HH:MM-HH:MM"
                    value={formData.conditions?.peak_hours || ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        conditions: { ...formData.conditions, peak_hours: e.target.value }
                      })
                    }
                  />
                  <small>24-hour format, e.g., 18:00-22:00</small>
                </div>
                <div className="prm-form-group">
                  <label>Peak Multiplier</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={formData.multiplier}
                    onChange={(e) => setFormData({ ...formData, multiplier: parseFloat(e.target.value) })}
                  />
                  <small>E.g., 1.5 = 50% markup</small>
                </div>
              </div>
            </div>
          </>
        );
      case 'demand_based':
        return (
          <>
            <div className="prm-config-section">
              <h5>Demand-Based Configuration</h5>
              <div className="prm-form-row">
                <div className="prm-form-group">
                  <label>Availability Threshold (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={formData.conditions?.availability_threshold || 50}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        conditions: { ...formData.conditions, availability_threshold: parseInt(e.target.value) }
                      })
                    }
                  />
                  <small>When availability drops below this %, apply surge pricing</small>
                </div>
                <div className="prm-form-group">
                  <label>Surge Multiplier</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={formData.multiplier}
                    onChange={(e) => setFormData({ ...formData, multiplier: parseFloat(e.target.value) })}
                  />
                </div>
              </div>
            </div>
          </>
        );
      case 'volume_based':
        return (
          <>
            <div className="prm-config-section">
              <h5>Volume-Based Configuration</h5>
              <div className="prm-form-row">
                <div className="prm-form-group">
                  <label>Minimum Quantity</label>
                  <input
                    type="number"
                    min="1"
                    value={formData.conditions?.min_quantity || 1}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        conditions: { ...formData.conditions, min_quantity: parseInt(e.target.value) }
                      })
                    }
                  />
                </div>
                <div className="prm-form-group">
                  <label>Discount (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={formData.discount_percent}
                    onChange={(e) => setFormData({ ...formData, discount_percent: parseInt(e.target.value) })}
                  />
                </div>
              </div>
            </div>
          </>
        );
      case 'customer_segment':
        return (
          <>
            <div className="prm-config-section">
              <h5>Customer Segment Configuration</h5>
              <div className="prm-form-row">
                <div className="prm-form-group">
                  <label>Loyalty Tier</label>
                  <select
                    value={formData.conditions?.tier || 'bronze'}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        conditions: { ...formData.conditions, tier: e.target.value }
                      })
                    }
                  >
                    <option value="bronze">Bronze</option>
                    <option value="silver">Silver</option>
                    <option value="gold">Gold</option>
                    <option value="platinum">Platinum</option>
                  </select>
                </div>
                <div className="prm-form-group">
                  <label>Discount (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={formData.discount_percent}
                    onChange={(e) => setFormData({ ...formData, discount_percent: parseInt(e.target.value) })}
                  />
                </div>
              </div>
            </div>
          </>
        );
      case 'seasonal':
        return (
          <>
            <div className="prm-config-section">
              <h5>Seasonal Configuration</h5>
              <div className="prm-form-row">
                <div className="prm-form-group">
                  <label>Start Date</label>
                  <input
                    type="date"
                    value={formData.conditions?.start_date || ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        conditions: { ...formData.conditions, start_date: e.target.value }
                      })
                    }
                  />
                </div>
                <div className="prm-form-group">
                  <label>End Date</label>
                  <input
                    type="date"
                    value={formData.conditions?.end_date || ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        conditions: { ...formData.conditions, end_date: e.target.value }
                      })
                    }
                  />
                </div>
              </div>
              <div className="prm-form-row">
                <div className="prm-form-group">
                  <label>Price Multiplier</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={formData.multiplier}
                    onChange={(e) => setFormData({ ...formData, multiplier: parseFloat(e.target.value) })}
                  />
                </div>
              </div>
            </div>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <div className="prm-container">
      <div className="prm-header">
        <h3>Pricing Rules</h3>
        <button
          onClick={() => {
            resetForm();
            setSelectedRule(null);
            setShowForm(true);
          }}
          className="prm-btn-new"
        >
          <Plus size={18} /> New Rule
        </button>
      </div>

      {showForm ? (
        <div className="prm-form-container">
          <h4>{selectedRule ? 'Edit Pricing Rule' : 'Create Pricing Rule'}</h4>

          <div className="prm-form-row">
            <div className="prm-form-group">
              <label>Rule Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Weekend Premium Pricing"
                required
              />
            </div>
            <div className="prm-form-group">
              <label>Rule Type *</label>
              <select
                value={formData.type}
                onChange={(e) => {
                  setFormData({ ...formData, type: e.target.value, conditions: {} });
                }}
                required
              >
                {RULE_TYPES.map(type => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="prm-form-group">
            <label>Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Explain when this rule applies..."
              rows="2"
            />
          </div>

          <div className="prm-form-row">
            <div className="prm-form-group">
              <label>Priority</label>
              <input
                type="number"
                min="1"
                max="100"
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) })}
              />
              <small>Higher priority rules apply first (1-100)</small>
            </div>
            <div className="prm-form-group">
              <label className="prm-checkbox-label">
                <input
                  type="checkbox"
                  checked={formData.is_active}
                  onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                />
                Active
              </label>
            </div>
          </div>

          {renderTypeSpecificConfig()}

          <div className="prm-form-buttons">
            <button onClick={() => setShowForm(false)} className="prm-btn-cancel">
              Cancel
            </button>
            <button onClick={handleSaveRule} className="prm-btn-save">
              Save Rule
            </button>
          </div>
        </div>
      ) : (
        <div className="prm-rules-grid">
          {loading ? (
            <div className="prm-loading">Loading pricing rules...</div>
          ) : rules.length === 0 ? (
            <div className="prm-empty">
              <p>No pricing rules yet</p>
              <button
                onClick={() => setShowForm(true)}
                className="prm-btn-new-large"
              >
                Create First Rule
              </button>
            </div>
          ) : (
            rules
              .sort((a, b) => (a.priority || 0) - (b.priority || 0))
              .map(rule => (
                <div
                  key={rule.id}
                  className={`prm-rule-card ${!rule.is_active ? 'inactive' : ''}`}
                >
                  <div className="prm-rule-header">
                    <div className="prm-rule-icon">
                      {getRuleTypeIcon(rule.type)}
                    </div>
                    <h4>{rule.name}</h4>
                    <div className="prm-rule-actions">
                      <button
                        onClick={() => handleEditRule(rule)}
                        className="prm-btn-action"
                        aria-label="Edit rule"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={() => handleDeleteRule(rule.id)}
                        className="prm-btn-action delete"
                        aria-label="Delete rule"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  <span className="prm-rule-type">{getRuleTypeName(rule.type)}</span>

                  {rule.description && (
                    <p className="prm-rule-description">{rule.description}</p>
                  )}

                  {rule.multiplier && rule.multiplier !== 1 && (
                    <div className="prm-rule-detail">
                      <strong>Multiplier:</strong> {rule.multiplier.toFixed(2)}x
                    </div>
                  )}

                  {rule.discount_percent > 0 && (
                    <div className="prm-rule-detail">
                      <strong>Discount:</strong> {rule.discount_percent}%
                    </div>
                  )}

                  {rule.priority && (
                    <div className="prm-rule-detail">
                      <strong>Priority:</strong> {rule.priority}
                    </div>
                  )}

                  <div className="prm-rule-meta">
                    <span className={`prm-status ${rule.is_active ? 'active' : 'inactive'}`}>
                      {rule.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>
              ))
          )}
        </div>
      )}
    </div>
  );
}
