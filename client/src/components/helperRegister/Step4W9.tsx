import { useState } from 'react';
import api from '../../api/axios';

interface Props { token: string; onSuccess: () => void; }

const taxTypes = [
  'Individual/sole proprietor', 'C Corporation', 'S Corporation',
  'Partnership', 'Trust/estate', 'LLC - C', 'LLC - S', 'LLC - P'
];

export default function Step4W9({ token, onSuccess }: Props) {
  const [form, setForm] = useState({
    legalName: '', businessName: '', taxClassification: '', tin: '',
    address: '', certify: false
  });
  const [signatureData, setSignatureData] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const set = (f: string, v: any) => setForm(p => ({ ...p, [f]: v }));
  const inputClass = 'w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-orange-500 focus:border-transparent';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.legalName || !form.taxClassification || !form.tin || !form.address) {
      setError('All fields required'); return;
    }
    if (!form.certify) { setError('Must certify information is correct'); return; }
    if (!signatureData) { setError('Signature required'); return; }
    setLoading(true); setError('');
    try {
      await api.post('/auth/helper/register/w9', {
        token, legalName: form.legalName, businessName: form.businessName,
        taxClassification: form.taxClassification, tin: form.tin,
        address: form.address, signatureData, certify: form.certify
      });
      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to submit W-9');
    } finally { setLoading(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-white">W-9 Tax Information</h1>
      <p className="text-gray-400 text-sm">Step 4 of 7 - Required for paid tiers</p>
      <p className="text-yellow-400 text-xs">Your TIN is encrypted and stored securely.</p>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <input placeholder="Legal Name *" value={form.legalName}
        onChange={e => set('legalName', e.target.value)} className={inputClass} />

      <input placeholder="Business Name (if different)" value={form.businessName}
        onChange={e => set('businessName', e.target.value)} className={inputClass} />

      <select value={form.taxClassification}
        onChange={e => set('taxClassification', e.target.value)} className={inputClass}>
        <option value="">Select Tax Classification *</option>
        {taxTypes.map(t => <option key={t} value={t}>{t}</option>)}
      </select>

      <input placeholder="SSN or EIN *" value={form.tin}
        onChange={e => set('tin', e.target.value.replace(/[^0-9-]/g, '').slice(0, 11))}
        className={inputClass} />

      <input placeholder="Address (street, city, state, zip) *" value={form.address}
        onChange={e => set('address', e.target.value)} className={inputClass} />

      <div>
        <label className="block text-sm text-gray-300 mb-1">Electronic Signature *</label>
        <input placeholder="Type your full legal name as signature" value={signatureData}
          onChange={e => setSignatureData(e.target.value)} className={inputClass} />
      </div>

      <label className="flex items-center gap-2 text-gray-300 text-sm cursor-pointer">
        <input type="checkbox" checked={form.certify}
          onChange={e => set('certify', e.target.checked)} className="rounded border-gray-600" />
        Under penalties of perjury, I certify the information provided is correct.
      </label>

      <button type="submit" disabled={loading}
        className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-lg disabled:opacity-50 transition">
        {loading ? 'Submitting...' : 'Continue to Payment'}
      </button>
    </form>
  );
}
