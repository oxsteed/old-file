import { useAuth } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    toast.success('Logged out successfully');
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <nav className="bg-gray-900/80 backdrop-blur-lg border-b border-gray-700/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <h1 className="text-xl font-bold text-orange-500">OxSteed</h1>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-300">
                {user?.first_name} {user?.last_name}
              </span>
              <span className="text-xs bg-orange-500/20 text-orange-400 px-2 py-1 rounded-full capitalize">
                {user?.role}
              </span>
              <button
                onClick={handleLogout}
                className="text-sm text-red-400 hover:text-red-300 font-medium"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-white">
            Welcome back, {user?.first_name}!
          </h2>
          <p className="mt-1 text-gray-400">Here's your dashboard overview.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-gray-900/80 backdrop-blur-lg border border-gray-700/50 rounded-xl p-6">
            <h3 className="text-sm font-medium text-gray-400">Account Type</h3>
            <p className="mt-2 text-2xl font-semibold text-white capitalize">{user?.role}</p>
          </div>
          <div className="bg-gray-900/80 backdrop-blur-lg border border-gray-700/50 rounded-xl p-6">
            <h3 className="text-sm font-medium text-gray-400">Subscription Tier</h3>
            <p className="mt-2 text-2xl font-semibold text-orange-400 capitalize">{user?.tier || 'Free'}</p>
          </div>
          <div className="bg-gray-900/80 backdrop-blur-lg border border-gray-700/50 rounded-xl p-6">
            <h3 className="text-sm font-medium text-gray-400">Email Verified</h3>
            <p className="mt-2 text-2xl font-semibold text-white">{user?.email_verified ? 'Yes' : 'No'}</p>
          </div>
        </div>

        <div className="mt-8 bg-gray-900/80 backdrop-blur-lg border border-gray-700/50 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Account Details</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-400">Email</p>
              <p className="text-white">{user?.email}</p>
            </div>
            <div>
              <p className="text-sm text-gray-400">Phone</p>
              <p className="text-white">{user?.phone || 'Not set'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-400">Member Since</p>
              <p className="text-white">{user?.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A'}</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
