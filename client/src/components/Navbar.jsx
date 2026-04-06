import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useState, useEffect } from 'react';
import api from '../api/axios';
import ThemeToggle from './ThemeToggle';

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
          setUnreadNotifs(Array.isArray(notifs) ? notifs.filter(n => !n.is_read && !n.read_at).length : 0);
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
    <nav
      className="sticky top-0 z-50 backdrop-blur-lg border-b"
      style={{
        background: 'var(--nav-bg)',
        borderColor: 'var(--nav-border)',
      }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          {/* Logo */}
          <Link
            to="/"
            className="text-xl font-bold transition"
            style={{ color: 'var(--app-brand)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--app-brand-hover)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--app-brand)')}
          >
            OxSteed
          </Link>

          {/* Desktop nav */}
          <div className="hidden sm:flex items-center gap-3">
            {user ? (
              <>
                <NavLink to="/jobs">Browse Jobs</NavLink>
                <NavLink to="/post-job">Post a Job</NavLink>
                <Link
                  to="/messages"
                  className="text-sm transition relative"
                  style={{ color: 'var(--nav-link)' }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--nav-link-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--nav-link)')}
                >
                  Messages
                  {unreadMsgs > 0 && (
                    <span className="absolute -top-1 -right-3 bg-orange-500 text-white text-xs w-4 h-4 flex items-center justify-center rounded-full">
                      {unreadMsgs}
                    </span>
                  )}
                </Link>
                <div className="h-4 w-px" style={{ background: 'var(--app-border-solid)' }} />
                <NavLink to="/dashboard">Dashboard</NavLink>
                <NavLink to="/settings">Settings</NavLink>
                <span className="text-xs px-2 py-1 rounded-full capitalize font-semibold" style={{ background: 'var(--app-brand-bg)', color: 'var(--app-brand)' }}>
                  {user?.role}
                </span>
                <button
                  onClick={logout}
                  className="text-sm font-medium transition text-red-400 hover:text-red-300"
                >
                  Logout
                </button>
              </>
            ) : (
              <>
                <NavLink to="/login">Sign in</NavLink>
                <Link
                  to="/jobs"
                  className="px-4 py-2 border rounded-lg text-sm font-medium transition"
                  style={{ borderColor: 'var(--app-brand)', color: 'var(--app-brand)' }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'var(--app-brand)';
                    e.currentTarget.style.color = '#fff';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'var(--app-brand)';
                  }}
                >
                  Find Help
                </Link>
                <Link
                  to="/register/helper"
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition"
                  style={{ background: 'var(--app-brand)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--app-brand-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'var(--app-brand)')}
                >
                  List Your Skills
                </Link>
              </>
            )}
            <ThemeToggle />
          </div>

          {/* Mobile: toggle + hamburger */}
          <div className="sm:hidden flex items-center gap-3">
            <ThemeToggle />
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="Toggle menu"
              style={{ color: 'var(--nav-link)' }}
              className="hover:opacity-80 transition"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {mobileOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="sm:hidden pb-4 space-y-1 border-t mt-1 pt-3" style={{ borderColor: 'var(--nav-border)' }}>
            {user ? (
              <>
                <MobileLink to="/dashboard" onClose={() => setMobileOpen(false)}>Dashboard</MobileLink>
                <MobileLink to="/jobs" onClose={() => setMobileOpen(false)}>Browse Jobs</MobileLink>
                <MobileLink to="/post-job" onClose={() => setMobileOpen(false)}>Post a Job</MobileLink>
                <MobileLink to="/messages" onClose={() => setMobileOpen(false)}>
                  Messages {unreadMsgs > 0 && (
                    <span className="bg-orange-500 text-white text-xs px-1.5 py-0.5 rounded-full ml-1">{unreadMsgs}</span>
                  )}
                </MobileLink>
                <MobileLink to="/settings" onClose={() => setMobileOpen(false)}>Settings</MobileLink>
                <button
                  onClick={() => { logout(); setMobileOpen(false); }}
                  className="block w-full text-left py-2 px-2 rounded-lg text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 transition"
                >
                  Logout
                </button>
              </>
            ) : (
              <>
                <MobileLink to="/login" onClose={() => setMobileOpen(false)}>Sign in</MobileLink>
                <MobileLink to="/jobs" onClose={() => setMobileOpen(false)}>Find Help</MobileLink>
                <MobileLink to="/register/helper" onClose={() => setMobileOpen(false)} brand>
                  List Your Skills
                </MobileLink>
                <MobileLink to="/register/customer" onClose={() => setMobileOpen(false)}>
                  Post a Job
                </MobileLink>
              </>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}

function NavLink({ to, children }) {
  return (
    <Link
      to={to}
      className="text-sm transition"
      style={{ color: 'var(--nav-link)' }}
      onMouseEnter={e => (e.currentTarget.style.color = 'var(--nav-link-hover)')}
      onMouseLeave={e => (e.currentTarget.style.color = 'var(--nav-link)')}
    >
      {children}
    </Link>
  );
}

function MobileLink({ to, children, onClose, brand }) {
  return (
    <Link
      to={to}
      onClick={onClose}
      className="block py-2 px-2 rounded-lg text-sm transition"
      style={{ color: brand ? 'var(--app-brand)' : 'var(--nav-link)' }}
      onMouseEnter={e => (e.currentTarget.style.color = brand ? 'var(--app-brand-hover)' : 'var(--nav-link-hover)')}
      onMouseLeave={e => (e.currentTarget.style.color = brand ? 'var(--app-brand)' : 'var(--nav-link)')}
    >
      {children}
    </Link>
  );
}
