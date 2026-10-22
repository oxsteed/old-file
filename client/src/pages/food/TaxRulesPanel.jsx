import { useCallback, useEffect, useState } from 'react';
import {
  listTaxRules,
  createTaxRule,
  updateTaxRule,
  deleteTaxRule,
} from '../../api/food';
import toast from '../../utils/toast';

// F-19: per-store tax rules manager. Rendered inside the locations panel
// while a store is being edited. Shows the rules that apply to the store
// (brand-wide + store-scoped) and lets a manager add, activate/deactivate
// or delete them. Every change is audit-logged server-side.
export default function TaxRulesPanel({ restaurant, locationId, t }) {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [ratePercent, setRatePercent] = useState('');
  const [appliesTo, setAppliesTo] = useState('items');
  const [category, setCategory] = useState('');
  const [scope, setScope] = useState('store');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    listTaxRules(restaurant.id, { locationId })
      .then(setRules)
      .catch(() => setRules([]))
      .finally(() => setLoading(false));
  }, [restaurant.id, locationId]);

  useEffect(() => { load(); }, [load]);

  const appliesLabel = (value) => ({
    items: t('food.merchant.taxRuleAppliesItems'),
    delivery_fee: t('food.merchant.taxRuleAppliesDeliveryFee'),
    service_fee: t('food.merchant.taxRuleAppliesServiceFee'),
  }[value] || value);

  const submit = async (e) => {
    e.preventDefault();
    const rate = Number(ratePercent);
    if (!name.trim() || !Number.isFinite(rate) || rate < 0 || rate > 100) return;
    setSaving(true);
    try {
      await createTaxRule(restaurant.id, {
        name: name.trim(),
        rateBps: Math.round(rate * 100),
        appliesTo,
        taxCategory: category.trim() || null,
        locationId: scope === 'store' ? locationId : null,
      });
      setName('');
      setRatePercent('');
      setCategory('');
      load();
    } catch {
      toast.error(t('food.merchant.locationError'));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (rule) => {
    try {
      await updateTaxRule(restaurant.id, rule.id, { isActive: !rule.is_active });
      load();
    } catch {
      toast.error(t('food.merchant.locationError'));
    }
  };

  const remove = async (rule) => {
    try {
      await deleteTaxRule(restaurant.id, rule.id);
      load();
    } catch {
      toast.error(t('food.merchant.locationError'));
    }
  };

  return (
    <div className="fd-card" style={{ marginTop: '0.75rem' }}>
      <h4>{t('food.merchant.taxRulesTitle')}</h4>
      <p className="fd-card-meta">{t('food.merchant.taxRulesHint')}</p>
      {loading ? null : (
        <ul className="fd-setup-steps">
          {rules.map((rule) => (
            <li key={rule.id} className="fd-setup-step fd-complete">
              <span>
                {rule.name} · {(Number(rule.rate_bps) / 100).toFixed(2)}% · {appliesLabel(rule.applies_to)}
                {rule.tax_category ? ` · ${rule.tax_category}` : ''}
                {' · '}{rule.location_id ? t('food.merchant.taxRuleScopeStore') : t('food.merchant.taxRuleScopeBrand')}
                {' · '}{rule.is_active ? t('food.merchant.taxRuleActive') : t('food.merchant.taxRuleInactive')}
              </span>
              <span style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => toggle(rule)} data-track="ui.256f7a03cf.1">
                  {rule.is_active ? t('food.merchant.taxRuleInactive') : t('food.merchant.taxRuleActive')}
                </button>
                <button type="button" className="fd-btn fd-btn-secondary fd-btn-sm" onClick={() => remove(rule)} data-track="ui.256f7a03cf.2">
                  {t('food.merchant.taxRuleDelete')}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} style={{ marginTop: '0.5rem' }} data-track="ui.256f7a03cf.3">
        <div className="fd-row" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
          <div className="fd-field" style={{ flex: '1 1 160px' }}>
            <label htmlFor="fd-taxrule-name">{t('food.merchant.taxRuleName')}</label>
            <input id="fd-taxrule-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </div>
          <div className="fd-field" style={{ flex: '0 1 110px' }}>
            <label htmlFor="fd-taxrule-rate">{t('food.merchant.taxRuleRate')}</label>
            <input id="fd-taxrule-rate" type="number" min="0" max="100" step="0.01" value={ratePercent} onChange={(e) => setRatePercent(e.target.value)} />
          </div>
          <div className="fd-field" style={{ flex: '0 1 150px' }}>
            <label htmlFor="fd-taxrule-applies">{t('food.merchant.taxRuleAppliesTo')}</label>
            <select id="fd-taxrule-applies" value={appliesTo} onChange={(e) => setAppliesTo(e.target.value)}>
              <option value="items">{t('food.merchant.taxRuleAppliesItems')}</option>
              <option value="delivery_fee">{t('food.merchant.taxRuleAppliesDeliveryFee')}</option>
              <option value="service_fee">{t('food.merchant.taxRuleAppliesServiceFee')}</option>
            </select>
          </div>
          <div className="fd-field" style={{ flex: '0 1 140px' }}>
            <label htmlFor="fd-taxrule-category">{t('food.merchant.taxRuleCategory')}</label>
            <input id="fd-taxrule-category" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={40} placeholder="alcohol" />
          </div>
          <div className="fd-field" style={{ flex: '0 1 140px' }}>
            <label htmlFor="fd-taxrule-scope">{t('food.merchant.taxRuleScope')}</label>
            <select id="fd-taxrule-scope" value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="store">{t('food.merchant.taxRuleScopeStore')}</option>
              <option value="brand">{t('food.merchant.taxRuleScopeBrand')}</option>
            </select>
          </div>
          <div className="fd-field" style={{ flex: '0 1 120px', justifyContent: 'flex-end' }}>
            <button type="submit" className="fd-btn fd-btn-primary fd-btn-sm" disabled={saving} data-track="ui.256f7a03cf.4">
              {t('food.merchant.taxRuleAdd')}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
