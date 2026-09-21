import { useTranslation } from 'react-i18next';
import '../../styles/ProfileStudio.css';

/**
 * Compact live public-card preview.
 *
 * variant: 'business' | 'helper'
 * cover, avatar, name, tagline, typeLabel?, meta?, contact?, about?,
 * availableNow?, publicHref?, publicLabel?
 */
export default function ProfilePreviewCard({
  variant = 'business',
  cover = null,
  avatar = null,
  name = '',
  tagline = '',
  typeLabel = '',
  meta = '',
  contact = '',
  about = '',
  availableNow = null,
  publicHref = '',
  publicLabel = '',
}) {
  const { t } = useTranslation();
  const emptyName = t('profileStudio.previewEmptyName');
  const emptyTagline = t('profileStudio.previewEmptyTagline');
  const emptyPlace = t('profileStudio.previewEmptyPlace');
  const initial = String(name || '').trim().slice(0, 1).toUpperCase() || '·';

  return (
    <article
      className={`ppc ppc-${variant}`}
      aria-label={t('profileStudio.previewLabel')}
    >
      <div className="ppc-cover">
        <span className="ppc-kicker">{t('profileStudio.previewLabel')}</span>
        {cover ? <img src={cover} alt="" /> : null}
      </div>
      <div className="ppc-body">
        <div className={`ppc-avatar${variant === 'helper' ? ' round' : ''}`}>
          {avatar
            ? <img src={avatar} alt="" />
            : initial}
        </div>
        <h3 className={`ppc-name${name ? '' : ' ppc-muted'}`}>
          {name || emptyName}
        </h3>
        {typeLabel ? <span className="ppc-type">{typeLabel}</span> : null}
        <p className={`ppc-tagline${tagline ? '' : ' ppc-muted'}`}>
          {tagline || emptyTagline}
        </p>
        <p className={`ppc-meta${meta ? '' : ' ppc-muted'}`}>
          {meta || emptyPlace}
        </p>
        {contact ? <p className="ppc-contact">{contact}</p> : null}
        {variant === 'helper' && availableNow != null ? (
          <p className={`ppc-avail${availableNow ? '' : ' off'}`}>
            {availableNow
              ? t('profileStudio.availableNow')
              : t('profileStudio.notAvailableNow')}
          </p>
        ) : null}
        {about ? <p className="ppc-about">{about}</p> : null}
        {publicHref ? (
          <a
            className="ppc-link"
            href={publicHref}
            target="_blank"
            rel="noopener noreferrer"
          >
            {publicLabel || t('profileStudio.viewPublic')}
          </a>
        ) : null}
      </div>
    </article>
  );
}
