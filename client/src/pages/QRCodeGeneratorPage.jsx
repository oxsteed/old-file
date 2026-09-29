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
import { BARCODE_TYPES, normalizeBarcodeValue, renderBarcode } from '../utils/barcodeGenerator';
import {
  Trash2, Download, Copy, Check, Plus, X, RotateCcw, Search,
  CopyPlus, MapPin, Warehouse, Package, Layers, Utensils, ShoppingBag, Megaphone, Sparkles,
  BadgeDollarSign,
} from 'lucide-react';
import {
  QR_OPERATION_TEMPLATES,
  getQrOperationTemplate,
  getQrOperationDefaults,
  buildQrOperationPayload,
} from '../utils/qrOperationsTemplates';

const QR_DOWNLOAD_DEFAULT_KEY = 'oxs:qr-generator-download-default:v1';
const QR_PENDING_EXPORT_KEY = 'oxs:qr-generator-pending-export:v1';
// A darker OxSteed orange preserves QR contrast on white backgrounds while
// still matching the brand accent used throughout the studio.
const DEFAULT_QR_ORANGE = '#c2410c';

const DOWNLOAD_FORMATS = {
  png: { rawFormat: 'png', mode: 'simple', labelKey: 'downloadFormatPng' },
  svg: { rawFormat: 'svg', mode: 'simple', labelKey: 'downloadFormatSvg' },
  'branded-png': { rawFormat: 'png', mode: 'branded', labelKey: 'downloadFormatBrandedPng' },
  'branded-svg': { rawFormat: 'svg', mode: 'branded', labelKey: 'downloadFormatBrandedSvg' },
  'promo-png': { rawFormat: 'png', mode: 'promotional', labelKey: 'downloadFormatPromoPng' },
  'promo-svg': { rawFormat: 'svg', mode: 'promotional', labelKey: 'downloadFormatPromoSvg' },
};

const OPERATION_ICONS = {
  'map-pin': MapPin,
  warehouse: Warehouse,
  package: Package,
  layers: Layers,
  utensils: Utensils,
  'shopping-bag': ShoppingBag,
  megaphone: Megaphone,
  sparkles: Sparkles,
};

function readStoredDownloadFormat() {
  if (typeof window === 'undefined') return 'promo-png';
  try {
    const stored = window.localStorage.getItem(QR_DOWNLOAD_DEFAULT_KEY);
    return DOWNLOAD_FORMATS[stored] ? stored : 'promo-png';
  } catch (_) {
    return 'promo-png';
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('QR image could not be read'));
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const [header, encoded] = String(dataUrl || '').split(',');
  if (!header || !encoded) throw new Error('Pending QR export is invalid');
  const match = header.match(/^data:([^;]+);base64$/);
  if (!match) throw new Error('Pending QR export is invalid');
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: match[1] });
}

