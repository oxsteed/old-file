/**
 * PageMeta.jsx - per-page <title>, description, Open Graph / Twitter, canonical.
 * Canonical base: VITE_PUBLIC_SITE_URL (build-time) or window.location.origin.
 */

import { Helmet } from 'react-helmet-async';
import { getPublicSiteUrl, toAbsoluteUrl } from '../utils/seoDescription';

const SITE_NAME = 'OxSteed';
const DEFAULT_TITLE = 'OxSteed - Hire Local Help Today';
const DEFAULT_DESC =
  'Post a job, compare bids from skills local helpers, and pay on OxSteed. Free to start.';
const TWITTER_HANDLE = '@oxsteed';

export default function PageMeta({
  title = DEFAULT_TITLE,
  description = DEFAULT_DESC,
  image,
  url,
  type = 'website',
  noIndex = false,
}) {
  const base = getPublicSiteUrl();
  const defaultUrl = base;
  const resolvedUrl = url || defaultUrl;
  const resolvedImage = toAbsoluteUrl(image || '/og-default.png');
  const fullTitle = title.includes(SITE_NAME) ? title : `${title} | ${SITE_NAME}`;

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      {noIndex && <meta name="robots" content="noindex, nofollow" />}

      <link rel="canonical" href={resolvedUrl} />

      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:type" content={type} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={resolvedImage} />
      <meta property="og:url" content={resolvedUrl} />

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:site" content={TWITTER_HANDLE} />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={resolvedImage} />
    </Helmet>
  );
}
