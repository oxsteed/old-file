import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useState, useEffect } from 'react';
import api from '../api/axios';
import ThemeToggle from './ThemeToggle';

/** The OxSteed brand icon (4-arrow clockwise ring with inner circle) */
function OxSteedIcon({ size = 24 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect width="512" height="512" rx="88" fill="#16213e" />
      <path d="M 40 285 A 218 218 0 0 1 173 55 L 211 26 A 178 178 0 0 0 80 279 Z" fill="#F97316" />
      <path d="M 228 40 A 218 218 0 0 1 457 173 L 486 211 A 178 178 0 0 0 233 80 Z" fill="#F97316" />
      <path d="M 472 228 A 218 218 0 0 1 339 457 L 301 486 A 178 178 0 0 0 433 233 Z" fill="#F97316" />
      <path d="M 284 472 A 218 218 0 0 1 55 339 L 26 301 A 178 178 0 0 0 279 433 Z" fill="#F97316" />
      <circle cx="256" cy="256" r="145" fill="#F97316" />
      <text x="256" y="236" textAnchor="middle" dominantBaseline="middle" fontFamily="Arial Black, Arial, Helvetica, system-ui, sans-serif" fontWeight="900" fontSize="90" fill="#FFFFFF">OxS</text>
      <polyline points="131,305 172,305 184,295 194,268 204,326 214,297 224,305 381,305" fill="none" stroke="#FFFFFF" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Navbar() {
  const { user, logout } = useAuth();
  const location = useLocation();
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

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const isActive = (path) => location.pathname === path;

  return (
    <nav
      className="ox-navbar"
      aria-label="Main navigation"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        background: 'var(--color-nav-bg)',
        borderBottom: '1px solid var(--color-nav-border)',
      }}
    >
      <div className="ox-container">
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          height: '3.75rem',
        }}>
          {/* Logo */}
          <Link
            to="/"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              textDecoration: 'none',
              color: 'var(--color-text)',
              fontWeight: 700,
              fontSize: 'var(--text-xl)',
            }}
          >
            <OxSteedIcon size={28} />
            <span>OxSteed</span>
          </Link>

          {/* Desktop nav links */}
          <div className="ox-nav-desktop" style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
          }}>
            {user ? (
              <>
                <NavLink to="/jobs" active={isActive('/jobs')}>Browse Jobs</NavLink>
                <NavLink to="/post-job" active={isActive('/post-job')}>Post a Job</NavLink>
                <NavLink to="/messages" active={isActive('/messages')}>
                  Messages
                  {unreadMsgs > 0 && (
                    <span style={{
                      marginLeft: '0.25rem',
                      background: 'var(--color-primary)',
                      color: '#fff',
                      fontSize: '0.65rem',
                      fontWeight: 700,
                      padding: '0.1rem 0.4rem',
                      borderRadius: 'var(--radius-full)',
                      lineHeight: 1.3,
                    }}>
                      {unreadMsgs}
                    </span>
                  )}
                </NavLink>
                <Divider />
                <NavLink to="/dashboard" active={isActive('/dashboard')}>Dashboard</NavLink>
                <NavLink to="/settings" active={isActive('/settings')}>Settings</NavLink>
                <span className="ox-badge ox-badge-primary" style={{ textTransform: 'capitalize' }}>
                  {user?.role}
                </span>
                <button
                  onClick={logout}
                  className="ox-btn ox-btn-ghost ox-btn-sm"
                  style={{ color: 'var(--color-error)' }}
                >
                  Sign Out
                </button>
              </>
            ) : (
              <>
                <NavLink to="/login" active={isActive('/login')}>Sign in</NavLink>
                <NavLink to="/jobs" active={isActive('/jobs')}>Browse Jobs</NavLink>
                <NavLink to="/how-it-works" active={isActive('/how-it-works')}>How It Works</NavLink>
                <Link to="/register/helper" className="ox-btn ox-btn-secondary ox-btn-sm">
                  List Your Skills
                </Link>
                <Link to="/register/customer" className="ox-btn ox-btn-primary ox-btn-sm">
                  Post a Job
                </Link>
              </>
            )}
            <ThemeToggle />
          </div>

          {/* Mobile: theme toggle + hamburger */}
          <div className="ox-nav-mobile-controls" style={{
            display: 'none',
            alignItems: 'center',
            gap: 'var(--space-2)',
          }}>
            <ThemeToggle />
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileOpen}
              className="ox-btn-icon"
              style={{ color: 'var(--color-nav-link)' }}
            >
              <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round">
                {mobileOpen ? (
                  <><line x1="6" y1="6" x2="18" y2="18" /><line x1="6" y1="18" x2="18" y2="6" /></>
                ) : (
                  <><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></>
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div style={{
            paddingBottom: 'var(--space-4)',
            borderTop: '1px solid var(--color-border)',
            marginTop: 'var(--space-1)',
            paddingTop: 'var(--space-3)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-1)',
          }}>
            {user ? (
              <>
                <MobileNavLink to="/dashboard" onClick={() => setMobileOpen(false)}>Dashboard</MobileNavLink>
                <MobileNavLink to="/jobs" onClick={() => setMobileOpen(false)}>Browse Jobs</MobileNavLink>
                <MobileNavLink to="/post-job" onClick={() => setMobileOpen(false)}>Post a Job</MobileNavLink>
                <MobileNavLink to="/messages" onClick={() => setMobileOpen(false)}>
                  Messages {unreadMsgs > 0 && (
                    <span style={{
                      background: 'var(--color-primary)',
                      color: '#fff',
                      fontSize: '0.65rem',
                      fontWeight: 700,
                      padding: '0.1rem 0.4rem',
                      borderRadius: 'var(--radius-full)',
                      marginLeft: '0.25rem',
                    }}>{unreadMsgs}</span>
                  )}
                </MobileNavLink>
                <MobileNavLink to="/settings" onClick={() => setMobileOpen(false)}>Settings</MobileNavLink>
                <button
                  onClick={() => { logout(); setMobileOpen(false); }}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '0.5rem 0.75rem',
                    borderRadius: 'var(--radius-md)',
                    fontSize: 'var(--text-sm)',
                    color: 'var(--color-error)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'background var(--transition-fast)',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--color-error-bg)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  Sign Out
                </button>
              </>
            ) : (
              <>
                <MobileNavLink to="/login" onClick={() => setMobileOpen(false)}>Sign in</MobileNavLink>
                <MobileNavLink to="/jobs" onClick={() => setMobileOpen(false)}>Browse Jobs</MobileNavLink>
                <MobileNavLink to="/how-it-works" onClick={() => setMobileOpen(false)}>How It Works</MobileNavLink>
                <MobileNavLink to="/register/helper" onClick={() => setMobileOpen(false)} highlight>
                  List Your Skills
                </MobileNavLink>
                <MobileNavLink to="/register/customer" onClick={() => setMobileOpen(false)} primary>
                  Post a Job
                </MobileNavLink>
              </>
            )}
          </div>
        )}
      </div>

      {/* Responsive hide/show via CSS */}
      <style>{`
        @media (max-width: 768px) {
          .ox-nav-desktop { display: none !important; }
          .ox-nav-mobile-controls { display: flex !important; }
        }
      `}</style>
    </nav>
  );
}

