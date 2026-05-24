import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { TrendingUp } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export default function InvestorLoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agreementName, setAgreementName] = useState('');
  const [termsAgreed, setTermsAgreed] = useState(false);
  const [loading, setLoading] = useState(false);

  const canSubmit = email.trim() && password && termsAgreed && agreementName.trim().split(/\s+/).length >= 2;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canSubmit || loading) return;
    setLoading(true);
    try {
      const result = await login({
        email: email.trim(),
        password,
        termsAgreed: true,
        agreementName: agreementName.trim(),
      });
      const user = result?.user;
      if (user?.default_mode !== 'investor') {
        toast('Logged in. Switching you to Investor mode...');
      }
      navigate('/investor/dashboard', { replace: true });
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Investor sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-gray-800 bg-gray-900 p-6 shadow-2xl">
        <div className="flex items-center gap-3 mb-5">
          <div className="h-10 w-10 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
            <TrendingUp size={18} className="text-emerald-300" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Investor Login</h1>
            <p className="text-xs text-gray-400">Access OxSteed Investor workspace</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Digital signature (full name)</label>
            <input
              type="text"
              value={agreementName}
              onChange={(e) => setAgreementName(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm"
            />
          </div>
          <label className="flex items-start gap-2 text-xs text-gray-300">
            <input type="checkbox" checked={termsAgreed} onChange={(e) => setTermsAgreed(e.target.checked)} className="mt-0.5" />
            <span>I agree to the Terms of Service and Privacy Policy.</span>
          </label>

          <button
            type="submit"
            disabled={!canSubmit || loading}
            className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-3 py-2 text-sm font-semibold"
          >
            {loading ? 'Signing in...' : 'Enter Investor Dashboard'}
          </button>
        </form>

        <div className="mt-4 text-xs text-gray-400 flex justify-between">
          <Link to="/join?mode=investor" className="hover:text-white">Create investor account</Link>
          <Link to="/login" className="hover:text-white">Standard login</Link>
        </div>
      </div>
    </div>
  );
}
