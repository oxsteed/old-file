import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, MessageCircle, User, Star, MapPin, HelpCircle, Calendar } from 'lucide-react';
import ToolReviewsList from './ToolReviewsList';
import './ToolDetailModal.css';

interface ToolDetailModalProps {
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
    description?: string;
    is_available: boolean;
    first_name?: string;
    last_name?: string;
    avatar_url?: string;
    owner_rating?: number;
    owner_id?: number;
  };
  isOpen: boolean;
  onClose: () => void;
  onMessage: (userId: number) => void;
  onViewProfile: (userId: number) => void;
}

const ToolDetailModal: React.FC<ToolDetailModalProps> = ({
  tool,
  isOpen,
  onClose,
  onMessage,
  onViewProfile,
}) => {
  const { t } = useTranslation();
  const [showConditionTooltip, setShowConditionTooltip] = useState(false);

  if (!isOpen) return null;

  const ownerName = tool.first_name && tool.last_name ? `${tool.first_name} ${tool.last_name}` : 'Unknown';

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

  return (
    <div className="tool-modal-overlay" onClick={onClose}>
      <div className="tool-modal-content" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="tool-modal-header">
          <h2 className="tool-modal-title">{tool.name}</h2>
          <button onClick={onClose} className="tool-modal-close-btn" aria-label="Close modal">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="tool-modal-body">
          {/* Image */}
          {tool.image_url && (
            <div className="tool-modal-image-container">
              <img src={tool.image_url} alt={tool.name} className="tool-modal-image" />
            </div>
          )}

          {/* Main Info */}
          <div className="tool-modal-info">
            <div className="tool-modal-category-condition">
              <span className="tool-modal-category">{tool.category}</span>
              <div className="tool-modal-condition-wrapper">
                <span className={`tool-modal-condition ${getConditionColor(tool.condition)}`}>
                  {tool.condition}
                </span>
                {getConditionTooltip(tool.condition) && (
                  <div
                    className="tool-modal-condition-tooltip-trigger"
                    onMouseEnter={() => setShowConditionTooltip(true)}
                    onMouseLeave={() => setShowConditionTooltip(false)}
                    aria-label={getConditionTooltip(tool.condition)}
                  >
                    <HelpCircle className="w-3.5 h-3.5 text-gray-400" />
                    {showConditionTooltip && (
                      <div className="tool-modal-condition-tooltip">
                        {getConditionTooltip(tool.condition)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Location */}
            <div className="tool-modal-location">
              <MapPin className="w-4 h-4" />
              <span>{tool.location_city}</span>
            </div>

            {/* Description */}
            {tool.description && (
              <div className="tool-modal-description">
                <h3 className="tool-modal-section-title">{t('common.description')}</h3>
                <p>{tool.description}</p>
              </div>
            )}

            {/* Pricing */}
            <div className="tool-modal-pricing">
              <h3 className="tool-modal-section-title">{t('toolRentals.pricing')}</h3>
              <div className="tool-modal-price-list">
                {tool.daily_rate && (
                  <div className="tool-modal-price-item">
                    <span>{t('toolRentals.perDay')}</span>
                    <span className="tool-modal-price-value">${tool.daily_rate}</span>
                  </div>
                )}
                {tool.weekly_rate && (
                  <div className="tool-modal-price-item">
                    <span>{t('toolRentals.perWeek')}</span>
                    <span className="tool-modal-price-value">${tool.weekly_rate}</span>
                  </div>
                )}
                {tool.monthly_rate && (
                  <div className="tool-modal-price-item">
                    <span>{t('toolRentals.perMonth')}</span>
                    <span className="tool-modal-price-value">${tool.monthly_rate}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Owner - Horizontal Layout */}
            <div className="tool-modal-owner">
              <h3 className="tool-modal-section-title">{t('toolRentals.owner')}</h3>
              <div className="tool-modal-owner-card-horizontal">
                {/* Left: Avatar + Name + Rating */}
                <div className="tool-modal-owner-info-group">
                  {tool.avatar_url ? (
                    <img src={tool.avatar_url} alt={ownerName} className="tool-modal-owner-avatar" />
                  ) : (
                    <div className="tool-modal-owner-avatar-placeholder">
                      {tool.first_name?.[0]}{tool.last_name?.[0]}
                    </div>
                  )}
                  <div className="tool-modal-owner-text">
                    <p className="tool-modal-owner-name">{ownerName}</p>
                    {tool.owner_rating !== undefined && (
                      <div className="tool-modal-owner-rating">
                        <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                        <span>{tool.owner_rating.toFixed(1)}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right: Action Buttons */}
                <div className="tool-modal-owner-actions-horizontal">
                  <button
                    onClick={() => tool.owner_id && onMessage(tool.owner_id)}
                    className="tool-modal-action-btn tool-modal-message-btn"
                  >
                    <MessageCircle className="w-4 h-4" />
                    {t('toolRentals.inquireAboutRental')}
                  </button>
                  <button
                    onClick={() => tool.owner_id && onViewProfile(tool.owner_id)}
                    className="tool-modal-action-btn tool-modal-profile-btn"
                  >
                    <User className="w-4 h-4" />
                    {t('toolRentals.viewProfile')}
                  </button>
                </div>
              </div>
            </div>

            {/* Availability */}
            <div className="tool-modal-availability">
              {!tool.is_available && (
                <div className="tool-modal-unavailable-notice">
                  {t('toolRentals.unavailableNotice')}
                </div>
              )}
              {tool.is_available && (
                <button className="tool-modal-booking-btn" disabled={!tool.is_available}>
                  <Calendar className="w-4 h-4" />
                  {t('toolRentals.booking')}
                </button>
              )}
            </div>

            {/* Reviews Section */}
            <ToolReviewsList
              toolId={tool.id}
              avgRating={tool.avg_rating}
              reviewCount={tool.review_count}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ToolDetailModal;
