import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Footer() {
  const { user } = useAuth();
  const year = new Date().getFullYear();

  return (
    <footer
      style={{
        borderTop: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        color: 'var(--color-text-muted)',
        padding: 'var(--space-12) 0 var(--space-8)',
      }}
    >
      <div className="ox-container">
        {/* Top: Logo + Nav links */}
        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 'var(--space-6)',
          marginBottom: 'var(--space-8)',
          paddingBottom: 'var(--space-8)',
          borderBottom: '1px solid var(--color-border)',
        }}>
          {/* Logo */}
          <div>
            <Link
              to="/"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                textDecoration: 'none',
                fontSize: 'var(--text-lg)',
                fontWeight: 700,
                color: 'var(--color-text)',
                marginBottom: 'var(--space-2)',
              }}
            >
              <svg width="22" height="22" viewBox="0 0 512 512" aria-hidden="true">
                <rect width="512" height="512" rx="88" fill="#16213e" />
                <path d="M 40 285 A 218 218 0 0 1 173 55 L 211 26 A 178 178 0 0 0 80 279 Z" fill="#F97316" />
                <path d="M 228 40 A 218 218 0 0 1 457 173 L 486 211 A 178 178 0 0 0 233 80 Z" fill="#F97316" />
                <path d="M 472 228 A 218 218 0 0 1 339 457 L 301 486 A 178 178 0 0 0 433 233 Z" fill="#F97316" />
                <path d="M 284 472 A 218 218 0 0 1 55 339 L 26 301 A 178 178 0 0 0 279 433 Z" fill="#F97316" />
                <circle cx="256" cy="256" r="145" fill="#F97316" />
                <text x="256" y="236" textAnchor="middle" dominantBaseline="middle" fontFamily="Arial Black, sans-serif" fontWeight="900" fontSize="90" fill="#FFFFFF">OxS</text>
                <polyline points="131,305 172,305 184,295 194,268 204,326 214,297 224,305 381,305" fill="none" stroke="#FFFFFF" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              OxSteed
            </Link>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', maxWidth: '36ch', lineHeight: 1.6 }}>
              Post a job, compare bids from trusted local helpers, and pay securely.
            </p>
          </div>

          {/* Navigation links */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-6)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Platform
              </span>
              {user ? (
                <FooterLink to="/dashboard">Dashboard</FooterLink>
              ) : (
                <FooterLink to="/login">Sign In</FooterLink>
              )}
              <FooterLink to="/jobs">Browse Jobs</FooterLink>
              <FooterLink to={user?.role === 'customer' ? '/post-job' : '/register/customer'}>Post a Job</FooterLink>
              <FooterLink to={user?.role === 'helper' ? '/dashboard' : '/register/helper'}>List Your Skills</FooterLink>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Company
              </span>
              <FooterLink to="/how-it-works">How It Works</FooterLink>
              <FooterLink to="/about">About</FooterLink>
              <FooterLink to="/helpers">Find Helpers</FooterLink>
            </div>
          </div>
        </div>

        {/* Legal links */}
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--space-4)',
          marginBottom: 'var(--space-4)',
        }}>
          <LegalLink to="/terms">Terms of Service</LegalLink>
          <LegalLink to="/privacy">Privacy Policy</LegalLink>
          <LegalLink to="/security">Security</LegalLink>
          <LegalLink to="/cookie-policy">Cookie Policy</LegalLink>
          <LegalLink to="/do-not-sell">Do Not Sell My Info</LegalLink>
          <LegalLink to="/accessibility">Accessibility</LegalLink>
        </div>

        {/* Copyright */}
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--space-2)',
          paddingTop: 'var(--space-4)',
          borderTop: '1px solid var(--color-border)',
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-faint)',
        }}>
          <p>&copy; {year} OxSteed LLC</p>
          <p>
            <a
              href="mailto:support@oxsteed.com"
              style={{ color: 'var(--color-primary)', textDecoration: 'none' }}
              onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
              onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
            >
              support@oxsteed.com
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterLink({ to, children }) {
  return (
    <Link
      to={to}
      style={{
        fontSize: 'var(--text-sm)',
        color: 'var(--color-text-muted)',
        textDecoration: 'none',
        transition: 'color var(--transition-fast)',
      }}
      onMouseEnter={e => e.currentTarget.style.color = 'var(--color-text)'}
      onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-muted)'}
    >
      {children}
    </Link>
  );
}

function LegalLink({ to, children }) {
  return (
    <Link
      to={to}
      style={{
        fontSize: '0.78rem',
        color: 'var(--color-text-faint)',
        textDecoration: 'none',
        transition: 'color var(--transition-fast)',
      }}
      onMouseEnter={e => e.currentTarget.style.color = 'var(--color-text-muted)'}
      onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-faint)'}
    >
      {children}
    </Link>
  );
}
