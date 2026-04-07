/**
 * PageMeta.jsx
 *
 * Drop-in component for per-page <title> and Open Graph / Twitter Card meta tags.
 *
 * Usage:
 *   import PageMeta from '../components/PageMeta';
 *   <PageMeta
 *     title="Find Local Helpers | OxSteed"
 *     description="Browse verified local helpers for any job."
 *     image="/og/helpers.png"       // optional
 *     url="https://oxsteed.com/helpers"  // optional
 *   />
 *
 * Defaults to site-level values when props are omitted.
 */

import { Helmet } from 'react-helmet-async';

const SITE_NAME  = 'OxSteed';
const DEFAULT_TITLE = 'OxSteed — Hire Local Help Today';
const DEFAULT_DESC  = 'Post a job, compare bids from trusted local helpers, and pay securely with optional escrow protection. Free to start.';
const DEFAULT_IMAGE = 'https://oxsteed.com/og-default.png';
const DEFAULT_URL   = 'https://oxsteed.com';
const TWITTER_HANDLE = '@oxsteed';

export default function PageMeta({
  title       = DEFAULT_TITLE,
  description = DEFAULT_DESC,
  image       = DEFAULT_IMAGE,
  url         = DEFAULT_URL,
  type        = 'website',
  noIndex     = false,
}) {
  const fullTitle = title.includes(SITE_NAME) ? title : `${title} | ${SITE_NAME}`;

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      {noIndex && <meta name="robots" content="noindex, nofollow" />}

      {/* Open Graph */}
      <meta property="og:site_name"   content={SITE_NAME} />
      <meta property="og:type"        content={type} />
      <meta property="og:title"       content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:image"       content={image} />
      <meta property="og:url"         content={url} />

      {/* Twitter Card */}
      <meta name="twitter:card"        content="summary_large_image" />
      <meta name="twitter:site"        content={TWITTER_HANDLE} />
      <meta name="twitter:title"       content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image"       content={image} />
    </Helmet>
  );
}
