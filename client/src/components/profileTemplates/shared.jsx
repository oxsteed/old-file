// client/src/components/profileTemplates/shared.jsx
// Shared sub-components used across profile templates

import { Star, MapPin, Shield, CheckCircle, Clock, Phone, Globe, Users } from 'lucide-react';

/** Star rating display */
export function StarRating({ rating = 0, size = 16, color = '#f59e0b' }) {
  return (
    <span className="flex items-center gap-0.5" aria-label={`${rating.toFixed(1)} stars`}>
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
  const priceStr = service.price
    ? `$${service.price.toFixed(2)}/${service.priceUnit || 'hr'}`
    : '';
  return (
    <div className={`rounded-xl p-4 ${cardClass}`}>
      <div className="flex justify-between items-start gap-2">
        <div>
          {service.popular && (
            <span className="text-xs font-bold text-orange-400 uppercase tracking-wide mb-1 block">Popular</span>
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
  const stats = [
    { value: rating?.toFixed(1) ?? '—', label: 'Rating' },
    { value: reviewCount ?? 0, label: 'Reviews' },
    { value: jobsCompleted ?? 0, label: 'Jobs Done' },
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
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold ${className}`}>
      <CheckCircle size={12} />
      Verified
    </span>
  );
}