async function createQrExportKey(payload) {
  if (!window.crypto?.subtle) throw new Error('Secure payment verification is unavailable');
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await window.crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const LOGO_STAGE_KEYS = {
  validating: 'logoStageValidating',
  loading: 'logoStageLoading',
  optimizing: 'logoStageOptimizing',
  generating: 'logoStageGenerating',
};

function formatLogoBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  const megabytes = bytes / (1024 * 1024);
  return `${megabytes >= 10 ? megabytes.toFixed(1) : megabytes.toFixed(2)} MB`;
}

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
    dotColor: DEFAULT_QR_ORANGE,
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
  const [promoDescription, setPromoDescription] = useState('');
  const [promoCta, setPromoCta] = useState('');
  const [logoRevision, setLogoRevision] = useState(0);
  const [logoProcessing, setLogoProcessing] = useState(false);
  const [logoProcessingStage, setLogoProcessingStage] = useState('validating');
  const [logoProcessingStartedAt, setLogoProcessingStartedAt] = useState(null);
  const [logoElapsedSeconds, setLogoElapsedSeconds] = useState(0);
  const [logoFileInfo, setLogoFileInfo] = useState(null);
  const [logoProcessingError, setLogoProcessingError] = useState('');
  const [downloadFormat, setDownloadFormat] = useState(readStoredDownloadFormat);
  const [rememberDownloadFormat, setRememberDownloadFormat] = useState(true);
  const [watermarkChoice, setWatermarkChoice] = useState('watermarked');
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [templateKey, setTemplateKey] = useState('custom');
  const [templateData, setTemplateData] = useState({});
  const [savedFilter, setSavedFilter] = useState('all');
  const [savedSearch, setSavedSearch] = useState('');
  const [codeType, setCodeType] = useState('qr');
  const [barcodeErrorKey, setBarcodeErrorKey] = useState('');
  const previewInput = JSON.stringify([
    codeType, formData.url, formData.size, formData.dotColor,
    formData.backgroundColor, formData.dotStyle, logoDataUrl,
  ]);
  const previewReady = Boolean(!logoProcessing && qrInstance && generatedInput === previewInput);
  const showLogoProcessing = codeType === 'qr'
    && !logoProcessingError
    && (logoProcessing || (Boolean(logoDataUrl) && !previewReady));

  useEffect(() => {
    if (!showLogoProcessing || !logoProcessingStartedAt) return undefined;
    const updateElapsed = () => {
      setLogoElapsedSeconds(Math.max(0, Math.floor((Date.now() - logoProcessingStartedAt) / 1000)));
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 250);
    return () => window.clearInterval(timer);
  }, [showLogoProcessing, logoProcessingStartedAt]);

  useEffect(() => () => {
    logoUploadRef.current?.abort();
    logoUploadRef.current = null;
  }, []);

  // Initialize QR code instance and regenerate on changes. Keep the async
  // preview work inside the effect so rejected image generation is surfaced
  // instead of becoming an unhandled promise rejection.
  useEffect(() => {
    let cancelled = false;
    let renderTimer;
    setQRInstance(null);
    setGeneratedInput(null);
    if (qrRef.current) qrRef.current.innerHTML = '';

    if (!canUseQr || !formData.url.trim()) {
      return undefined;
    }

    const generatePreview = async () => {
      try {
        if (logoDataUrl && codeType === 'qr') {
          setLogoProcessingStage('generating');
          setLogoProcessingStartedAt((previous) => previous || Date.now());
        }
        let renderer;
        let blob;
        if (codeType === 'qr') {
          const qr = new QRCodeStyling({
            width: Number(formData.size),
            height: Number(formData.size),
            data: formData.url,
            image: logoDataUrl || undefined,
            // Undefined nested options overwrite the library defaults and crash
            // its constructor. Supply valid options with and without a logo.
            imageOptions: {
              // prepareQrLogo already returns a bounded, embedded PNG data URL.
              // The default re-fetches it with XHR, which production connect-src
              // blocks, leaving the library's drawing promise unresolved.
              saveAsBlob: false,
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
          blob = await Promise.race([
            qr.getRawData('png'),
            new Promise((_, reject) => {
              renderTimer = window.setTimeout(() => reject(new Error('QR render timed out')), 15_000);
            }),
          ]);
          renderer = qr;
        } else {
          const normalized = normalizeBarcodeValue(codeType, formData.url);
          if (normalized.error) {
            const error = new Error(normalized.error);
            error.code = normalized.error;
            throw error;
          }
          blob = await renderBarcode(codeType, normalized.value, 'png', {
            height: Number(formData.size) * 0.55,
            lineColor: formData.dotColor,
            background: formData.backgroundColor,
          });
          renderer = {
            getRawData: (format) => renderBarcode(codeType, normalized.value, format, {
              height: Number(formData.size) * 0.55,
              lineColor: formData.dotColor,
              background: formData.backgroundColor,
            }),
          };
          setBarcodeErrorKey('');
        }
        if (cancelled) return;
        if (!blob || !blob.size) throw new Error('QR image is empty');
        if (qrRef.current) {
          qrRef.current.innerHTML = '';
          if (codeType === 'qr') {
            renderer.append(qrRef.current);
          } else {
            const image = document.createElement('img');
            image.src = URL.createObjectURL(blob);
            image.alt = t('qrGenerator.preview');
            image.onload = () => URL.revokeObjectURL(image.src);
            qrRef.current.appendChild(image);
          }
        }
        setQRInstance(renderer);
        setGeneratedInput(previewInput);
        if (logoDataUrl && codeType === 'qr') {
          setLogoProcessing(false);
          setLogoProcessingStage('ready');
          setLogoProcessingStartedAt(null);
        }
      } catch (err) {
        if (cancelled) return;
        setQRInstance(null);
        setGeneratedInput(null);
        if (err.code === 'barcodeValueRequired' || err.code === 'barcodeCode128Invalid' || err.code === 'barcodeEan13Invalid') {
          setBarcodeErrorKey(err.code);
          return;
        }
        if (logoDataUrl && codeType === 'qr') {
          setLogoProcessing(false);
          setLogoProcessingStage('error');
          setLogoProcessingError('logoInvalid');
          setLogoProcessingStartedAt(null);
        }
        logger.error('QRCodeGeneratorPage: QR generation error', { err: err.message });
        toast.error(t('qrGenerator.errorGenerating'));
      } finally {
        window.clearTimeout(renderTimer);
      }
    };

    generatePreview();

    return () => {
      cancelled = true;
      window.clearTimeout(renderTimer);
    };
  }, [previewInput, logoRevision, canUseQr, codeType, t]);

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

  const handleCodeTypeChange = (nextType) => {
    setCodeType(nextType);
    setBarcodeErrorKey('');
    if (nextType !== 'qr' && logoDataUrl) {
      setLogoProcessingError('');
      setLogoProcessing(false);
      setLogoProcessingStage('idle');
      setLogoProcessingStartedAt(null);
    }
  };

  const handleColorChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const processLogoFile = async (file) => {
    if (!file) return;
    logoUploadRef.current?.abort();
    const controller = new AbortController();
    logoUploadRef.current = controller;
    setLogoFileInfo({ file, name: file.name, size: file.size, type: file.type, dimensions: null });
    setLogoProcessingError('');
    setLogoProcessing(true);
    setLogoProcessingStage('validating');
    setLogoProcessingStartedAt(Date.now());
    setLogoElapsedSeconds(0);
    try {
      const normalized = await prepareQrLogo(file, controller.signal, ({ stage, dimensions }) => {
        setLogoProcessingStage(stage);
        if (dimensions) {
          setLogoFileInfo((previous) => previous ? { ...previous, dimensions } : previous);
        }
      });
      if (!controller.signal.aborted) {
        setLogoDataUrl(normalized);
        // Retrying/reselecting the same logo must complete processing even if
        // its normalized data URL is identical to the previous selection.
        setLogoRevision((revision) => revision + 1);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      const key = ['logoTooLarge', 'logoUnsupported', 'logoDimensions', 'logoInvalid'].includes(err.message)
        ? err.message : 'logoInvalid';
      setLogoProcessing(false);
      setLogoProcessingStage('error');
      setLogoProcessingError(key);
      setLogoProcessingStartedAt(null);
      toast.error(t(`qrGenerator.${key}`));
      if (logoInputRef.current) logoInputRef.current.value = '';
    } finally {
      if (logoUploadRef.current === controller) {
        logoUploadRef.current = null;
      }
    }
  };

  const handleLogoChange = (e) => {
    processLogoFile(e.target.files?.[0]);
  };

  const handleCancelLogoProcessing = () => {
    logoUploadRef.current?.abort();
    logoUploadRef.current = null;
    if (logoProcessingStage === 'generating') setLogoDataUrl('');
    setLogoProcessing(false);
    setLogoProcessingStage('idle');
    setLogoProcessingStartedAt(null);
    setLogoProcessingError('');
    if (logoInputRef.current) logoInputRef.current.value = '';
  };

  const handleRetryLogo = () => {
    if (logoFileInfo?.file) processLogoFile(logoFileInfo.file);
  };

  const handleRemoveLogo = () => {
    logoUploadRef.current?.abort();
    logoUploadRef.current = null;
    setLogoProcessing(false);
    setLogoProcessingStage('idle');
    setLogoProcessingStartedAt(null);
    setLogoProcessingError('');
    setLogoFileInfo(null);
    setLogoDataUrl('');
    if (logoInputRef.current) logoInputRef.current.value = '';
  };

  const applyOperationalTemplate = (nextKey) => {
    const template = getQrOperationTemplate(nextKey);
    const defaults = getQrOperationDefaults(template);
    setTemplateKey(template.key);
    setTemplateData(defaults);
    if (template.key === 'custom') {
      setFormData((previous) => ({ ...previous, title: '', url: 'https://example.com' }));
      setPromoDescription('');
      setPromoCta('');
      return;
    }
    setFormData((previous) => ({
      ...previous,
      title: t(template.titleKey),
      url: buildQrOperationPayload(template, defaults),
    }));
    setPromoDescription(t(template.descriptionKey));
    setPromoCta(t('qrGenerator.operations.defaultCta'));
  };

  const handleTemplateFieldChange = (fieldKey, value) => {
    const nextData = { ...templateData, [fieldKey]: value };
    const template = getQrOperationTemplate(templateKey);
    setTemplateData(nextData);
    setFormData((previous) => ({
      ...previous,
      url: buildQrOperationPayload(template, nextData),
    }));
  };

  const handleDuplicateQR = (qr) => {
    const nextTemplate = getQrOperationTemplate(qr.template_key || 'custom');
    const nextData = qr.label_data && typeof qr.label_data === 'object' ? qr.label_data : {};
    setTemplateKey(nextTemplate.key);
    setTemplateData(nextData);
    setCodeType(BARCODE_TYPES[qr.code_type] ? qr.code_type : 'qr');
    setFormData((previous) => ({
      ...previous,
      title: qr.title || '',
      url: qr.url || 'https://example.com',
      dotColor: qr.dot_color || DEFAULT_QR_ORANGE,
      backgroundColor: qr.background_color || '#ffffff',
      dotStyle: qr.dot_style || 'square',
      size: Number(qr.size) || 300,
    }));
    toast.success(t('qrGenerator.operations.duplicateReady'));
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
        codeType,
        workspace: getQrOperationTemplate(templateKey).workspace,
        templateKey,
        labelData: templateData,
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
      const titledBlob = await composeQrDownload(blob, qr.title, format, { watermark: true });
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

  const performExportDownload = async ({
    rawBlob,
    formatKey,
    watermark,
    title = formData.title,
    description = promoDescription,
    cta = promoCta,
    backgroundColor = formData.backgroundColor,
    accentColor = formData.dotColor || DEFAULT_QR_ORANGE,
  }) => {
    const selection = DOWNLOAD_FORMATS[formatKey] || DOWNLOAD_FORMATS['promo-png'];
    const titledBlob = await composeQrDownload(rawBlob, title, selection.rawFormat, {
      mode: selection.mode,
      description,
      cta,
      backgroundColor,
      accentColor,
      watermark,
    });
    const url = URL.createObjectURL(titledBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = qrDownloadFileName(title, selection.rawFormat);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success(t('qrGenerator.downloadSuccess'));
  };

  const buildExportPayload = () => ({
    codeType,
    title: formData.title.trim(),
    url: formData.url.trim(),
    dotColor: formData.dotColor,
    backgroundColor: formData.backgroundColor,
    dotStyle: formData.dotStyle,
    size: Number(formData.size),
    logo: logoDataUrl,
    templateKey,
    labelData: templateData,
    format: downloadFormat,
    description: promoDescription.trim(),
    cta: promoCta.trim(),
  });

  const handleDownloadQR = async () => {
    try {
      if (!previewReady) {
        toast.error(t('qrGenerator.errorGenerating'));
        return;
      }

      const selection = DOWNLOAD_FORMATS[downloadFormat] || DOWNLOAD_FORMATS['promo-png'];
      if (selection.mode === 'promotional' && !formData.title.trim()) {
        toast.error(t('qrGenerator.titleRequired'));
        return;
      }
      const rawBlob = await qrInstance.getRawData(selection.rawFormat);
      if (watermarkChoice === 'watermarked') {
        await performExportDownload({ rawBlob, formatKey: downloadFormat, watermark: true });
        return;
      }

      setPaymentLoading(true);
      const qrKey = await createQrExportKey(buildExportPayload());
      const pending = {
        qrKey,
        formatKey: downloadFormat,
          rawImage: await blobToDataUrl(rawBlob),
        codeType,
        title: formData.title,
        url: formData.url,
        description: promoDescription,
        cta: promoCta,
        backgroundColor: formData.backgroundColor,
        accentColor: formData.dotColor || DEFAULT_QR_ORANGE,
      };
      const { data } = await qrCodesApi.createExportCheckout({ qrKey, format: downloadFormat });
      if (data.data?.paid || data.data?.alreadyPaid) {
        await performExportDownload({ rawBlob, formatKey: downloadFormat, watermark: false });
        return;
      }

      window.sessionStorage.setItem(QR_PENDING_EXPORT_KEY, JSON.stringify(pending));
      if (!data.data?.url) throw new Error('Checkout URL is unavailable');
      window.location.assign(data.data.url);
    } catch (err) {
      logger.error('QRCodeGeneratorPage: download error', { err: err.message });
      toast.error(err.response?.data?.error || t('qrGenerator.downloadError'));
    } finally {
      setPaymentLoading(false);
    }
  };

  useEffect(() => {
    if (!rememberDownloadFormat) return;
    try {
      window.localStorage.setItem(QR_DOWNLOAD_DEFAULT_KEY, downloadFormat);
    } catch (_) {
      // A blocked storage context should not prevent downloading.
    }
  }, [downloadFormat, rememberDownloadFormat]);

  // Stripe Checkout returns to this page. Verify the session with the server
  // before producing a watermark-free file, then replay the exact export that
  // the user started before leaving the page.
  useEffect(() => {
    if (!canUseQr || typeof window === 'undefined') return undefined;
    const params = new URLSearchParams(window.location.search);
    if (params.get('qr_payment') !== 'success' || !params.get('session_id')) return undefined;

    let cancelled = false;
    const recoverPaidExport = async () => {
      setPaymentLoading(true);
      try {
        const pendingRaw = window.sessionStorage.getItem(QR_PENDING_EXPORT_KEY);
        if (!pendingRaw) throw new Error(t('qrGenerator.paymentSessionMissing'));
        const pending = JSON.parse(pendingRaw);
        const { data } = await qrCodesApi.verifyExportCheckout({
          sessionId: params.get('session_id'),
          qrKey: pending.qrKey,
        });
        if (!data.data?.paid) throw new Error(t('qrGenerator.paymentNotCompleted'));
        if (cancelled) return;
        await performExportDownload({
          rawBlob: dataUrlToBlob(pending.rawImage),
          formatKey: pending.formatKey,
          watermark: false,
          title: pending.title,
          description: pending.description,
          cta: pending.cta,
          backgroundColor: pending.backgroundColor,
          accentColor: pending.accentColor,
        });
        window.sessionStorage.removeItem(QR_PENDING_EXPORT_KEY);
        window.history.replaceState({}, document.title, window.location.pathname);
      } catch (err) {
        if (!cancelled) {
          logger.error('QRCodeGeneratorPage: paid export recovery failed', { err: err.message });
          toast.error(err.response?.data?.error || err.message || t('qrGenerator.paymentVerificationFailed'));
        }
      } finally {
        if (!cancelled) setPaymentLoading(false);
      }
    };

    recoverPaidExport();
    return () => { cancelled = true; };
  }, [canUseQr, t]);

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

  const normalizedSavedSearch = savedSearch.trim().toLowerCase();
  const filteredSavedQRs = savedQRs.filter((qr) => {
    const matchesWorkspace = savedFilter === 'all' || (qr.workspace || 'custom') === savedFilter;
    if (!matchesWorkspace) return false;
    if (!normalizedSavedSearch) return true;
    return [qr.title, qr.url, qr.template_key, qr.workspace]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedSavedSearch));
  });
  const savedWorkspaceCount = (workspace) => savedQRs.filter((qr) => (qr.workspace || 'custom') === workspace).length;

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
          <span className="qrg-eyebrow">{t('qrGenerator.studioEyebrow')}</span>
          <h1 className="qrg-title">{t('qrGenerator.title')}</h1>
          <p className="qrg-subtitle">{t('qrGenerator.subtitle')}</p>
          <div className="qrg-journey" aria-label={t('qrGenerator.journeyLabel')}>
            <span className="qrg-journey-step qrg-journey-step-active"><b>01</b>{t('qrGenerator.journeyCreate')}</span>
            <span className="qrg-journey-line" aria-hidden="true" />
            <span className="qrg-journey-step"><b>02</b>{t('qrGenerator.journeyStyle')}</span>
            <span className="qrg-journey-line" aria-hidden="true" />
            <span className="qrg-journey-step"><b>03</b>{t('qrGenerator.journeyShare')}</span>
          </div>
        </div>

        <Link to="/qr-payments" className="qrg-pay-banner">
          <span className="qrg-pay-banner-icon" aria-hidden="true">
            <BadgeDollarSign size={26} />
          </span>
          <span className="qrg-pay-banner-copy">
            <strong>{t('qrPay.bannerTitle', { defaultValue: 'Get paid with QR codes' })}</strong>
            <span>{t('qrPay.bannerBody', { defaultValue: 'Create a QR code customers can scan to pay you directly.' })}</span>
          </span>
          <span className="qrg-pay-banner-cta">{t('qrPay.bannerCta', { defaultValue: 'Set up QR payments' })}</span>
        </Link>

        <section className="qrg-operations-panel" aria-labelledby="qrg-operations-title">
          <div className="qrg-operations-header">
            <div>
              <span className="qrg-section-kicker">{t('qrGenerator.operations.kicker')}</span>
              <h2 id="qrg-operations-title">{t('qrGenerator.operations.title')}</h2>
              <p>{t('qrGenerator.operations.subtitle')}</p>
            </div>
            <div className="qrg-operations-stat">
              <strong>{t('qrGenerator.operations.freeLabel')}</strong>
              <span>{t('qrGenerator.operations.freeDetail')}</span>
            </div>
          </div>
          <div className="qrg-code-type-picker">
            <div>
              <span className="qrg-section-kicker">{t('qrGenerator.codeTypeKicker')}</span>
              <h3>{t('qrGenerator.codeTypeTitle')}</h3>
              <p>{t('qrGenerator.codeTypeHelp')}</p>
            </div>
            <div className="qrg-code-type-options" role="radiogroup" aria-label={t('qrGenerator.codeTypeTitle')}>
              {Object.entries(BARCODE_TYPES).map(([type, details]) => (
                <button
                  key={type}
                  type="button"
                  role="radio"
                  aria-checked={codeType === type}
                  className={`qrg-code-type-option ${codeType === type ? 'is-selected' : ''}`}
                  onClick={() => handleCodeTypeChange(type)}
                >
                  <strong>{t(`qrGenerator.${details.labelKey}`)}</strong>
                  <span>{t(`qrGenerator.${details.descriptionKey}`)}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="qrg-template-grid">
            {QR_OPERATION_TEMPLATES.map((template) => {
              const Icon = OPERATION_ICONS[template.icon] || Sparkles;
              return (
                <button
                  key={template.key}
                  type="button"
                  className={`qrg-template-card ${templateKey === template.key ? 'is-selected' : ''}`}
                  onClick={() => applyOperationalTemplate(template.key)}
                  aria-pressed={templateKey === template.key}
                >
                  <span className="qrg-template-icon"><Icon size={18} /></span>
                  <span className="qrg-template-copy">
                    <small>{t(template.categoryKey)}</small>
                    <strong>{t(template.titleKey)}</strong>
                    <span>{t(template.descriptionKey)}</span>
                  </span>
                </button>
              );
            })}
          </div>

          {templateKey !== 'custom' && (
            <div className="qrg-label-fields">
              <div className="qrg-label-fields-heading">
                <div>
                  <span className="qrg-section-kicker">{t('qrGenerator.operations.labelDetails')}</span>
                  <h3>{t(getQrOperationTemplate(templateKey).titleKey)}</h3>
                </div>
                <span className="qrg-structured-badge">{t('qrGenerator.operations.structuredBadge')}</span>
              </div>
              <div className="qrg-label-fields-grid">
                {getQrOperationTemplate(templateKey).fields.map((field) => (
                  <div className="qrg-form-group" key={field.key}>
                    <label htmlFor={`operation-${field.key}`}>{t(field.labelKey)}</label>
                    <input
                      id={`operation-${field.key}`}
                      value={templateData[field.key] || ''}
                      onChange={(event) => handleTemplateFieldChange(field.key, event.target.value)}
                      placeholder={t(field.placeholderKey)}
                      className="qrg-input"
                      maxLength={120}
                    />
                  </div>
                ))}
              </div>
              <p className="qrg-label-payload">{t('qrGenerator.operations.payloadHelp')}</p>
            </div>
          )}
        </section>

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
                {codeType !== 'qr' && (
                  <p className={`qrg-barcode-help ${barcodeErrorKey ? 'is-error' : ''}`} role={barcodeErrorKey ? 'alert' : undefined}>
                    {barcodeErrorKey ? t(`qrGenerator.${barcodeErrorKey}`) : t(`qrGenerator.${BARCODE_TYPES[codeType].descriptionKey}`)}
                  </p>
                )}
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
                      <strong>{t(`qrGenerator.${LOGO_STAGE_KEYS[logoProcessingStage] || 'logoProcessing'}`)}</strong>
                      <small>{t('qrGenerator.logoProcessingDetail')}</small>
                      {logoFileInfo && (
                        <small className="qrg-processing-meta">
                          {t('qrGenerator.logoFileDetails', {
                            name: logoFileInfo.name,
                            size: formatLogoBytes(logoFileInfo.size),
                            dimensions: logoFileInfo.dimensions
                              ? `${logoFileInfo.dimensions.width}×${logoFileInfo.dimensions.height}`
                              : t('qrGenerator.logoDimensionsPending'),
                          })}
                          {logoElapsedSeconds > 0 && ` · ${t('qrGenerator.logoElapsed', { seconds: logoElapsedSeconds })}`}
                        </small>
                      )}
                      {logoElapsedSeconds >= 3 && (
                        <small className="qrg-processing-slow">{t('qrGenerator.logoProcessingSlow')}</small>
                      )}
                    </span>
                    {logoProcessing && (
                      <button type="button" className="qrg-processing-cancel" onClick={handleCancelLogoProcessing}>
                        <X size={14} />
                        {t('qrGenerator.logoCancel')}
                      </button>
                    )}
                    <span className="qrg-processing-track" aria-hidden="true"><span /></span>
                  </div>
                )}
                {logoProcessingError && (
                  <div className="qrg-logo-error" role="alert">
                    <strong>{t('qrGenerator.logoProcessingFailed')}</strong>
                    <small>{t('qrGenerator.logoRetryDetail')}</small>
                    {logoFileInfo?.file && (
                      <button type="button" className="qrg-button qrg-button-secondary" onClick={handleRetryLogo}>
                        <RotateCcw size={16} />
                        {t('qrGenerator.logoRetry')}
                      </button>
                    )}
                  </div>
                )}
                {logoDataUrl && !logoProcessing && (
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

            <div className="qrg-download-options">
              <div className="qrg-download-heading">
                <div>
                  <span className="qrg-section-kicker">{t('qrGenerator.downloadKicker')}</span>
                  <h3>{t('qrGenerator.downloadTitle')}</h3>
                </div>
                <span className="qrg-price-pill">{watermarkChoice === 'clean' ? '$1' : t('qrGenerator.free')}</span>
              </div>
              <label htmlFor="downloadFormat">{t('qrGenerator.downloadFormat')}</label>
              <select
                id="downloadFormat"
                value={downloadFormat}
                onChange={(event) => setDownloadFormat(event.target.value)}
                className="qrg-select"
              >
                {Object.entries(DOWNLOAD_FORMATS).map(([value, option]) => (
                  <option key={value} value={value}>{t(`qrGenerator.${option.labelKey}`)}</option>
                ))}
              </select>
              <p>{t(`qrGenerator.${DOWNLOAD_FORMATS[downloadFormat]?.labelKey || 'downloadFormatPromoPng'}Help`)}</p>
              {DOWNLOAD_FORMATS[downloadFormat]?.mode === 'promotional' && (
                <div className="qrg-promo-fields">
                  <div className="qrg-form-group">
                    <label htmlFor="promoDescription">{t('qrGenerator.promoDescription')}</label>
                    <textarea
                      id="promoDescription"
                      value={promoDescription}
                      onChange={(event) => setPromoDescription(event.target.value)}
                      className="qrg-input qrg-textarea"
                      maxLength={240}
                      placeholder={t('qrGenerator.promoDescriptionPlaceholder')}
                    />
                  </div>
                  <div className="qrg-form-group">
                    <label htmlFor="promoCta">{t('qrGenerator.promoCta')}</label>
                    <input
                      id="promoCta"
                      value={promoCta}
                      onChange={(event) => setPromoCta(event.target.value)}
                      className="qrg-input"
                      maxLength={80}
                      placeholder={t('qrGenerator.promoCtaPlaceholder')}
                    />
                  </div>
                </div>
              )}
              <div className="qrg-export-choice" role="radiogroup" aria-label={t('qrGenerator.watermarkChoice')}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={watermarkChoice === 'watermarked'}
                  className={`qrg-export-choice-card ${watermarkChoice === 'watermarked' ? 'is-selected' : ''}`}
                  onClick={() => setWatermarkChoice('watermarked')}
                >
                  <span className="qrg-choice-dot" aria-hidden="true" />
                  <span><strong>{t('qrGenerator.watermarkedOption')}</strong><small>{t('qrGenerator.watermarkedHelp')}</small></span>
                  <b>{t('qrGenerator.free')}</b>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={watermarkChoice === 'clean'}
                  className={`qrg-export-choice-card ${watermarkChoice === 'clean' ? 'is-selected' : ''}`}
                  onClick={() => setWatermarkChoice('clean')}
                >
                  <span className="qrg-choice-dot" aria-hidden="true" />
                  <span><strong>{t('qrGenerator.cleanOption')}</strong><small>{t('qrGenerator.cleanHelp')}</small></span>
                  <b>$1</b>
                </button>
              </div>
              <label className="qrg-default-format">
                <input
                  type="checkbox"
                  checked={rememberDownloadFormat}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setRememberDownloadFormat(checked);
                    if (!checked) {
                      try { window.localStorage.removeItem(QR_DOWNLOAD_DEFAULT_KEY); } catch (_) { /* ignore */ }
                    }
                  }}
                />
                {t('qrGenerator.rememberFormat')}
              </label>
            </div>

            <div className="qrg-download-buttons">
              <button
                onClick={handleDownloadQR}
                disabled={!previewReady || paymentLoading}
                className="qrg-button qrg-button-primary"
              >
                <Download size={16} />
                {paymentLoading ? t('qrGenerator.paymentProcessing') : watermarkChoice === 'clean' ? t('qrGenerator.payAndDownload') : t('qrGenerator.downloadSelected')}
              </button>
            </div>
            <p className="qrg-download-footnote">{t('qrGenerator.watermarkFootnote')}</p>

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
            <div className="qrg-management-header">
              <div>
                <span className="qrg-section-kicker">{t('qrGenerator.operations.managementKicker')}</span>
                <h2 className="qrg-section-title">{t('qrGenerator.savedQRs')}</h2>
                <p>{t('qrGenerator.operations.managementSubtitle')}</p>
              </div>
              <div className="qrg-management-stats" aria-label={t('qrGenerator.operations.managementStats')}>
                <span><b>{savedQRs.length}</b>{t('qrGenerator.operations.totalLabels')}</span>
                <span><b>{savedWorkspaceCount('warehouse')}</b>{t('qrGenerator.operations.warehouseLabels')}</span>
                <span><b>{savedWorkspaceCount('restaurant')}</b>{t('qrGenerator.operations.restaurantLabels')}</span>
              </div>
            </div>
            <div className="qrg-management-toolbar">
              <label className="qrg-search-box">
                <Search size={16} aria-hidden="true" />
                <span className="sr-only">{t('qrGenerator.operations.searchLabels')}</span>
                <input
                  value={savedSearch}
                  onChange={(event) => setSavedSearch(event.target.value)}
                  placeholder={t('qrGenerator.operations.searchPlaceholder')}
                />
              </label>
              <div className="qrg-filter-pills" role="group" aria-label={t('qrGenerator.operations.filterLabels')}>
                {['all', 'warehouse', 'restaurant', 'custom'].map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    className={savedFilter === filter ? 'is-selected' : ''}
                    onClick={() => setSavedFilter(filter)}
                  >
                    {t(`qrGenerator.operations.filter${filter[0].toUpperCase()}${filter.slice(1)}`)}
                  </button>
                ))}
              </div>
            </div>
            {filteredSavedQRs.length === 0 ? (
              <div className="qrg-management-empty">{t('qrGenerator.operations.noMatchingLabels')}</div>
            ) : (
              <div className="qrg-grid">
              {filteredSavedQRs.map((qr) => (
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
                    <span className={`qrg-workspace-tag qrg-workspace-${qr.workspace || 'custom'}`}>
                      {t(`qrGenerator.operations.workspace${(qr.workspace || 'custom')[0].toUpperCase()}${(qr.workspace || 'custom').slice(1)}`)}
                    </span>
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
                      onClick={() => handleDuplicateQR(qr)}
                      className="qrg-action-btn"
                      title={t('qrGenerator.operations.duplicateLabel')}
                    >
                      <CopyPlus size={18} />
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
            )}
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
