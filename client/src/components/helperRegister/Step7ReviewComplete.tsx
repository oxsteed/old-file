import { useState } from 'react';
import api from '../../api/axios';

interface Props {
  token: string;
  formData: {
    firstName: string; lastName: string; email: string;
    phone: string; zip: string; city: string; state: string;
    bio: string; skills: string[]; photoUrl: string;
    taxType: string; taxId: string; legalName: string;
    mailingAddress: { street: string; city: string; state: string; zip: string };
  };
  selectedTier: string;
  onEdit: (step: number) => void;
  onSuccess: () => void;
}

export default function Step7ReviewComplete({ token: _token, formData, selectedTier, onEdit, onSuccess }: Props) {
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [contractorAcknowledged, setContractorAcknowledged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState(false);

  const maskedTaxId = formData.taxId
    ? '•••-••-' + formData.taxId.replace(/\D/g, '').slice(-4)
    : 'Not provided';

  const handleSubmit = async () => {
    if (!termsAccepted || !contractorAcknowledged) {
      setError('You must accept both checkboxes to continue.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      // Accept terms then finalize
      await api.post('/helper-registration/accept-terms');
      await api.post('/helper-registration/finalize');
      setCompleted(true);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to complete registration');
    } finally {
      setLoading(false);
    }
  };

  if (completed) {
    return (
      <div className="max-w-md mx-auto text-center">
        <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-10 h-10 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-3xl font-bold text-white mb-2">Welcome to OxSteed!</h2>
        <p className="text-gray-400 mb-8">
          Your helper account is ready. Here's what happens next:
        </p>
        <div className="text-left space-y-3 mb-8">
          <div className="flex gap-3 items-start">
            <span className="text-orange-500 font-bold">1.</span>
            <p className="text-gray-300 text-sm">Your profile is now visible to customers in your area.</p>
          </div>
          <div className="flex gap-3 items-start">
            <span className="text-orange-500 font-bold">2.</span>
            <p className="text-gray-300 text-sm">Browse available jobs and start bidding.</p>
          </div>
          <div className="flex gap-3 items-start">
            <span className="text-orange-500 font-bold">3.</span>
            <p className="text-gray-300 text-sm">Check your email for a welcome message with tips to get your first job.</p>
          </div>
        </div>
        <button onClick={onSuccess}
          className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-lg transition text-lg">
          Go to Dashboard
        </button>
      </div>
    );
  }

  const Section = ({ title, step, children }: { title: string; step: number; children: React.ReactNode }) => (
    <div className="p-4 bg-gray-900 border border-gray-700 rounded-lg">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-white font-semibold text-sm">{title}</h3>
        <button type="button" onClick={() => onEdit(step)}
          className="text-orange-400 text-xs hover:text-orange-300">[Edit]</button>
      </div>
      <div className="text-gray-400 text-sm space-y-1">{children}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm" role="alert">{error}</div>
      )}

      <Section title="Account" step={1}>
        <p>{formData.firstName} {formData.lastName}</p>
        <p>{formData.email}</p>
      </Section>

      <Section title="Profile & Location" step={4}>
        <p>Phone: {formData.phone ? `(${formData.phone.slice(0,3)}) ${formData.phone.slice(3,6)}-${formData.phone.slice(6)}` : '—'}</p>
        <p>Location: {formData.city && formData.state ? `${formData.city}, ${formData.state} ${formData.zip}` : formData.zip || '—'}</p>
        <p>Skills: {formData.skills.length > 0 ? formData.skills.join(', ') : '—'}</p>
        {formData.bio && <p>Bio: {formData.bio.slice(0, 80)}{formData.bio.length > 80 ? '...' : ''}</p>}
      </Section>

      <Section title="Plan" step={5}>
        <p className="text-orange-400 font-medium">
          {selectedTier === 'pro' ? 'Pro — $19.99/mo' : 'Free'}
        </p>
      </Section>

      {selectedTier !== 'free' && (
        <Section title="Tax Information" step={6}>
          <p>Legal Name: {formData.legalName || '—'}</p>
          <p>Tax ID: {maskedTaxId}</p>
          <p>Address: {formData.mailingAddress.street ? `${formData.mailingAddress.street}, ${formData.mailingAddress.city}, ${formData.mailingAddress.state} ${formData.mailingAddress.zip}` : '—'}</p>
        </Section>
      )}

      {/* Legal checkboxes */}
      <div className="space-y-3 pt-2">
        <label className="flex items-start gap-2 text-gray-300 text-sm cursor-pointer">
          <input type="checkbox" checked={termsAccepted}
            onChange={e => { setTermsAccepted(e.target.checked); setError(''); }}
            className="rounded border-gray-600 mt-0.5 accent-orange-500" />
          <span>I agree to the{' '}
            <a href="/terms" target="_blank" className="text-orange-400 underline">Terms of Service</a> and{' '}
            <a href="/privacy" target="_blank" className="text-orange-400 underline">Privacy Policy</a>.
          </span>
        </label>

        <label className="flex items-start gap-2 text-gray-300 text-sm cursor-pointer">
          <input type="checkbox" checked={contractorAcknowledged}
            onChange={e => { setContractorAcknowledged(e.target.checked); setError(''); }}
            className="rounded border-gray-600 mt-0.5 accent-orange-500" />
          <span>I acknowledge that I am registering as an <strong>independent contractor</strong>, not an employee of OxSteed. I am responsible for my own taxes, insurance, and business operations.</span>
        </label>
      </div>

      <button onClick={handleSubmit}
        disabled={loading || !termsAccepted || !contractorAcknowledged}
        className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-lg disabled:opacity-50 transition text-lg">
        {loading ? 'Completing...' : 'Complete Registration'}
      </button>
    </div>
  );
}
