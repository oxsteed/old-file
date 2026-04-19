import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Star, MapPin, Eye, HelpCircle, Heart } from 'lucide-react';
import ToolFavoriteButton from './ToolFavoriteButton';
import './ToolCard.css';

interface ToolCardProps {
  tool: {
    id: number;
    name: string;
    category: string;
    condition: string;
    location_city: string;
    daily_rate: number;
    weekly_rate?: number;
    monthly_rate?: number;
    image_url?: string;
    is_available: boolean;
    first_name?: string;
    last_name?: string;
    avatar_url?: string;
    owner_rating?: number;
    owner_id?: number;
  };
  onViewDetails: (tool: any) => void;
  onViewProfile: (userId: number) => void;
}

const ToolCard: React.FC<ToolCardProps> = ({ tool, onViewDetails, onViewProfile }) => {
  const { t } = useTranslation();
  const [showTooltip, setShowTooltip] = useState(false);

  const getConditionColor = (condition: string) => {
    const conditionMap: Record<string, string> = {
      'New': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100',
      'Like New': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100',
      'Good': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100',
      'Fair': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100',
      'Poor': 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100',
    };
    return conditionMap[condition] || 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-100';
  };

  const getConditionTooltip = (condition: string) => {
    const conditionMap: Record<string, string> = {
      'New': t('toolRentals.conditionExcellent'),
      'Like New': t('toolRentals.conditionExcellent'),
      'Good': t('toolRentals.conditionGood'),
      'Fair': t('toolRentals.conditionFair'),
      'Poor': t('toolRentals.conditionPoor'),
    };
    return conditionMap[condition] || '';
  };

  const ownerName = tool.first_name && tool.last_name ? `${tool.first_name} ${tool.last_name}` : 'Unknown';

  return (
    <div className="tool-card">
      {/* Tool Image + Favorite Button */}
      <div className="tool-card-image-container">
        {tool.image_url ? (
          <img src={tool.image_url} alt={tool.name} className="tool-card-image" loading="lazy" />
        ) : (
          <div className="tool-card-image-placeholder">
            <Eye className="w-8 h-8 text-gray-400" />
          </div>
        )}
        {!tool.is_available && <div className="tool-card-unavailable-overlay">{t('common.unavailable')}</div>}
        <div className="tool-card-favorite-overlay">
          <ToolFavoriteButton toolId={tool.id} />
        </div>
      </div>

      {/* Tool Info */}
      <div className="tool-card-body">
        {/* Tool Name & Category */}
        <h3 className="tool-card-title">{tool.name}</h3>
        <p className="tool-card-category">{tool.category}</p>

        {/* Condition Badge with Tooltip */}
        <div className="tool-card-condition-wrapper">
          <span className={`tool-card-condition ${getConditionColor(tool.condition)}`}>
            {tool.condition}
          </span>
          {getConditionTooltip(tool.condition) && (
            <div
              className="tool-card-condition-tooltip-trigger"
              onMouseEnter={() => setShowTooltip(true)}
              onMouseLeave={() => setShowTooltip(false)}
              aria-label={getConditionTooltip(tool.condition)}
            >
              <HelpCircle className="w-3.5 h-3.5 text-gray-400" />
              {showTooltip && (
                <div className="tool-card-condition-tooltip">
                  {getConditionTooltip(tool.condition)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Location */}
        <div className="tool-card-location">
          <MapPin className="w-4 h-4" />
          <span>{tool.location_city}</span>
        </div>

        {/* Pricing - Price Hierarchy: Daily (Hero), Weekly/Monthly (Muted) */}
        <div className="tool-card-pricing">
          {tool.daily_rate && tool.daily_rate > 0 ? (
            <div className="tool-card-daily-price">
              <span className="tool-card-daily-rate">${tool.daily_rate}</span>
              <span className="tool-card-daily-label">{t('toolRentals.perDay')}</span>
            </div>
          ) : null}
          {(tool.weekly_rate && tool.weekly_rate > 0) || (tool.monthly_rate && tool.monthly_rate > 0) ? (
            <div className="tool-card-other-prices">
              {tool.weekly_rate && tool.weekly_rate > 0 && (
                <span className="tool-card-other-price">${tool.weekly_rate}{t('toolRentals.perWeek')}</span>
              )}
              {tool.monthly_rate && tool.monthly_rate > 0 && (
                <span className="tool-card-other-price">${tool.monthly_rate}{t('toolRentals.perMonth')}</span>
              )}
            </div>
          ) : null}
        </div>

        {/* Owner Info + Response Time */}
        <div className="tool-card-owner">
          {tool.avatar_url ? (
            <img src={tool.avatar_url} alt={ownerName} className="tool-card-owner-avatar" />
          ) : (
            <div className="tool-card-owner-avatar-placeholder">
              {tool.first_name?.[0]}{tool.last_name?.[0]}
            </div>
          )}
          <div className="tool-card-owner-info">
            <p className="tool-card-owner-name">{ownerName}</p>
            <div className="tool-card-owner-meta">
              {tool.owner_rating !== undefined && (
                <div className="tool-card-owner-rating">
                  <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                  <span>{tool.owner_rating.toFixed(1)}</span>
                </div>
              )}
              {tool.avg_response_time_hours && (
                <span className="tool-card-response-time">
                  {t('toolRentals.respondIn', { hours: tool.avg_response_time_hours })}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action Button */}
        <button
          onClick={() => onViewDetails(tool)}
          disabled={!tool.is_available}
          className="tool-card-button"
        >
          {t('toolRentals.viewDetails')}
        </button>
      </div>
    </div>
  );
};

export default React.memo(ToolCard);
