import '../../styles/PublicProfileSummaryCard.css';

/**
 * Pure presentational public-profile summary.
 * Shared by public helper/business pages and Profile Studio preview.
 * No routing, data loading, or CTAs — pass `footer` for page-specific actions.
 *
 * @param {'helper'|'business'} variant
 * @param {'studio'|'public'} surface — studio = dark preview chrome; public = CSS-var theme
 */
export default function PublicProfileSummaryCard({
  variant = 'helper',
  surface = 'public',
  cover = null,
  avatar = null,
  name = '',
  tagline = '',
  typeLabel = '',
  meta = '',
  contact = '',
  about = '',
  availableNow = null,
  ratingLabel = '',
  emptyName = '',
  emptyTagline = '',
  emptyPlace = '',
  availableNowLabel = '',
  notAvailableNowLabel = '',
  ariaLabel = '',
  footer = null,
  className = '',
}) {
  const initial = String(name || '').trim().slice(0, 1).toUpperCase() || '·';
  const classes = [
    'ppsc',
    `ppsc-${variant}`,
    surface === 'studio' ? 'ppsc--studio' : 'ppsc--public',
    className,
  ].filter(Boolean).join(' ');

  return (
    <article className={classes} aria-label={ariaLabel || undefined}>
      <div className="ppsc-cover">
        {cover ? <img src={cover} alt="" /> : null}
      </div>
      <div className="ppsc-body">
        <div className={`ppsc-avatar${variant === 'helper' ? ' round' : ''}`}>
          {avatar ? <img src={avatar} alt="" /> : initial}
        </div>
        <h3 className={`ppsc-name${name ? '' : ' ppsc-muted'}`}>
          {name || emptyName}
        </h3>
        {typeLabel ? <span className="ppsc-type">{typeLabel}</span> : null}
        <p className={`ppsc-tagline${tagline ? '' : ' ppsc-muted'}`}>
          {tagline || emptyTagline}
        </p>
        {ratingLabel ? <p className="ppsc-rating">{ratingLabel}</p> : null}
        <p className={`ppsc-meta${meta ? '' : ' ppsc-muted'}`}>
          {meta || emptyPlace}
        </p>
        {contact ? <p className="ppsc-contact">{contact}</p> : null}
        {variant === 'helper' && availableNow != null ? (
          <p className={`ppsc-avail${availableNow ? '' : ' off'}`}>
            {availableNow ? availableNowLabel : notAvailableNowLabel}
          </p>
        ) : null}
        {about ? <p className="ppsc-about">{about}</p> : null}
        {footer ? <div className="ppsc-footer">{footer}</div> : null}
      </div>
    </article>
  );
}
