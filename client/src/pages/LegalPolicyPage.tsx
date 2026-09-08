import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';
import { TermsBlocks } from './terms/TermsBlocks';
import type { TermsBlock } from './terms/termsTypes';

export type LegalContentFile = {
  sections: Record<
    string,
    {
      search: string;
      blocks: TermsBlock[];
    }
  >;
};

function isLegalContentFile(x: unknown): x is LegalContentFile {
  return (
    typeof x === 'object' &&
    x !== null &&
    'sections' in x &&
    typeof (x as LegalContentFile).sections === 'object'
  );
}

function mainTocLabel(blocks: TermsBlock[]): string {
  const h2 = blocks.find(
    (b): b is Extract<TermsBlock, { type: 'h2' }> => b.type === 'h2' && !b.sub
  );
  return h2?.text ?? '';
}

function firstParagraphText(blocks: TermsBlock[]): string {
  const paragraph = blocks.find(
    (block): block is Extract<TermsBlock, { type: 'p' }> => block.type === 'p',
  );
  if (!paragraph) return '';
  if (paragraph.text) return paragraph.text;
  return (paragraph.segments || [])
    .map((segment) => {
      if (typeof segment === 'string') return segment;
      if ('strong' in segment) return segment.strong;
      if ('mailto' in segment) return segment.mailto;
      if ('routeLink' in segment) return segment.routeLink.label;
      return '';
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type HeroIconProps = { className?: string };

type LegalPolicyPageProps = {
  HeroIcon: ComponentType<HeroIconProps>;
  /** i18next key holding merged JSON, e.g. termsContent */
  contentKey: string;
  fallbackContent: LegalContentFile;
  sectionIds: readonly number[];
  /** Anchor prefix without trailing dash, e.g. terms-section */
  sectionAnchorPrefix: string;
  /** Namespace prefix for strings in locale JSON, e.g. termsPage */
  i18nPrefix: string;
};

export default function LegalPolicyPage({
  HeroIcon,
  contentKey,
  fallbackContent,
  sectionIds,
  sectionAnchorPrefix,
  i18nPrefix,
}: LegalPolicyPageProps) {
  const { t, i18n } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');

  const pk = (suffix: string) => `${i18nPrefix}.${suffix}`;

  const legalData = useMemo((): LegalContentFile => {
    const raw = t(contentKey, { returnObjects: true });
    if (isLegalContentFile(raw)) return raw;
    return fallbackContent;
  }, [t, i18n.language, contentKey, fallbackContent]);

  const sectionMeta = useMemo(
    () =>
      sectionIds.map((id) => {
        const key = String(id);
        const sec = legalData.sections[key];
        return {
          id,
          match: (sec?.search ?? '').toLowerCase(),
          tocLabel: mainTocLabel(sec?.blocks ?? []),
        };
      }),
    [legalData, sectionIds]
  );

  const metaDescription = useMemo(
    () => firstParagraphText(legalData.sections['1']?.blocks ?? []),
    [legalData],
  );

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const visibleSectionIds = useMemo(() => {
    if (!normalizedQuery) return null;
    const q = normalizedQuery.replace(/\s+/g, ' ');
    const matched = sectionMeta
      .filter(({ id, match }) => {
        if (String(id) === q) return true;
        return match.includes(q);
      })
      .map((x) => x.id);
    return matched.length ? new Set(matched) : new Set<number>();
  }, [normalizedQuery, sectionMeta]);

  const tocLinks = useMemo(
    () =>
      sectionMeta.map(({ id, tocLabel }) => ({
        id,
        label: tocLabel || t(`${i18nPrefix}.sectionTitles.${id}`),
      })),
    [sectionMeta, t, i18nPrefix]
  );

  const sectionHidden = (id: number) =>
    visibleSectionIds !== null && !visibleSectionIds.has(id);

  const lastScrolledFirstId = useRef<number | null>(null);

  useEffect(() => {
    if (visibleSectionIds === null) {
      lastScrolledFirstId.current = null;
      return;
    }
    const firstId = sectionIds.find((m) => visibleSectionIds.has(m));
    if (firstId === undefined) {
      lastScrolledFirstId.current = null;
      return;
    }
    if (lastScrolledFirstId.current === firstId) return;
    lastScrolledFirstId.current = firstId;
    globalThis.document
      .getElementById(`${sectionAnchorPrefix}-${firstId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [visibleSectionIds, sectionIds, sectionAnchorPrefix]);

  const searchInputId = `${sectionAnchorPrefix}-search`;

  return (
    <PageShell>
      <PageMeta title={t(pk('title'))} description={metaDescription} />
      <div className="min-h-screen bg-gray-950 text-gray-300 flex flex-col">
        <div className="bg-gradient-to-r from-orange-600/20 via-orange-500/10 to-transparent border-b border-gray-800">
          <div className="max-w-4xl mx-auto px-4 py-10 flex items-center gap-4">
            <div className="bg-orange-500/20 p-3 rounded-xl">
              <HeroIcon className="w-8 h-8 text-orange-400" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white">{t(pk('title'))}</h1>
              <p className="text-gray-400 text-sm mt-1">{t(pk('lastUpdated'))}</p>
              {i18n.language !== 'en' && (
                <p className="text-gray-500 text-xs mt-2 max-w-xl">
                  {t(pk('translationDisclaimer'))}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1">
          <div className="max-w-6xl mx-auto px-4 py-12 flex gap-10 items-start">
            <aside
              className="sticky top-20 shrink-0 w-52 max-lg:hidden"
              aria-label={t(pk('onThisPageAria'))}
            >
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                {t(pk('onThisPage'))}
              </p>
              <nav className="flex flex-col gap-1 text-sm">
                {tocLinks.map(({ id, label }) => (
                  <a
                    key={id}
                    href={`#${sectionAnchorPrefix}-${id}`}
                    className="text-gray-400 hover:text-orange-400"
                  >
                    {label}
                  </a>
                ))}
              </nav>
            </aside>
            <div className="flex-1 min-w-0 text-sm leading-relaxed">
              <label className="sr-only" htmlFor={searchInputId}>
                {t(pk('searchLabel'))}
              </label>
              <input
                id={searchInputId}
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t(pk('searchPlaceholder'))}
                className="w-full mb-8 px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-gray-200 placeholder:text-gray-500"
              />
              {sectionIds.map((id) => {
                const sec = legalData.sections[String(id)];
                if (!sec?.blocks?.length) return null;
                return (
                  <section
                    key={id}
                    id={`${sectionAnchorPrefix}-${id}`}
                    hidden={sectionHidden(id)}
                    className="mb-8"
                  >
                    <TermsBlocks
                      blocks={sec.blocks}
                      emailLabel={t(pk('emailLabel'))}
                    />
                  </section>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
