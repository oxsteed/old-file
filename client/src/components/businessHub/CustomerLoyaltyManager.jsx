import React, { useState, useEffect } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Edit2, Trash2, Plus, Gift, Zap, Crown } from 'lucide-react';
import '../../styles/CustomerLoyaltyManager.css';

const TIER_CONFIGS = [
  {
    id: 'bronze',
    name: 'Bronze',
    icon: Gift,
    color: '#cd7f32',
    minPoints: 0,
    benefits: ['5% discount on services', 'Priority support']
  },
  {
    id: 'silver',
    name: 'Silver',
    icon: Zap,
    color: '#c0c0c0',
    minPoints: 500,
    benefits: ['10% discount on services', 'Early booking access', 'Monthly bonus points']
  },
  {
    id: 'gold',
    name: 'Gold',
    icon: Crown,
    color: '#ffd700',
    minPoints: 1500,
    benefits: ['15% discount on services', 'VIP support', 'Free service upgrade', 'Exclusive events']
  },
  {
    id: 'platinum',
    name: 'Platinum',
    icon: Crown,
    color: '#e5e4e2',
    minPoints: 3500,
    benefits: ['25% discount on services', 'Dedicated account manager', 'Custom pricing', 'Annual gift']
  }
];

export function CustomerLoyaltyManager({ businessId }) {
  const [tiers, setTiers] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showCustomerList, setShowCustomerList] = useState(false);
  const [selectedTier, setSelectedTier] = useState(null);
  const [formData, setFormData] = useState({
    tier_name: 'bronze',
    discount_percent: 5,
    min_points: 0,
    benefits: []
  });

  useEffect(() => {
    loadTiers();
  }, [businessId]);

  const loadTiers = async () => {
    try {
      setLoading(true);
      const response = await api.get(
        `/businesses/${businessId}/loyalty-tiers`
      );
      setTiers(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      toast.error('Failed to load loyalty tiers');
    } finally {
      setLoading(false);
    }
  };

  const loadCustomersByTier = async (tierId) => {
    try {
      const response = await api.get(
        `/businesses/${businessId}/loyalty/tier/${tierId}/customers`
      );
      setCustomers(response.data || []);
      setShowCustomerList(true);
    } catch (error) {
      toast.error('Failed to load customers');
    }
  };

  const handleSaveTier = async () => {
    if (!formData.tier_name || formData.discount_percent < 0) {
      toast.error('Please fill in required fields');
      return;
    }

    try {
      if (selectedTier) {
        await api.put(
          `/businesses/${businessId}/loyalty-tiers/${selectedTier.id}`,
          formData
        );
        toast.success('Tier updated');
      } else {
        await api.post(
          `/businesses/${businessId}/loyalty-tiers`,
          formData
        );
        toast.success('Tier created');
      }
      setShowForm(false);
      setSelectedTier(null);
      resetForm();
      loadTiers();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to save tier');
    }
  };

  const handleDeleteTier = async (tierId) => {
    if (!window.confirm('Delete this loyalty tier?')) return;

    try {
      await api.delete(
        `/businesses/${businessId}/loyalty-tiers/${tierId}`
      );
      toast.success('Tier deleted');
      loadTiers();
    } catch (error) {
      toast.error('Failed to delete tier');
    }
  };

  const handleEditTier = (tier) => {
    setSelectedTier(tier);
    setFormData({
      tier_name: tier.tier_name,
      discount_percent: tier.discount_percent,
      min_points: tier.min_points,
      benefits: tier.benefits || []
    });
    setShowForm(true);
  };

  const resetForm = () => {
    setFormData({
      tier_name: 'bronze',
      discount_percent: 5,
      min_points: 0,
      benefits: []
    });
  };

  const getTierConfig = (tierId) => {
    return TIER_CONFIGS.find(t => t.id === tierId);
  };

  return (
    <div className="clm-container">
      <div className="clm-header">
        <h3>Customer Loyalty Program</h3>
        <button
          onClick={() => {
            resetForm();
            setSelectedTier(null);
            setShowForm(true);
          }}
          className="clm-btn-new"
        >
          <Plus size={18} /> New Tier
        </button>
      </div>

      {showForm ? (
        <div className="clm-form-container">
          <h4>{selectedTier ? 'Edit Loyalty Tier' : 'Create Loyalty Tier'}</h4>

          <div className="clm-form-row">
            <div className="clm-form-group">
              <label>Tier Name *</label>
              <select
                value={formData.tier_name}
                onChange={(e) => setFormData({ ...formData, tier_name: e.target.value })}
                required
              >
                {TIER_CONFIGS.map(tier => (
                  <option key={tier.id} value={tier.id}>
                    {tier.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="clm-form-group">
              <label>Minimum Points *</label>
              <input
                type="number"
                min="0"
                value={formData.min_points}
                onChange={(e) => setFormData({ ...formData, min_points: parseInt(e.target.value) })}
                required
              />
            </div>
          </div>

          <div className="clm-form-row">
            <div className="clm-form-group">
              <label>Discount Percentage *</label>
              <input
                type="number"
                min="0"
                max="50"
                step="0.5"
                value={formData.discount_percent}
                onChange={(e) => setFormData({ ...formData, discount_percent: parseFloat(e.target.value) })}
                required
              />
              <small>Percentage discount applied to services</small>
            </div>
          </div>

          <div className="clm-form-group">
            <label>Benefits</label>
            <textarea
              value={formData.benefits.join('\n')}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  benefits: e.target.value.split('\n').filter(b => b.trim())
                })
              }
              placeholder="Enter each benefit on a new line&#10;E.g., Priority support&#10;Free service upgrade"
              rows="4"
            />
            <small>Enter each benefit on a separate line</small>
          </div>

          <div className="clm-form-buttons">
            <button onClick={() => setShowForm(false)} className="clm-btn-cancel">
              Cancel
            </button>
            <button onClick={handleSaveTier} className="clm-btn-save">
              Save Tier
            </button>
          </div>
        </div>
      ) : showCustomerList ? (
        <div className="clm-customer-list-container">
          <button
            onClick={() => setShowCustomerList(false)}
            className="clm-btn-back"
          >
            ← Back to Tiers
          </button>
          <h4>Customers in this tier</h4>
          {customers.length === 0 ? (
            <p className="clm-no-customers">No customers in this tier yet</p>
          ) : (
            <div className="clm-customers-table">
              <div className="clm-table-header">
                <div>Customer Name</div>
                <div>Email</div>
                <div>Loyalty Points</div>
                <div>Appointments</div>
              </div>
              {customers.map(customer => (
                <div key={customer.id} className="clm-table-row">
                  <div>{customer.name}</div>
                  <div>{customer.email}</div>
                  <div>{customer.loyalty_points || 0}</div>
                  <div>{customer.appointment_count || 0}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="clm-tiers-grid">
          {loading ? (
            <div className="clm-loading">Loading loyalty tiers...</div>
          ) : tiers.length === 0 ? (
            <div className="clm-empty">
              <p>No loyalty tiers configured yet</p>
              <button
                onClick={() => setShowForm(true)}
                className="clm-btn-new-large"
              >
                Set Up First Tier
              </button>
            </div>
          ) : (
            tiers.map(tier => {
              const config = getTierConfig(tier.tier_name);
              const TierIcon = config?.icon || Gift;
              return (
                <div key={tier.id} className="clm-tier-card">
                  <div className="clm-tier-header">
                    <div
                      className="clm-tier-icon"
                      style={{ backgroundColor: config?.color }}
                    >
                      <TierIcon size={24} color="white" />
                    </div>
                    <h4>{config?.name || tier.tier_name}</h4>
                    <div className="clm-tier-actions">
                      <button
                        onClick={() => handleEditTier(tier)}
                        className="clm-btn-action"
                        aria-label="Edit tier"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={() => handleDeleteTier(tier.id)}
                        className="clm-btn-action delete"
                        aria-label="Delete tier"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  <div className="clm-tier-details">
                    <div className="clm-detail">
                      <span className="clm-label">Min Points:</span>
                      <span className="clm-value">{tier.min_points}</span>
                    </div>
                    <div className="clm-detail">
                      <span className="clm-label">Discount:</span>
                      <span className="clm-value">{tier.discount_percent}%</span>
                    </div>
                  </div>

                  {tier.benefits && tier.benefits.length > 0 && (
                    <div className="clm-tier-benefits">
                      <p className="clm-benefits-title">Benefits:</p>
                      <ul>
                        {tier.benefits.map((benefit, idx) => (
                          <li key={idx}>{benefit}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <button
                    onClick={() => loadCustomersByTier(tier.id)}
                    className="clm-btn-view-customers"
                  >
                    View {tier.customer_count || 0} Customers
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
