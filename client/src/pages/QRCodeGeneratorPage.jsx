import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import PageMeta from '../components/PageMeta';
import qrCodesApi from '../api/qrCodes';
import QRCodeStyling from 'qr-code-styling';
import './QRCodeGeneratorPage.css';
import { Trash2, Download, Copy, Check, Plus, Zap, Package, Settings } from 'lucide-react';

const QRCodeGeneratorPage = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qrRef = useRef(null);

  // Tab state
  const [activeTab, setActiveTab] = useState('generator');

  // State for live preview form
  const [formData, setFormData] = useState({
    title: '',
    url: 'https://example.com',
    logoUrl: '',
    dotColor: '#000000',
    backgroundColor: '#ffffff',
    dotStyle: 'square',
    size: 300,
    overlayText: '',
    overlayPosition: 'bottom',
    overlayTextColor: '#000000',
    templateType: null,
  });

  // QR code instance
  const [qrCode, setQRCode] = useState(null);
  const [qrInstance, setQRInstance] = useState(null);

  // Saved QR codes list
  const [savedQRs, setSavedQRs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  // Templates
  const [templates, setTemplates] = useState([]);
  const [presets, setPresets] = useState([]);
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [presetName, setPresetName] = useState('');

  // Batch generation
  const [batches, setBatches] = useState([]);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchName, setBatchName] = useState('');
  const [batchItems, setBatchItems] = useState([{ title: '', url: '', overlayText: '' }]);

  // Initialize QR code instance and regenerate on changes
  useEffect(() => {
    if (!formData.url) return;

    try {
      const imageConfig = formData.logoUrl
        ? {
            image: {
              src: formData.logoUrl,
              hideBackgroundDots: true,
            },
          }
        : {};

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
        ...imageConfig,
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

  // Fetch saved QR codes, templates, presets, and batches
  useEffect(() => {
    fetchSavedQRs();
    fetchTemplates();
    fetchPresets();
    fetchBatches();
  }, []);

  const fetchSavedQRs = async () => {
    try {
      setLoading(true);
      const response = await qrCodesApi.getAll(100, 0);
      setSavedQRs(response.data.data || []);
    } catch (err) {
      logger.error('QRCodeGeneratorPage: failed to fetch saved QRs', { err: err.message });
      toast.error(t('qrGenerator.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const fetchTemplates = async () => {
    try {
      const response = await qrCodesApi.getTemplates();
      setTemplates(response.data || []);
    } catch (err) {
      logger.warn('QRCodeGeneratorPage: failed to fetch templates', { err: err.message });
    }
  };

  const fetchPresets = async () => {
    try {
      const response = await qrCodesApi.getPresets();
      setPresets(response.data || []);
    } catch (err) {
      logger.warn('QRCodeGeneratorPage: failed to fetch presets', { err: err.message });
    }
  };

  const fetchBatches = async () => {
    try {
      const response = await qrCodesApi.getBatches(100, 0);
      setBatches(response.data || []);
    } catch (err) {
      logger.warn('QRCodeGeneratorPage: failed to fetch batches', { err: err.message });
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

  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setFormData((prev) => ({
        ...prev,
        logoUrl: event.target?.result,
      }));
    };
    reader.readAsDataURL(file);
  };

  const applyTemplate = (templateId) => {
    const templateUrls = {
      profile: `${window.location.origin}/helpers/${user?.id}`,
      service: `${window.location.origin}/helpers?service=`,
      job: `${window.location.origin}/jobs/`,
      contact: `https://vcard.example.com/${user?.id}`,
    };

    const templateTitles = {
      profile: `${user?.first_name || 'My'} Profile`,
      service: 'My Service',
      job: 'Job Post',
      contact: `${user?.first_name || 'Contact'} Me`,
    };

    setFormData((prev) => ({
      ...prev,
      templateType: templateId,
      url: templateUrls[templateId] || '',
      title: templateTitles[templateId] || '',
    }));

    toast.success(t('qrGenerator.templateApplied'));
  };

  const applyPreset = (preset) => {
    setFormData((prev) => ({
      ...prev,
      dotColor: preset.dot_color,
      backgroundColor: preset.background_color,
      dotStyle: preset.dot_style,
      logoUrl: preset.logo_url || '',
      overlayTextColor: preset.overlay_text_color,
      overlayPosition: preset.overlay_position,
    }));

    toast.success(t('qrGenerator.presetApplied'));
  };

  const handleSavePreset = async () => {
    if (!presetName.trim()) {
      toast.error(t('qrGenerator.presetNameRequired'));
      return;
    }

    try {
      setLoading(true);
      await qrCodesApi.savePreset({
        presetName,
        dotColor: formData.dotColor,
        backgroundColor: formData.backgroundColor,
        dotStyle: formData.dotStyle,
        logoUrl: formData.logoUrl,
        overlayTextColor: formData.overlayTextColor,
        overlayPosition: formData.overlayPosition,
      });

      toast.success(t('qrGenerator.presetSaved'));
      setPresetName('');
      setShowPresetModal(false);
      fetchPresets();
    } catch (err) {
      logger.error('QRCodeGeneratorPage: failed to save preset', { err: err.message });
      toast.error(t('qrGenerator.presetSaveError'));
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePreset = async (presetId) => {
    if (!confirm(t('qrGenerator.confirmDeletePreset'))) return;

    try {
      await qrCodesApi.deletePreset(presetId);
      toast.success(t('qrGenerator.presetDeleted'));
      fetchPresets();
    } catch (err) {
      logger.error('QRCodeGeneratorPage: failed to delete preset', { err: err.message });
      toast.error(t('qrGenerator.deleteError'));
    }
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
        logoUrl: formData.logoUrl,
        dotColor: formData.dotColor,
        backgroundColor: formData.backgroundColor,
        dotStyle: formData.dotStyle,
        size: parseInt(formData.size),
        overlayText: formData.overlayText,
        overlayPosition: formData.overlayPosition,
        overlayTextColor: formData.overlayTextColor,
        templateType: formData.templateType,
        imageData,
        imageFormat: 'png',
      };

      await qrCodesApi.create(payload);
      toast.success(t('qrGenerator.savedSuccess'));
      setFormData((prev) => ({
        ...prev,
        title: '',
        overlayText: '',
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

  const handleGenerateBatch = async () => {
    if (!batchName.trim()) {
      toast.error(t('qrGenerator.batchNameRequired'));
      return;
    }

    const validItems = batchItems.filter((item) => item.title.trim() && item.url.trim());
    if (validItems.length === 0) {
      toast.error(t('qrGenerator.batchItemsRequired'));
      return;
    }

    try {
      setLoading(true);

      // Create batch
      const batchResponse = await qrCodesApi.createBatch({
        batchName,
        batchType: 'manual',
        config: {
          dotColor: formData.dotColor,
          backgroundColor: formData.backgroundColor,
          dotStyle: formData.dotStyle,
          logoUrl: formData.logoUrl,
          overlayTextColor: formData.overlayTextColor,
          overlayPosition: formData.overlayPosition,
        },
      });

      // Generate QR codes
      await qrCodesApi.generateBatchQRCodes(batchResponse.data.id, validItems);

      toast.success(t('qrGenerator.batchGenerated', { count: validItems.length }));
      setBatchName('');
      setBatchItems([{ title: '', url: '', overlayText: '' }]);
      setShowBatchModal(false);
      fetchBatches();
      fetchSavedQRs();
    } catch (err) {
      logger.error('QRCodeGeneratorPage: failed to generate batch', { err: err.message });
      toast.error(t('qrGenerator.batchError'));
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

        {/* Tabs */}
        <div className="qrg-tabs">
          <button
            className={`qrg-tab ${activeTab === 'generator' ? 'active' : ''}`}
            onClick={() => setActiveTab('generator')}
          >
            <Zap size={18} />
            {t('qrGenerator.generator')}
          </button>
          <button
            className={`qrg-tab ${activeTab === 'templates' ? 'active' : ''}`}
            onClick={() => setActiveTab('templates')}
          >
            <Zap size={18} />
            {t('qrGenerator.templates')}
          </button>
          <button
            className={`qrg-tab ${activeTab === 'presets' ? 'active' : ''}`}
            onClick={() => setActiveTab('presets')}
          >
            <Settings size={18} />
            {t('qrGenerator.presets')}
          </button>
          <button
            className={`qrg-tab ${activeTab === 'batch' ? 'active' : ''}`}
            onClick={() => setActiveTab('batch')}
          >
            <Package size={18} />
            {t('qrGenerator.batch')}
          </button>
        </div>

        {/* Generator Tab */}
        {activeTab === 'generator' && (
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

                {/* Text Overlay */}
                <div className="qrg-form-group">
                  <label htmlFor="overlayText">{t('qrGenerator.overlayText')}</label>
                  <input
                    id="overlayText"
                    type="text"
                    name="overlayText"
                    value={formData.overlayText}
                    onChange={handleInputChange}
                    placeholder={t('qrGenerator.overlayTextPlaceholder')}
                    className="qrg-input"
                    maxLength={255}
                  />
                </div>

                <div className="qrg-form-group">
                  <label htmlFor="overlayPosition">{t('qrGenerator.overlayPosition')}</label>
                  <select
                    id="overlayPosition"
                    name="overlayPosition"
                    value={formData.overlayPosition}
                    onChange={handleInputChange}
                    className="qrg-select"
                  >
                    <option value="top">{t('qrGenerator.positionTop')}</option>
                    <option value="bottom">{t('qrGenerator.positionBottom')}</option>
                    <option value="inside">{t('qrGenerator.positionInside')}</option>
                  </select>
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
                  <label htmlFor="overlayTextColor">{t('qrGenerator.overlayTextColor')}</label>
                  <div className="qrg-color-picker">
                    <input
                      id="overlayTextColor"
                      type="color"
                      name="overlayTextColor"
                      value={formData.overlayTextColor}
                      onChange={handleColorChange}
                      className="qrg-color-input"
                    />
                    <span className="qrg-color-value">{formData.overlayTextColor}</span>
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

              {/* Logo */}
              <div className="qrg-section">
                <h2 className="qrg-section-title">{t('qrGenerator.logo')}</h2>

                <div className="qrg-form-group">
                  <label htmlFor="logo-upload">{t('qrGenerator.uploadLogo')}</label>
                  <input
                    id="logo-upload"
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    className="qrg-file-input"
                  />
                  {formData.logoUrl && (
                    <div className="qrg-logo-preview">
                      <img src={formData.logoUrl} alt="Logo preview" />
                      <button
                        type="button"
                        onClick={() =>
                          setFormData((prev) => ({
                            ...prev,
                            logoUrl: '',
                          }))
                        }
                        className="qrg-remove-logo"
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Right: Preview */}
            <div className="qrg-preview-panel">
              <h2 className="qrg-section-title">{t('qrGenerator.preview')}</h2>
              <div ref={qrRef} className="qrg-preview-container" />

              {formData.overlayText && (
                <div className={`qrg-overlay-preview qrg-overlay-${formData.overlayPosition}`}>
                  <p style={{ color: formData.overlayTextColor }}>{formData.overlayText}</p>
                </div>
              )}

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
                onClick={() => setShowPresetModal(true)}
                className="qrg-button qrg-button-secondary-sm"
              >
                <Settings size={16} />
                {t('qrGenerator.saveAsPreset')}
              </button>

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
        )}

        {/* Templates Tab */}
        {activeTab === 'templates' && (
          <div className="qrg-templates-section">
            <h2 className="qrg-section-title">{t('qrGenerator.quickTemplates')}</h2>
            <div className="qrg-templates-grid">
              {templates.map((template) => (
                <div key={template.id} className="qrg-template-card">
                  <div className="qrg-template-icon" style={{ backgroundColor: template.color }}>
                    <span>{template.name.charAt(0)}</span>
                  </div>
                  <h3>{template.name}</h3>
                  <p>{template.description}</p>
                  <button
                    onClick={() => applyTemplate(template.id)}
                    className="qrg-button qrg-button-primary qrg-button-sm"
                  >
                    {t('qrGenerator.useTemplate')}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Presets Tab */}
        {activeTab === 'presets' && (
          <div className="qrg-presets-section">
            <h2 className="qrg-section-title">{t('qrGenerator.savedPresets')}</h2>
            {presets.length > 0 ? (
              <div className="qrg-presets-grid">
                {presets.map((preset) => (
                  <div key={preset.id} className="qrg-preset-card">
                    <div className="qrg-preset-colors">
                      <div className="qrg-color-swatch" style={{ backgroundColor: preset.dot_color }} />
                      <div className="qrg-color-swatch" style={{ backgroundColor: preset.background_color }} />
                    </div>
                    <h3>{preset.preset_name}</h3>
                    <p>{preset.dot_style}</p>
                    <div className="qrg-preset-actions">
                      <button
                        onClick={() => applyPreset(preset)}
                        className="qrg-button qrg-button-primary qrg-button-sm"
                      >
                        {t('qrGenerator.apply')}
                      </button>
                      <button
                        onClick={() => handleDeletePreset(preset.id)}
                        className="qrg-button qrg-button-danger qrg-button-sm"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="qrg-empty-state">{t('qrGenerator.noPresets')}</p>
            )}
          </div>
        )}

        {/* Batch Tab */}
        {activeTab === 'batch' && (
          <div className="qrg-batch-section">
            <h2 className="qrg-section-title">{t('qrGenerator.batchGeneration')}</h2>
            <button
              onClick={() => setShowBatchModal(true)}
              className="qrg-button qrg-button-primary"
            >
              <Plus size={16} />
              {t('qrGenerator.newBatch')}
            </button>

            {batches.length > 0 && (
              <div className="qrg-batches-list">
                <h3>{t('qrGenerator.previousBatches')}</h3>
                <div className="qrg-batches-grid">
                  {batches.map((batch) => (
                    <div key={batch.id} className="qrg-batch-card">
                      <h4>{batch.batch_name}</h4>
                      <p>
                        {t('qrGenerator.codesGenerated')}: {batch.qr_code_count}
                      </p>
                      <small>{new Date(batch.created_at).toLocaleDateString()}</small>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

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
                    {qr.overlay_text && <p className="qrg-card-overlay">"{qr.overlay_text}"</p>}
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
              {formData.overlayText && (
                <p>
                  <strong>{t('qrGenerator.overlayText')}:</strong> {formData.overlayText}
                </p>
              )}
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

      {/* Save Preset Modal */}
      {showPresetModal && (
        <div className="qrg-modal-overlay" onClick={() => setShowPresetModal(false)}>
          <div className="qrg-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t('qrGenerator.saveAsPreset')}</h2>
            <p className="qrg-modal-text">{t('qrGenerator.presetDescription')}</p>
            <div className="qrg-form-group">
              <label htmlFor="preset-name">{t('qrGenerator.presetName')}</label>
              <input
                id="preset-name"
                type="text"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder={t('qrGenerator.presetNamePlaceholder')}
                className="qrg-input"
                maxLength={255}
              />
            </div>
            <div className="qrg-modal-actions">
              <button
                onClick={() => setShowPresetModal(false)}
                className="qrg-button qrg-button-secondary"
                disabled={loading}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSavePreset}
                className="qrg-button qrg-button-primary"
                disabled={loading || !presetName.trim()}
              >
                {loading ? t('common.saving') : t('qrGenerator.savePreset')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Modal */}
      {showBatchModal && (
        <div className="qrg-modal-overlay" onClick={() => setShowBatchModal(false)}>
          <div className="qrg-modal qrg-modal-lg" onClick={(e) => e.stopPropagation()}>
            <h2>{t('qrGenerator.newBatch')}</h2>

            <div className="qrg-form-group">
              <label htmlFor="batch-name">{t('qrGenerator.batchName')}</label>
              <input
                id="batch-name"
                type="text"
                value={batchName}
                onChange={(e) => setBatchName(e.target.value)}
                placeholder={t('qrGenerator.batchNamePlaceholder')}
                className="qrg-input"
                maxLength={255}
              />
            </div>

            <div className="qrg-batch-items">
              <h3>{t('qrGenerator.batchItems')}</h3>
              {batchItems.map((item, index) => (
                <div key={index} className="qrg-batch-item">
                  <div className="qrg-form-group">
                    <label>{t('qrGenerator.title')}</label>
                    <input
                      type="text"
                      value={item.title}
                      onChange={(e) => {
                        const newItems = [...batchItems];
                        newItems[index].title = e.target.value;
                        setBatchItems(newItems);
                      }}
                      placeholder="QR Code Title"
                      className="qrg-input"
                      maxLength={255}
                    />
                  </div>
                  <div className="qrg-form-group">
                    <label>{t('qrGenerator.url')}</label>
                    <input
                      type="text"
                      value={item.url}
                      onChange={(e) => {
                        const newItems = [...batchItems];
                        newItems[index].url = e.target.value;
                        setBatchItems(newItems);
                      }}
                      placeholder="https://example.com"
                      className="qrg-input"
                    />
                  </div>
                  <div className="qrg-form-group">
                    <label>{t('qrGenerator.overlayText')}</label>
                    <input
                      type="text"
                      value={item.overlayText}
                      onChange={(e) => {
                        const newItems = [...batchItems];
                        newItems[index].overlayText = e.target.value;
                        setBatchItems(newItems);
                      }}
                      placeholder="Optional text overlay"
                      className="qrg-input"
                      maxLength={255}
                    />
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={() => setBatchItems([...batchItems, { title: '', url: '', overlayText: '' }])}
              className="qrg-button qrg-button-secondary qrg-button-sm"
            >
              <Plus size={14} />
              {t('qrGenerator.addItem')}
            </button>

            <div className="qrg-modal-actions">
              <button
                onClick={() => setShowBatchModal(false)}
                className="qrg-button qrg-button-secondary"
                disabled={loading}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleGenerateBatch}
                className="qrg-button qrg-button-primary"
                disabled={loading || !batchName.trim()}
              >
                {loading ? t('common.generating') : t('qrGenerator.generateBatch')}
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
