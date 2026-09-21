import { useTranslation } from 'react-i18next';
import PublicProfileSummaryCard from '../publicProfile/PublicProfileSummaryCard';
import {
  buildBusinessStudioSummaryModel,
  buildHelperStudioSummaryModel,
} from '../../utils/profileStudio';
import '../../styles/ProfileStudio.css';

/**
 * Profile Studio live preview — composes the shared PublicProfileSummaryCard
 * (same presentation as public helper/business profile pages) plus Studio chrome.
 *
 * variant: 'business' | 'helper'
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

  const model = variant === 'helper'
    ? buildHelperStudioSummaryModel({
      coverImageUrl: cover,
      avatar,
      name,
      core: {
        profile_headline: tagline,
        bio_long: about,
        is_available_now: availableNow,
      },
      meta,
    })
    : buildBusinessStudioSummaryModel({
      cover,
      avatar,
      name,
      tagline,
      typeLabel,
      meta,
      contact,
      about,
    });

  const footer = publicHref ? (
    <a
      className="ppc-link"
      href={publicHref}
      target="_blank"
      rel="noopener noreferrer"
    >
      {publicLabel || t('profileStudio.viewPublic')}
    </a>
  ) : null;

  return (
    <div className="ppc-wrap" aria-label={t('profileStudio.previewLabel')}>
      <div className="ppc-studio-chrome">
        <span className="ppc-kicker">{t('profileStudio.previewLabel')}</span>
      </div>
      <PublicProfileSummaryCard
        {...model}
        surface="studio"
        emptyName={t('profileStudio.previewEmptyName')}
        emptyTagline={t('profileStudio.previewEmptyTagline')}
        emptyPlace={t('profileStudio.previewEmptyPlace')}
        availableNowLabel={t('profileStudio.availableNow')}
        notAvailableNowLabel={t('profileStudio.notAvailableNow')}
        ariaLabel={t('profileStudio.previewLabel')}
        footer={footer}
      />
    </div>
  );
}
