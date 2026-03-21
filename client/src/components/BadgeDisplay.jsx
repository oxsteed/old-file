import React, { useState, useEffect } from 'react';
import api from '../api/axios';
import './BadgeDisplay.css';

const BADGE_CONFIG = {
  verified_identity: { label: 'ID Verified', icon: '🛡️', color: '#4CAF50' },
  background_check: { label: 'Background Checked', icon: '✅', color: '#2196F3' },
  pro_subscriber: { label: 'Pro Member', icon: '⭐', color: '#FF9800' },
  top_rated: { label: 'Top Rated', icon: '🏆', color: '#9C27B0' },
};

export default function BadgeDisplay({ userId, badges: propBadges, size = 'medium' }) {
  const [badges, setBadges] = useState(propBadges || []);
  const [loading, setLoading] = useState(!propBadges);

  useEffect(() => {
    if (propBadges) {
      setBadges(propBadges);
      return;
    }
    if (userId) {
      api.get(`/subscription/badges/${userId}`)
        .then(({ data }) => setBadges(data))
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [userId, propBadges]);

  if (loading) return null;
  if (!badges || badges.length === 0) return null;

  return (
    <div className={`badge-display badge-${size}`}>
      {badges.map((badge) => {
        const config = BADGE_CONFIG[badge.badge_type] || {
          label: badge.badge_type,
          icon: '🏅',
          color: '#607D8B',
        };
        return (
          <span
            key={badge.id || badge.badge_type}
            className="badge-item"
            style={{ borderColor: config.color }}
            title={config.label}
          >
            <span className="badge-icon">{config.icon}</span>
            <span className="badge-label">{config.label}</span>
          </span>
        );
      })}
    </div>
  );
}
