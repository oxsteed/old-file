import React from 'react';

interface SectionCardProps {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  id?: string;
  /** Render an action in the header row */
  headerAction?: React.ReactNode;
}

const SectionCard: React.FC<SectionCardProps> = ({
  title,
  subtitle,
  children,
  className = '',
  id,
  headerAction,
}) => (
  <section
    id={id}
    aria-labelledby={id ? `${id}-heading` : undefined}
    className={`bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden ${className}`}
  >
    {(title || subtitle) && (
      <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 border-b border-gray-800">
        <div>
          {title && (
            <h2
              id={id ? `${id}-heading` : undefined}
              className="text-lg font-semibold text-white"
            >
              {title}
            </h2>
          )}
          {subtitle && <p className="text-sm text-gray-400 mt-0.5">{subtitle}</p>}
        </div>
        {headerAction && <div className="flex-shrink-0">{headerAction}</div>}
      </div>
    )}
    <div className="px-6 py-5">{children}</div>
  </section>
);

export default SectionCard;
