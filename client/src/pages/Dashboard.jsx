import { useAuth } from '../hooks/useAuth';
import { useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useState, useEffect } from 'react';
import api from '../api/axios';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);
  const [myJobs, setMyJobs] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        const [jobsRes, notifRes, msgRes] = await Promise.allSettled([
          api.get('/jobs/me/list'),
          api.get('/notifications'),
          api.get('/messages/conversations'),
        ]);
        if (jobsRes.status === 'fulfilled') setMyJobs(jobsRes.value.data?.jobs || jobsRes.value.data || []);
        if (notifRes.status === 'fulfilled') setNotifications(notifRes.value.data?.notifications || notifRes.value.data || []);
        if (msgRes.status === 'fulfilled') setConversations(msgRes.value.data?.conversations || msgRes.value.data || []);
      } catch (err) {
        console.error('Dashboard fetch error:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchDashboardData();
  }, []);

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

  const displayName = user?.first_name ? `${user.first_name}` : '';
  const greetingText = displayName ? `${greeting()}, ${displayName}!` : `${greeting()}!`;
  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : null;

  const unreadNotifs = Array.isArray(notifications) ? notifications.filter(n => !n.read).length : 0;
  const unreadMessages = Array.isArray(conversations) ? conversations.filter(c => c.unread_count > 0).length : 0;
  const activeJobs = Array.isArray(myJobs) ? myJobs.filter(j => j.status === 'open' || j.status === 'in_progress') : [];

  const tierColor = {
    free: 'text-gray-400',
    pro: 'text-orange-400',
    premium: 'text-yellow-400',
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Navbar />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Greeting */}
        <div className="mb-8">
          <h2 className="text-2xl sm:text-3xl font-bold text-white">{greetingText}</h2>
          <p className="mt-1 text-gray-400">Here's what's happening with your account.</p>
        </div>

        {/* Email Verification Warning */}
        {user && !user.email_verified && (
          <div className="mb-6 bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-2xl">&#9888;</span>
              <div>
                <p className="text-yellow-400 font-medium">Email not verified</p>
                <p className="text-sm text-gray-400">Please verify your email to access all features.</p>
              </div>
            </div>
            <button
              onClick={async () => {
                try {
                  await api.post('/auth/resend-verification');
                  toast.success('Verification email sent!');
                } catch { toast.error('Could not send verification email.'); }
              }}
              className="text-sm bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 px-4 py-2 rounded-lg transition whitespace-nowrap"
            >
              Resend Verification
            </button>
          </div>
        )}

        {/* Quick Actions */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          <Link to="/post-job" className="group bg-gradient-to-br from-orange-500/10 to-orange-600/5 border border-orange-500/30 rounded-xl p-5 hover:border-orange-500/60 hover:from-orange-500/20 transition-all">
            <div className="text-2xl mb-2">+</div>
            <h3 className="font-semibold text-white group-hover:text-orange-400 transition">Post a Job</h3>
            <p className="text-sm text-gray-400 mt-1">Describe what you need done and get bids from helpers.</p>
          </Link>
          <Link to="/jobs" className="group bg-gray-900/80 border border-gray-700/50 rounded-xl p-5 hover:border-gray-600 transition-all">
            <div className="text-2xl mb-2">&#128269;</div>
            <h3 className="font-semibold text-white group-hover:text-orange-400 transition">Browse Listings</h3>
            <p className="text-sm text-gray-400 mt-1">Find helpers in your area for any project.</p>
          </Link>
          <Link to="/messages" className="group bg-gray-900/80 border border-gray-700/50 rounded-xl p-5 hover:border-gray-600 transition-all relative">
            <div className="text-2xl mb-2">&#128172;</div>
            <h3 className="font-semibold text-white group-hover:text-orange-400 transition">Messages</h3>
            <p className="text-sm text-gray-400 mt-1">Chat with helpers and manage conversations.</p>
            {unreadMessages > 0 && <span className="absolute top-3 right-3 bg-orange-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">{unreadMessages}</span>}
          </Link>
          <Link to="/disputes" className="group bg-gray-900/80 border border-gray-700/50 rounded-xl p-5 hover:border-gray-600 transition-all">
            <div className="text-2xl mb-2">&#9878;</div>
            <h3 className="font-semibold text-white group-hover:text-orange-400 transition">Disputes</h3>
            <p className="text-sm text-gray-400 mt-1">View and manage any open disputes.</p>
          </Link>
          <Link to="/settings" className="group bg-gray-900/80 border border-gray-700/50 rounded-xl p-5 hover:border-gray-600 transition-all">
            <div className="text-2xl mb-2">&#9881;</div>
            <h3 className="font-semibold text-white group-hover:text-orange-400 transition">Settings</h3>
            <p className="text-sm text-gray-400 mt-1">Edit profile, change password, or manage your account.</p>
          </Link>
          <Link to="/settings/2fa" className="group bg-gray-900/80 border border-gray-700/50 rounded-xl p-5 hover:border-gray-600 transition-all">
            <div className="text-2xl mb-2">&#128274;</div>
            <h3 className="font-semibold text-white group-hover:text-orange-400 transition">Security</h3>
            <p className="text-sm text-gray-400 mt-1">Set up two-factor authentication to secure your account.</p>
          </Link>
        </div>

        {/* Status Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <div className="bg-gray-900/80 backdrop-blur-lg border border-gray-700/50 rounded-xl p-5">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Account Type</p>
            <p className="mt-2 text-xl font-semibold text-white capitalize">{user?.role || '---'}</p>
          </div>
          <div className="bg-gray-900/80 backdrop-blur-lg border border-gray-700/50 rounded-xl p-5">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Subscription</p>
            <p className={`mt-2 text-xl font-semibold capitalize ${tierColor[user?.tier] || tierColor.free}`}>{user?.tier || 'Free'}</p>
            {(!user?.tier || user?.tier === 'free') && <Link to="/upgrade" className="text-xs text-orange-400 hover:text-orange-300 mt-1 inline-block">Upgrade &rarr;</Link>}
          </div>
          <div className="bg-gray-900/80 backdrop-blur-lg border border-gray-700/50 rounded-xl p-5">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Email Verified</p>
            <p className={`mt-2 text-xl font-semibold ${user?.email_verified ? 'text-green-400' : 'text-red-400'}`}>{user?.email_verified ? 'Yes' : 'No'}</p>
          </div>
          <div className="bg-gray-900/80 backdrop-blur-lg border border-gray-700/50 rounded-xl p-5">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Member Since</p>
            <p className="mt-2 text-lg font-semibold text-white">{memberSince || '---'}</p>
          </div>
        </div>

        {/* My Active Jobs */}
        <div className="bg-gray-900/80 backdrop-blur-lg border border-gray-700/50 rounded-xl p-6 mb-8">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-lg font-semibold text-white">My Active Jobs</h3>
            <Link to="/post-job" className="text-sm text-orange-400 hover:text-orange-300 transition">+ Post New</Link>
          </div>
          {loading ? (
            <p className="text-gray-500 text-sm">Loading...</p>
          ) : activeJobs.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500 mb-3">You haven't posted any jobs yet.</p>
              <Link to="/post-job" className="text-orange-400 hover:text-orange-300 text-sm font-medium">Post your first job &rarr;</Link>
            </div>
          ) : (
            <div className="space-y-3">
              {activeJobs.slice(0, 5).map(job => (
                <Link key={job.id} to={`/jobs/${job.id}`} className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg hover:bg-gray-800 transition group">
                  <div>
                    <p className="text-white font-medium group-hover:text-orange-400 transition">{job.title}</p>
                    <p className="text-xs text-gray-500 mt-1">{job.category} &middot; {job.city}, {job.state}</p>
                  </div>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${job.status === 'open' ? 'bg-green-500/20 text-green-400' : 'bg-blue-500/20 text-blue-400'}`}>
                    {job.status === 'open' ? 'Open' : 'In Progress'}
                  </span>
                </Link>
              ))}
              {activeJobs.length > 5 && <p className="text-sm text-gray-500 text-center pt-2">+ {activeJobs.length - 5} more active jobs</p>}
            </div>
          )}
        </div>

        {/* Recent Notifications */}
        <div className="bg-gray-900/80 backdrop-blur-lg border border-gray-700/50 rounded-xl p-6 mb-8">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-lg font-semibold text-white">Recent Notifications</h3>
            {unreadNotifs > 0 && <span className="text-xs bg-orange-500/20 text-orange-400 px-2 py-1 rounded-full">{unreadNotifs} unread</span>}
          </div>
          {loading ? (
            <p className="text-gray-500 text-sm">Loading...</p>
          ) : !Array.isArray(notifications) || notifications.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-6">No notifications yet.</p>
          ) : (
            <div className="space-y-2">
              {notifications.slice(0, 5).map(n => (
                <div key={n.id} className={`p-3 rounded-lg text-sm ${n.read ? 'bg-gray-800/30 text-gray-400' : 'bg-gray-800/60 text-white'}`}>
                  <p>{n.message || n.title}</p>
                  <p className="text-xs text-gray-500 mt-1">{n.created_at ? new Date(n.created_at).toLocaleDateString() : ''}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Account Details */}
        <div className="bg-gray-900/80 backdrop-blur-lg border border-gray-700/50 rounded-xl p-6 mb-8">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-lg font-semibold text-white">Account Details</h3>
            <Link to="/settings" className="text-sm text-orange-400 hover:text-orange-300 transition">Edit &rarr;</Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Full Name</p>
              <p className="text-white mt-1">{user?.first_name || user?.last_name ? `${user?.first_name || ''} ${user?.last_name || ''}`.trim() : <span className="text-gray-500 italic">Not set</span>}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Email</p>
              <p className="text-white mt-1">{user?.email}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Phone</p>
              <p className="text-white mt-1">{user?.phone || <span className="text-gray-500 italic">Not set</span>}</p>
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
            <Link to="/upgrade" className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-6 py-2.5 rounded-lg transition whitespace-nowrap">View Plans</Link>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
