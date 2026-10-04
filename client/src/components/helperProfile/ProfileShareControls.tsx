import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link2, Share2, QrCode, Download, X } from 'lucide-react';
import toast from 'react-hot-toast';

export interface ProfileShareControlsProps {
  /** Absolute URL to copy / share (e.g. from getPublicSiteUrl() + path) */
  shareUrl: string;
  /** Shown in native share sheet */
  shareTitle: string;
  /** Optional line for system share body */
  shareText?: string;
  /** i18n key prefix: helperProfile or businessProfile (both define `.share.*`) */
  i18nPrefix?: 'helperProfile' | 'businessProfile';
  /** When provided, a "QR code" button opens a popover with the profile QR */
  qrImageUrl?: string;
  className?: string;
}

/**
 * Copy link + Web Share API for public helper/business profiles.
 */
const ProfileShareControls: React.FC<ProfileShareControlsProps> = ({
  shareUrl,
  shareTitle,
  shareText,
  i18nPrefix = 'helperProfile',
  qrImageUrl,
  className = '',
}) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const qrWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!qrOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setQrOpen(false);
    };
    const onPointer = (e: PointerEvent) => {
      if (qrWrapRef.current && !qrWrapRef.current.contains(e.target as Node)) {
        setQrOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [qrOpen]);

  const tk = (key: string, opts?: Record<string, string | number>) =>
    t(`${i18nPrefix}.share.${key}`, opts);

  const payloadText =
    shareText ||
    tk('defaultMessage', {
      name: shareTitle,
      url: shareUrl,
    });

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success(t(`${i18nPrefix}.share.linkCopied`));
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t(`${i18nPrefix}.share.copyFailed`));
    }
  }, [shareUrl, t, i18nPrefix]);

  const handleShare = useCallback(async () => {
    const data: ShareData = {
      title: shareTitle,
      text: payloadText,
      url: shareUrl,
    };
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share(data);
        return;
      } catch (err: unknown) {
        const name = err && typeof err === 'object' && 'name' in err ? (err as Error).name : '';
        if (name === 'AbortError') return;
      }
    }
    await handleCopy();
  }, [shareTitle, payloadText, shareUrl, handleCopy]);

  const showShareButton =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={tk('copyLinkAria')}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-700 text-gray-200 text-sm font-medium hover:bg-gray-800 transition-colors"
      >
        <Link2 className="w-4 h-4 flex-shrink-0" aria-hidden />
        {copied ? tk('copied') : tk('copyLink')}
      </button>
      {showShareButton && (
        <button
          type="button"
          onClick={handleShare}
          aria-label={tk('shareAria')}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-700 text-gray-200 text-sm font-medium hover:bg-gray-800 transition-colors"
        >
          <Share2 className="w-4 h-4 flex-shrink-0" aria-hidden />
          {tk('share')}
        </button>
      )}
      {qrImageUrl && (
        <div ref={qrWrapRef} className="relative inline-flex">
          <button
            type="button"
            onClick={() => setQrOpen((v) => !v)}
            aria-expanded={qrOpen}
            aria-label={tk('qrCodeAria')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-700 text-gray-200 text-sm font-medium hover:bg-gray-800 transition-colors"
          >
            <QrCode className="w-4 h-4 flex-shrink-0" aria-hidden />
            {tk('qrCode')}
          </button>
          {qrOpen && (
            <div
              role="dialog"
              aria-label={tk('qrCodeAria')}
              className="absolute bottom-full mb-2 left-0 z-30 w-56 rounded-2xl border border-gray-700 bg-gray-900 p-4 shadow-xl"
            >
              <button
                type="button"
                onClick={() => setQrOpen(false)}
                aria-label={tk('qrClose')}
                className="absolute top-2 right-2 p-1 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800"
              >
                <X className="w-4 h-4" aria-hidden />
              </button>
              <img
                src={qrImageUrl}
                alt={tk('qrCodeAria')}
                className="w-full h-auto rounded-lg bg-white p-2"
                loading="lazy"
              />
              <p className="mt-2 text-xs text-gray-400 text-center">{tk('qrTitle')}</p>
              <a
                href={qrImageUrl}
                download={`${shareTitle}-qr.png`}
                className="mt-2 inline-flex w-full items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors"
              >
                <Download className="w-4 h-4" aria-hidden />
                {tk('qrDownload')}
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ProfileShareControls;
