import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { ShieldCheck, Loader2 } from 'lucide-react';
import api from '../api/axios';
import SignaturePad from './SignaturePad';

/**
 * Review P2-2-F08: in-app W-9 submission. POST /helper-registration/w9
 * (saveW9) was mounted with zero client callers while the requireTaxIdentity
 * payout gate depends on w9_completed, so helpers were dead-ended at payout
 * time with no way to comply. This form closes the loop: it is reachable
 * from Settings (tax tab) and from the payout 403 surface.
 *
 * The TIN is sent once over TLS and stored server-side encrypted
 * (tin_encrypted); only the last four digits are ever readable back.
 */
const CLASSIFICATIONS = [
  'individual',
  'c_corp',
  's_corp',
  'partnership',
  'trust_estate',
  'llc',
];

export default function W9Form() {
  const { t } = useTranslation();
  const [status, setStatus] = useState('loading'); // loading | filed | form
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    legalName: '',
    businessName: '',
    taxClassification: 'individual',
    tin: '',
    street: '',
    city: '',
    state: '',
    zip: '',
  });
  const [signatureData, setSignatureData] = useState('');
  const [certify, setCertify] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get('/helper-registration/onboarding/status')
      .then(({ data }) => {
        if (!cancelled) setStatus(data?.w9_completed ? 'filed' : 'form');
      })
      .catch(() => { if (!cancelled) setStatus('form'); });
    return () => { cancelled = true; };
  }, []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    const digits = form.tin.replace(/\D/g, '');
    if (digits.length < 9) {
      toast.error(t('w9.tinInvalid'));
      return;
    }
    if (!signatureData) {
      toast.error(t('w9.signatureRequired'));
      return;
    }
    if (!certify) {
      toast.error(t('w9.certifyRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const address = [form.street, form.city, form.state, form.zip].filter(Boolean).join(', ');
      await api.post('/helper-registration/w9', {
        legalName: form.legalName.trim(),
        businessName: form.businessName.trim() || null,
        taxClassification: form.taxClassification,
        tin: digits,
        address,
        signatureData,
        certify: true,
      });
      toast.success(t('w9.success'));
      setStatus('filed');
    } catch (err) {
      toast.error(err.response?.data?.error || t('w9.error'));
    } finally {
      setSubmitting(false);
    }
  }

  if (status === 'loading') {
    return <p className="text-gray-400 text-sm">{t('common.loading')}</p>;
  }

  if (status === 'filed') {
    return (
      <div className="rounded-2xl border border-emerald-800 bg-emerald-950/40 p-5 flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-emerald-200 font-semibold text-sm">{t('w9.filedTitle')}</p>
          <p className="text-emerald-200/70 text-sm mt-1">{t('w9.filedCopy')}</p>
        </div>
      </div>
    );
  }

  const inputCls = 'w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm placeholder-gray-500 focus:border-orange-500 focus:outline-none';

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-xl">
      <p className="text-sm text-gray-400">{t('w9.intro')}</p>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">{t('w9.legalName')} *</label>
        <input className={inputCls} value={form.legalName} onChange={set('legalName')} required maxLength={255}
          placeholder={t('w9.legalNamePlaceholder')} />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">{t('w9.businessName')}</label>
        <input className={inputCls} value={form.businessName} onChange={set('businessName')} maxLength={255}
          placeholder={t('w9.businessNamePlaceholder')} />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">{t('w9.taxClassification')} *</label>
        <select className={inputCls} value={form.taxClassification} onChange={set('taxClassification')} required>
          {CLASSIFICATIONS.map((c) => (
            <option key={c} value={c}>{t(`w9.classification.${c}`)}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">{t('w9.tin')} *</label>
        <input className={inputCls} type="password" inputMode="numeric" value={form.tin} onChange={set('tin')}
          required minLength={9} maxLength={11} autoComplete="off" placeholder={t('w9.tinPlaceholder')} />
        <p className="text-xs text-gray-500 mt-1">{t('w9.tinHelp')}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-sm font-medium text-gray-300 mb-1">{t('w9.street')} *</label>
          <input className={inputCls} value={form.street} onChange={set('street')} required maxLength={255} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">{t('w9.city')} *</label>
          <input className={inputCls} value={form.city} onChange={set('city')} required maxLength={120} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">{t('w9.state')} *</label>
            <input className={inputCls} value={form.state} onChange={set('state')} required maxLength={60} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">{t('w9.zip')} *</label>
            <input className={inputCls} value={form.zip} onChange={set('zip')} required maxLength={20} />
          </div>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">{t('w9.signature')} *</label>
        <div className="rounded-lg overflow-hidden border border-gray-700 bg-white">
          <SignaturePad onChange={setSignatureData} disabled={submitting} />
        </div>
      </div>

      <label className="flex items-start gap-2 text-sm text-gray-300 cursor-pointer">
        <input type="checkbox" checked={certify} onChange={(e) => setCertify(e.target.checked)}
          className="mt-1 w-4 h-4 accent-orange-500" />
        <span>{t('w9.certify')}</span>
      </label>

      <button type="submit" disabled={submitting}
        className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50">
        {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
        {submitting ? t('w9.submitting') : t('w9.submit')}
      </button>
    </form>
  );
}
