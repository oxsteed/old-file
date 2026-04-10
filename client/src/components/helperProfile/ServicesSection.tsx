import React from 'react';
import { Flame, Clock, ChevronRight } from 'lucide-react';
import type { Service, PriceUnit } from '../../types/helperProfile';
import SectionCard from './ui/SectionCard';

interface ServicesSectionProps {
  services: Service[];
  onSelectService?: (service: Service) => void;
}

function formatPrice(price: number, unit: PriceUnit): string {
  if (unit === 'quote') return 'Get a quote';
  const formatted = price.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });
  switch (unit) {
    case 'hour':      return `${formatted}/hr`;
    case 'flat':      return formatted;
    case 'starting_at': return `From ${formatted}`;
    default:          return formatted;
  }
}

const categoryOrder = ['Landscaping', 'Cleaning', 'Painting', 'Home Repair'];

const ServicesSection: React.FC<ServicesSectionProps> = ({ services, onSelectService }) => {
  if (!services || services.length === 0) {
    return (
      <SectionCard
        id="services"
        title="Services & Pricing"
        subtitle="All prices include labor. Materials billed separately if required."
      >
        <div className="py-6 text-center">
          <p className="text-sm text-gray-500">This helper hasn't listed their services yet.</p>
          <p className="text-xs text-gray-600 mt-1">Send them a message to ask about what they offer.</p>
        </div>
      </SectionCard>
    );
  }

  const grouped = categoryOrder.reduce<Record<string, Service[]>>((acc, cat) => {
    const items = services.filter((s) => s.category === cat);
    if (items.length) acc[cat] = items;
    return acc;
  }, {});

  // Catch any categories not in the ordered list
  services.forEach((s) => {
    if (!grouped[s.category]) {
      grouped[s.category] = [];
    }
    if (!grouped[s.category].includes(s)) {
      grouped[s.category].push(s);
    }
  });

  return (
    <SectionCard
      id="services"
      title="Services & Pricing"
      subtitle="All prices include labor. Materials billed separately if required."
    >
      <div className="space-y-6">
        {Object.entries(grouped).map(([category, items]) => (
          <div key={category}>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              {category}
            </p>
            <ul className="space-y-2" role="list" aria-label={`${category} services`}>
              {items.map((service) => (
                <li key={service.id}>
                  <button
                    onClick={() => onSelectService?.(service)}
                    className="w-full text-left group flex items-start gap-3 p-4 rounded-xl bg-gray-800/50 hover:bg-gray-800 border border-gray-700/50 hover:border-gray-600 transition-all"
                    aria-label={`${service.name} — ${formatPrice(service.price, service.priceUnit)}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-white text-sm">{service.name}</span>
                        {service.popular && (
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 bg-orange-900/40 text-orange-400 border border-orange-800 rounded-full text-xs font-medium"
                            aria-label="Popular service"
                          >
                            <Flame className="w-3 h-3" aria-hidden="true" />
                            Popular
                          </span>
                        )}
                      </div>
                      <p className="text-gray-400 text-xs mt-1 leading-relaxed">
                        {service.description}
                      </p>
                      {service.duration && (
                        <span className="inline-flex items-center gap-1 text-xs text-gray-500 mt-1.5">
                          <Clock className="w-3 h-3" aria-hidden="true" />
                          {service.duration}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 pt-0.5">
                      <span
                        className={`text-sm font-semibold whitespace-nowrap ${
                          service.priceUnit === 'quote' ? 'text-brand-400' : 'text-white'
                        }`}
                      >
                        {formatPrice(service.price, service.priceUnit)}
                      </span>
                      <ChevronRight
                        className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors"
                        aria-hidden="true"
                      />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </SectionCard>
  );
};

export default ServicesSection;
