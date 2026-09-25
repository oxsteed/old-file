import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Edit2, Trash2, Plus, Gift, Zap, Crown } from 'lucide-react';
import '../../styles/CustomerLoyaltyManager.css';

const TIER_CONFIGS = [
  {
    id: 'bronze',
    nameKey: 'bronze',
    icon: Gift,
    color: '#cd7f32',
    minPoints: 0,
    benefitKeys: ['bronzeDiscount', 'prioritySupport']
  },
  {
    id: 'silver',
    nameKey: 'silver',
    icon: Zap,
    color: '#c0c0c0',
    minPoints: 500,
    benefitKeys: ['silverDiscount', 'earlyBooking', 'monthlyBonus']
  },
  {
    id: 'gold',
    nameKey: 'gold',
    icon: Crown,
    color: '#ffd700',
    minPoints: 1500,
    benefitKeys: ['goldDiscount', 'vipSupport', 'freeUpgrade', 'exclusiveEvents']
  },
  {
    id: 'platinum',
    nameKey: 'platinum',
    icon: Crown,
    color: '#e5e4e2',
    minPoints: 3500,
    benefitKeys: ['platinumDiscount', 'accountManager', 'customPricing', 'annualGift']
  }
];

export function CustomerLoyaltyManager({ businessId }) {
  const { t } = useTranslation();
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
      toast.error(t('businessHub.loyalty.toastLoadTiersFail'));
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
      toast.error(t('businessHub.loyalty.toastLoadCustomersFail'));
    }
  };

  const handleSaveTier = async () => {
    if (!formData.tier_name || formData.discount_percent < 0) {
      toast.error(t('businessHub.loyalty.toastFieldsRequired'));
      return;
    }

    try {
      if (selectedTier) {
        await api.put(
          `/businesses/${businessId}/loyalty-tiers/${selectedTier.id}`,
          formData
        );
        toast.success(t('businessHub.loyalty.toastTierUpdated'));
      } else {
        await api.post(
          `/businesses/${businessId}/loyalty-tiers`,
          formData
        );
        toast.success(t('businessHub.loyalty.toastTierCreated'));
      }
      setShowForm(false);
      setSelectedTier(null);
      resetForm();
      loadTiers();
    } catch (error) {
      toast.error(error.response?.data?.message || t('businessHub.loyalty.toastSaveFail'));
    }
  };

  const handleDeleteTier = async (tierId) => {
    if (!window.confirm(t('businessHub.loyalty.confirmDeleteTier'))) return;

    try {
      await api.delete(
        `/businesses/${businessId}/loyalty-tiers/${tierId}`
      );
      toast.success(t('businessHub.loyalty.toastTierDeleted'));
      loadTiers();
    } catch (error) {
      toast.error(t('businessHub.loyalty.toastDeleteFail'));
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
        <h3>{t('businessHub.loyalty.title')}</h3>
        <button
          onClick={() => {
            resetForm();
            setSelectedTier(null);
            setShowForm(true);
          }}
          className="clm-btn-new"
        >
          <Plus size={18} /> {t('businessHub.loyalty.newTier')}
        </button>
      </div>

      {showForm ? (
        <div className="clm-form-container">
          <h4>{selectedTier ? t('businessHub.loyalty.editTier') : t('businessHub.loyalty.createTier')}</h4>

          <div className="clm-form-row">
            <div className="clm-form-group">
              <label>{t('businessHub.loyalty.tierNameRequired')}</label>
              <select
                value={formData.tier_name}
                onChange={(e) => setFormData({ ...formData, tier_name: e.target.value })}
                required
              >
                {TIER_CONFIGS.map(tier => (
                  <option key={tier.id} value={tier.id}>
                    {t(`businessHub.loyalty.tiers.${tier.nameKey}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="clm-form-group">
              <label>{t('businessHub.loyalty.minimumPointsRequired')}</label>
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
              <label>{t('businessHub.loyalty.discountPercentageRequired')}</label>
              <input
                type="number"
                min="0"
                max="50"
                step="0.5"
                value={formData.discount_percent}
                onChange={(e) => setFormData({ ...formData, discount_percent: parseFloat(e.target.value) })}
                required
              />
              <small>{t('businessHub.loyalty.discountHint')}</small>
            </div>
          </div>

          <div className="clm-form-group">
            <label>{t('businessHub.loyalty.benefits')}</label>
            <textarea
              value={formData.benefits.join('\n')}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  benefits: e.target.value.split('\n').filter(b => b.trim())
                })
              }
              placeholder={t('businessHub.loyalty.benefitsPlaceholder')}
              rows="4"
            />
            <small>{t('businessHub.loyalty.benefitsHint')}</small>
          </div>

          <div className="clm-form-buttons">
            <button onClick={() => setShowForm(false)} className="clm-btn-cancel">
              {t('common.cancel')}
            </button>
            <button onClick={handleSaveTier} className="clm-btn-save">
              {t('businessHub.loyalty.saveTier')}
            </button>
          </div>
        </div>
      ) : showCustomerList ? (
        <div className="clm-customer-list-container">
          <button
            onClick={() => setShowCustomerList(false)}
            className="clm-btn-back"
          >
            ← {t('businessHub.loyalty.backToTiers')}
          </button>
          <h4>{t('businessHub.loyalty.customersInTier')}</h4>
          {customers.length === 0 ? (
            <p className="clm-no-customers">{t('businessHub.loyalty.noCustomers')}</p>
          ) : (
            <div className="clm-customers-table">
              <div className="clm-table-header">
                <div>{t('businessHub.loyalty.customerName')}</div>
                <div>{t('businessHub.loyalty.email')}</div>
                <div>{t('businessHub.loyalty.loyaltyPoints')}</div>
                <div>{t('businessHub.loyalty.appointments')}</div>
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
            <div className="clm-loading">{t('businessHub.loyalty.loading')}</div>
          ) : tiers.length === 0 ? (
            <div className="clm-empty">
              <p>{t('businessHub.loyalty.noTiers')}</p>
              <button
                onClick={() => setShowForm(true)}
                className="clm-btn-new-large"
              >
                {t('businessHub.loyalty.setupFirstTier')}
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
                    <h4>{config ? t(`businessHub.loyalty.tiers.${config.nameKey}`) : tier.tier_name}</h4>
                    <div className="clm-tier-actions">
                      <button
                        onClick={() => handleEditTier(tier)}
                        className="clm-btn-action"
                        aria-label={t('businessHub.loyalty.editTier')}
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={() => handleDeleteTier(tier.id)}
                        className="clm-btn-action delete"
                        aria-label={t('businessHub.loyalty.deleteTier')}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  <div className="clm-tier-details">
                    <div className="clm-detail">
                      <span className="clm-label">{t('businessHub.loyalty.minPoints')}</span>
                      <span className="clm-value">{tier.min_points}</span>
                    </div>
                    <div className="clm-detail">
                      <span className="clm-label">{t('businessHub.loyalty.discount')}</span>
                      <span className="clm-value">{tier.discount_percent}%</span>
                    </div>
                  </div>

                  {tier.benefits && tier.benefits.length > 0 && (
                    <div className="clm-tier-benefits">
                      <p className="clm-benefits-title">{t('businessHub.loyalty.benefits')}:</p>
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
                    {t('businessHub.loyalty.viewCustomers', { count: tier.customer_count || 0 })}
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
