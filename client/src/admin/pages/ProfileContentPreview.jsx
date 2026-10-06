import { useTranslation } from 'react-i18next';

// Intentionally read-only: no public-page effects, booking, cart, payment,
// messaging, or tracking. Text is rendered by React, never injected as HTML.
function imageUrl(value) {
  if (!value || typeof value !== 'string') return undefined;
  try {
    const url = new URL(value, window.location.origin);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined;
  } catch { return undefined; }
}

const panel = { padding: '1rem', border: '1px solid var(--color-border)', borderRadius: '8px', marginTop: '1rem' };
const text = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };
const list = (value) => Array.isArray(value) ? value : [];

function Photo({ url, alt }) {
  const src = imageUrl(url);
  return src ? <img src={src} alt={alt || ''} loading="lazy" referrerPolicy="no-referrer"
    style={{ maxWidth: '100%', maxHeight: '240px', objectFit: 'contain', borderRadius: '6px' }} /> : null;
}

function Section({ title, children }) {
  return <section style={panel}><h3>{title}</h3>{children}</section>;
}

export default function ProfileContentPreview({ content, profileType, copy }) {
  const { i18n } = useTranslation();
  const money = (value, currency) => {
    const minor = Number(value);
    try {
      const formatter = new Intl.NumberFormat(i18n?.language, { style: 'currency', currency });
      const digits = formatter.resolvedOptions().maximumFractionDigits;
      if (value != null && Number.isSafeInteger(minor)) return formatter.format(minor / (10 ** digits));
    } catch { /* Invalid currency metadata must not crash a moderation preview. */ }
    return `${value ?? ''} ${currency || ''} (${copy('previewMinorUnits')})`;
  };
  const profile = content.helper || content.business || content.restaurant;
  if (!profile) return <p role="alert">{copy('previewUnavailable')}</p>;
  const name = profile.businessName || profile.business_name || profile.display_name;
  const city = profile.city || profile.address_city;
  const state = profile.state || profile.address_state;
  const hours = list(content.hours);
  const restaurantHours = profile.operating_hours?.weekly || profile.operating_hours;
  const menu = [...list(content.menu), ...(list(content.uncategorizedItems).length
    ? [{ id: 'other', name: copy('previewMenuOther'), items: content.uncategorizedItems }] : [])];
  const labels = profileType === 'restaurant' ? {} : {
    services: copy('previewServices'), gallery: copy('previewGallery'),
    faqs: copy('previewFaqs'), policies: copy('previewPolicies'),
  };
  return <div data-testid="pv-preview-content" style={{ color: 'var(--color-text)', ...text }}>
    <p role="note" style={panel}>{copy('previewReadOnly')}</p>
    <header style={panel}>
      <Photo url={profile.coverImage || profile.cover_photo_url} alt="" />
      <div><Photo url={profile.avatar || profile.logo_url} alt={name} /></div>
      <h2>{name}</h2>
      <p>{profile.tagline || profile.profile_headline}</p>
      <p>{[city, state, profile.address_country].filter(Boolean).join(', ')}</p>
      <p>{profile.bio || profile.description}</p>
      <p>{copy('previewRating')}: {profile.rating ?? profile.avg_rating ?? 0} ({profile.reviewCount ?? profile.total_reviews ?? profile.review_count ?? 0})</p>
      {profile.website && <p>{profile.website}</p>}
      {profile.phone && <p>{profile.phone}</p>}
      {list(profile.categories).length > 0 && <p>{profile.categories.join(', ')}</p>}
      {list(profile.cuisine_tags).length > 0 && <p>{profile.cuisine_tags.join(', ')}</p>}
      {list(profile.badges).map(badge => <span key={badge.id} style={{ marginInlineEnd: '1rem' }}>{badge.label}</span>)}
    </header>
    {Object.entries(labels).map(([key, title]) => <Section key={key} title={title}>
      {content.visibility?.[key] === false && <p>{copy('previewSectionUnlisted')}</p>}
      {list(content[key]).length === 0 ? <p>{copy('previewEmpty')}</p> : list(content[key]).map((item, index) =>
        <article key={item.id ?? index} style={{ marginBlock: '1rem' }}>
          {key === 'gallery' ? <><Photo url={item.url} alt={item.alt || item.caption} /><p>{item.caption}</p></>
            : <><h4>{item.name || item.question || item.title}</h4>
              <p>{item.description || item.answer || item.content}</p>
              {key === 'services' && item.price != null && <p>{copy('previewPrice')}: {item.price} {item.price_unit || item.priceUnit}</p>}
            </>}
        </article>)}
    </Section>)}
    <Section title={copy('previewHours')}>
      {hours.length ? hours.map((hour, index) => <p key={hour.day ?? hour.day_of_week ?? index}>
        {hour.day ?? hour.day_of_week}: {hour.closed || hour.is_closed ? copy('previewClosed')
          : `${hour.open || hour.start_time || ''} - ${hour.close || hour.end_time || ''}`}
      </p>) : restaurantHours && typeof restaurantHours === 'object'
        ? Object.entries(restaurantHours).map(([day, value]) => <p key={day}>{day}: {typeof value === 'object' && value
          ? value.closed ? copy('previewClosed') : `${value.open || ''} - ${value.close || ''}` : String(value ?? '')}</p>)
        : <p>{copy('previewEmpty')}</p>}
      {profile.timezone && <p>{profile.timezone}</p>}
    </Section>
    {profileType === 'restaurant' && <Section title={copy('previewMenu')}>
      {!menu.length && <p>{copy('previewEmpty')}</p>}
      {menu.map(category => <div key={category.id}>
        <h4>{category.name}</h4><p>{category.description}</p>
        {list(category.items).map(item => <article key={item.id} style={panel}>
          <Photo url={item.image_url} alt={item.name} /><h4>{item.name}</h4><p>{item.description}</p>
          <p>{copy('previewPrice')}: {money(item.price_cents, item.currency_code || profile.currency_code)}</p>
          {item.is_available === false && <p>{copy('previewUnavailableItem')}</p>}
          {list(item.allergens).length > 0 && <p>{copy('previewAllergens')}: {item.allergens.join(', ')}</p>}
          {list(item.tags).length > 0 && <p>{item.tags.join(', ')}</p>}
          {list(item.modifierGroups).map(group => <div key={group.id}><h5>{group.name}</h5>
            {list(group.options).map(option => <p key={option.id}>{option.name}: {money(option.priceDeltaCents, item.currency_code || profile.currency_code)}</p>)}
          </div>)}
        </article>)}
      </div>)}
    </Section>}
    {profileType !== 'restaurant' && <Section title={copy('previewReviews')}>
      {list(content.reviews).length === 0 ? <p>{copy('previewEmpty')}</p>
        : list(content.reviews).map(review => <article key={review.id} style={panel}>
          <h4>{review.authorName || [review.first_name, review.last_name].filter(Boolean).join(' ')}</h4>
          <p>{copy('previewRating')}: {review.rating}</p><p>{review.content || review.comment}</p>
          {(review.response || review.helperReply?.content) && <p>{review.response || review.helperReply.content}</p>}
        </article>)}
    </Section>}
    {profileType === 'business' && <Section title={copy('previewTeam')}>
      {list(content.team).length === 0 ? <p>{copy('previewEmpty')}</p>
        : list(content.team).map((member, index) => <p key={index}>{member.first_name} {member.last_name} - {member.role}</p>)}
    </Section>}
  </div>;
}
