import { useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import '../styles/ProductImageGallery.css';
import { useTranslation } from 'react-i18next';

export default function ProductImageGallery({ images = [], productName = 'Product' }) {
  const { t } = useTranslation();
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  // Handle empty images gracefully
  const validImages = Array.isArray(images) ? images.filter(Boolean) : [];
  const hasImages = validImages.length > 0;

  const handlePrevious = () => {
    setActiveImageIndex((prev) =>
      prev === 0 ? validImages.length - 1 : prev - 1
    );
  };

  const handleNext = () => {
    setActiveImageIndex((prev) =>
      prev === validImages.length - 1 ? 0 : prev + 1
    );
  };

  const handleThumbnailClick = (index) => {
    setActiveImageIndex(index);
  };

  const handleMainImageClick = () => {
    setLightboxOpen(true);
  };

  const closeLightbox = () => {
    setLightboxOpen(false);
  };

  if (!hasImages) {
    return (
      <div className="pig-container">
        <div className="pig-main-placeholder">
          <div className="pig-placeholder-content">
          <svg
              className="pig-placeholder-icon"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <p className="pig-placeholder-text">{t('productGallery.noImage')}</p>
          </div>
        </div>
      </div>
    );
  }

  const currentImage = validImages[activeImageIndex];

  return (
    <div className="pig-container">
      {/* Main Image */}
      <div className="pig-main-container">
        <img
          src={currentImage}
          alt={t('productGallery.imageAlt', { productName, index: activeImageIndex + 1 })}
          className="pig-main-image"
          onClick={handleMainImageClick}
        />
        {validImages.length > 1 && (
          <>
            <button
              onClick={handlePrevious}
              className="pig-nav-button pig-nav-prev"
              aria-label={t('productGallery.previousImage')}
            >
              <ChevronLeft size={24} />
            </button>
            <button
              onClick={handleNext}
              className="pig-nav-button pig-nav-next"
              aria-label={t('productGallery.nextImage')}
            >
              <ChevronRight size={24} />
            </button>
          </>
        )}
        <div className="pig-image-counter">
          {activeImageIndex + 1} / {validImages.length}
        </div>
      </div>

      {/* Thumbnails */}
      {validImages.length > 1 && (
        <div className="pig-thumbnails-container">
          {validImages.map((image, index) => (
            <button
              key={index}
              onClick={() => handleThumbnailClick(index)}
              className={`pig-thumbnail ${
                index === activeImageIndex ? 'pig-thumbnail-active' : ''
              }`}
              aria-label={t('productGallery.viewImage', { index: index + 1 })}
              aria-current={index === activeImageIndex}
            >
              <img src={image} alt={t('productGallery.thumbnailAlt', { productName, index: index + 1 })} />
            </button>
          ))}
        </div>
      )}

      {/* Lightbox Modal */}
      {lightboxOpen && (
        <div className="pig-lightbox-overlay" onClick={closeLightbox}>
          <div className="pig-lightbox-content" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={closeLightbox}
              className="pig-lightbox-close"
              aria-label={t('productGallery.closeLightbox')}
            >
              <X size={28} />
            </button>
            <img
              src={currentImage}
              alt={t('productGallery.fullscreenImageAlt', { productName, index: activeImageIndex + 1 })}
              className="pig-lightbox-image"
            />
            {validImages.length > 1 && (
              <>
                <button
                onClick={handlePrevious}
                  className="pig-lightbox-nav pig-lightbox-prev"
                  aria-label={t('productGallery.previousImage')}
                >
                  <ChevronLeft size={32} />
                </button>
                <button
                onClick={handleNext}
                  className="pig-lightbox-nav pig-lightbox-next"
                  aria-label={t('productGallery.nextImage')}
                >
                  <ChevronRight size={32} />
                </button>
              </>
            )}
            <div className="pig-lightbox-counter">
              {activeImageIndex + 1} / {validImages.length}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
