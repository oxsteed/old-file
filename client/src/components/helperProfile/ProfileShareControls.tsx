import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link2, Share2 } from 'lucide-react';
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
  className = '',
}) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

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
    </div>
  );
};

export default ProfileShareControls;
