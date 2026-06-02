import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, X, AlertCircle, CheckCircle } from 'lucide-react';
import api from '../../api/axios';
import './CoverImageUpload.css';

/** Turn axios/network errors into a safe string for UI + toast (never pass objects to toast). */
function stringifyUploadError(err, fallback) {
  if (err == null) return fallback;
  if (typeof err === 'string') return err;
  const d = err.response?.data;
  if (d != null) {
    if (typeof d === 'string') return d;
    if (typeof d.message === 'string') return d.message;
    if (typeof d.error === 'string') return d.error;
    if (d.error != null && typeof d.error !== 'object') return String(d.error);
    if (d.fields && typeof d.fields === 'object') {
      const first = Object.values(d.fields).find((v) => typeof v === 'string');
      if (first) return first;
    }
  }
  if (typeof err.message === 'string' && err.message) return err.message;
  return fallback;
}

function safeOnError(onError, message) {
  if (typeof onError !== 'function') return;
  try {
    onError(typeof message === 'string' ? message : String(message));
  } catch {
    /* ignore toast / parent errors */
  }
}

/**
 * CoverImageUpload Component
 *
 * Allows helpers to upload or update their profile cover image.
 * Shows preview, upload progress, and error handling.
 */
export default function CoverImageUpload({
  currentCoverUrl,
  onUploadSuccess,
  onError,
  embedded = false,
  uploadCover,
  deleteCover,
}) {
  const { t } = useTranslation();
  const fileInputRef = useRef(null);

  const [preview, setPreview] = useState(currentCoverUrl);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [fileName, setFileName] = useState(null);
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    setPreview(currentCoverUrl || null);
  }, [currentCoverUrl]);

  const handleFileSelect = async (file) => {
    // Reset states
    setError(null);
    setSuccess(false);

    // Validate file
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      const msg = t('profile.coverImage.invalidFormat');
      setError(msg);
      safeOnError(onError, msg);
      return;
    }

    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      const msg = t('profile.coverImage.fileTooLarge');
      setError(msg);
      safeOnError(onError, msg);
      return;
    }

    // Show preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setPreview(e.target.result);
      setFileName(file.name);
    };
    reader.readAsDataURL(file);

    await uploadCoverImage(file);
  };

  const uploadCoverImage = async (file) => {
    setLoading(true);
    setError(null);

    try {
      const uploadedUrl = uploadCover
        ? await uploadCover(file)
        : await (async () => {
            const formData = new FormData();
            formData.append('image', file);
            const { data } = await api.put('/helper-profile/cover-image', formData);
            return data.data.coverImageUrl;
          })();

      setSuccess(true);
      setFileName(null);
      setPreview(uploadedUrl);

      if (onUploadSuccess) {
        onUploadSuccess(uploadedUrl);
      }

      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      const errorMsg = stringifyUploadError(err, t('profile.coverImage.uploadFailed'));
      setError(errorMsg);
      safeOnError(onError, errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      void handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleInputChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      void handleFileSelect(e.target.files[0]);
    }
  };

  const handleRemove = async () => {
    if (!window.confirm(t('profile.coverImage.confirmDelete'))) {
      return;
    }

    setLoading(true);

    try {
      if (deleteCover) {
        await deleteCover();
      } else {
        await api.delete('/helper-profile/cover-image');
      }

      setPreview(null);
      setError(null);
      setSuccess(true);

      if (onUploadSuccess) {
        onUploadSuccess(null);
      }

      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      const msg = stringifyUploadError(err, t('profile.coverImage.deleteFailed'));
      setError(msg);
      safeOnError(onError, msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="cover-image-upload">
      {!embedded && (
      <div className="cover-upload-header">
        <h3>{t('profile.coverImage.title')}</h3>
        <p className="cover-upload-subtitle">{t('profile.coverImage.subtitle')}</p>
      </div>
      )}

      {/* Preview */}
      <div className="cover-preview-container">
        {preview ? (
          <div className="cover-preview-image">
            <img src={preview} alt="Cover preview" />
            <button
              onClick={handleRemove}
              disabled={loading}
              className="cover-preview-remove"
              title={t('common.delete')}
            >
              <X size={20} />
            </button>
          </div>
        ) : (
          <div className="cover-preview-placeholder">
            <Upload size={40} />
            <p>{t('profile.coverImage.noImageYet')}</p>
          </div>
        )}
      </div>

      {/* Upload Area */}
      <div
        className={`cover-upload-area ${dragActive ? 'active' : ''}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleInputChange}
          disabled={loading}
          className="cover-upload-input"
        />

        <div className="cover-upload-content">
          <Upload size={32} />
          <div>
            <p className="cover-upload-main">{t('profile.coverImage.dragOrClick')}</p>
            <p className="cover-upload-sub">{t('profile.coverImage.formats')}</p>
            <p className="cover-upload-size">{t('profile.coverImage.maxSize')}</p>
          </div>
        </div>
      </div>

      {/* File Name */}
      {fileName && (
        <div className="cover-upload-filename">
          {t('profile.coverImage.selected')}: <strong>{fileName}</strong>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="cover-upload-error">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* Success Message */}
      {success && (
        <div className="cover-upload-success">
          <CheckCircle size={18} />
          <span>
            {preview
              ? t('profile.coverImage.uploadSuccess')
              : t('profile.coverImage.deleteSuccess')}
          </span>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="cover-upload-loading">
          <div className="spinner"></div>
          <p>{t('profile.coverImage.uploading')}</p>
        </div>
      )}

      {/* Recommended Dimensions */}
      <div className="cover-upload-info">
        <p>
          <strong>{t('profile.coverImage.recommended')}:</strong> {t('profile.coverImage.dimensions')}
        </p>
        <p className="cover-upload-tip">
          {t('profile.coverImage.tip')}
        </p>
      </div>
    </div>
  );
}
