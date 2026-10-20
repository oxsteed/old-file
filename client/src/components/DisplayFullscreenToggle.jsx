// Subtle fullscreen toggle for the public restaurant display pages. Small,
// corner-docked, and faded so it does not distract on a wall screen; it
// becomes an exit button while fullscreen is active (ESC also exits).
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useFullscreen } from '../hooks/useFullscreen';

export default function DisplayFullscreenToggle({ targetRef }) {
  const { t } = useTranslation();
  const { isFullscreen, supported, toggle } = useFullscreen(targetRef);

  if (!supported) return null;

  return (
    <button
      type="button"
      className="fd-display-fs-toggle"
      aria-label={isFullscreen ? t('display.fullscreen.exit') : t('display.fullscreen.enter')}
      title={isFullscreen ? t('display.fullscreen.exit') : t('display.fullscreen.enter')}
      onClick={(event) => {
        event.stopPropagation();
        toggle();
      }} data-track="ui.48f4fff886.1"
    >
      {isFullscreen ? '⤡' : '⛶'}
    </button>
  );
}
