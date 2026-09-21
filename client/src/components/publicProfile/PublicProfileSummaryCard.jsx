import { publicProfileSummaryCardClassName } from '../../utils/profileStudio';
import '../../styles/PublicProfileSummaryCard.css';

/**
 * Pure presentational public-profile summary.
 * Shared by public helper/business pages, Profile Studio preview,
 * and full guarded profile pages (via PublicProfileHero).
 * No routing or data loading — pass slots for page chrome:
 * `coverOverlay`, `actions` (identity-band CTAs beside/under title),
 * `belowTitle`, `footer`.
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
  coverOverlay = null,
  actions = null,
  belowTitle = null,
  footer = null,
  className = '',
}) {
  const initial = String(name || '').trim().slice(0, 1).toUpperCase() || '·';
  const classes = publicProfileSummaryCardClassName({ variant, surface, className });

  return (
    <article className={classes} aria-label={ariaLabel || undefined}>
      <div className="ppsc-cover">
        {cover ? <img src={cover} alt="" /> : null}
        {coverOverlay ? <div className="ppsc-cover-overlay">{coverOverlay}</div> : null}
      </div>
      <div className="ppsc-body">
        <div className={`ppsc-avatar${variant === 'helper' ? ' round' : ''}`}>
          {avatar ? <img src={avatar} alt="" /> : initial}
        </div>
        <div className="ppsc-title-row">
          <div className="ppsc-title-block">
            <h3 className={`ppsc-name${name ? '' : ' ppsc-muted'}`}>
              {name || emptyName}
            </h3>
            {typeLabel ? <span className="ppsc-type">{typeLabel}</span> : null}
            {belowTitle ? <div className="ppsc-below-title">{belowTitle}</div> : null}
          </div>
          {actions ? <div className="ppsc-actions">{actions}</div> : null}
        </div>
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
