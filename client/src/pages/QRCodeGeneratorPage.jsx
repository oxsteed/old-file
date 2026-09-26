import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import PageMeta from '../components/PageMeta';
import qrCodesApi from '../api/qrCodes';
import QRCodeStyling from 'qr-code-styling';
import logger from '../utils/logger';
import './QRCodeGeneratorPage.css';
import { canUseQrGenerator } from '../utils/modeAccess';
import { prepareQrLogo } from '../utils/qrLogo';
import { composeQrDownload, qrDownloadFileName } from '../utils/qrExport';
import { Trash2, Download, Copy, Check, Plus } from 'lucide-react';

const QRCodeGeneratorPage = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qrRef = useRef(null);
  const logoInputRef = useRef(null);
  const logoUploadRef = useRef(null);
  const canUseQr = canUseQrGenerator(user);

  // State for live preview form
  const [formData, setFormData] = useState({
    title: '',
    url: 'https://example.com',
    dotColor: '#000000',
    backgroundColor: '#ffffff',
    dotStyle: 'square',
    size: 300,
  });

  // QR code instance
  const [qrInstance, setQRInstance] = useState(null);
  const [generatedInput, setGeneratedInput] = useState(null);

  // Saved QR codes list
  const [savedQRs, setSavedQRs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [logoDataUrl, setLogoDataUrl] = useState('');
  const [logoProcessing, setLogoProcessing] = useState(false);
  const previewInput = JSON.stringify([
    formData.url, formData.size, formData.dotColor,
    formData.backgroundColor, formData.dotStyle, logoDataUrl,
  ]);
  const previewReady = Boolean(!logoProcessing && qrInstance && generatedInput === previewInput);
  const showLogoProcessing = logoProcessing || (Boolean(logoDataUrl) && !previewReady);

  useEffect(() => () => {
    logoUploadRef.current?.abort();
    logoUploadRef.current = null;
  }, []);

  // Initialize QR code instance and regenerate on changes. Keep the async
  // preview work inside the effect so rejected image generation is surfaced
  // instead of becoming an unhandled promise rejection.
  useEffect(() => {
    let cancelled = false;
    setQRInstance(null);
    setGeneratedInput(null);
    if (qrRef.current) qrRef.current.innerHTML = '';

    if (!canUseQr || !formData.url.trim()) {
      return undefined;
    }

    const generatePreview = async () => {
      try {
        const qr = new QRCodeStyling({
          width: Number(formData.size),
          height: Number(formData.size),
          data: formData.url,
          image: logoDataUrl || undefined,
          // Undefined nested options overwrite the library defaults and crash
          // its constructor. Supply valid options with and without a logo.
          imageOptions: {
            hideBackgroundDots: true,
            imageSize: 0.22,
            margin: 5,
          },
          qrOptions: { errorCorrectionLevel: logoDataUrl ? 'H' : 'Q' },
          dotsOptions: {
            color: formData.dotColor,
            type: formData.dotStyle,
          },
          backgroundOptions: {
            color: formData.backgroundColor,
          },
          margin: 10,
        });

        const blob = await qr.getRawData('png');
        if (cancelled) return;
        if (!blob || !blob.size) throw new Error('QR image is empty');
        if (qrRef.current) {
          qrRef.current.innerHTML = '';
          qr.append(qrRef.current);
        }
        setQRInstance(qr);
        setGeneratedInput(previewInput);
      } catch (err) {
        if (cancelled) return;
        setQRInstance(null);
        setGeneratedInput(null);
        logger.error('QRCodeGeneratorPage: QR generation error', { err: err.message });
        toast.error(t('qrGenerator.errorGenerating'));
      }
    };

    generatePreview();

    return () => {
      cancelled = true;
    };
  }, [previewInput, canUseQr, t]);

  // Fetch saved QR codes only after the same Pro entitlement check used by
  // the API. This prevents a generic load error for regular helpers.
  const fetchSavedQRs = async () => {
    try {
      setLoading(true);
      const { data } = await qrCodesApi.getAll(100, 0);
      setSavedQRs(data.data || []);
    } catch (err) {
      logger.error('QRCodeGeneratorPage: failed to fetch saved QRs', {
        err: err.message,
        status: err.response?.status,
      });
      toast.error(
        err.response?.status === 403
          ? t('qrGenerator.proRequired')
          : t('qrGenerator.loadError'),
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canUseQr) fetchSavedQRs();
  }, [canUseQr]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name === 'size' ? Number(value) : value,
    }));
  };

  const handleColorChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleLogoChange = async (e) => {
    const input = e.target;
    const file = e.target.files?.[0];
    if (!file) return;
    logoUploadRef.current?.abort();
    const controller = new AbortController();
    logoUploadRef.current = controller;
    setLogoProcessing(true);
    try {
      const normalized = await prepareQrLogo(file, controller.signal);
      if (!controller.signal.aborted) setLogoDataUrl(normalized);
    } catch (err) {
      if (controller.signal.aborted) return;
      const key = ['logoTooLarge', 'logoUnsupported', 'logoDimensions', 'logoInvalid'].includes(err.message)
        ? err.message : 'logoInvalid';
      toast.error(t(`qrGenerator.${key}`));
      input.value = '';
    } finally {
      if (logoUploadRef.current === controller) {
        logoUploadRef.current = null;
        setLogoProcessing(false);
      }
    }
  };

  const handleRemoveLogo = () => {
    logoUploadRef.current?.abort();
    logoUploadRef.current = null;
    setLogoProcessing(false);
    setLogoDataUrl('');
    if (logoInputRef.current) logoInputRef.current.value = '';
  };


  const handleSaveQR = async () => {
    if (!formData.title.trim()) {
      toast.error(t('qrGenerator.titleRequired'));
      return;
    }

    if (!previewReady) {
      toast.error(t('qrGenerator.errorGenerating'));
      return;
    }

    try {
      setLoading(true);

      // Get current QR code image
      const blob = await qrInstance.getRawData('png');
      if (!blob || !blob.size) throw new Error('QR image is empty');
      const imageData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read generated QR image'));
        reader.readAsDataURL(blob);
      });

      const payload = {
        title: formData.title,
        url: formData.url,
        dotColor: formData.dotColor,
        backgroundColor: formData.backgroundColor,
        dotStyle: formData.dotStyle,
        size: parseInt(formData.size),
        imageData,
        imageFormat: 'png',
      };

      await qrCodesApi.create(payload);
      toast.success(t('qrGenerator.savedSuccess'));
      setFormData((prev) => ({
        ...prev,
        title: '',
      }));
      setShowSaveModal(false);
      fetchSavedQRs();
    } catch (err) {
      logger.error('QRCodeGeneratorPage: failed to save QR', {
        err: err.message,
        status: err.response?.status,
      });
      toast.error(
        err.response?.status === 403
          ? t('qrGenerator.proRequired')
          : t('qrGenerator.saveError'),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadSavedQR = async (qr) => {
    try {
      const format = qr.image_format === 'svg' ? 'svg' : 'png';
      const { data } = await qrCodesApi.download(qr.id, format);
      const imageUrl = data.data?.imageUrl || qr.image_url;

      if (!imageUrl) {
        throw new Error('Saved QR image is unavailable');
      }

      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error('Saved QR image is unavailable');
      const blob = await response.blob();
      if (!blob.type.startsWith('image/')) throw new Error('Saved QR image is invalid');
      const titledBlob = await composeQrDownload(blob, qr.title, format);
      const objectUrl = URL.createObjectURL(titledBlob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = qrDownloadFileName(qr.title, format);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      setSavedQRs((items) => items.map((item) => item.id === qr.id
        ? { ...item, download_count: Number(item.download_count || 0) + 1 }
        : item));
      toast.success(t('qrGenerator.downloadSuccess'));
    } catch (err) {
      logger.error('QRCodeGeneratorPage: saved QR download error', {
        err: err.message,
        status: err.response?.status,
      });
      toast.error(t('qrGenerator.downloadError'));
    }
  };

  const handleDownloadQR = async (format = 'png') => {
    try {
      if (!previewReady) {
        toast.error(t('qrGenerator.errorGenerating'));
        return;
      }

      const blob = await qrInstance.getRawData(format);
      const titledBlob = await composeQrDownload(blob, formData.title, format);
      const url = URL.createObjectURL(titledBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = qrDownloadFileName(formData.title, format);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(t('qrGenerator.downloadSuccess'));
    } catch (err) {
      logger.error('QRCodeGeneratorPage: download error', { err: err.message });
      toast.error(t('qrGenerator.downloadError'));
    }
  };

  const handleDeleteQR = async (id) => {
    if (!confirm(t('qrGenerator.confirmDelete'))) return;

    try {
      await qrCodesApi.delete(id);
      toast.success(t('qrGenerator.deleteSuccess'));
      fetchSavedQRs();
    } catch (err) {
      logger.error('QRCodeGeneratorPage: delete error', { err: err.message });
      toast.error(t('qrGenerator.deleteError'));
    }
  };

  const handleCopyURL = (url) => {
    navigator.clipboard.writeText(url);
    toast.success(t('common.copiedToClipboard'));
    setCopiedId(url);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (!canUseQr) {
    return (
      <>
        <PageMeta title={t('qrGenerator.pageTitle')} description={t('qrGenerator.pageDescription')} />
        <Navbar />
        <div className="qrg-container">
          <div className="qrg-hero">
            <h1 className="qrg-title">{t('qrGenerator.title')}</h1>
            <p className="qrg-subtitle">{t('qrGenerator.subtitle')}</p>
          </div>
          <section className="qrg-section" role="status" style={{ maxWidth: '640px', margin: '0 auto', textAlign: 'center' }}>
            <h2 className="qrg-section-title">{t('qrGenerator.proRequiredTitle')}</h2>
            <p className="qrg-subtitle" style={{ marginBottom: '24px' }}>{t('qrGenerator.proRequiredDescription')}</p>
            <Link to="/upgrade" className="qrg-button qrg-button-primary">{t('qrGenerator.viewPlans')}</Link>
          </section>
        </div>
        <Footer />
      </>
    );
  }

  return (
    <>
      <PageMeta title={t('qrGenerator.pageTitle')} description={t('qrGenerator.pageDescription')} />
      <Navbar />

      <div className="qrg-container">
        <div className="qrg-hero">
          <h1 className="qrg-title">{t('qrGenerator.title')}</h1>
          <p className="qrg-subtitle">{t('qrGenerator.subtitle')}</p>
        </div>

        <div className="qrg-main">
          {/* Left: Controls */}
          <div className="qrg-controls-panel">
            <div className="qrg-section">
              <h2 className="qrg-section-title">{t('qrGenerator.urlAndTitle')}</h2>

              <div className="qrg-form-group">
                <label htmlFor="title">{t('qrGenerator.title')}</label>
                <input
                  id="title"
                  type="text"
                  name="title"
                  value={formData.title}
                  onChange={handleInputChange}
                  placeholder={t('qrGenerator.titlePlaceholder')}
                  className="qrg-input"
                  maxLength={255}
                />
              </div>

              <div className="qrg-form-group">
                <label htmlFor="url">{t('qrGenerator.url')}</label>
                <input
                  id="url"
                  type="text"
                  name="url"
                  value={formData.url}
                  onChange={handleInputChange}
                  placeholder="https://example.com"
                  className="qrg-input"
                />
              </div>
            </div>

            {/* Styling */}
            <div className="qrg-section">
              <h2 className="qrg-section-title">{t('qrGenerator.styling')}</h2>

              <div className="qrg-form-group">
                <label htmlFor="dotStyle">{t('qrGenerator.dotStyle')}</label>
                <select
                  id="dotStyle"
                  name="dotStyle"
                  value={formData.dotStyle}
                  onChange={handleInputChange}
                  className="qrg-select"
                >
                  <option value="square">{t('qrGenerator.styleSquare')}</option>
                  <option value="rounded">{t('qrGenerator.styleRounded')}</option>
                  <option value="dots">{t('qrGenerator.styleDots')}</option>
                  <option value="classy">{t('qrGenerator.styleClassy')}</option>
                  <option value="classy-rounded">{t('qrGenerator.styleClassyRounded')}</option>
                </select>
              </div>

              <div className="qrg-form-group">
                <label htmlFor="logoUpload">{t('qrGenerator.logo')}</label>
                <input
                  ref={logoInputRef}
                  id="logoUpload"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleLogoChange}
                  className="qrg-file-input"
                  aria-describedby="logo-help"
                />
                <p id="logo-help">{t('qrGenerator.logoHelp')}</p>
                {showLogoProcessing && (
                  <div className="qrg-logo-processing" role="status" aria-live="polite">
                    <span className="qrg-processing-spinner" aria-hidden="true" />
                    <span className="qrg-processing-copy">
                      <strong>{t('qrGenerator.logoProcessing')}</strong>
                      <small>{t('qrGenerator.logoProcessingDetail')}</small>
                    </span>
                    <span className="qrg-processing-track" aria-hidden="true"><span /></span>
                  </div>
                )}
                {(logoDataUrl || logoProcessing) && (
                  <button
                    type="button"
                    onClick={handleRemoveLogo}
                    className="qrg-button qrg-button-secondary"
                    style={{ marginTop: '12px' }}
                  >
                    <Trash2 size={16} />
                    {t('qrGenerator.removeLogo')}
                  </button>
                )}
              </div>

              <div className="qrg-color-row">
                <div className="qrg-form-group">
                  <label htmlFor="dotColor">{t('qrGenerator.dotColor')}</label>
                  <div className="qrg-color-picker">
                    <input
                      id="dotColor"
                      type="color"
                      name="dotColor"
                      value={formData.dotColor}
                      onChange={handleColorChange}
                      className="qrg-color-input"
                    />
                    <span className="qrg-color-value">{formData.dotColor}</span>
                  </div>
                </div>

                <div className="qrg-form-group">
                  <label htmlFor="backgroundColor">{t('qrGenerator.backgroundColor')}</label>
                  <div className="qrg-color-picker">
                    <input
                      id="backgroundColor"
                      type="color"
                      name="backgroundColor"
                      value={formData.backgroundColor}
                      onChange={handleColorChange}
                      className="qrg-color-input"
                    />
                    <span className="qrg-color-value">{formData.backgroundColor}</span>
                  </div>
                </div>
              </div>

              <div className="qrg-form-group">
                <label htmlFor="size">
                  {t('qrGenerator.size')}: {formData.size}px
                </label>
                <input
                  id="size"
                  type="range"
                  name="size"
                  min="100"
                  max="1000"
                  step="10"
                  value={formData.size}
                  onChange={handleInputChange}
                  className="qrg-slider"
                />
              </div>
            </div>

          </div>

          {/* Right: Preview */}
          <div className="qrg-preview-panel">
            <h2 className="qrg-section-title">{t('qrGenerator.preview')}</h2>
            <div ref={qrRef} className="qrg-preview-container" />

            <div className="qrg-download-buttons">
              <button
                onClick={() => handleDownloadQR('png')}
                disabled={!previewReady}
                className="qrg-button qrg-button-primary"
              >
                <Download size={16} />
                {t('qrGenerator.downloadPNG')}
              </button>
              <button
                onClick={() => handleDownloadQR('svg')}
                disabled={!previewReady}
                className="qrg-button qrg-button-secondary"
              >
                <Download size={16} />
                {t('qrGenerator.downloadSVG')}
              </button>
            </div>

            <button
              onClick={() => setShowSaveModal(true)}
              className="qrg-button qrg-button-accent"
              disabled={!formData.title.trim() || !previewReady || loading}
            >
              <Plus size={16} />
              {t('qrGenerator.save')}
            </button>
          </div>
        </div>

        {/* Saved QR Codes */}
        {savedQRs.length > 0 && (
          <div className="qrg-saved-section">
            <h2 className="qrg-section-title">{t('qrGenerator.savedQRs')}</h2>
            <div className="qrg-grid">
              {savedQRs.map((qr) => (
                <div key={qr.id} className="qrg-card">
                  <div className="qrg-card-image">
                    {qr.image_url ? (
                      <img src={qr.image_url} alt={qr.title} />
                    ) : (
                      <div className="qrg-card-placeholder">{t('qrGenerator.noImage')}</div>
                    )}
                  </div>
                  <div className="qrg-card-content">
                    <h3 className="qrg-card-title">{qr.title}</h3>
                    <p className="qrg-card-url">{qr.url}</p>
                    <div className="qrg-card-meta">
                      <span>{qr.size}px</span>
                      <span>{qr.download_count} {t('qrGenerator.downloads')}</span>
                    </div>
                  </div>
                  <div className="qrg-card-actions">
                    <button
                      onClick={() => handleCopyURL(qr.url)}
                      className="qrg-action-btn"
                      title={t('common.copy')}
                    >
                      {copiedId === qr.url ? <Check size={18} /> : <Copy size={18} />}
                    </button>
                    <button
                      onClick={() => handleDownloadSavedQR(qr)}
                      className="qrg-action-btn"
                      title={t(qr.image_format === 'svg' ? 'qrGenerator.downloadSVG' : 'qrGenerator.downloadPNG')}
                    >
                      <Download size={18} />
                    </button>
                    <button
                      onClick={() => handleDeleteQR(qr.id)}
                      className="qrg-action-btn qrg-action-delete"
                      title={t('common.delete')}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Save Modal */}
      {showSaveModal && (
        <div className="qrg-modal-overlay" onClick={() => setShowSaveModal(false)}>
          <div className="qrg-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t('qrGenerator.confirmSave')}</h2>
            <p className="qrg-modal-text">{t('qrGenerator.savingWith')}</p>
            <div className="qrg-modal-details">
              <p>
                <strong>{t('qrGenerator.title')}:</strong> {formData.title}
              </p>
              <p>
                <strong>{t('qrGenerator.url')}:</strong> {formData.url}
              </p>
            </div>
            <div className="qrg-modal-actions">
              <button
                onClick={() => setShowSaveModal(false)}
                className="qrg-button qrg-button-secondary"
                disabled={loading}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSaveQR}
                className="qrg-button qrg-button-primary"
                disabled={loading || !previewReady}
              >
                {loading ? t('common.saving') : t('qrGenerator.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      <Footer />
    </>
  );
};

export default QRCodeGeneratorPage;
