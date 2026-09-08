import React, { useState, useEffect } from 'react';
import { QrCode, Download, Share2 } from 'lucide-react';
import './ProfileHeader.css';
import { useTranslation } from 'react-i18next';

/**
 * ProfileHeader Component
 *
 * Displays the helper profile cover image with QR code overlay in the top-right corner.
 * Shows QR code on hover with download and share options.
 */
export default function ProfileHeader({ helperId, helperName, coverImageUrl }) {
  const { t } = useTranslation();
  const [showQRCode, setShowQRCode] = useState(false);
  const [qrCode, setQRCode] = useState(null);
  const [qrLoading, setQRLoading] = useState(false);

  // Load QR code when hovering over profile header
  const handleMouseEnter = () => {
    setShowQRCode(true);
    if (!qrCode && !qrLoading) {
      loadQRCode();
    }
  };

  const loadQRCode = async () => {
    setQRLoading(true);
    try {
      const response = await fetch(
        `/api/helper-profile/${helperId}/qr-code?size=small&format=dataurl`
      );

      if (response.ok) {
        const data = await response.json();
        setQRCode(data.data.qrCode);
      }
    } catch (err) {
      console.error('Failed to load QR code:', err);
    } finally {
      setQRLoading(false);
    }
  };

  const handleQRDownload = async (e) => {
    e.stopPropagation();
    try {
      const response = await fetch(
        `/api/helper-profile/${helperId}/qr-code?size=medium&format=buffer`
      );

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${helperName || t('profileHeader.profileFilenamePrefix')}-qr-code.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('Failed to download QR code:', err);
    }
  };

  const handleQRShare = (e) => {
    e.stopPropagation();
    const profileUrl = `${window.location.origin}/helpers/public/${helperId}`;

    if (navigator.share) {
      navigator.share({
        title: t('profileHeader.shareTitle', { name: helperName || '' }),
        text: t('profileHeader.shareText'),
        url: profileUrl
      }).catch(err => console.error('Share failed:', err));
    } else {
      // Fallback: copy to clipboard
      navigator.clipboard.writeText(profileUrl);
    }
  };

  return (
    <div
      className="profile-header"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setShowQRCode(false)}
    >
      {/* Cover Image */}
      {coverImageUrl ? (
        <img
          src={coverImageUrl}
          alt={t('profileHeader.profileCover')}
          className="profile-header-image"
        />
      ) : (
        <div className="profile-header-placeholder">
          <div className="placeholder-content">
            <span>{t('profileHeader.noCoverImage')}</span>
          </div>
        </div>
      )}

      {/* QR Code Overlay (Top Right Corner) */}
      <div className={`profile-qr-overlay ${showQRCode ? 'visible' : ''}`}>
        {qrLoading && (
          <div className="profile-qr-loading">
            <div className="spinner"></div>
          </div>
        )}

        {qrCode && !qrLoading && (
          <div className="profile-qr-content">
            <img
              src={qrCode}
              alt="Profile QR code"
              className="profile-qr-image"
            />

            <div className="profile-qr-actions">
              <button
                onClick={handleQRDownload}
                className="profile-qr-action-btn"
              title={t('profileHeader.downloadQr')}
            >
                <Download size={16} />
              </button>
              <button
                onClick={handleQRShare}
                className="profile-qr-action-btn"
              title={t('profileHeader.shareProfile')}
            >
                <Share2 size={16} />
              </button>
            </div>
          </div>
        )}

        {!qrCode && !qrLoading && (
          <div className="profile-qr-placeholder">
            <QrCode size={24} />
          </div>
        )}
      </div>

      {/* QR Code Badge (Always Visible) */}
      <div className="profile-qr-badge">
        <QrCode size={16} />
      </div>
    </div>
  );
}
