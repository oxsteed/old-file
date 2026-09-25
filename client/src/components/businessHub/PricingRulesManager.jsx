import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Trash2, Plus, TrendingUp, Clock, Users, Zap, Calendar, ToggleLeft, ToggleRight } from 'lucide-react';
import '../../styles/PricingRulesManager.css';

// Server rule_type values (not 'time_based' etc.)
const RULE_TYPES = [
  { id: 'time', nameKey: 'time', descriptionKey: 'timeDescription', icon: Clock },
  { id: 'demand', nameKey: 'demand', descriptionKey: 'demandDescription', icon: Zap },
  { id: 'volume', nameKey: 'volume', descriptionKey: 'volumeDescription', icon: TrendingUp },
  { id: 'segment', nameKey: 'segment', descriptionKey: 'segmentDescription', icon: Users },
  { id: 'seasonal', nameKey: 'seasonal', descriptionKey: 'seasonalDescription', icon: Calendar },
];

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const DEFAULT_FORM = {
  rule_type: 'time',
  priority: 0,
  time:     { day_of_week: 1, start_time: '18:00', end_time: '22:00', is_peak: true,  price_multiplier: 1.5,  fixed_modifier_cents: 0 },
  demand:   { availability_threshold_percent: 50, surge_multiplier: 1.25 },
  volume:   { min_quantity: 2, max_quantity: null, period: 'order', price_multiplier: 0.9, fixed_modifier_cents: 0 },
  segment:  { segment_type: 'returning', segment_criteria: {}, price_multiplier: 0.95, min_customer_bookings: null, max_customer_bookings: null },
  seasonal: { start_date: '', end_date: '', price_multiplier: 1.2, fixed_price_cents: null, fixed_modifier_cents: 0 },
};

