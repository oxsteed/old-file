import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { FAQ } from '../../types/helperProfile';
import SectionCard from './ui/SectionCard';

interface FAQSectionProps {
  faqs: FAQ[];
}

const FAQItem: React.FC<{ faq: FAQ; isOpen: boolean; onToggle: () => void }> = ({
  faq,
  isOpen,
  onToggle,
}) => (
  <div className="border border-gray-700/50 rounded-xl overflow-hidden">
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left bg-gray-800/40 hover:bg-gray-800/70 transition-colors"
      aria-expanded={isOpen}
      aria-controls={`faq-body-${faq.id}`}
    >
      <span className="text-sm font-medium text-white">{faq.question}</span>
      {isOpen ? (
        <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" aria-hidden="true" />
      ) : (
        <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" aria-hidden="true" />
      )}
    </button>

    {isOpen && (
      <div
        id={`faq-body-${faq.id}`}
        className="px-4 py-3.5 bg-gray-900/50 border-t border-gray-700/50"
        role="region"
      >
        <p className="text-sm text-gray-300 leading-relaxed">{faq.answer}</p>
      </div>
    )}
  </div>
);

const FAQSection: React.FC<FAQSectionProps> = ({ faqs }) => {
  const [openId, setOpenId] = useState<string | null>(faqs[0]?.id ?? null);

  // Don't render section if there's nothing to show
  if (!faqs || faqs.length === 0) return null;

  const toggle = (id: string) => setOpenId((cur) => (cur === id ? null : id));

  return (
    <SectionCard id="faqs" title="Frequently Asked Questions">
      <div className="space-y-2" role="list" aria-label="Frequently asked questions">
        {faqs.map((faq) => (
          <div key={faq.id} role="listitem">
            <FAQItem
              faq={faq}
              isOpen={openId === faq.id}
              onToggle={() => toggle(faq.id)}
            />
          </div>
        ))}
      </div>
    </SectionCard>
  );
};

export default FAQSection;
