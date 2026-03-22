import React, { useState, useEffect } from 'react';
import api from '../../api/axios';
import { useAuth } from '../../hooks/useAuth';

export default function PricingConfig() {
  const { user } = useAuth();
  const [form, setForm] = useState({
    tier1_price: '0',
    tier1_label: 'Free',
    tier2_price: '29.99',
    tier2_label: '/month',
    tier3_price: '5%',
    tier3_label: 'per transaction'
  });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/config/pricing')
      .then(res => { setForm(res.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaved(false);
    setError('');
    try {
      await api.put('/api/config/pricing', form);
      setSaved(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
    }
  };

  if (user?.admin_role !== 'super_admin') {
    return <div className="p-8 text-center text-red-500">Access denied. Super admin only.</div>;
  }

  if (loading) return <div className="p-8 text-center">Loading...</div>;

  const fields = [
    { key: 'tier1_price', label: 'Tier 1 Price' },
    { key: 'tier1_label', label: 'Tier 1 Label' },
    { key: 'tier2_price', label: 'Tier 2 Price' },
    { key: 'tier2_label', label: 'Tier 2 Label' },
    { key: 'tier3_price', label: 'Tier 3 Price' },
    { key: 'tier3_label', label: 'Tier 3 Label' },
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">Tier Pricing Configuration</h1>
        <p className="text-gray-400 text-sm mb-8">Update the pricing displayed on the homepage. Changes take effect immediately.</p>
        <div className="space-y-4">
          {fields.map(f => (
            <div key={f.key} className="flex items-center gap-4">
              <label className="w-32 text-sm text-gray-300">{f.label}</label>
              <input
                type="text"
                value={form[f.key] || ''}
                onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white"
              />
            </div>
          ))}
        </div>
        <div className="mt-8 flex items-center gap-4">
          <button
            onClick={handleSave}
            className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-2 rounded font-medium"
          >
            Save Changes
          </button>
          {saved && <span className="text-green-400 text-sm">Saved successfully!</span>}
          {error && <span className="text-red-400 text-sm">{error}</span>}
        </div>
      </div>
    </div>
  );
}