export function PricingRulesManager({ businessId }) {
  const { t } = useTranslation();
  const [services, setServices]               = useState([]);
  const [selectedServiceId, setSelectedServiceId] = useState(null);
  const [rules, setRules]                     = useState([]);
  const [loadingSvc, setLoadingSvc]           = useState(false);
  const [loadingRules, setLoadingRules]       = useState(false);
  const [error, setError]                     = useState(null);
  const [showForm, setShowForm]               = useState(false);
  const [formData, setFormData]               = useState(DEFAULT_FORM);

  // Load services once businessId is available
  useEffect(() => {
    if (!businessId) return;
    setLoadingSvc(true);
    api.get(`/businesses/${businessId}/services`)
      .then(r => {
        const list = Array.isArray(r.data) ? r.data : (r.data?.services || []);
        setServices(list);
        if (list.length > 0) setSelectedServiceId(list[0].id);
      })
      .catch(() => toast.error(t('businessHub.pricingRules.toastLoadServicesFail')))
      .finally(() => setLoadingSvc(false));
  }, [businessId]);

  // Load rules whenever the selected service changes
  useEffect(() => {
    if (!businessId || !selectedServiceId) return;
    loadRules();
  }, [businessId, selectedServiceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadRules = async () => {
    try {
      setLoadingRules(true);
      setError(null);
      const response = await api.get(
        `/businesses/${businessId}/pricing/service/${selectedServiceId}/rules`
      );
      setRules(response.data?.rules || []);
    } catch (err) {
      const msg = err.response?.data?.message || t('businessHub.pricingRules.toastLoadRulesFail');
      setError(msg);
      toast.error(msg);
    } finally {
      setLoadingRules(false);
    }
  };

  const handleSaveRule = async () => {
    try {
      const { rule_type, priority } = formData;
      const payload = {
        rule_type,
        priority: Number(priority) || 0,
        [rule_type]: formData[rule_type],
      };
      await api.post(
        `/businesses/${businessId}/pricing/service/${selectedServiceId}/rules`,
        payload
      );
      toast.success(t('businessHub.pricingRules.toastCreated'));
      setShowForm(false);
      setFormData(DEFAULT_FORM);
      loadRules();
    } catch (err) {
      toast.error(err.response?.data?.message || t('businessHub.pricingRules.toastSaveFail'));
    }
  };

  const handleToggleRule = async (ruleId, currentlyActive) => {
    try {
      await api.patch(
        `/businesses/${businessId}/pricing/service/${selectedServiceId}/rules/${ruleId}/toggle`,
        { is_active: !currentlyActive }
      );
      toast.success(currentlyActive ? t('businessHub.pricingRules.toastDisabled') : t('businessHub.pricingRules.toastEnabled'));
      loadRules();
    } catch {
      toast.error(t('businessHub.pricingRules.toastToggleFail'));
    }
  };

  const handleDeleteRule = async (ruleId) => {
    if (!window.confirm(t('businessHub.pricingRules.confirmDeleteRule'))) return;
    try {
      await api.delete(
        `/businesses/${businessId}/pricing/service/${selectedServiceId}/rules/${ruleId}`
      );
      toast.success(t('businessHub.pricingRules.toastDeleted'));
      loadRules();
    } catch {
      toast.error(t('businessHub.pricingRules.toastDeleteFail'));
    }
  };

  const getRuleTypeInfo = (ruleType) => RULE_TYPES.find(type => type.id === ruleType) || { nameKey: ruleType, descriptionKey: '', icon: TrendingUp };

  const setDimension = (key, patch) =>
    setFormData(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  const renderTypeSpecificConfig = () => {
    const { rule_type } = formData;
    switch (rule_type) {
      case 'time':
        return (
          <div className="prm-config-section">
            <h5>{t('businessHub.pricingRules.config.time')}</h5>
            <div className="prm-form-row">
              <div className="prm-form-group">
                <label>{t('businessHub.pricingRules.dayOfWeek')}</label>
                <select
                  value={formData.time.day_of_week}
                  onChange={e => setDimension('time', { day_of_week: parseInt(e.target.value) })}
                >
                  {DAY_NAMES.map((d, i) => <option key={i} value={i}>{t(`common.weekdays.${d}`)}</option>)}
                </select>
              </div>
              <div className="prm-form-group">
                <label>{t('businessHub.pricingRules.peakPeriod')}</label>
                <label className="prm-checkbox-label">
                  <input
                    type="checkbox"
                    checked={formData.time.is_peak}
                    onChange={e => setDimension('time', { is_peak: e.target.checked })}
                  />
                  {t('businessHub.pricingRules.isPeak')}
                </label>
              </div>
            </div>
            <div className="prm-form-row">
              <div className="prm-form-group">
                <label>{t('businessHub.pricingRules.startTime')}</label>
                <input
                  type="time"
                  value={formData.time.start_time}
                  onChange={e => setDimension('time', { start_time: e.target.value })}
                />
              </div>
              <div className="prm-form-group">
                <label>{t('businessHub.pricingRules.endTime')}</label>
                <input
                  type="time"
                  value={formData.time.end_time}
                  onChange={e => setDimension('time', { end_time: e.target.value })}
                />
              </div>
            </div>
            <div className="prm-form-row">
              <div className="prm-form-group">
                <label>{t('businessHub.pricingRules.priceMultiplier')}</label>
                <input
                  type="number" step="0.05" min="0.1"
                  value={formData.time.price_multiplier}
                  onChange={e => setDimension('time', { price_multiplier: parseFloat(e.target.value) })}
                />
                <small>{t('businessHub.pricingRules.multiplierHint', { value: '1.5', percent: '50%' })}</small>
              </div>
            </div>
          </div>
        );
      case 'demand':
        return (
          <div className="prm-config-section">
            <h5>{t('businessHub.pricingRules.config.demand')}</h5>
            <div className="prm-form-row">
              <div className="prm-form-group">
                <label>{t('businessHub.pricingRules.availabilityThreshold')}</label>
                <input
                  type="number" min="0" max="100"
                  value={formData.demand.availability_threshold_percent}
                  onChange={e => setDimension('demand', { availability_threshold_percent: parseInt(e.target.value) })}
                />
                <small>{t('businessHub.pricingRules.surgeHint')}</small>
              </div>
              <div className="prm-form-group">
                <label>{t('businessHub.pricingRules.surgeMultiplier')}</label>
                <input
                  type="number" step="0.05" min="1"
                  value={formData.demand.surge_multiplier}
                  onChange={e => setDimension('demand', { surge_multiplier: parseFloat(e.target.value) })}
                />
              </div>
            </div>
          </div>
        );
      case 'volume':
        return (
          <div className="prm-config-section">
            <h5>{t('businessHub.pricingRules.config.volume')}</h5>
            <div className="prm-form-row">
              <div className="prm-form-group">
                <label>{t('businessHub.pricingRules.minQuantity')}</label>
                <input
                  type="number" min="1"
                  value={formData.volume.min_quantity}
                  onChange={e => setDimension('volume', { min_quantity: parseInt(e.target.value) })}
                />
              </div>
              <div className="prm-form-group">
                <label>{t('businessHub.pricingRules.maxQuantity')}</label>
                <input
                  type="number" min="1"
                  value={formData.volume.max_quantity ?? ''}
                  onChange={e => setDimension('volume', { max_quantity: e.target.value ? parseInt(e.target.value) : null })}
                />
              </div>
            </div>
            <div className="prm-form-row">
              <div className="prm-form-group">
                <label>{t('businessHub.pricingRules.period')}</label>
                <select
                  value={formData.volume.period}
                  onChange={e => setDimension('volume', { period: e.target.value })}
                >
                  <option value="order">{t('businessHub.pricingRules.periods.order')}</option>
                  <option value="day">{t('businessHub.pricingRules.periods.day')}</option>
                  <option value="week">{t('businessHub.pricingRules.periods.week')}</option>
                  <option value="month">{t('businessHub.pricingRules.periods.month')}</option>
                </select>
              </div>
              <div className="prm-form-group">
                <label>Price Multiplier</label>
                <input
                  type="number" step="0.05" min="0.1"
                  value={formData.volume.price_multiplier}
                  onChange={e => setDimension('volume', { price_multiplier: parseFloat(e.target.value) })}
                />
                <small>{t('businessHub.pricingRules.multiplierHint', { value: '0.9', percent: '10%' })}</small>
              </div>
            </div>
          </div>
        );
      case 'segment':
        return (
          <div className="prm-config-section">
            <h5>{t('businessHub.pricingRules.config.segment')}</h5>
            <div className="prm-form-row">
              <div className="prm-form-group">
                <label>{t('businessHub.pricingRules.segmentType')}</label>
                <select
                  value={formData.segment.segment_type}
                  onChange={e => setDimension('segment', { segment_type: e.target.value })}
                >
                  <option value="new">{t('businessHub.pricingRules.segments.new')}</option>
                  <option value="returning">{t('businessHub.pricingRules.segments.returning')}</option>
                  <option value="vip">{t('businessHub.pricingRules.segments.vip')}</option>
                  <option value="loyalty_tier_bronze">{t('businessHub.pricingRules.segments.bronze')}</option>
                  <option value="loyalty_tier_silver">{t('businessHub.pricingRules.segments.silver')}</option>
                  <option value="loyalty_tier_gold">{t('businessHub.pricingRules.segments.gold')}</option>
                  <option value="loyalty_tier_platinum">{t('businessHub.pricingRules.segments.platinum')}</option>
                </select>
              </div>
              <div className="prm-form-group">
                <label>Price Multiplier</label>
                <input
                  type="number" step="0.05" min="0.1"
                  value={formData.segment.price_multiplier}
                  onChange={e => setDimension('segment', { price_multiplier: parseFloat(e.target.value) })}
                />
                <small>{t('businessHub.pricingRules.multiplierHint', { value: '0.95', percent: '5%' })}</small>
              </div>
            </div>
          </div>
        );
      case 'seasonal':
        return (
          <div className="prm-config-section">
            <h5>{t('businessHub.pricingRules.config.seasonal')}</h5>
            <div className="prm-form-row">
              <div className="prm-form-group">
                <label>{t('businessHub.pricingRules.startDate')}</label>
                <input
                  type="date"
                  value={formData.seasonal.start_date}
                  onChange={e => setDimension('seasonal', { start_date: e.target.value })}
                />
              </div>
              <div className="prm-form-group">
                <label>{t('businessHub.pricingRules.endDate')}</label>
                <input
                  type="date"
                  value={formData.seasonal.end_date}
                  onChange={e => setDimension('seasonal', { end_date: e.target.value })}
                />
              </div>
            </div>
            <div className="prm-form-row">
              <div className="prm-form-group">
                <label>{t('businessHub.pricingRules.priceMultiplier')}</label>
                <input
                  type="number" step="0.05" min="0.1"
                  value={formData.seasonal.price_multiplier}
                  onChange={e => setDimension('seasonal', { price_multiplier: parseFloat(e.target.value) })}
                />
                <small>{t('businessHub.pricingRules.multiplierHint', { value: '1.2', percent: '20%' })}</small>
              </div>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  if (loadingSvc) {
    return <div className="prm-loading">{t('businessHub.pricingRules.loadingServices')}</div>;
  }

  if (services.length === 0) {
    return (
      <div className="prm-empty">
        <p>{t('businessHub.pricingRules.noServices')}</p>
      </div>
    );
  }

  return (
    <div className="prm-container">
      <div className="prm-header">
        <h3>{t('businessHub.pricingRules.title')}</h3>
        {!showForm && (
          <button
            onClick={() => { setFormData(DEFAULT_FORM); setShowForm(true); }}
            className="prm-btn-new"
          >
            <Plus size={18} /> {t('businessHub.pricingRules.newRule')}
          </button>
        )}
      </div>

      {/* Service selector */}
      <div className="prm-form-group" style={{ marginBottom: '1rem' }}>
        <label>{t('businessHub.pricingRules.service')}</label>
        <select
          value={selectedServiceId || ''}
          onChange={e => { setSelectedServiceId(e.target.value); setShowForm(false); }}
        >
          {services.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {showForm ? (
        <div className="prm-form-container">
          <h4>{t('businessHub.pricingRules.createRule')}</h4>

          <div className="prm-form-row">
            <div className="prm-form-group">
              <label>{t('businessHub.pricingRules.ruleTypeRequired')}</label>
              <select
                value={formData.rule_type}
                onChange={e => setFormData({ ...formData, rule_type: e.target.value })}
              >
                {RULE_TYPES.map(ruleType => (
                  <option key={ruleType.id} value={ruleType.id}>{t(`businessHub.pricingRules.types.${ruleType.nameKey}`)}</option>
                ))}
              </select>
            </div>
            <div className="prm-form-group">
              <label>{t('businessHub.pricingRules.priority')}</label>
              <input
                type="number" min="0" max="100"
                value={formData.priority}
                onChange={e => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })}
              />
              <small>{t('businessHub.pricingRules.priorityHint')}</small>
            </div>
          </div>

          {renderTypeSpecificConfig()}

          <div className="prm-form-buttons">
            <button onClick={() => setShowForm(false)} className="prm-btn-cancel">
              {t('common.cancel')}
            </button>
            <button onClick={handleSaveRule} className="prm-btn-save">
              {t('businessHub.pricingRules.saveRule')}
            </button>
          </div>
        </div>
      ) : (
        <div className="prm-rules-grid">
          {error && (
            <div className="prm-error" style={{ padding: '1rem', backgroundColor: '#fee2e2', borderRadius: '0.5rem', color: '#991b1b', marginBottom: '1rem' }}>
              <p><strong>{t('businessHub.pricingRules.errorLabel')}:</strong> {error}</p>
              <button onClick={loadRules} className="prm-btn-new" style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>
                {t('common.tryAgain')}
              </button>
            </div>
          )}
          {loadingRules ? (
            <div className="prm-loading">{t('businessHub.pricingRules.loadingRules')}</div>
          ) : rules.length === 0 ? (
            <div className="prm-empty">
              <p>{t('businessHub.pricingRules.noRules')}</p>
              <button onClick={() => setShowForm(true)} className="prm-btn-new-large">
                {t('businessHub.pricingRules.createFirstRule')}
              </button>
            </div>
          ) : (
            rules
              .slice()
              .sort((a, b) => (b.priority || 0) - (a.priority || 0))
              .map(rule => {
                const typeInfo = getRuleTypeInfo(rule.rule_type);
                const Icon = typeInfo.icon;
                return (
                  <div
                    key={rule.id}
                    className={`prm-rule-card ${!rule.is_active ? 'inactive' : ''}`}
                  >
                    <div className="prm-rule-header">
                      <div className="prm-rule-icon">
                        <Icon size={16} />
                      </div>
                      <h4>{t(`businessHub.pricingRules.types.${typeInfo.nameKey}`, typeInfo.nameKey || rule.rule_type)}</h4>
                      <div className="prm-rule-actions">
                        <button
                          onClick={() => handleToggleRule(rule.id, rule.is_active)}
                          className="prm-btn-action"
                          aria-label={rule.is_active ? t('businessHub.pricingRules.disableRule') : t('businessHub.pricingRules.enableRule')}
                          title={rule.is_active ? t('businessHub.pricingRules.disable') : t('businessHub.pricingRules.enable')}
                        >
                          {rule.is_active
                            ? <ToggleRight size={18} style={{ color: '#f97316' }} />
                            : <ToggleLeft  size={18} />}
                        </button>
                        <button
                          onClick={() => handleDeleteRule(rule.id)}
                          className="prm-btn-action delete"
                          aria-label={t('businessHub.pricingRules.deleteRule')}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>

                    <p className="prm-rule-description" style={{ margin: '0.25rem 0', fontSize: '0.8rem', color: 'var(--muted-text)' }}>
                      {t(`businessHub.pricingRules.types.${typeInfo.descriptionKey}`, typeInfo.descriptionKey || '')}
                    </p>

                    {rule.priority > 0 && (
                      <div className="prm-rule-detail">
                        <strong>{t('businessHub.pricingRules.priority')}:</strong> {rule.priority}
                      </div>
                    )}

                    <div className="prm-rule-meta">
                      <span className={`prm-status ${rule.is_active ? 'active' : 'inactive'}`}>
                        {rule.is_active ? t('businessHub.pricingRules.active') : t('businessHub.pricingRules.inactive')}
                      </span>
                    </div>
                  </div>
                );
              })
          )}
        </div>
      )}
    </div>
  );
}