function NavLink({ to, children, active }) {
  return (
    <Link
      to={to}
      style={{
        fontSize: 'var(--text-sm)',
        fontWeight: active ? 600 : 500,
        color: active ? 'var(--color-primary)' : 'var(--color-nav-link)',
        textDecoration: 'none',
        padding: '0.375rem 0.625rem',
        borderRadius: 'var(--radius-md)',
        transition: 'color var(--transition-fast), background var(--transition-fast)',
        display: 'inline-flex',
        alignItems: 'center',
      }}
      onMouseEnter={e => {
        if (!active) {
          e.currentTarget.style.color = 'var(--color-nav-link-hover)';
          e.currentTarget.style.background = 'var(--color-surface-2)';
        }
      }}
      onMouseLeave={e => {
        e.currentTarget.style.color = active ? 'var(--color-primary)' : 'var(--color-nav-link)';
        e.currentTarget.style.background = 'transparent';
      }}
    >
      {children}
    </Link>
  );
}

function MobileNavLink({ to, children, onClick, highlight, primary }) {
  const baseStyle = {
    display: 'block',
    padding: '0.5rem 0.75rem',
    borderRadius: 'var(--radius-md)',
    fontSize: 'var(--text-sm)',
    fontWeight: primary ? 600 : 500,
    textDecoration: 'none',
    transition: 'background var(--transition-fast), color var(--transition-fast)',
    color: primary ? 'var(--color-primary-text)' : highlight ? 'var(--color-primary)' : 'var(--color-nav-link)',
    background: primary ? 'var(--color-primary)' : 'transparent',
    textAlign: primary ? 'center' : 'left',
    marginTop: primary ? 'var(--space-2)' : 0,
  };

  return (
    <Link
      to={to}
      onClick={onClick}
      style={baseStyle}
      onMouseEnter={e => {
        if (!primary) e.currentTarget.style.background = 'var(--color-surface-2)';
        if (!primary) e.currentTarget.style.color = 'var(--color-nav-link-hover)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = primary ? 'var(--color-primary)' : 'transparent';
        e.currentTarget.style.color = primary ? 'var(--color-primary-text)' : highlight ? 'var(--color-primary)' : 'var(--color-nav-link)';
      }}
    >
      {children}
    </Link>
  );
}

function Divider() {
  return (
    <div style={{
      width: '1px',
      height: '1rem',
      background: 'var(--color-border-strong)',
      flexShrink: 0,
    }} />
  );
}
