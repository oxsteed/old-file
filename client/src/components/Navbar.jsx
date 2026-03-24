import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useState, useEffect } from 'react';
import api from '../api/axios';

export default function Navbar() {
  const { user, logout } = useAuth();
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const [unreadMsgs, setUnreadMsgs] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    const fetchCounts = async () => {
      try {
        const [notifRes, msgRes] = await Promise.allSettled([
          api.get('/notifications'),
          api.get('/messages/conversations'),
        ]);
        if (notifRes.status === 'fulfilled') {
          const notifs = notifRes.value.data?.notifications || notifRes.value.data || [];
          setUnreadNotifs(Array.isArray(notifs) ? notifs.filter(n => !n.read).length : 0);
        }
        if (msgRes.status === 'fulfilled') {
          const convos = msgRes.value.data?.conversations || msgRes.value.data || [];
          setUnreadMsgs(Array.isArray(convos) ? convos.filter(c => c.unread_count > 0).length : 0);
        }
      } catch {}
    };
    fetchCounts();
  }, [user]);

  return (
    <nav className="bg-gray-900/80 backdrop-blur-lg border-b border-gray-700/50 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          <Link to="/" className="text-xl font-bold text-orange-500 hover:text-orange-400 transition">OxSteed</Link>

          {/* Mobile menu button */}
          <button onClick={() => setMobileOpen(!mobileOpen)} className="sm:hidden text-gray-300 hover:text-white">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {mobileOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>

          {/* Desktop nav */}
          <div className="hidden sm:flex items-center gap-3">
            {user ? (
              <>
                <Link to="/jobs" className="text-sm text-gray-300 hover:text-white transition">Browse Jobs</Link>
                <Link to="/post-job" className="text-sm text-gray-300 hover:text-white transition">Post a Job</Link>
                <Link to="/messages" className="text-sm text-gray-300 hover:text-white transition relative">
                  Messages
                  {unreadMsgs > 0 && <span className="absolute -top-1 -right-3 bg-orange-500 text-white text-xs w-4 h-4 flex items-center justify-center rounded-full">{unreadMsgs}</span>}
                </Link>
                <div className="h-4 w-px bg-gray-700" />
                <Link to="/dashboard" className="text-sm text-gray-300 hover:text-white transition">Dashboard</Link>
                <Link to="/settings" className="text-sm text-gray-300 hover:text-white transition">Settings</Link>
                <span className="text-xs bg-orange-500/20 text-orange-400 px-2 py-1 rounded-full capitalize">{user?.role}</span>
                <button onClick={logout} className="text-sm text-red-400 hover:text-red-300 font-medium transition">Logout</button>
              </>
            ) : (
              <>
                <Link to="/login" className="text-gray-300 hover:text-white transition">Sign in</Link>
                <Link to="/jobs" className="px-4 py-2 border border-orange-500 text-orange-500 rounded-lg hover:bg-orange-500 hover:text-white transition">Find Help</Link>
                <Link to="/register/helper" className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition">List Your Skills</Link>
              </>
            )}
          </div>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="sm:hidden pb-4 space-y-2">
            {user ? (
              <>
                <Link to="/dashboard" onClick={() => setMobileOpen(false)} className="block text-gray-300 hover:text-white py-2">Dashboard</Link>
                <Link to="/jobs" onClick={() => setMobileOpen(false)} className="block text-gray-300 hover:text-white py-2">Browse Jobs</Link>
                <Link to="/post-job" onClick={() => setMobileOpen(false)} className="block text-gray-300 hover:text-white py-2">Post a Job</Link>
                <Link to="/messages" onClick={() => setMobileOpen(false)} className="block text-gray-300 hover:text-white py-2">
                  Messages {unreadMsgs > 0 && <span className="bg-orange-500 text-white text-xs px-1.5 py-0.5 rounded-full ml-1">{unreadMsgs}</span>}
                </Link>
                <Link to="/settings" onClick={() => setMobileOpen(false)} className="block text-gray-300 hover:text-white py-2">Settings</Link>
                <button onClick={() => { logout(); setMobileOpen(false); }} className="block text-red-400 hover:text-red-300 py-2">Logout</button>
              </>
            ) : (
              <>
                <Link to="/login" onClick={() => setMobileOpen(false)} className="block text-gray-300 hover:text-white py-2">Sign in</Link>
                <Link to="/jobs" onClick={() => setMobileOpen(false)} className="block text-gray-300 hover:text-white py-2">Find Help</Link>
                <Link to="/register/helper" onClick={() => setMobileOpen(false)} className="block text-orange-400 hover:text-orange-300 py-2">List Your Skills</Link>
              </>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}
