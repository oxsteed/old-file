import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import PageMeta from '../components/PageMeta';
import qrCodesApi from '../api/qrCodes';
import QRCodeStyling from 'qr-code-styling';
import logger from '../utils/logger';
import './QRCodeGeneratorPage.css';
import { Trash2, Download, Copy, Check, Plus } from 'lucide-react';

const QRCodeGeneratorPage = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qrRef = useRef(null);

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
  const [qrCode, setQRCode] = useState(null);
  const [qrInstance, setQRInstance] = useState(null);

  // Saved QR codes list
  const [savedQRs, setSavedQRs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  // Initialize QR code instance and regenerate on changes
  useEffect(() => {
    if (!formData.url) return;

    try {
      const qr = new QRCodeStyling({
        width: formData.size,
        height: formData.size,
        data: formData.url,
        dotsOptions: {
          color: formData.dotColor,
          type: formData.dotStyle,
        },
        backgroundOptions: {
          color: formData.backgroundColor,
        },
        margin: 10,
      });

      setQRInstance(qr);

      // Append to container
      if (qrRef.current) {
        qrRef.current.innerHTML = '';
        qr.append(qrRef.current);
      }

      // Generate canvas preview
      qr.getRawData('png').then((blob) => {
        const url = URL.createObjectURL(blob);
        setQRCode(url);
      });
    } catch (err) {
      logger.error('QRCodeGeneratorPage: QR generation error', { err: err.message });
      toast.error(t('qrGenerator.errorGenerating'));
    }
  }, [formData, t]);

  // Fetch saved QR codes
  useEffect(() => {
    fetchSavedQRs();
  }, []);

  const fetchSavedQRs = async () => {
    try {
      setLoading(true);
      const { data } = await qrCodesApi.getAll(100, 0);
      setSavedQRs(data.data || []);
    } catch (err) {
      logger.error('QRCodeGeneratorPage: failed to fetch saved QRs', { err: err.message });
      toast.error(t('qrGenerator.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleColorChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSaveQR = async () => {
    if (!formData.title.trim()) {
      toast.error(t('qrGenerator.titleRequired'));
      return;
    }

    try {
      setLoading(true);

      // Get current QR code image
      let imageData = null;
      if (qrInstance) {
        const blob = await qrInstance.getRawData('png');
        imageData = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
      }

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
      logger.error('QRCodeGeneratorPage: failed to save QR', { err: err.message });
      toast.error(t('qrGenerator.saveError'));
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadQR = async (format = 'png') => {
    try {
      if (!qrInstance) {
        toast.error(t('qrGenerator.errorGenerating'));
        return;
      }

      const blob = await qrInstance.getRawData(format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `qr-code-${Date.now()}.${format}`;
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
                className="qrg-button qrg-button-primary"
              >
                <Download size={16} />
                {t('qrGenerator.downloadPNG')}
              </button>
              <button
                onClick={() => handleDownloadQR('svg')}
                className="qrg-button qrg-button-secondary"
              >
                <Download size={16} />
                {t('qrGenerator.downloadSVG')}
              </button>
            </div>

            <button
              onClick={() => setShowSaveModal(true)}
              className="qrg-button qrg-button-accent"
              disabled={!formData.title.trim() || loading}
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
                disabled={loading}
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
