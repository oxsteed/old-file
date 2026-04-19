import React from 'react';
import { useTranslation } from 'react-i18next';
import { Star, MapPin, Eye } from 'lucide-react';
import './ToolCard.css';

interface ToolCardProps {
  tool: {
    id: number;
    user_id?: string;
    name: string;
    category: string;
    condition: string;
    location_city: string;
    daily_rate: number;
    hourly_rate?: number;
    image_url?: string;
    is_available: boolean;
    first_name?: string;
    last_name?: string;
    avatar_url?: string;
    owner_rating?: number;
  };
  onViewDetails: (tool: any) => void;
  onViewProfile: (userId: string) => void;
}

const ToolCard: React.FC<ToolCardProps> = ({ tool, onViewDetails, onViewProfile }) => {
  const { t } = useTranslation();

  const getConditionColor = (condition: string) => {
    const conditionMap: Record<string, string> = {
      'excellent': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100',
      'good': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100',
      'fair': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100',
      'poor': 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100',
    };
    return conditionMap[condition] || 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-100';
  };

  const ownerName = tool.first_name && tool.last_name ? `${tool.first_name} ${tool.last_name}` : 'Unknown';

  return (
    <div className="tool-card">
      {/* Tool Image */}
      <div className="tool-card-image-container">
        {tool.image_url ? (
          <img src={tool.image_url} alt={tool.name} className="tool-card-image" loading="lazy" />
        ) : (
          <div className="tool-card-image-placeholder">
            <Eye className="w-8 h-8 text-gray-400" />
          </div>
        )}
        {!tool.is_available && <div className="tool-card-unavailable-overlay">{t('common.unavailable')}</div>}
      </div>

      {/* Tool Info */}
      <div className="tool-card-body">
        {/* Tool Name & Category */}
        <h3 className="tool-card-title">{tool.name}</h3>
        <p className="tool-card-category">{tool.category}</p>

        {/* Condition Badge */}
        <span className={`tool-card-condition ${getConditionColor(tool.condition)}`}>
          {tool.condition}
        </span>

        {/* Location */}
        <div className="tool-card-location">
          <MapPin className="w-4 h-4" />
          <span>{tool.location_city}</span>
        </div>

        {/* Pricing */}
        <div className="tool-card-pricing">
          {tool.daily_rate && (
            <div className="tool-price-item">
              <span className="tool-price-label">{t('toolRentals.perDay')}</span>
              <span className="tool-price-value">${tool.daily_rate}</span>
            </div>
          )}
          {tool.hourly_rate && (
            <div className="tool-price-item">
              <span className="tool-price-label">{t('toolRentals.perHour')}</span>
              <span className="tool-price-value">${tool.hourly_rate}</span>
            </div>
          )}
        </div>

        {/* Owner Info */}
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
            {tool.owner_rating !== undefined && (
              <div className="tool-card-owner-rating">
                <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                <span>{tool.owner_rating.toFixed(1)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Action Button */}
        <button
          onClick={() => onViewDetails(tool)}
          disabled={!tool.is_available}
          className="tool-card-button"
          aria-label={t('toolRentals.viewDetails')}
        >
          {t('toolRentals.viewDetails')}
        </button>
      </div>
    </div>
  );
};

export default ToolCard;
