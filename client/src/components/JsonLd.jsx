/**
 * JsonLd.jsx - SEO structured data for key public pages (Track P, 2026-11-02).
 *
 * Renders a single <script type="application/ld+json"> tag from a plain
 * object. The object is serialized with JSON.stringify only, and the
 * characters that could break out of a script element (<, >, &) plus the
 * Unicode line/paragraph separators are escaped to \uXXXX sequences before
 * React renders the string as the script's text content. No other
 * dangerouslySetInnerHTML use, and no caller-supplied HTML is ever inserted.
 *
 * Callers must only pass truthful, already-loaded page data: every builder
 * below drops fields the data does not support instead of inventing them.
 */

export function stringifyJsonLd(data) {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function cleanJsonLd(value) {
  return clean(value);
}

function clean(value) {
  if (Array.isArray(value)) {
    const out = value.map(clean).filter((item) => item !== undefined && item !== null && item !== '');
    return out.length ? out : undefined;
  }
  if (value && typeof value === 'object') {
    const out = {};
    Object.entries(value).forEach(([key, item]) => {
      const cleaned = clean(item);
      if (cleaned !== undefined) out[key] = cleaned;
    });
    return Object.keys(out).length ? out : undefined;
  }
  if (typeof value === 'string' && !value.trim()) return undefined;
  return value;
}

/** BreadcrumbList from [{ name, url? }]; the last item may omit url. */
export function buildBreadcrumbList(items) {
  const list = (items || []).filter((item) => item && item.name);
  if (!list.length) return null;
  return clean({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: list.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url || undefined,
    })),
  });
}

/** ItemList from [{ name, url }]; items without a real URL are dropped. */
export function buildItemList(items) {
  const list = (items || []).filter((item) => item && item.name && item.url);
  if (!list.length) return null;
  return clean({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: list.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      url: item.url,
    })),
  });
}

/** FAQPage from [{ question, answer }]; only rendered FAQs, never new copy. */
export function buildFaqPage(faqs) {
  const list = (faqs || []).filter(
    (faq) => faq && typeof faq.question === 'string' && faq.question.trim()
      && typeof faq.answer === 'string' && faq.answer.trim(),
  );
  if (!list.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: list.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: { '@type': 'Answer', text: faq.answer },
    })),
  };
}

export default function JsonLd({ data }) {
  if (!data || typeof data !== 'object') return null;
  const cleaned = clean(data);
  if (!cleaned) return null;
  return (
    <script type="application/ld+json">
      {stringifyJsonLd(cleaned)}
    </script>
  );
}
