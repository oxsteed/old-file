/**
 * ToolCompareModal
 *
 * Group 11 item 565: side-by-side comparison of up to TOOL_COMPARE_MAX
 * listings. Rows cover the specs a renter compares before booking: price,
 * deposit, condition, brand/model, category, location, distance (when the
 * browse carried it), capacity, weight, size, delivery and rating.
 * Values the listing does not carry render as "Not listed", never invented.
 */
import React from 'react';
import { X, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ToolCardData, ToolCondition } from '../../types/toolDirectory';
import { translateToolDirectoryCategory } from '../../utils/toolRentalsTaxonomy';

interface ToolCompareModalProps {
  tools: ToolCardData[];
  loading: boolean;
  onClose: () => void;
  onRemove: (toolId: number) => void;
  onViewDetails: (tool: ToolCardData) => void;
}

function normalizeCondition(c: string | undefined | null): ToolCondition | null {
  if (!c) return null;
  const lower = String(c).toLowerCase();
  if (lower === 'excellent' || lower === 'new' || lower === 'like new') return 'excellent';
  if (lower === 'good') return 'good';
  if (lower === 'fair') return 'fair';
  if (lower === 'poor') return 'poor';
  return null;
}

const ToolCompareModal: React.FC<ToolCompareModalProps> = ({
  tools,
  loading,
  onClose,
  onRemove,
  onViewDetails,
}) => {
  const { t } = useTranslation();

  const notListed = t('toolRentalsDir.compareNotListed');
  const money = (v: number | string | null | undefined) =>
    v != null && Number(v) > 0 ? `$${Number(v).toFixed(0)}` : notListed;

  const rows: { label: string; values: string[] }[] = [
    {
      label: t('toolRentalsDir.compareDailyRate'),
      values: tools.map((tool) => `${money(tool.daily_rate)}${t('toolRentalsDir.perDay')}`),
    },
    {
      label: t('toolRentalsDir.compareHourlyRate'),
      values: tools.map((tool) => (tool.hourly_rate != null && Number(tool.hourly_rate) > 0 ? money(tool.hourly_rate) : notListed)),
    },
    {
      label: t('toolRentalsDir.compareDeposit'),
      values: tools.map((tool) => (tool.requires_deposit ? money(tool.deposit_amount) : t('toolRentalsDir.noDeposit'))),
    },
    {
      label: t('toolRentalsDir.compareCondition'),
      values: tools.map((tool) => {
        const cond = normalizeCondition(tool.condition);
        return cond ? t(`toolRentalsDir.condition.${cond}`) : (tool.condition || notListed);
      }),
    },
    {
      label: t('toolRentalsDir.compareBrand'),
      values: tools.map((tool) => tool.brand || notListed),
    },
    {
      label: t('toolRentalsDir.compareModel'),
      values: tools.map((tool) => tool.model || notListed),
    },
    {
      label: t('toolRentalsDir.compareCategory'),
      values: tools.map((tool) => translateToolDirectoryCategory(t, tool.category)),
    },
    {
      label: t('toolRentalsDir.compareLocation'),
      values: tools.map((tool) => [tool.location_city, tool.location_state].filter(Boolean).join(', ') || notListed),
    },
    {
      label: t('toolRentalsDir.compareDistance'),
      values: tools.map((tool) => (tool.distance_miles != null
        ? t('toolRentalsDir.distanceLabel', { distance: Number(tool.distance_miles).toFixed(1) })
        : notListed)),
    },
    {
      label: t('toolRentalsDir.compareCapacity'),
      values: tools.map((tool) => (tool.capacity_value != null && tool.capacity_unit
        ? t('toolRentalsDir.capacityLabel', { value: Number(tool.capacity_value), unit: tool.capacity_unit })
        : notListed)),
    },
    {
      label: t('toolRentalsDir.compareWeight'),
      values: tools.map((tool) => (tool.weight_kg != null
        ? t('toolRentalsDir.weightLabel', { value: Number(tool.weight_kg) })
        : notListed)),
    },
    {
      label: t('toolRentalsDir.compareSize'),
      values: tools.map((tool) => {
        const dims = [tool.size_length_cm, tool.size_width_cm, tool.size_height_cm]
          .filter((v) => v != null)
          .map((v) => Number(v));
        if (dims.length === 0) return notListed;
        return `${dims.join(' x ')} cm`;
      }),
    },
    {
      label: t('toolRentalsDir.compareDelivery'),
      values: tools.map((tool) => (tool.delivery_available ? t('common.yes') : t('common.no'))),
    },
    {
      label: t('toolRentalsDir.compareRating'),
      values: tools.map((tool) => (typeof tool.avg_rating === 'number' && tool.avg_rating > 0
        ? `${Number(tool.avg_rating).toFixed(1)}${tool.review_count ? ` (${tool.review_count})` : ''}`
        : notListed)),
    },
    {
      label: t('toolRentalsDir.compareAvailability'),
      values: tools.map((tool) => (tool.is_available
        ? t('toolRentalsDir.compareAvailable')
        : t('toolRentalsDir.compareUnavailable'))),
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label={t('toolRentalsDir.compareTitle')}>
      <div className="absolute inset-0 bg-black/70" onClick={onClose} aria-hidden="true" />
      <div className="relative bg-gray-900 border border-gray-800 rounded-t-2xl sm:rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 flex-shrink-0">
          <h2 className="text-base font-semibold text-white">{t('toolRentalsDir.compareTitle')}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
            aria-label={t('common.close')} data-track="ui.9c3f1d2a55.1"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
        <div className="overflow-auto flex-1 p-5">
          {loading ? (
            <p className="text-sm text-gray-400">{t('common.loading')}</p>
          ) : tools.length < 2 ? (
            <p className="text-sm text-gray-400">{t('toolRentalsDir.compareEmpty')}</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr>
                  <th className="text-start align-bottom p-2 w-32" aria-label="" />
                  {tools.map((tool) => (
                    <th key={tool.id} className="align-bottom p-2 min-w-44 text-start">
                      <div className="flex flex-col gap-2">
                        <div className="relative h-24 rounded-xl overflow-hidden bg-gray-800 flex items-center justify-center">
                          {tool.image_url ? (
                            <img src={tool.image_url} alt={tool.name} className="w-full h-full object-cover" loading="lazy" />
                          ) : (
                            <Wrench className="w-8 h-8 text-gray-700" aria-hidden="true" />
                          )}
                          <button
                            onClick={() => onRemove(tool.id)}
                            className="absolute top-1.5 end-1.5 w-6 h-6 rounded-full bg-gray-900/80 text-gray-300 hover:text-white flex items-center justify-center"
                            aria-label={t('toolRentalsDir.compareRemove', { name: tool.name })} data-track="ui.9c3f1d2a55.2"
                          >
                            <X className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </div>
                        <p className="font-semibold text-white leading-snug">{tool.name}</p>
                        <button
                          onClick={() => onViewDetails(tool)}
                          className="self-start text-xs font-medium text-brand-400 hover:text-brand-300 transition-colors" data-track="ui.9c3f1d2a55.3"
                        >
                          {t('toolRentalsDir.compareViewDetails')}
                        </button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label} className="border-t border-gray-800">
                    <th scope="row" className="text-start p-2 text-xs font-semibold text-gray-500 align-top">
                      {row.label}
                    </th>
                    {row.values.map((value, i) => (
                      <td key={tools[i].id} className="p-2 text-gray-200 align-top">{value}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default ToolCompareModal;
