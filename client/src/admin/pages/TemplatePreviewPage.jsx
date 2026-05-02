import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageMeta from '../../components/PageMeta';
import { TEMPLATE_REGISTRY, ProfileTemplateRenderer } from '../../components/profileTemplates/index';
import { DEMO_TEMPLATE_PROFILE_DATA } from '../utils/templatePreviewData';

export default function TemplatePreviewPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const slug = params.get('slug') || 'default';

  const meta = useMemo(() => TEMPLATE_REGISTRY[slug] || TEMPLATE_REGISTRY.default, [slug]);
  const displayName = meta?.name || slug;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <PageMeta title={`${displayName} - ${t('adminTemplates.previewPageTitle')}`} />
      <div className="sticky top-0 z-20 border-b border-gray-800 bg-gray-950/95 backdrop-blur px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs text-amber-400 font-semibold uppercase tracking-wide">
            {t('adminTemplates.sampleBanner')}
          </p>
          <h1 className="text-lg font-bold text-white">{displayName}</h1>
          <p className="text-xs text-gray-500 font-mono">{slug}</p>
        </div>
        <Link
          to="/admin/templates"
          className="text-sm text-blue-400 hover:text-blue-300 font-medium"
        >
          {t('adminTemplates.backToManagement')}
        </Link>
      </div>
      <div className="max-w-5xl mx-auto px-2 py-4">
        <ProfileTemplateRenderer slug={slug} profileData={DEMO_TEMPLATE_PROFILE_DATA} />
      </div>
    </div>
  );
}
