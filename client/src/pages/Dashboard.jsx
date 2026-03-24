import { useAuth } from '../hooks/useAuth';
import { useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useState } from 'react';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    await logout();
    toast.success('Logged out successfully');
    navigate('/login', { replace: true });
  };

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const displayName = user?.first_name || 'there';
  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : null;

  const tierColor = {
    free: 'text-gray-400',
    pro: 'text-orange-400',
    premium: 'text-yellow-400',
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Navbar */}
      <nav className="bg-gray-900/80 backdrop-blur-lg border-b border-gray-700/50 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <Link to="/" className="text-xl font-bold text-orange-500 hover:text-orange-400 transition">OxSteed</Link>
            <div className="flex items-center gap-3">
              <Link to="/jobs" className="text-sm text-gray-300 hover:text-white transition hidden sm:block">Browse Jobs</Link>
              <Link to="/post-job" className="text-sm text-gray-300 hover:text-white transition hidden sm:block">Post a Job</Link>
              <div className="h-4 w-px bg-gray-700 hidden sm:block" />
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-400 font-semibold text-sm">
                  {user?.first_name?.[0]?.toUpperCase() || '?'}{user?.last_name?.[0]?.toUpperCase() || ''}
                </div>
                <span className="text-sm text-gray-300 hidden sm:block">
                  {user?.first_name} {user?.last_name}
                </span>
              </div>
              <span className="text-xs bg-orange-500/20 text-orange-400 px-2 py-1 rounded-full capitalize">
                {user?.role}
              </span>
              <button
                onClick={handleLogout}
                disabled={loggingOut}
                className="text-sm text-red-400 hover:text-red-300 font-medium transition"
              >
                {loggingOut ? 'Logging out...' : 'Logout'}
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Greeting */}
        <div className="mb-8">
          <h2 className="text-2xl sm:text-3xl font-bold text-white">
            {greeting()}, {displayName}!
          </h2>
          <p className="mt-1 text-gray-400">Here's what's happening with your account.</p>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <Link
            to="/post-job"
            className="group bg-gradient-to-br from-orange-500/10 to-orange-600/5 border border-orange-500/30 rounded-xl p-5 hover:border-orange-500/60 hover:from-orange-500/20 transition-all"
          >
            <div className="text-2xl mb-2">+</div>
            <h3 className="font-semibold text-white group-hover:text-orange-400 transition">Post a Job</h3>
            <p className="text-sm text-gray-400 mt-1">Describe what you need done and get bids from helpers.</p>
          </Link>
          <Link
            to="/jobs"
            className="group bg-gray-900/80 border border-gray-700/50 rounded-xl p-5 hover:border-gray-600 transition-all"
          >
            <div className="text-2xl mb-2">&#x1F50D;</div>
            <h3 className="font-semibold text-white group-hover:text-orange-400 transition">Browse Listings</h3>
            <p className="text-sm text-gray-400 mt-1">Find helpers in your area for any project.</p>
          </Link>
          <Link
            to="/settings/2fa"
            className="group bg-gray-900/80 border border-gray-700/50 rounded-xl p-5 hover:border-gray-600 transition-all"
          >
            <div className="text-2xl mb-2">&#x1F512;</div>
            <h3 className="font-semibold text-white group-hover:text-orange-400 transition">Security Settings</h3>
            <p className="text-sm text-gray-400 mt-1">Set up two-factor authentication to secure your account.</p>
          </Link>
        </div>

        {/* Status Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <div className="bg-gray-900/80 backdrop-blur-lg border border-gray-700/50 rounded-xl p-5">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Account Type</p>
            <p className="mt-2 text-xl font-semibold text-white capitalize">{user?.role || '—'}</p>
          </div>
          <div className="bg-gray-900/80 backdrop-blur-lg border border-gray-700/50 rounded-xl p-5">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Subscription</p>
            <p className={`mt-2 text-xl font-semibold capitalize ${tierColor[user?.tier] || tierColor.free}`}>
              {user?.tier || 'Free'}
            </p>
            {(!user?.tier || user?.tier === 'free') && (
              <Link to="/upgrade" className="text-xs text-orange-400 hover:text-orange-300 mt-1 inline-block">Upgrade &rarr;</Link>
            )}
          </div>
          <div className="bg-gray-900/80 backdrop-blur-lg border border-gray-700/50 rounded-xl p-5">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Email Verified</p>
            <p className={`mt-2 text-xl font-semibold ${user?.email_verified ? 'text-green-400' : 'text-red-400'}`}>
              {user?.email_verified ? 'Yes' : 'No'}
            </p>
          </div>
          <div className="bg-gray-900/80 backdrop-blur-lg border border-gray-700/50 rounded-xl p-5">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Member Since</p>
            <p className="mt-2 text-lg font-semibold text-white">{memberSince || '—'}</p>
          </div>
        </div>

        {/* Account Details */}
        <div className="bg-gray-900/80 backdrop-blur-lg border border-gray-700/50 rounded-xl p-6 mb-8">
          <h3 className="text-lg font-semibold text-white mb-5">Account Details</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Full Name</p>
              <p className="text-white mt-1">{user?.first_name} {user?.last_name}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Email</p>
              <p className="text-white mt-1">{user?.email}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Phone</p>
              <p className="text-white mt-1">{user?.phone || <span className="text-gray-500 italic">Not set</span>}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Referral Code</p>
              <p className="text-white mt-1 font-mono text-sm">{user?.referral_code || '—'}</p>
            </div>
          </div>
        </div>

        {/* Upgrade CTA for free tier */}
        {(!user?.tier || user?.tier === 'free') && (
          <div className="bg-gradient-to-r from-orange-500/10 via-orange-600/5 to-transparent border border-orange-500/20 rounded-xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-white">Upgrade to Pro</h3>
              <p className="text-sm text-gray-400 mt-1">Get priority placement, a verified badge, and bid alerts for new jobs.</p>
            </div>
            <Link
              to="/upgrade"
              className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-6 py-2.5 rounded-lg transition whitespace-nowrap"
            >
              View Plans
            </Link>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col sm:flex-row justify-between items-center gap-4 text-sm text-gray-500">
          <p>&copy; 2026 OxSteed LLC</p>
          <div className="flex gap-4">
            <Link to="/terms" className="hover:text-gray-300 transition">Terms</Link>
            <Link to="/privacy" className="hover:text-gray-300 transition">Privacy</Link>
            <Link to="/security" className="hover:text-gray-300 transition">Security</Link>
            <Link to="/about" className="hover:text-gray-300 transition">About</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
