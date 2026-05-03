import { useEffect, useState, useCallback } from 'react';
import { DollarSign, Edit2, Save, X, Loader2, TrendingDown } from 'lucide-react';
import adminApi from '../../../lib/adminApi';
import toast from 'react-hot-toast';

export default function PricingOverrides() {
  const [overrides, setOverrides] = useState([]);
  const [comparison, setComparison] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [editPrice, setEditPrice] = useState('');
  const [editCurrency, setEditCurrency] = useState('');
  const [editReason, setEditReason] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [overridesRes, comparisonRes] = await Promise.all([
        adminApi.get('/admin/pricing-overrides'),
        adminApi.get('/admin/pricing-overrides/comparison')
      ]);
      setOverrides(overridesRes.data.overrides || []);
      setComparison(comparisonRes.data || null);
    } catch (err) {
      toast.error('Failed to load pricing data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleEdit = (override) => {
    setEditing(override.country_code);
    setEditPrice((override.price_cents / 100).toFixed(2));
    setEditCurrency(override.currency_code);
    setEditReason('');
  };

  const handleCancel = () => {
    setEditing(null);
    setEditPrice('');
    setEditCurrency('');
    setEditReason('');
  };

  const handleSave = async () => {
    if (!editPrice || parseFloat(editPrice) < 0) {
      toast.error('Invalid price');
      return;
    }

    setSaving(true);
    try {
      await adminApi.put(`/admin/pricing-overrides/${editing}`, {
        price_cents: Math.round(parseFloat(editPrice) * 100),
        currency_code: editCurrency,
        reason: editReason || null
      });
      toast.success(`Updated pricing for ${editing}`);
      fetchData();
      handleCancel();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update pricing');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <DollarSign className="w-6 h-6 text-orange-500" />
          <h1 className="text-2xl font-bold text-gray-900">
            Location-Based Pricing
          </h1>
        </div>
        <div className="text-sm text-gray-500">
          {overrides.length} countries configured
        </div>
      </div>

      {/* Pricing Comparison Stats */}
      {comparison && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Object.entries(comparison.by_currency || {}).map(([currency, stats]) => (
            <div
              key={currency}
              className="bg-white rounded-xl border border-gray-200 p-4"
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900">{currency}</h3>
                <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded-full">
                  {stats.count} countries
                </span>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Min Price:</span>
                  <span className="font-mono text-gray-900">
                    {currency} {(stats.min_price / 100).toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Max Price:</span>
                  <span className="font-mono text-gray-900">
                    {currency} {(stats.max_price / 100).toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between pt-2 border-t">
                  <span className="text-gray-600">Average:</span>
                  <span className="font-mono font-semibold text-orange-600">
                    {currency} {(stats.avg_price / 100).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pricing Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                  Country
                </th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                  Price
                </th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                  Currency
                </th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                  Status
                </th>
                <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {overrides.map((override) => (
                <tr key={override.id} className="border-b hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">
                    {override.country_code}
                  </td>
                  {editing === override.country_code ? (
                    <>
                      <td className="px-6 py-4">
                        <input
                          type="number"
                          value={editPrice}
                          onChange={(e) => setEditPrice(e.target.value)}
                          step="0.01"
                          className="w-24 px-2 py-1 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                        />
                      </td>
                      <td className="px-6 py-4">
                        <input
                          type="text"
                          value={editCurrency}
                          onChange={(e) => setEditCurrency(e.target.value.toUpperCase())}
                          maxLength="3"
                          className="w-16 px-2 py-1 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                        />
                      </td>
                      <td className="px-6 py-4">
                        <textarea
                          value={editReason}
                          onChange={(e) => setEditReason(e.target.value)}
                          placeholder="Why this change?"
                          className="w-40 px-2 py-1 border border-gray-300 rounded-lg text-sm resize-none h-8 focus:outline-none focus:ring-2 focus:ring-orange-300"
                        />
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={handleSave}
                            disabled={saving}
                            className="flex items-center gap-1 px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg disabled:opacity-50"
                          >
                            <Save className="w-4 h-4" />
                            Save
                          </button>
                          <button
                            onClick={handleCancel}
                            className="flex items-center gap-1 px-3 py-1 bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm rounded-lg"
                          >
                            <X className="w-4 h-4" />
                            Cancel
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-6 py-4 text-sm font-mono text-gray-900">
                        {(override.price_cents / 100).toFixed(2)}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {override.currency_code}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${
                            override.is_active
                              ? 'bg-green-100 text-green-800'
                              : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {override.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => handleEdit(override)}
                          className="flex items-center gap-2 px-3 py-1 bg-orange-100 hover:bg-orange-200 text-orange-700 text-sm rounded-lg transition"
                        >
                          <Edit2 className="w-4 h-4" />
                          Edit
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Info Box */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <div className="flex gap-3">
          <TrendingDown className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-900">
            <p className="font-semibold mb-1">Location-Based Pricing</p>
            <p>
              Premium subscription prices are adjusted based on the user's country to account
              for purchasing power parity (PPP). Users from lower-cost regions pay proportionally
              less, improving conversion rates while maintaining revenue.
            </p>
            <p className="mt-2 text-xs text-blue-800">
              Default fallback: US pricing ($29 USD) is used for countries without overrides.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
