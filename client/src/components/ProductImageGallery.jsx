import { useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import '../styles/ProductImageGallery.css';

export default function ProductImageGallery({ images = [], productName = 'Product' }) {
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
            <p className="pig-placeholder-text">No image available</p>
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
          alt={`${productName} - image ${activeImageIndex + 1}`}
          className="pig-main-image"
          onClick={handleMainImageClick}
        />
        {validImages.length > 1 && (
          <>
            <button
              onClick={handlePrevious}
              className="pig-nav-button pig-nav-prev"
              aria-label="Previous image"
            >
              <ChevronLeft size={24} />
            </button>
            <button
              onClick={handleNext}
              className="pig-nav-button pig-nav-next"
              aria-label="Next image"
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
              aria-label={`View image ${index + 1}`}
              aria-current={index === activeImageIndex}
            >
              <img src={image} alt={`${productName} thumbnail ${index + 1}`} />
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
              aria-label="Close lightbox"
            >
              <X size={28} />
            </button>
            <img
              src={currentImage}
              alt={`${productName} - fullscreen`}
              className="pig-lightbox-image"
            />
            {validImages.length > 1 && (
              <>
                <button
                  onClick={handlePrevious}
                  className="pig-lightbox-nav pig-lightbox-prev"
                  aria-label="Previous image"
                >
                  <ChevronLeft size={32} />
                </button>
                <button
                  onClick={handleNext}
                  className="pig-lightbox-nav pig-lightbox-next"
                  aria-label="Next image"
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
