import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import qrCodesApi from '../api/qrCodes';
import QRCode from 'qrcode.react';
import toast from 'react-hot-toast';
import { Copy, Download, Save, Trash2, Plus, RotateCcw } from 'lucide-react';
import PageMeta from '../components/PageMeta';
import './QRCodeGeneratorPage.css';

const DEFAULT_CONFIG = {
  url: '',
  overlayText: '',
  textPosition: 'bottom',
  textColor: '#000000',
  textFontSize: 14,
  squareColor: '#FF6B35',
  backgroundColor: '#ffffff',
  errorCorrectionLevel: 'M',
  logoUrl: '',
};

const QR_TEMPLATES = [
  { id: 'profile', name: 'My Profile', description: 'Link to your helper profile' },
  { id: 'service', name: 'Service Card', description: 'Link to a specific service' },
  { id: 'job', name: 'Job Post', description: 'Link to a job listing' },
  { id: 'contact', name: 'Contact Info', description: 'vCard with contact details' },
];

export default function QRCodeGeneratorPage() {
  const { user } = useAuth();
  const qrRef = useRef();

  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [savedQRs, setSavedQRs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveDescription, setSaveDescription] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [activeTab, setActiveTab] = useState('generator');

  useEffect(() => {
    if (user) {
      loadSavedQRCodes();
    }
  }, [user]);

  const loadSavedQRCodes = async () => {
    try {
      const { data } = await qrCodesApi.getMyQRCodes();
      setSavedQRs(data.qrCodes || []);
    } catch (err) {
      console.error('Failed to load saved QR codes:', err);
    }
  };

  const handleConfigChange = (key, value) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const applyTemplate = (templateId) => {
    const template = QR_TEMPLATES.find(t => t.id === templateId);
    if (template) {
      setSelectedTemplate(templateId);
      setConfig(prev => ({
        ...prev,
        squareColor: '#FF6B35',
        backgroundColor: '#ffffff',
      }));
    }
  };

  const handleSaveQRCode = async () => {
    if (!saveName.trim()) {
      toast.error('Please enter a name');
      return;
    }

    if (!config.url.trim()) {
      toast.error('URL is required');
      return;
    }

    try {
      setLoading(true);
      await qrCodesApi.saveQRCode({
        name: saveName,
        description: saveDescription,
        ...config,
        templateType: selectedTemplate || 'custom',
      });

      toast.success('QR code saved successfully!');
      setSaveName('');
      setSaveDescription('');
      setShowSaveModal(false);
      setSelectedTemplate(null);
      loadSavedQRCodes();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save QR code');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteQRCode = async (id) => {
    if (!window.confirm('Are you sure you want to delete this QR code?')) return;

    try {
      await qrCodesApi.deleteQRCode(id);
      toast.success('QR code deleted');
      loadSavedQRCodes();
    } catch (err) {
      toast.error('Failed to delete QR code');
    }
  };

  const handleLoadQRCode = (qrCode) => {
    setConfig({
      url: qrCode.url,
      overlayText: qrCode.overlay_text || '',
      textPosition: qrCode.text_position || 'bottom',
      textColor: qrCode.text_color || '#000000',
      textFontSize: qrCode.text_font_size || 14,
      squareColor: qrCode.square_color || '#FF6B35',
      backgroundColor: qrCode.background_color || '#ffffff',
      errorCorrectionLevel: qrCode.error_correction_level || 'M',
      logoUrl: qrCode.logo_url || '',
    });
    setSelectedTemplate(qrCode.template_type);
    setActiveTab('generator');
  };

  const handleDownload = (format = 'png') => {
    if (!config.url.trim()) {
      toast.error('Please enter a URL first');
      return;
    }

    try {
      if (format === 'png') {
        const image = qrRef.current?.querySelector('canvas').toDataURL('image/png');
        const link = document.createElement('a');
        link.href = image;
        link.download = `qr-code-${Date.now()}.png`;
        link.click();
      } else if (format === 'svg') {
        const svg = qrRef.current?.querySelector('svg').outerHTML;
        const blob = new Blob([svg], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `qr-code-${Date.now()}.svg`;
        link.click();
      }
      toast.success(`QR code downloaded as ${format.toUpperCase()}`);
    } catch (err) {
      toast.error('Failed to download QR code');
    }
  };

  const handleCopyURL = () => {
    navigator.clipboard.writeText(config.url);
    toast.success('URL copied to clipboard');
  };

  const handleReset = () => {
    setConfig(DEFAULT_CONFIG);
    setSelectedTemplate(null);
    setSaveName('');
    setSaveDescription('');
  };

  return (
    <>
      <PageMeta title="QR Code Generator" />
      <div className="qr-generator-page">
        {/* Header */}
        <div className="qr-header">
          <div className="qr-header-content">
            <h1>QR Code Generator</h1>
            <p>Create branded QR codes with logos, custom colors, and text overlays</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="qr-tabs">
          <button
            className={`qr-tab ${activeTab === 'generator' ? 'active' : ''}`}
            onClick={() => setActiveTab('generator')}
          >
            Generator
          </button>
          <button
            className={`qr-tab ${activeTab === 'saved' ? 'active' : ''}`}
            onClick={() => setActiveTab('saved')}
          >
            Saved ({savedQRs.length})
          </button>
        </div>

        {activeTab === 'generator' ? (
          <div className="qr-container">
            {/* Main Content */}
            <div className="qr-main">
              {/* URL Input */}
              <div className="qr-section">
                <label className="qr-label">URL or Text</label>
                <input
                  type="text"
                  value={config.url}
                  onChange={(e) => handleConfigChange('url', e.target.value)}
                  placeholder="https://example.com or any text to encode"
                  maxLength="2048"
                  className="qr-input"
                />
                <p className="qr-helper-text">Max 2048 characters</p>
              </div>

              {/* Templates */}
              <div className="qr-section">
                <label className="qr-label">Quick Templates</label>
                <div className="qr-templates">
                  {QR_TEMPLATES.map(template => (
                    <button
                      key={template.id}
                      className={`qr-template ${selectedTemplate === template.id ? 'selected' : ''}`}
                      onClick={() => applyTemplate(template.id)}
                      title={template.description}
                    >
                      {template.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Text Overlay */}
              <div className="qr-section">
                <label className="qr-label">Text Overlay</label>
                <input
                  type="text"
                  value={config.overlayText}
                  onChange={(e) => handleConfigChange('overlayText', e.target.value)}
                  placeholder="Optional text to display with QR code"
                  maxLength="255"
                  className="qr-input"
                />

                <div className="qr-grid">
                  <div>
                    <label className="qr-label-small">Text Position</label>
                    <select
                      value={config.textPosition}
                      onChange={(e) => handleConfigChange('textPosition', e.target.value)}
                      className="qr-select"
                    >
                      <option value="top">Top</option>
                      <option value="bottom">Bottom</option>
                      <option value="none">None</option>
                    </select>
                  </div>

                  <div>
                    <label className="qr-label-small">Font Size</label>
                    <input
                      type="number"
                      min="8"
                      max="32"
                      value={config.textFontSize}
                      onChange={(e) => handleConfigChange('textFontSize', parseInt(e.target.value))}
                      className="qr-input-small"
                    />
                  </div>

                  <div>
                    <label className="qr-label-small">Text Color</label>
                    <input
                      type="color"
                      value={config.textColor}
                      onChange={(e) => handleConfigChange('textColor', e.target.value)}
                      className="qr-color-picker"
                    />
                  </div>
                </div>
              </div>

              {/* Colors */}
              <div className="qr-section">
                <label className="qr-label">Colors</label>
                <div className="qr-grid">
                  <div>
                    <label className="qr-label-small">QR Squares</label>
                    <div className="qr-color-input">
                      <input
                        type="color"
                        value={config.squareColor}
                        onChange={(e) => handleConfigChange('squareColor', e.target.value)}
                        className="qr-color-picker"
                      />
                      <input
                        type="text"
                        value={config.squareColor}
                        onChange={(e) => handleConfigChange('squareColor', e.target.value)}
                        maxLength="7"
                        className="qr-input-small"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="qr-label-small">Background</label>
                    <div className="qr-color-input">
                      <input
                        type="color"
                        value={config.backgroundColor}
                        onChange={(e) => handleConfigChange('backgroundColor', e.target.value)}
                        className="qr-color-picker"
                      />
                      <input
                        type="text"
                        value={config.backgroundColor}
                        onChange={(e) => handleConfigChange('backgroundColor', e.target.value)}
                        maxLength="7"
                        className="qr-input-small"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="qr-label-small">Error Correction</label>
                    <select
                      value={config.errorCorrectionLevel}
                      onChange={(e) => handleConfigChange('errorCorrectionLevel', e.target.value)}
                      className="qr-select"
                    >
                      <option value="L">L (7%)</option>
                      <option value="M">M (15%)</option>
                      <option value="Q">Q (25%)</option>
                      <option value="H">H (30%)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Logo Upload */}
              <div className="qr-section">
                <label className="qr-label">Logo (Optional)</label>
                <input
                  type="url"
                  value={config.logoUrl}
                  onChange={(e) => handleConfigChange('logoUrl', e.target.value)}
                  placeholder="https://example.com/logo.png"
                  className="qr-input"
                />
                <p className="qr-helper-text">URL to PNG/JPG logo image. Will be embedded in center.</p>
              </div>

              {/* Actions */}
              <div className="qr-actions">
                <button
                  onClick={handleReset}
                  className="qr-btn qr-btn-secondary"
                >
                  <RotateCcw size={18} /> Reset
                </button>
                <button
                  onClick={() => config.url && setShowSaveModal(true)}
                  className="qr-btn qr-btn-primary"
                  disabled={!config.url}
                >
                  <Save size={18} /> Save QR Code
                </button>
              </div>
            </div>

            {/* Preview Sidebar */}
            <div className="qr-sidebar">
              <div className="qr-preview-container">
                <div
                  className="qr-preview"
                  ref={qrRef}
                  style={{ backgroundColor: config.backgroundColor, padding: '20px' }}
                >
                  {config.textPosition === 'top' && config.overlayText && (
                    <div
                      style={{
                        color: config.textColor,
                        fontSize: `${config.textFontSize}px`,
                        marginBottom: '10px',
                        textAlign: 'center',
                        fontWeight: '600',
                      }}
                    >
                      {config.overlayText}
                    </div>
                  )}

                  <div style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
                    <QRCode
                      value={config.url || 'https://oxsteed.com'}
                      size={256}
                      bgColor={config.backgroundColor}
                      fgColor={config.squareColor}
                      level={config.errorCorrectionLevel}
                      includeMargin={true}
                    />
                    {config.logoUrl && (
                      <img
                        src={config.logoUrl}
                        alt="Logo"
                        style={{
                          position: 'absolute',
                          top: '50%',
                          left: '50%',
                          transform: 'translate(-50%, -50%)',
                          width: '60px',
                          height: '60px',
                          borderRadius: '8px',
                          backgroundColor: 'white',
                          padding: '4px',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                        }}
                      />
                    )}
                  </div>

                  {config.textPosition === 'bottom' && config.overlayText && (
                    <div
                      style={{
                        color: config.textColor,
                        fontSize: `${config.textFontSize}px`,
                        marginTop: '10px',
                        textAlign: 'center',
                        fontWeight: '600',
                      }}
                    >
                      {config.overlayText}
                    </div>
                  )}
                </div>

                <div className="qr-download-buttons">
                  <button
                    onClick={() => handleDownload('png')}
                    className="qr-btn qr-btn-small"
                    disabled={!config.url}
                  >
                    <Download size={16} /> PNG
                  </button>
                  <button
                    onClick={() => handleDownload('svg')}
                    className="qr-btn qr-btn-small"
                    disabled={!config.url}
                  >
                    <Download size={16} /> SVG
                  </button>
                </div>

                {config.url && (
                  <button
                    onClick={handleCopyURL}
                    className="qr-btn qr-btn-small qr-btn-secondary"
                  >
                    <Copy size={16} /> Copy URL
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          // Saved QR Codes Tab
          <div className="qr-saved-container">
            {savedQRs.length === 0 ? (
              <div className="qr-empty-state">
                <p>No saved QR codes yet. Create and save one to get started!</p>
              </div>
            ) : (
              <div className="qr-saved-grid">
                {savedQRs.map(qr => (
                  <div key={qr.id} className="qr-saved-card">
                    <h3>{qr.name}</h3>
                    {qr.description && <p>{qr.description}</p>}
                    <p className="qr-saved-url">{qr.url}</p>
                    <div className="qr-saved-actions">
                      <button
                        onClick={() => handleLoadQRCode(qr)}
                        className="qr-btn qr-btn-small qr-btn-primary"
                      >
                        Load
                      </button>
                      <button
                        onClick={() => handleDeleteQRCode(qr.id)}
                        className="qr-btn qr-btn-small qr-btn-danger"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Save Modal */}
        {showSaveModal && (
          <div className="qr-modal-overlay" onClick={() => setShowSaveModal(false)}>
            <div className="qr-modal" onClick={(e) => e.stopPropagation()}>
              <h2>Save QR Code</h2>
              <input
                type="text"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="QR Code Name"
                maxLength="255"
                className="qr-input"
              />
              <input
                type="text"
                value={saveDescription}
                onChange={(e) => setSaveDescription(e.target.value)}
                placeholder="Optional Description"
                maxLength="255"
                className="qr-input"
              />
              <div className="qr-modal-actions">
                <button
                  onClick={() => setShowSaveModal(false)}
                  className="qr-btn qr-btn-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveQRCode}
                  disabled={loading}
                  className="qr-btn qr-btn-primary"
                >
                  {loading ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
