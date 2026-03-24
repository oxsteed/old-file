import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export default function AdminLogin() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(null);
  const [requires2FA, setRequires2FA] = useState(false);
  const [twoFACode, setTwoFACode] = useState('');
  const [userId, setUserId] = useState(null);

  const isLocked = lockedUntil && Date.now() < lockedUntil;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (isLocked) {
      const mins = Math.ceil((lockedUntil - Date.now()) / 60000);
      setError(`Too many failed attempts. Try again in ${mins} minute(s).`);
      return;
    }

    if (!email || !password) {
      setError('Email and password are required.');
      return;
    }

    setLoading(true);
    try {
      const data = await login({ email: email.trim().toLowerCase(), password });

      if (data.requiresTwoFactor) {
        setRequires2FA(true);
        setUserId(data.userId);
        setLoading(false);
        return;
      }

      const user = data.user;
      if (!['admin', 'super_admin'].includes(user.role)) {
        setError('Access denied. Admin privileges required.');
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('user');
        setLoading(false);
        return;
      }

      setAttempts(0);
      navigate('/admin/dashboard', { replace: true });
    } catch (err) {
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);
      if (newAttempts >= MAX_ATTEMPTS) {
        const lockTime = Date.now() + LOCKOUT_MS;
        setLockedUntil(lockTime);
        setError('Account temporarily locked due to too many failed attempts.');
      } else {
        setError(err.response?.data?.error || 'Login failed. Please check your credentials.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handle2FASubmit(e) {
    e.preventDefault();
    setError('');

    if (!twoFACode) {
      setError('Please enter your 2FA code.');
      return;
    }

    setLoading(true);
    try {
      const api = (await import('../../api/auth')).default;
      const { data } = await api.post('/auth/login/2fa', {
        userId,
        token: twoFACode,
        isBackupCode: twoFACode.length > 6
      });

      if (!['admin', 'super_admin'].includes(data.user.role)) {
        setError('Access denied. Admin privileges required.');
        setLoading(false);
        return;
      }

      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      localStorage.setItem('user', JSON.stringify(data.user));
      window.location.href = '/admin/dashboard';
    } catch (err) {
      setError(err.response?.data?.error || 'Invalid 2FA code.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-orange-500">OxSteed</h1>
          <p className="text-gray-400 mt-2">Admin Portal</p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8">
          <h2 className="text-xl font-semibold text-white mb-6">
            {requires2FA ? 'Two-Factor Authentication' : 'Sign In'}
          </h2>

          {error && (
            <div className="bg-red-900/30 border border-red-700 text-red-400 px-4 py-3 rounded-lg mb-4 text-sm">
              {error}
            </div>
          )}

          {!requires2FA ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 transition"
                  placeholder="admin@oxsteed.com"
                  autoComplete="email"
                  disabled={loading || isLocked}
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 transition"
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  disabled={loading || isLocked}
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading || isLocked}
                className="w-full bg-orange-600 hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition mt-2"
              >
                {loading ? 'Signing in...' : isLocked ? 'Account Locked' : 'Sign In'}
              </button>
            </form>
          ) : (
            <form onSubmit={handle2FASubmit} className="space-y-4">
              <p className="text-sm text-gray-400 mb-2">
                Enter the 6-digit code from your authenticator app, or a backup code.
              </p>
              <div>
                <label className="block text-sm text-gray-400 mb-1">2FA Code</label>
                <input
                  type="text"
                  value={twoFACode}
                  onChange={e => setTwoFACode(e.target.value.replace(/[^a-zA-Z0-9]/g, ''))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 transition text-center tracking-widest text-lg"
                  placeholder="000000"
                  maxLength={20}
                  autoComplete="one-time-code"
                  disabled={loading}
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-orange-600 hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition"
              >
                {loading ? 'Verifying...' : 'Verify'}
              </button>
              <button
                type="button"
                onClick={() => { setRequires2FA(false); setTwoFACode(''); setError(''); }}
                className="w-full text-gray-400 hover:text-white text-sm py-2 transition"
              >
                Back to login
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-gray-600 text-xs mt-6">
          Authorized personnel only. All access is monitored and logged.
        </p>
      </div>
    </div>
  );
}
