import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
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
      id={`faq-btn-${faq.id}`}
      onClick={onToggle}
      className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left bg-gray-800/40 hover:bg-gray-800/70 transition-colors"
      aria-expanded={isOpen}
      aria-controls={`faq-body-${faq.id}`}
    >
      <span className="text-sm font-medium text-white">{faq.question}</span>
      <ChevronDown
        className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform duration-300 ${
          isOpen ? 'rotate-180' : ''
        }`}
        aria-hidden="true"
      />
    </button>

    {/*
      Animate height via CSS grid-template-rows: 0fr → 1fr.
      The inner wrapper needs min-h-0 so the grid can actually collapse it.
    */}
    <div
      id={`faq-body-${faq.id}`}
      role="region"
      aria-labelledby={`faq-btn-${faq.id}`}
      className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
        isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
      }`}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="px-4 py-3.5 bg-gray-900/50 border-t border-gray-700/50">
          <p className="text-sm text-gray-300 leading-relaxed">{faq.answer}</p>
        </div>
      </div>
    </div>
  </div>
);

const FAQSection: React.FC<FAQSectionProps> = ({ faqs }) => {
  // All items collapsed by default — users reveal on demand.
  const [openId, setOpenId] = useState<string | null>(null);

  if (!faqs || faqs.length === 0) return null;

  // Single-item accordion: opening one closes whichever was open.
  const toggle = (id: string) => setOpenId((cur) => (cur === id ? null : id));

  return (
    <SectionCard id="faqs" title="Frequently Asked Questions">
      <div className="space-y-2">
        {faqs.map((faq) => (
          <FAQItem
            key={faq.id}
            faq={faq}
            isOpen={openId === faq.id}
            onToggle={() => toggle(faq.id)}
          />
        ))}
      </div>
    </SectionCard>
  );
};

export default FAQSection;
