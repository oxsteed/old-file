import React from 'react';
import {
  CalendarX,
  CreditCard,
  ShieldCheck,
  Shield,
  FileText,
} from 'lucide-react';
import type { Policy } from '../../types/helperProfile';
import SectionCard from './ui/SectionCard';

interface PoliciesSectionProps {
  policies: Policy[];
}

const iconMap: Record<string, React.ElementType> = {
  'calendar-x': CalendarX,
  'credit-card': CreditCard,
  'shield-check': ShieldCheck,
  shield: Shield,
};

const PoliciesSection: React.FC<PoliciesSectionProps> = ({ policies }) => (
  <SectionCard id="policies" title="Policies">
    <dl className="space-y-4">
      {policies.map((policy) => {
        const Icon = iconMap[policy.icon] ?? FileText;
        return (
          <div
            key={policy.id}
            className="flex gap-3 p-4 rounded-xl bg-gray-800/50 border border-gray-700/50"
          >
            <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-gray-700/80 flex items-center justify-center mt-0.5">
              <Icon className="w-4 h-4 text-brand-400" aria-hidden="true" />
            </div>
            <div>
              <dt className="text-sm font-semibold text-white">{policy.title}</dt>
              <dd className="text-sm text-gray-400 mt-1 leading-relaxed">{policy.content}</dd>
            </div>
          </div>
        );
      })}
    </dl>
  </SectionCard>
);

export default PoliciesSection;
