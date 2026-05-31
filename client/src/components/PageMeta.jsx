/**
 * PageMeta.jsx - per-page <title>, description, Open Graph / Twitter, canonical.
 * Canonical base: VITE_PUBLIC_SITE_URL (build-time) or window.location.origin.
 */

import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { getPublicSiteUrl, toAbsoluteUrl } from '../utils/seoDescription';

const SITE_NAME = 'OxSteed';
const TWITTER_HANDLE = '@oxsteed';

export default function PageMeta({
  title,
  description,
  image = undefined,
  url = undefined,
  type = 'website',
  noIndex = false,
}) {
  const { t } = useTranslation('common');
  const defaultTitle = t('pageMeta.defaults.title');
  const defaultDescription = t('pageMeta.defaults.description');
  const resolvedTitle = title || defaultTitle;
  const resolvedDescription = description || defaultDescription;
  const base = getPublicSiteUrl();
  const defaultUrl = base;
  const resolvedUrl = url || defaultUrl;
  const resolvedImage = toAbsoluteUrl(image || '/og-default.png');
  const fullTitle = resolvedTitle.includes(SITE_NAME)
    ? resolvedTitle
    : `${resolvedTitle} | ${SITE_NAME}`;

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={resolvedDescription} />
      {noIndex && <meta name="robots" content="noindex, nofollow" />}

      <link rel="canonical" href={resolvedUrl} />

      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:type" content={type} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={resolvedDescription} />
      <meta property="og:image" content={resolvedImage} />
      <meta property="og:url" content={resolvedUrl} />

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:site" content={TWITTER_HANDLE} />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={resolvedDescription} />
      <meta name="twitter:image" content={resolvedImage} />
    </Helmet>
  );
}
