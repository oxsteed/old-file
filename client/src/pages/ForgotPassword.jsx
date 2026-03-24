import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axios';
import toast from 'react-hot-toast';
import { ArrowLeft, Mail } from 'lucide-react';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
      toast.success('Reset link sent! Check your email.');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <Link to="/" className="text-3xl font-bold text-orange-500">OxSteed</Link>
          <h2 className="mt-6 text-2xl font-bold text-white">Reset your password</h2>
          <p className="mt-2 text-gray-400 text-sm">
            {sent
              ? 'Check your email for a password reset link. It expires in 1 hour.'
              : 'Enter your email and we\'ll send you a link to reset your password.'}
          </p>
        </div>

        {!sent ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-1.5">
                Email address
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
                placeholder="you@example.com"
                autoComplete="email"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-xl shadow-lg shadow-orange-500/25 disabled:opacity-50 transition"
            >
              {loading ? 'Sending...' : (<><Mail size={18} /> Send Reset Link</>)}
            </button>
          </form>
        ) : (
          <div className="text-center space-y-4">
            <div className="w-16 h-16 mx-auto bg-orange-500/10 rounded-full flex items-center justify-center">
              <Mail className="w-8 h-8 text-orange-500" />
            </div>
            <p className="text-gray-300 text-sm">Didn't receive the email? Check your spam folder or try again.</p>
            <button
              onClick={() => setSent(false)}
              className="text-orange-500 hover:text-orange-400 text-sm font-medium transition"
            >
              Try again
            </button>
          </div>
        )}

        <div className="text-center">
          <Link to="/login" className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-white transition">
            <ArrowLeft size={16} /> Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
