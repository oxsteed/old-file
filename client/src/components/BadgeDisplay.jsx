import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import './BadgeDisplay.css';

const BADGE_ICONS = {
  verified_identity: '🛡️',
  background_check:  '✅',
  pro_subscriber:    '⭐',
  top_rated:         '🏆',
};

const BADGE_COLORS = {
  verified_identity: '#4CAF50',
  background_check:  '#2196F3',
  pro_subscriber:    '#FF9800',
  top_rated:         '#9C27B0',
};

export default function BadgeDisplay({ userId, badges: propBadges, size = 'medium' }) {
  const { t } = useTranslation();
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

  const getBadgeLabel = (badgeType) => {
    switch (badgeType) {
      case 'verified_identity': return t('badge.idVerified');
      case 'background_check':  return t('badge.backgroundChecked');
      case 'pro_subscriber':    return t('badge.proMember');
      case 'top_rated':         return t('badge.topRated');
      default:                  return badgeType;
    }
  };

  if (loading) return null;
  if (!badges || badges.length === 0) return null;

  return (
    <div className={`badge-display badge-${size}`}>
      {badges.map((badge) => {
        const label = getBadgeLabel(badge.badge_type);
        const icon  = BADGE_ICONS[badge.badge_type] || '🏅';
        const color = BADGE_COLORS[badge.badge_type] || '#607D8B';
        return (
          <span
            key={badge.id || badge.badge_type}
            className="badge-item"
            style={{ borderColor: color }}
            title={label}
          >
            <span className="badge-icon">{icon}</span>
            <span className="badge-label">{label}</span>
          </span>
        );
      })}
    </div>
  );
}
