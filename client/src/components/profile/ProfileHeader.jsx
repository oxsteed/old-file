import React from 'react';
import './ProfileHeader.css';
import { useTranslation } from 'react-i18next';

/**
 * ProfileHeader Component
 *
 * Displays the business profile cover image. When there is no cover photo,
 * renders a compact branded band instead of a tall empty placeholder.
 * (QR sharing lives behind the Share controls on the page, not on the hero.)
 */
export default function ProfileHeader({ coverImageUrl }) {
  const { t } = useTranslation();

  return (
    <div className={`profile-header${coverImageUrl ? '' : ' profile-header--compact'}`}>
      {/* Cover Image */}
      {coverImageUrl ? (
        <img
          src={coverImageUrl}
          alt={t('profileHeader.profileCover')}
          className="profile-header-image"
        />
      ) : (
        <div className="profile-header-placeholder" aria-hidden="true" />
      )}
    </div>
  );
}
