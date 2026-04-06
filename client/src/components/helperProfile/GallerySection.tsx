import React, { useState } from 'react';
import { X, ChevronLeft, ChevronRight, ZoomIn } from 'lucide-react';
import type { GalleryImage } from '../../types/helperProfile';
import SectionCard from './ui/SectionCard';

interface GallerySectionProps {
  images: GalleryImage[];
}

const GallerySection: React.FC<GallerySectionProps> = ({ images }) => {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const openLightbox = (i: number) => setLightboxIndex(i);
  const closeLightbox = () => setLightboxIndex(null);

  const prev = () =>
    setLightboxIndex((i) => (i === null ? null : (i - 1 + images.length) % images.length));
  const next = () =>
    setLightboxIndex((i) => (i === null ? null : (i + 1) % images.length));

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') prev();
    if (e.key === 'ArrowRight') next();
    if (e.key === 'Escape') closeLightbox();
  };

  if (images.length === 0) return null;

  return (
    <>
      <SectionCard
        id="gallery"
        title="Photos & Work Samples"
        subtitle={`${images.length} photos from recent jobs`}
      >
        <div
          className="grid grid-cols-2 sm:grid-cols-3 gap-2"
          role="list"
          aria-label="Work photo gallery"
        >
          {images.map((img, i) => (
            <div
              key={img.id}
              role="listitem"
              className={`relative group cursor-pointer rounded-xl overflow-hidden bg-gray-800 ${
                i === 0 ? 'col-span-2 sm:col-span-1 row-span-2 sm:row-span-1' : ''
              }`}
              style={{ aspectRatio: i === 0 ? '4/3' : '4/3' }}
            >
              <img
                src={img.url}
                alt={img.alt}
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                loading="lazy"
              />
              {/* Hover overlay */}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                <ZoomIn
                  className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-hidden="true"
                />
              </div>
              {/* Caption */}
              {img.caption && (
                <div className="absolute bottom-0 inset-x-0 px-2.5 py-2 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                  <p className="text-white text-xs leading-snug">{img.caption}</p>
                </div>
              )}
              <button
                onClick={() => openLightbox(i)}
                className="absolute inset-0"
                aria-label={`View photo: ${img.alt}`}
              />
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Photo lightbox"
          className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center"
          onClick={closeLightbox}
          onKeyDown={handleKeyDown}
          tabIndex={-1}
        >
          {/* Close */}
          <button
            onClick={closeLightbox}
            className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            aria-label="Close lightbox"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Prev */}
          {images.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); prev(); }}
              className="absolute left-4 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
              aria-label="Previous photo"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
          )}

          {/* Image */}
          <div
            className="max-w-4xl max-h-[80vh] mx-16 flex flex-col items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={images[lightboxIndex].url}
              alt={images[lightboxIndex].alt}
              className="max-h-[72vh] max-w-full rounded-xl object-contain shadow-2xl"
            />
            {images[lightboxIndex].caption && (
              <p className="text-gray-400 text-sm text-center">
                {images[lightboxIndex].caption}
              </p>
            )}
            <p className="text-gray-600 text-xs">
              {lightboxIndex + 1} / {images.length}
            </p>
          </div>

          {/* Next */}
          {images.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); next(); }}
              className="absolute right-4 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
              aria-label="Next photo"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          )}
        </div>
      )}
    </>
  );
};

export default GallerySection;
