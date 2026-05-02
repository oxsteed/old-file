import { Link } from 'react-router-dom';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

/**
 * StatCard
 *
 * Props:
 *   label      string   — card title
 *   value      number|string — primary value
 *   icon       LucideIcon
 *   color      string   — Tailwind color class for the icon
 *   delta      number   — optional: change vs previous period (positive = up)
 *   deltaLabel string   — e.g. "vs last period" (default)
 *   subtitle   string   — optional secondary line below value
 *   format     'number'|'currency'|'percent' — how to format value
 *   href       string   — if set, card is wrapped in a Link
 *   highlight  boolean  — orange gradient treatment
 */
export default function StatCard({
  label, value, icon: Icon, color,
  delta, deltaLabel = 'vs last period',
  subtitle, format = 'number', href, highlight = false,
}) {
  const formatted = (() => {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'string') return value;
    if (format === 'currency') {
      return '$' + (value / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (format === 'percent') return `${value}%`;
    return typeof value === 'number' ? value.toLocaleString() : String(value);
  })();

  const deltaEl = (() => {
    if (delta === null || delta === undefined) return null;
    const abs = Math.abs(delta);
    if (delta === 0) return (
      <span className="flex items-center gap-0.5 text-xs text-gray-500">
        <Minus size={11} />{abs} {deltaLabel}
      </span>
    );
    if (delta > 0) return (
      <span className="flex items-center gap-0.5 text-xs text-emerald-400">
        <TrendingUp size={11} />+{format === 'currency' ? `$${(abs / 100).toFixed(2)}` : abs} {deltaLabel}
      </span>
    );
    return (
      <span className="flex items-center gap-0.5 text-xs text-red-400">
        <TrendingDown size={11} />{format === 'currency' ? `-$${(abs / 100).toFixed(2)}` : `-${abs}`} {deltaLabel}
      </span>
    );
  })();

  const inner = (
    <div className={`rounded-xl p-4 flex flex-col gap-1 h-full ${
      highlight
        ? 'bg-gradient-to-br from-orange-500 to-orange-600 text-white'
        : 'bg-[#111318] border border-gray-800 text-white'
    } ${href ? 'hover:border-gray-600 transition-colors cursor-pointer' : ''}`}>
      <div className="flex items-center justify-between">
        <p className={`text-xs font-medium uppercase tracking-wider ${
          highlight ? 'text-orange-100' : 'text-gray-400'
        }`}>
          {label}
        </p>
        {Icon && <Icon size={14} className={highlight ? 'text-orange-200' : color} />}
      </div>
      <p className={`text-2xl font-bold leading-tight ${highlight ? 'text-white' : 'text-white'}`}>
        {formatted}
      </p>
      {subtitle && (
        <p className={`text-xs ${highlight ? 'text-orange-100' : 'text-gray-500'}`}>{subtitle}</p>
      )}
      {deltaEl}
    </div>
  );

  if (href) return <Link to={href} className="block h-full">{inner}</Link>;
  return inner;
}
