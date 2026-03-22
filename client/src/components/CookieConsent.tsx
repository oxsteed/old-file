import { useState } from 'react';
import { useCookieConsent, CookiePreferences } from '../hooks/useCookieConsent';

export default function CookieConsent() {
  const {
    showBanner,
    showSettings,
    acceptAll,
    rejectAll,
    savePreferences,
    openSettings,
    closeSettings,
    preferences,
  } = useCookieConsent();

  const [local, setLocal] = useState({
    analytics: false,
    marketing: false,
    functional: false,
  });

  if (!showBanner && !showSettings) return null;

  // ─── Settings Panel ─────────────────────────────────────────
  if (showSettings) {
    return (
      <div style={overlay}>
        <div style={settingsCard}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ color: '#f97316', margin: 0 }}>Cookie Preferences</h3>
            <button onClick={closeSettings} style={closeBtn}>&times;</button>
          </div>
          <p style={desc}>Manage how OxSteed uses cookies. Essential cookies cannot be disabled.</p>

          <div style={categoryBlock}>
            <div style={catHeader}>
              <span style={catTitle}>Essential Cookies</span>
              <span style={alwaysOn}>Always On</span>
            </div>
            <p style={catDesc}>Required for the platform to function. Includes authentication, security, and session management.</p>
          </div>

          <div style={categoryBlock}>
            <label style={catHeader}>
              <span style={catTitle}>Analytics Cookies</span>
              <input type="checkbox" checked={local.analytics}
                onChange={(e) => setLocal((p) => ({ ...p, analytics: e.target.checked }))}
                style={checkbox} />
            </label>
            <p style={catDesc}>Help us understand how visitors use OxSteed so we can improve the experience. Includes Google Analytics.</p>
          </div>

          <div style={categoryBlock}>
            <label style={catHeader}>
              <span style={catTitle}>Marketing Cookies</span>
              <input type="checkbox" checked={local.marketing}
                onChange={(e) => setLocal((p) => ({ ...p, marketing: e.target.checked }))}
                style={checkbox} />
            </label>
            <p style={catDesc}>Used to deliver relevant advertisements and track campaign effectiveness across platforms.</p>
          </div>

          <div style={categoryBlock}>
            <label style={catHeader}>
              <span style={catTitle}>Functional Cookies</span>
              <input type="checkbox" checked={local.functional}
                onChange={(e) => setLocal((p) => ({ ...p, functional: e.target.checked }))}
                style={checkbox} />
            </label>
            <p style={catDesc}>Enable enhanced functionality like chat support, saved preferences, and personalized features.</p>
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
            <button onClick={() => savePreferences(local)} style={primaryBtn}>Save Preferences</button>
            <button onClick={acceptAll} style={secondaryBtn}>Accept All</button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Banner ─────────────────────────────────────────────────
  return (
    <div style={bannerWrap}>
      <div style={bannerInner}>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontSize: 14, color: '#ccc' }}>
            We use cookies to improve your experience on OxSteed. Essential cookies are required for
            the platform to work. You can customize your preferences or accept all cookies.{' '}
            <a href="/cookie-policy" style={link}>Cookie Policy</a>
          </p>
        </div>
        <div style={btnGroup}>
          <button onClick={rejectAll} style={rejectBtn}>Reject All</button>
          <button onClick={openSettings} style={settingsBtn}>Customize</button>
          <button onClick={acceptAll} style={acceptBtn}>Accept All</button>
        </div>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────
const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 10000,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  backgroundColor: 'rgba(0,0,0,0.7)',
};
const settingsCard: React.CSSProperties = {
  background: '#1a1a2e', border: '1px solid #333', borderRadius: 12,
  padding: 28, maxWidth: 540, width: '92%', color: '#fff', maxHeight: '85vh', overflowY: 'auto',
};
const closeBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: '#888', fontSize: 24, cursor: 'pointer',
};
const desc: React.CSSProperties = { color: '#999', fontSize: 13, margin: '12px 0 20px' };
const categoryBlock: React.CSSProperties = {
  borderTop: '1px solid #2a2a3e', padding: '16px 0',
};
const catHeader: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer',
};
const catTitle: React.CSSProperties = { fontWeight: 600, fontSize: 14 };
const catDesc: React.CSSProperties = { color: '#888', fontSize: 12, margin: '6px 0 0' };
const alwaysOn: React.CSSProperties = {
  fontSize: 11, color: '#22c55e', background: '#14291e', padding: '2px 8px', borderRadius: 4,
};
const checkbox: React.CSSProperties = { width: 18, height: 18, accentColor: '#f97316' };
const primaryBtn: React.CSSProperties = {
  flex: 1, padding: '10px 0', borderRadius: 8, border: 'none', fontWeight: 600,
  fontSize: 14, cursor: 'pointer', backgroundColor: '#f97316', color: '#fff',
};
const secondaryBtn: React.CSSProperties = {
  flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid #555',
  fontWeight: 600, fontSize: 14, cursor: 'pointer', backgroundColor: 'transparent', color: '#ccc',
};

const bannerWrap: React.CSSProperties = {
  position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9998,
  background: '#111827', borderTop: '1px solid #2a2a3e', padding: '16px 0',
};
const bannerInner: React.CSSProperties = {
  maxWidth: 1100, margin: '0 auto', padding: '0 20px',
  display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap',
};
const link: React.CSSProperties = { color: '#f97316', textDecoration: 'underline' };
const btnGroup: React.CSSProperties = { display: 'flex', gap: 10, flexShrink: 0 };
const rejectBtn: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 6, border: '1px solid #555',
  background: 'transparent', color: '#ccc', fontSize: 13, cursor: 'pointer', fontWeight: 500,
};
const settingsBtn: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 6, border: '1px solid #f97316',
  background: 'transparent', color: '#f97316', fontSize: 13, cursor: 'pointer', fontWeight: 500,
};
const acceptBtn: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 6, border: 'none',
  background: '#f97316', color: '#fff', fontSize: 13, cursor: 'pointer', fontWeight: 600,
};
