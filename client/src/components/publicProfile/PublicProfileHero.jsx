import PublicProfileSummaryCard from './PublicProfileSummaryCard';
import '../../styles/PublicProfileHero.css';

/**
 * Full-page public profile identity band.
 * Composes PublicProfileSummaryCard (shared with Studio + /public pages)
 * plus slots for page-only chrome: cover accessory (QR), actions (CTA near
 * the title band), belowTitle, and children (badges, stats, share).
 */
export default function PublicProfileHero({
  summary = {},
  surface = 'public',
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
  children = null,
  className = '',
}) {
  const classes = ['pph', className].filter(Boolean).join(' ');

  return (
    <header className={classes}>
      <PublicProfileSummaryCard
        {...summary}
        surface={surface}
        emptyName={emptyName}
        emptyTagline={emptyTagline}
        emptyPlace={emptyPlace}
        availableNowLabel={availableNowLabel}
        notAvailableNowLabel={notAvailableNowLabel}
        ariaLabel={ariaLabel}
        coverOverlay={coverOverlay}
        actions={actions}
        belowTitle={belowTitle}
        footer={footer}
        className="ppsc--page"
      />
      {children ? <div className="pph-extra">{children}</div> : null}
    </header>
  );
}
