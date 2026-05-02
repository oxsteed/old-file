import { ProfileTemplateRenderer } from '../../components/profileTemplates/index';
import { DEMO_TEMPLATE_PROFILE_DATA } from '../utils/templatePreviewData';

/** Scaled-down live render for table thumbnails */
export function TemplatePreviewThumb({ slug, className = '', width = 72, height = 52 }) {
  return (
    <div
      className={`relative rounded-lg overflow-hidden border border-gray-700 bg-gray-950 shrink-0 ${className}`}
      style={{ width, height }}
      aria-hidden
    >
      <div
        className="absolute top-0 left-0 origin-top-left pointer-events-none"
        style={{ width: 360, transform: `scale(${width / 360})` }}
      >
        <ProfileTemplateRenderer slug={slug} profileData={DEMO_TEMPLATE_PROFILE_DATA} />
      </div>
    </div>
  );
}

/** Scrollable preview for modals (narrow column or mobile) */
export function TemplatePreviewPanel({ slug, scale = 0.38, maxHeight = 'min(70vh, 520px)' }) {
  const mh = maxHeight === 'none' ? undefined : maxHeight;
  return (
    <div
      className="rounded-xl border border-gray-700 bg-gray-950 overflow-auto overscroll-contain"
      style={mh ? { maxHeight: mh } : {}}
    >
      <div
        className="origin-top-left mx-auto"
        style={{ width: 960, transform: `scale(${scale})`, transformOrigin: 'top center' }}
      >
        <ProfileTemplateRenderer slug={slug} profileData={DEMO_TEMPLATE_PROFILE_DATA} />
      </div>
    </div>
  );
}
