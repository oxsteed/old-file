import React from 'react';
import './TrustKeys.css';

// SVG for a single upright golden key
const KeyIcon = ({ size = 20 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className="trust-key-icon"
  >
    <circle cx="12" cy="7" r="5" stroke="#F5A623" strokeWidth="2" fill="none" />
    <line x1="12" y1="12" x2="12" y2="22" stroke="#F5A623" strokeWidth="2" strokeLinecap="round" />
    <line x1="12" y1="17" x2="16" y2="17" stroke="#F5A623" strokeWidth="2" strokeLinecap="round" />
    <line x1="12" y1="20" x2="15" y2="20" stroke="#F5A623" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const TRUST_LEVELS = {
  community: { keys: 0, label: 'Community', desc: 'Profile & reviews' },
  verified: { keys: 1, label: 'ID Verified', desc: 'Identity confirmed' },
  pro: { keys: 2, label: 'Verified Pro', desc: 'ID + background check' },
  protected: { keys: 3, label: 'Protected', desc: 'ID + background + escrow' },
};

/**
 * TrustKeys - Universal trust level indicator
 * @param {string} level - 'community' | 'verified' | 'pro' | 'protected'
 * @param {string} mode - 'inline' (next to name) | 'card' (in tour/profile sections)
 * @param {number} size - key icon size in px (default: 18 for inline, 28 for card)
 */
export default function TrustKeys({ level = 'community', mode = 'inline', size }) {
  const config = TRUST_LEVELS[level] || TRUST_LEVELS.community;
  const keySize = size || (mode === 'card' ? 28 : 18);

  if (mode === 'inline') {
    return (
      <span className="trust-keys-inline" title={`${config.label} — ${config.desc}`}>
        {config.keys === 0 ? (
          <span className="trust-keys-none">—</span>
        ) : (
          Array.from({ length: config.keys }).map((_, i) => (
            <KeyIcon key={i} size={keySize} />
          ))
        )}
      </span>
    );
  }

  // Card mode
  return (
    <div className={`trust-keys-card ${level === 'protected' ? 'trust-keys-card-highlight' : ''}`}>
      <div className="trust-keys-card-icons">
        {config.keys === 0 ? (
          <span className="trust-keys-card-empty">No keys yet</span>
        ) : (
          Array.from({ length: config.keys }).map((_, i) => (
            <KeyIcon key={i} size={keySize} />
          ))
        )}
      </div>
      <span className="trust-keys-card-label">{config.label}</span>
      <span className="trust-keys-card-desc">{config.desc}</span>
    </div>
  );
}

// Export config for external use
export { TRUST_LEVELS, KeyIcon };
