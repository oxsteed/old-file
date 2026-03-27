import { useState } from 'react';
import api from '../../api/axios';

interface Props {
  token: string;
  onSuccess: (data: { taxType: string; taxId: string; legalName: string; mailingAddress: { street: string; city: string; state: string; zip: string } }) => void;
  onBack: () => void;
}

export default function Step6TaxInfo({ token, onSuccess, onBack }: Props) {
  const [taxType, setTaxType] = useState<'ssn' | 'ein'>('ssn');
  const [form, setForm] = useState({
    legalName: '', taxId: '', street: '', city: '', state: '', zip: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [showTaxId, setShowTaxId] = useState(false);

  const set = (field: string, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setErrors(prev => ({ ...prev, [field]: '' }));
  };

  const formatTaxId = (val: string) => {
    const digits = val.replace(/\D/g, '');
    if (taxType === 'ssn') {
      if (digits.length <= 3) return digits;
      if (digits.length <= 5) return `${digits.slice(0,3)}-${digits.slice(3)}`;
      return `${digits.slice(0,3)}-${digits.slice(3,5)}-${digits.slice(5,9)}`;
    } else {
      if (digits.length <= 2) return digits;
      return `${digits.slice(0,2)}-${digits.slice(2,9)}`;
    }
  };

  const maskedTaxId = () => {
    if (showTaxId) return form.taxId;
    const digits = form.taxId.replace(/\D/g, '');
    if (digits.length < 4) return form.taxId;
    return '•••-••-' + digits.slice(-4);
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.legalName.trim()) e.legalName = 'Legal name is required';
    const digits = form.taxId.replace(/\D/g, '');
    if (taxType === 'ssn' && digits.length !== 9) e.taxId = 'SSN must be 9 digits';
    if (taxType === 'ein' && digits.length !== 9) e.taxId = 'EIN must be 9 digits';
    if (!form.street.trim()) e.street = 'Street address is required';
    if (!form.city.trim()) e.city = 'City is required';
    if (!form.state.trim() || form.state.length !== 2) e.state = 'Enter 2-letter state code';
    if (form.zip.replace(/\D/g, '').length !== 5) e.zip = 'Enter a valid zip code';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      await api.post('/api/helper-registration/w9', {
        token,
        legalName: form.legalName.trim(),
        businessName: null,
        taxClassification: taxType === 'ssn' ? 'Individual/sole proprietor' : 'LLC - S',
        tin: form.taxId.replace(/\D/g, ''),
        address: `${form.street}, ${form.city}, ${form.state} ${form.zip}`,
        signatureData: form.legalName.trim(),
        certify: true,
      });
      onSuccess({
        taxType, taxId: form.taxId,
        legalName: form.legalName,
        mailingAddress: { street: form.street, city: form.city, state: form.state, zip: form.zip },
      });
    } catch (err: any) {
      setErrors({ general: err.response?.data?.error || 'Failed to save tax info' });
    } finally {
      setLoading(false);
    }
  };

  const inputClass = 'w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-orange-500 focus:border-transparent transition';

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {errors.general && (
        <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm" role="alert">{errors.general}</div>
      )}

      {/* Why we collect this */}
      <div className="p-4 bg-blue-900/20 border border-blue-800/30 rounded-lg">
        <p className="text-blue-300 text-sm">
          <strong>Why do we need this?</strong> The IRS requires us to issue a 1099-NEC to anyone who earns $600+ in a calendar year. Your SSN/EIN is encrypted with AES-256 and never visible to other users.{' '}
          <a href="/security" target="_blank" className="text-blue-400 underline hover:text-blue-300">Security Policy</a>
        </p>
      </div>

      {/* SSN / EIN toggle */}
      <div>
        <label className="block text-sm text-gray-300 mb-2">Tax ID Type</label>
        <div className="flex gap-2">
          <button type="button" onClick={() => { setTaxType('ssn'); set('taxId', ''); }}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
              taxType === 'ssn' ? 'bg-orange-500 text-white' : 'bg-gray-800 text-gray-400 border border-gray-700'
            }`}>
            SSN (Individual)
          </button>
          <button type="button" onClick={() => { setTaxType('ein'); set('taxId', ''); }}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
              taxType === 'ein' ? 'bg-orange-500 text-white' : 'bg-gray-800 text-gray-400 border border-gray-700'
            }`}>
            EIN (Business)
          </button>
        </div>
      </div>

      {/* Legal name */}
      <div>
        <label htmlFor="legalName" className="block text-sm text-gray-300 mb-1">Legal Name (as shown on tax return)</label>
        <input id="legalName" type="text" autoComplete="name" placeholder="Jane A. Doe"
          value={form.legalName} onChange={e => set('legalName', e.target.value)}
          className={inputClass} aria-required="true" />
        {errors.legalName && <p className="text-red-400 text-xs mt-1" role="alert">{errors.legalName}</p>}
      </div>

      {/* Tax ID */}
      <div>
        <label htmlFor="taxId" className="block text-sm text-gray-300 mb-1">
          {taxType === 'ssn' ? 'Social Security Number' : 'Employer Identification Number'}
        </label>
        <div className="relative">
          <input id="taxId" type="text" inputMode="numeric"
            placeholder={taxType === 'ssn' ? '___-__-____' : '__-_______'}
            value={showTaxId ? form.taxId : maskedTaxId()}
            onFocus={() => setShowTaxId(true)}
            onBlur={() => setShowTaxId(false)}
            onChange={e => {
              const formatted = formatTaxId(e.target.value);
              set('taxId', formatted);
            }}
            maxLength={taxType === 'ssn' ? 11 : 10}
            className={inputClass + ' pr-12'} aria-required="true" />
          <button type="button" onClick={() => setShowTaxId(!showTaxId)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white text-sm">
            {showTaxId ? 'Hide' : 'Show'}
          </button>
        </div>
        {errors.taxId && <p className="text-red-400 text-xs mt-1" role="alert">{errors.taxId}</p>}
      </div>

      {/* Mailing address */}
      <div>
        <label className="block text-sm text-gray-300 mb-1">Mailing Address</label>
        <input type="text" placeholder="Street address" value={form.street}
          onChange={e => set('street', e.target.value)}
          className={inputClass + ' mb-2'} aria-required="true" />
        {errors.street && <p className="text-red-400 text-xs mb-2" role="alert">{errors.street}</p>}
        <div className="grid grid-cols-3 gap-2">
          <input type="text" placeholder="City" value={form.city}
            onChange={e => set('city', e.target.value)} className={inputClass} />
          <input type="text" placeholder="ST" maxLength={2} value={form.state}
            onChange={e => set('state', e.target.value.toUpperCase().slice(0, 2))} className={inputClass} />
          <input type="text" inputMode="numeric" placeholder="Zip" maxLength={5} value={form.zip}
            onChange={e => set('zip', e.target.value.replace(/\D/g, '').slice(0, 5))} className={inputClass} />
        </div>
        {(errors.city || errors.state || errors.zip) && (
          <p className="text-red-400 text-xs mt-1" role="alert">{errors.city || errors.state || errors.zip}</p>
        )}
      </div>

      <div className="flex gap-3">
        <button type="button" onClick={onBack}
          className="px-6 py-3 bg-transparent border border-gray-600 text-gray-300 hover:border-gray-500 rounded-lg transition">
          ← Back
        </button>
        <button type="submit" disabled={loading}
          className="flex-1 py-3 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-lg disabled:opacity-50 transition">
          {loading ? 'Saving...' : 'Continue →'}
        </button>
      </div>
    </form>
  );
}
