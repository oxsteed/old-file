import { useState, useEffect } from 'react';
import api from '../../api/axios';

interface Category { id: number; name: string; slug: string; icon: string; }
interface Props { token: string; onSuccess: () => void; }

export default function Step2Profile({ token, onSuccess }: Props) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [form, setForm] = useState({ profileHeadline: '', bio: '', serviceRadius: 10, ratePreference: 'per_job', hourlyRate: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/helper-registration/categories').then(r => setCategories(r.data.categories)).catch(() => {});
  }, []);

  const toggleCat = (slug: string) => {
    setSelected(prev =>
      prev.includes(slug) ? prev.filter(s => s !== slug) : prev.length < 8 ? [...prev, slug] : prev
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.profileHeadline.trim()) { setError('Profile headline required'); return; }
    if (selected.length < 1) { setError('Select at least 1 category'); return; }
    setLoading(true); setError('');
    try {
      await api.post('/helper-registration/profile', {
        profileHeadline: form.profileHeadline, bio: form.bio,
        serviceCategories: selected, serviceRadius: form.serviceRadius,
        ratePreference: form.ratePreference,
        hourlyRate: form.hourlyRate ? parseFloat(form.hourlyRate) : null
      });
      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save profile');
    } finally { setLoading(false); }
  };

  const inputClass = 'w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-orange-500 focus:border-transparent';

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-white">Your Helper Profile</h1>
      <p className="text-gray-400 text-sm">Step 2 of 7 - Tell customers about yourself</p>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div>
        <label className="block text-sm text-gray-300 mb-1">Profile Headline *</label>
        <input placeholder="e.g. Experienced Handyman & Mover" value={form.profileHeadline}
          maxLength={80} onChange={e => setForm(p => ({ ...p, profileHeadline: e.target.value }))}
          className={inputClass} />
        <p className="text-xs text-gray-500 mt-1">{form.profileHeadline.length}/80</p>
      </div>

      <div>
        <label className="block text-sm text-gray-300 mb-1">Bio (optional)</label>
        <textarea placeholder="Tell customers about your experience..." value={form.bio}
          onChange={e => setForm(p => ({ ...p, bio: e.target.value }))} rows={3}
          className={inputClass + ' resize-none'} />
      </div>

      <div>
        <label className="block text-sm text-gray-300 mb-2">Service Categories * (select 1-8)</label>
        <div className="grid grid-cols-2 gap-2">
          {categories.map(cat => (
            <button key={cat.slug} type="button" onClick={() => toggleCat(cat.slug)}
              className={`p-3 rounded-lg border text-left text-sm transition ${
                selected.includes(cat.slug)
                  ? 'border-orange-500 bg-orange-500/10 text-white'
                  : 'border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-600'
              }`}>
              {cat.name}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-1">{selected.length}/8 selected</p>
      </div>

      <div>
        <label className="block text-sm text-gray-300 mb-1">Service Radius (miles)</label>
        <input type="number" min={1} max={50} value={form.serviceRadius}
          onChange={e => setForm(p => ({ ...p, serviceRadius: parseInt(e.target.value) || 10 }))}
          className={inputClass} />
      </div>

      <div>
        <label className="block text-sm text-gray-300 mb-1">Rate Preference</label>
        <select value={form.ratePreference}
          onChange={e => setForm(p => ({ ...p, ratePreference: e.target.value }))}
          className={inputClass}>
          <option value="per_job">Per Job</option>
          <option value="hourly">Hourly</option>
        </select>
      </div>

      {form.ratePreference === 'hourly' && (
        <div>
          <label className="block text-sm text-gray-300 mb-1">Hourly Rate ($)</label>
          <input type="number" min={1} placeholder="e.g. 25" value={form.hourlyRate}
            onChange={e => setForm(p => ({ ...p, hourlyRate: e.target.value }))}
            className={inputClass} />
        </div>
      )}

      <button type="submit" disabled={loading}
        className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-lg disabled:opacity-50 transition">
        {loading ? 'Saving...' : 'Continue to Plan Selection'}
      </button>
    </form>
  );
}
