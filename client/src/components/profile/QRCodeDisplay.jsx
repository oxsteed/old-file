import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Copy, Share2, AlertCircle, Loader } from 'lucide-react';
import './QRCodeDisplay.css';

/**
 * QRCodeDisplay Component
 *
 * Displays a QR code that points to the helper's public profile page.
 * QR codes are generated on-the-fly (not stored).
 * Supports download, copy, and share functionality.
 */
export default function QRCodeDisplay({ helperId, helperName }) {
  const { t } = useTranslation();

  const [qrCode, setQRCode] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [size, setSize] = useState('medium'); // small, medium, large
  const [copied, setCopied] = useState(false);
  const [downloadFormat, setDownloadFormat] = useState('png'); // png or svg

  // Generate QR code on mount and when size changes
  useEffect(() => {
    generateQRCode();
  }, [helperId, size]);

  const generateQRCode = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/helper-profile/${helperId}/qr-code?size=${size}&format=dataurl`
      );

      if (!response.ok) {
        throw new Error('Failed to generate QR code');
      }

      const data = await response.json();
      const image = data.data?.qr_code || data.data?.qrCode;
      if (!image) throw new Error(t('profile.qrCode.generationFailed'));
      setQRCode(image);
    } catch (err) {
      setError(err.message || t('profile.qrCode.generationFailed'));
      console.error('QR code generation error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    try {
      const response = await fetch(
        `/api/helper-profile/${helperId}/qr-code?size=${size}&format=png`
      );

      if (!response.ok) {
        throw new Error('Failed to download QR code');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${helperName || 'profile'}-qr-code.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || t('profile.qrCode.downloadFailed'));
    }
  };

  const handleCopyLink = async () => {
    try {
      const profileUrl = `${window.location.origin}/helpers/public/${helperId}`;
      await navigator.clipboard.writeText(profileUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError('Failed to copy link');
    }
  };

  const handleShare = async () => {
    const profileUrl = `${window.location.origin}/helpers/public/${helperId}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: t('profile.qrCode.shareTitle', { name: helperName }),
          text: t('profile.qrCode.shareText'),
          url: profileUrl
        });
      } catch (err) {
        if (err.name !== 'AbortError') {
          setError(err.message);
        }
      }
    } else {
      // Fallback: copy to clipboard
      handleCopyLink();
    }
  };

  const sizeOptions = {
    small: { label: t('profile.qrCode.sizeSmall'), px: 150 },
    medium: { label: t('profile.qrCode.sizeMedium'), px: 300 },
    large: { label: t('profile.qrCode.sizeLarge'), px: 500 }
  };

  return (
    <div className="qr-code-display">
      <div className="qr-code-header">
        <h3>{t('profile.qrCode.title')}</h3>
        <p className="qr-code-subtitle">{t('profile.qrCode.subtitle')}</p>
      </div>

      {/* QR Code Container */}
      <div className="qr-code-container">
        {loading && (
          <div className="qr-code-loading">
            <Loader size={32} className="spinner" />
            <p>{t('profile.qrCode.generating')}</p>
          </div>
        )}

        {error && (
          <div className="qr-code-error">
            <AlertCircle size={24} />
            <p>{error}</p>
            <button onClick={generateQRCode} className="qr-code-retry">
              {t('common.retry')}
            </button>
          </div>
        )}

        {qrCode && !loading && (
          <div className="qr-code-image-wrapper">
            <img
              src={qrCode}
              alt="QR Code"
              className="qr-code-image"
              style={{ width: `${sizeOptions[size].px}px` }}
            />
          </div>
        )}
      </div>

      {/* Size Selector */}
      {!loading && !error && (
        <div className="qr-code-size-selector">
          <label>{t('profile.qrCode.selectSize')}:</label>
          <div className="qr-code-size-options">
            {Object.entries(sizeOptions).map(([key, option]) => (
              <button
                key={key}
                onClick={() => setSize(key)}
                className={`qr-code-size-btn ${size === key ? 'active' : ''}`}
              >
                {option.label}
                <span className="qr-code-size-px">({option.px}px)</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      {!loading && !error && (
        <div className="qr-code-actions">
          <button
            onClick={handleDownload}
            className="qr-code-btn qr-code-btn-primary"
            title={t('profile.qrCode.downloadTooltip')}
          >
            <Download size={18} />
            {t('profile.qrCode.download')}
          </button>

          <button
            onClick={handleCopyLink}
            className={`qr-code-btn ${copied ? 'success' : ''}`}
            title={t('profile.qrCode.copyLinkTooltip')}
          >
            <Copy size={18} />
            {copied ? t('profile.qrCode.copied') : t('profile.qrCode.copyLink')}
          </button>

          <button
            onClick={handleShare}
            className="qr-code-btn"
            title={t('profile.qrCode.shareTooltip')}
          >
            <Share2 size={18} />
            {t('profile.qrCode.share')}
          </button>
        </div>
      )}

      {/* Info Box */}
      <div className="qr-code-info">
        <p>
          <strong>{t('profile.qrCode.howToUse')}:</strong> {t('profile.qrCode.howToUseDesc')}
        </p>
        <p className="qr-code-tip">
          {t('profile.qrCode.tip')}
        </p>
      </div>
    </div>
  );
}
