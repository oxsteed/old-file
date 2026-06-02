/**
 * CustomerReliabilityBadge.tsx
 * Shows customer reliability level (helpful for helpers deciding whether to bid)
 * Displays completion rate, cancellation rate, and caution level
 */

import React, { useState, useEffect } from 'react';
import { AlertCircle, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';

interface ReliabilityData {
  completionRate: number;
  cancellationRate: number;
  reliabilityLevel: 'excellent' | 'good' | 'fair' | 'caution' | 'warning';
  cancellationPattern?: string;
}

interface CustomerReliabilityBadgeProps {
  customerId: string;
  compact?: boolean; // if true, show as small badge; if false, show with tooltip
}

const CustomerReliabilityBadge: React.FC<CustomerReliabilityBadgeProps> = ({
  customerId,
  compact = true,
}) => {
  const { t } = useTranslation();
  const [reliability, setReliability] = useState<ReliabilityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTooltip, setShowTooltip] = useState(false);

  useEffect(() => {
    const fetchReliability = async () => {
      try {
        const { data } = await api.get(`/reputation/customers/${customerId}/reliability`);
        setReliability(data.data);
      } catch (err) {
        console.error('Failed to fetch customer reliability', err);
      } finally {
        setLoading(false);
      }
    };

    fetchReliability();
  }, [customerId]);

  if (loading || !reliability) {
    return null; // Don't render if not loaded
  }

  const getBadgeColor = () => {
    switch (reliability.reliabilityLevel) {
      case 'excellent':
        return 'bg-green-900/40 border-green-700/40 text-green-200';
      case 'good':
        return 'bg-emerald-900/40 border-emerald-700/40 text-emerald-200';
      case 'fair':
        return 'bg-blue-900/40 border-blue-700/40 text-blue-200';
      case 'caution':
        return 'bg-yellow-900/40 border-yellow-700/40 text-yellow-200';
      case 'warning':
        return 'bg-red-900/40 border-red-700/40 text-red-200';
      default:
        return 'bg-gray-800 border-gray-700 text-gray-300';
    }
  };

  const getIcon = () => {
    switch (reliability.reliabilityLevel) {
      case 'excellent':
      case 'good':
        return <CheckCircle2 className="w-3 h-3" />;
      case 'caution':
      case 'warning':
        return <AlertTriangle className="w-3 h-3" />;
      default:
        return <AlertCircle className="w-3 h-3" />;
    }
  };

  const getLabel = () => {
    switch (reliability.reliabilityLevel) {
      case 'excellent':
        return t('customerReliability.excellent');
      case 'good':
        return t('customerReliability.good');
      case 'fair':
        return t('customerReliability.fair');
      case 'caution':
        return t('customerReliability.caution');
      case 'warning':
        return t('customerReliability.warning');
      default:
        return t('customerReliability.unknown');
    }
  };

  if (compact) {
    return (
      <div className="relative">
        <button
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
          onClick={() => setShowTooltip(!showTooltip)}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-semibold transition-colors ${getBadgeColor()}`}
          aria-label={t('customerReliability.ariaLabel', { level: getLabel() })}
        >
          {getIcon()}
          <span className="hidden sm:inline">{getLabel()}</span>
        </button>

        {showTooltip && (
          <div className="absolute bottom-full left-0 mb-2 bg-gray-950 border border-gray-700 rounded-lg p-3 text-xs text-gray-300 z-10 whitespace-nowrap">
            <div className="font-semibold text-white mb-1">{getLabel()}</div>
            <div className="space-y-0.5">
              <div>{t('customerReliability.completionRate')}: {reliability.completionRate}%</div>
              <div>{t('customerReliability.cancellationRate')}: {reliability.cancellationRate}%</div>
              {reliability.cancellationPattern && (
                <div className="text-gray-400 italic">{reliability.cancellationPattern}</div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border ${getBadgeColor()}`}
    >
      {getIcon()}
      <div>
        <p className="font-semibold text-xs">{getLabel()}</p>
        <p className="text-[10px] text-gray-400">
          {reliability.completionRate}% {t('customerReliability.completion')}
        </p>
      </div>
    </div>
  );
};

export default CustomerReliabilityBadge;
