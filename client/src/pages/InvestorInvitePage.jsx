import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../api/axios';

const inputClass = 'w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white';

export default function InvestorInvitePage() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [proof, setProof] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [account, setAccount] = useState({ firstName: '', lastName: '', password: '', ageConfirmed: false, termsAccepted: false });
  const [step, setStep] = useState('invite');
  const [message, setMessage] = useState('');
  const [signInRequired, setSignInRequired] = useState(false);
  const [busy, setBusy] = useState(false);

  async function verify(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setMessage(''); setSignInRequired(false);
    try {
      const { data } = await api.post('/investor-invitations/verify', {
        id: params.get('id') || undefined, email: email.trim(), inviteCode: inviteCode.trim(),
      });
      setProof(data.proof); setStep('email');
    } catch (error) {
      setMessage(error?.response?.data?.error || 'The invitation could not be verified.');
    } finally { setBusy(false); }
  }

  async function complete(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setMessage(''); setSignInRequired(false);
    try {
      await api.post('/investor-invitations/accept', {
        email: email.trim(), proof, verificationCode: verificationCode.trim(), ...account,
      });
      setStep('done');
    } catch (error) {
      setSignInRequired(error?.response?.data?.code === 'sign_in_required');
      setMessage(error?.response?.data?.error || 'The invitation could not be verified.');
    } finally { setBusy(false); }
  }

  return (
    <main className="min-h-screen bg-gray-950 px-4 py-16 text-white">
      <div className="mx-auto w-full max-w-lg rounded-2xl border border-gray-800 bg-gray-900 p-6 shadow-2xl">
        <p className="text-xs uppercase tracking-widest text-orange-400">Private invitation</p>
        <h1 className="mt-2 text-2xl font-bold">OxSteed Investor</h1>
        {step === 'invite' && <form onSubmit={verify} className="mt-6 space-y-4">
          <p className="text-sm text-gray-400">Enter the email address the administrator invited and the one-time code from the invitation email.</p>
          <input className={inputClass} type="email" required placeholder="Invited email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className={inputClass} inputMode="numeric" required placeholder="Invitation code" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} />
          <button className="w-full rounded-lg bg-orange-500 px-4 py-2 font-semibold text-gray-950" disabled={busy}>{busy ? 'Checking…' : 'Continue'}</button>
        </form>}
        {step === 'email' && <form onSubmit={complete} className="mt-6 space-y-4">
          <p className="text-sm text-gray-400">We sent a separate verification code to {email}. Email verification does not replace the invitation check.</p>
          <input className={inputClass} inputMode="numeric" required placeholder="Email verification code" value={verificationCode} onChange={(e) => setVerificationCode(e.target.value)} />
          <div className="grid gap-4 sm:grid-cols-2">
            <input className={inputClass} required placeholder="First name" value={account.firstName} onChange={(e) => setAccount({ ...account, firstName: e.target.value })} />
            <input className={inputClass} required placeholder="Last name" value={account.lastName} onChange={(e) => setAccount({ ...account, lastName: e.target.value })} />
          </div>
          <input className={inputClass} type="password" minLength="8" required placeholder="Create your customer password" value={account.password} onChange={(e) => setAccount({ ...account, password: e.target.value })} />
          <label className="flex items-start gap-2 text-sm text-gray-300"><input type="checkbox" required checked={account.ageConfirmed} onChange={(e) => setAccount({ ...account, ageConfirmed: e.target.checked })} /> I confirm I am at least 18 years old.</label>
          <label className="flex items-start gap-2 text-sm text-gray-300"><input type="checkbox" required checked={account.termsAccepted} onChange={(e) => setAccount({ ...account, termsAccepted: e.target.checked })} /> I agree to the Terms of Service and Privacy Policy.</label>
          <button className="w-full rounded-lg bg-orange-500 px-4 py-2 font-semibold text-gray-950" disabled={busy}>{busy ? 'Creating account…' : 'Create customer account'}</button>
        </form>}
        {step === 'done' && <div className="mt-6 space-y-3"><p className="text-sm text-gray-300">Your customer account is ready. Your investor admission is pending administrator review; no reporting or investment access has been granted yet.</p><Link className="inline-block rounded-lg border border-orange-500 px-4 py-2 text-orange-300" to="/login">Sign in</Link></div>}
        {message && <p role="alert" className="mt-4 text-sm text-red-300">{message}</p>}
        {signInRequired && <Link className="mt-3 inline-block text-sm text-orange-300 underline" to="/login">Sign in with the invited email, then return here to finish</Link>}
        <p className="mt-6 text-xs text-gray-500">Do not have an invitation? <Link className="text-orange-300" to="/join">Create a customer account</Link>.</p>
      </div>
    </main>
  );
}
