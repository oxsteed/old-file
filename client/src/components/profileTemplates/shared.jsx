// client/src/components/profileTemplates/shared.jsx
// Shared sub-components used across profile templates

import { Star, MapPin, Shield, CheckCircle, Clock, Phone, Globe, Users, Check, X, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** Star rating display */
export function StarRating({ rating = 0, size = 16, color = '#f59e0b' }) {
  const { t } = useTranslation();
  return (
    <span className="flex items-center gap-0.5" aria-label={t('profileTemplates.ratingStars', { count: rating.toFixed(1) })}>
      {[1,2,3,4,5].map(n => (
        <Star
          key={n}
          size={size}
          fill={n <= Math.round(rating) ? color : 'none'}
          stroke={color}
        />
      ))}
    </span>
  );
}

/** Avatar with fallback initials */
export function Avatar({ src, name = '', size = 80, className = '' }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        className={`rounded-full object-cover ${className}`}
        style={{ width: size, height: size, minWidth: size }}
        loading="lazy"
      />
    );
  }
  return (
    <div
      className={`rounded-full flex items-center justify-center font-bold select-none ${className}`}
      style={{ width: size, height: size, minWidth: size, fontSize: size * 0.36 }}
    >
      {initials || '?'}
    </div>
  );
}

/** Badge list */
export function BadgeList({ badges = [], badgeClass = '' }) {
  if (!badges.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {badges.map(b => (
        <span key={b.id} className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold ${badgeClass}`}>
          <Shield size={11} />
          {b.label}
        </span>
      ))}
    </div>
  );
}

/** Simple service card */
export function ServiceCard({ service, cardClass = '', priceClass = '' }) {
  const { t } = useTranslation();
  const priceStr = service.price
    ? `$${service.price.toFixed(2)}/${service.priceUnit || 'hr'}`
    : '';
  return (
    <div className={`rounded-xl p-4 ${cardClass}`}>
      <div className="flex justify-between items-start gap-2">
        <div>
          {service.popular && (
            <span className="text-xs font-bold text-orange-400 uppercase tracking-wide mb-1 block">{t('profileTemplates.popular')}</span>
          )}
          <h4 className="font-semibold text-sm leading-tight">{service.name}</h4>
          {service.description && <p className="text-xs mt-1 opacity-70 line-clamp-2">{service.description}</p>}
        </div>
        {priceStr && <span className={`text-sm font-bold whitespace-nowrap ${priceClass}`}>{priceStr}</span>}
      </div>
    </div>
  );
}

/** Gallery grid */
export function GalleryGrid({ gallery = [], cols = 3, rounded = 'rounded-xl' }) {
  if (!gallery.length) return null;
  return (
    <div className={`grid gap-2`} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {gallery.slice(0, cols * 2).map(img => (
        <div key={img.id} className={`aspect-square overflow-hidden ${rounded}`}>
          <img src={img.url} alt={img.alt} className="w-full h-full object-cover" loading="lazy" />
        </div>
      ))}
    </div>
  );
}

/** Review card */
export function ReviewCard({ review, cardClass = '' }) {
  return (
    <div className={`rounded-xl p-4 ${cardClass}`}>
      <div className="flex justify-between items-start mb-2">
        <span className="font-semibold text-sm">{review.authorName}</span>
        <StarRating rating={review.rating} size={12} />
      </div>
      <p className="text-xs opacity-75 line-clamp-3">{review.content}</p>
    </div>
  );
}

/** FAQ accordion */
export function FAQList({ faqs = [], itemClass = '', questionClass = '', answerClass = '' }) {
  if (!faqs.length) return null;
  return (
    <div className="space-y-2">
      {faqs.slice(0, 5).map(f => (
        <details key={f.id} className={`rounded-xl overflow-hidden ${itemClass}`}>
          <summary className={`cursor-pointer px-4 py-3 text-sm font-semibold list-none flex justify-between items-center ${questionClass}`}>
            {f.question}
            <span className="ml-2 text-lg leading-none select-none">+</span>
          </summary>
          <p className={`px-4 pb-3 text-sm ${answerClass}`}>{f.answer}</p>
        </details>
      ))}
    </div>
  );
}

/** Location chip */
export function LocationChip({ city, state, className = '' }) {
  if (!city && !state) return null;
  return (
    <span className={`flex items-center gap-1 text-sm ${className}`}>
      <MapPin size={13} />
      {[city, state].filter(Boolean).join(', ')}
    </span>
  );
}

/** Stats row */
export function StatsRow({ rating, reviewCount, jobsCompleted, statClass = '', labelClass = '' }) {
  const { t } = useTranslation();
  const stats = [
    { value: rating?.toFixed(1) ?? '—', label: t('profileTemplates.rating') },
    { value: reviewCount ?? 0, label: t('profileTemplates.reviews') },
    { value: jobsCompleted ?? 0, label: t('profileTemplates.jobsDone') },
  ];
  return (
    <div className="flex gap-6">
      {stats.map(s => (
        <div key={s.label} className="text-center">
          <div className={`text-xl font-black ${statClass}`}>{s.value}</div>
          <div className={`text-xs ${labelClass}`}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}

/** Contact row */
export function ContactRow({ phone, website, linkClass = '' }) {
  if (!phone && !website) return null;
  return (
    <div className="flex flex-wrap gap-3">
      {phone && (
        <a href={`tel:${phone}`} className={`flex items-center gap-1.5 text-sm ${linkClass}`}>
          <Phone size={13} />{phone}
        </a>
      )}
      {website && (
        <a href={website} target="_blank" rel="noopener noreferrer" className={`flex items-center gap-1.5 text-sm ${linkClass}`}>
          <Globe size={13} />{website.replace(/^https?:\/\//, '')}
        </a>
      )}
    </div>
  );
}

/** Section heading */
export function SectionHead({ children, className = '' }) {
  return <h3 className={`text-lg font-bold mb-4 ${className}`}>{children}</h3>;
}

/** Verified badge inline */
export function VerifiedBadge({ className = '' }) {
  const { t } = useTranslation();
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold ${className}`}>
      <CheckCircle size={12} />
      {t('profileTemplates.verified')}
    </span>
  );
}

// ── NEW PRIMITIVES ────────────────────────────────────────────────────────────

/** Single checklist row with check icon */
export function ChecklistRow({ children, checked = true, iconColor = '#22c55e', textClass = '' }) {
  return (
    <div className={`flex items-start gap-2 py-1 ${textClass}`}>
      {checked
        ? <Check size={14} style={{ color: iconColor, flexShrink: 0, marginTop: 2 }} />
        : <X size={14} style={{ color: '#ef4444', flexShrink: 0, marginTop: 2 }} />}
      <span className="text-sm leading-snug">{children}</span>
    </div>
  );
}

/** Horizontal service bar — full-width row with left accent */
export function HorizontalServiceBar({ service, accentColor = '#3b82f6', bgClass = '', textClass = '', priceClass = '' }) {
  const { t } = useTranslation();
  return (
    <div className={`flex justify-between items-center px-4 py-3 rounded-xl border-l-4 ${bgClass}`}
      style={{ borderLeftColor: accentColor }}>
      <div className="flex-1 min-w-0">
        {service.popular && <span className="text-xs font-bold uppercase tracking-wide opacity-60 block">{t('profileTemplates.popular')}</span>}
        <p className={`font-semibold text-sm ${textClass}`}>{service.name}</p>
        {service.description && <p className="text-xs opacity-60 mt-0.5 line-clamp-1">{service.description}</p>}
      </div>
      {service.price > 0 && (
        <span className={`ml-4 text-sm font-bold whitespace-nowrap ${priceClass}`}>
          ${service.price.toFixed(0)}/{service.priceUnit || 'hr'}
        </span>
      )}
    </div>
  );
}

/** Package / pricing tier card */
export function PackageCard({ title, price, priceUnit = 'session', features = [], highlighted = false, bgClass = '', titleClass = '', priceClass = '', featureClass = '' }) {
  return (
    <div className={`rounded-2xl p-5 flex flex-col ${highlighted ? 'ring-2' : ''} ${bgClass}`}>
      <p className={`text-xs font-bold uppercase tracking-widest mb-1 ${titleClass}`}>{title}</p>
      <div className={`text-3xl font-black mb-1 ${priceClass}`}>
        ${price}<span className="text-sm font-normal opacity-60">/{priceUnit}</span>
      </div>
      <div className="mt-3 space-y-1 flex-1">
        {features.map((f, i) => (
          <div key={i} className={`flex items-center gap-2 text-xs ${featureClass}`}>
            <Check size={11} style={{ flexShrink: 0, opacity: 0.7 }} />
            {f}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Specialty / skill chip pill */
export function SpecialtyPill({ label, pillClass = '' }) {
  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${pillClass}`}>
      {label}
    </span>
  );
}

/** Numbered process step */
export function ProcessStep({ number, title, description, numBg = '#3b82f6', textClass = '', descClass = '' }) {
  return (
    <div className="flex gap-3 items-start">
      <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-black text-white"
        style={{ background: numBg }}>
        {number}
      </div>
      <div>
        <p className={`font-semibold text-sm ${textClass}`}>{title}</p>
        {description && <p className={`text-xs mt-0.5 opacity-70 ${descClass}`}>{description}</p>}
      </div>
    </div>
  );
}

/** Italic block quote for testimonials */
export function QuoteBlock({ text, author, accentColor = '#d4af6a', textClass = '', authorClass = '' }) {
  return (
    <div className="pl-4" style={{ borderLeft: `3px solid ${accentColor}` }}>
      <p className={`italic text-sm leading-relaxed ${textClass}`}>"{text}"</p>
      {author && <p className={`text-xs mt-1.5 font-semibold ${authorClass}`}>— {author}</p>}
    </div>
  );
}

/** Credential / experience timeline item */
export function CredentialItem({ year, title, subtitle, dotColor = '#3b82f6', textClass = '', subClass = '' }) {
  return (
    <div className="flex gap-3 items-start">
      <div className="flex flex-col items-center">
        <div className="w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0" style={{ background: dotColor }} />
        <div className="w-px flex-1 mt-1 opacity-20" style={{ background: dotColor }} />
      </div>
      <div className="pb-4">
        {year && <span className="text-xs font-mono opacity-50">{year}</span>}
        <p className={`text-sm font-semibold leading-tight ${textClass}`}>{title}</p>
        {subtitle && <p className={`text-xs mt-0.5 opacity-60 ${subClass}`}>{subtitle}</p>}
      </div>
    </div>
  );
}

/** Single stat card (icon + number + label) */
export function StatCard({ value, label, icon: Icon, bgClass = '', valueClass = '', labelClass = '' }) {
  return (
    <div className={`rounded-xl p-4 text-center ${bgClass}`}>
      {Icon && <Icon size={20} className={`mx-auto mb-1 ${valueClass}`} />}
      <div className={`text-2xl font-black ${valueClass}`}>{value}</div>
      <div className={`text-xs ${labelClass}`}>{label}</div>
    </div>
  );
}

/** Masonry-style gallery (2-col with variable heights) */
export function MasonryGallery({ gallery = [], rounded = 'rounded-xl', maxItems = 6 }) {
  if (!gallery.length) return null;
  const items = gallery.slice(0, maxItems);
  return (
    <div className="columns-2 gap-2 space-y-2">
      {items.map((img, i) => (
        <div key={img.id} className={`overflow-hidden ${rounded} break-inside-avoid`}
          style={{ aspectRatio: i % 3 === 0 ? '1/1.3' : i % 3 === 1 ? '1/0.8' : '1/1' }}>
          <img src={img.url} alt={img.alt} className="w-full h-full object-cover" loading="lazy" />
        </div>
      ))}
    </div>
  );
}

/** Tech stack / tool chip (monospace) */
export function TechChip({ label, bgClass = '', textClass = '' }) {
  return (
    <span className={`font-mono text-xs px-2 py-1 rounded ${bgClass} ${textClass}`}>{label}</span>
  );
}
