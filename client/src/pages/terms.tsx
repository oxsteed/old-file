import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText } from 'lucide-react';
import PageShell from '../components/PageShell';
import { TermsBlocks } from './terms/TermsBlocks';
import type { TermsBlock } from './terms/termsTypes';
import enTerms from '../locales/terms/en.content.json';

const SECTION_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20] as const;

type TermsContentFile = {
  sections: Record<
    string,
    {
      search: string;
      blocks: TermsBlock[];
    }
  >;
};

function isTermsContentFile(x: unknown): x is TermsContentFile {
  return (
    typeof x === 'object' &&
    x !== null &&
    'sections' in x &&
    typeof (x as TermsContentFile).sections === 'object'
  );
}

function mainTocLabel(blocks: TermsBlock[]): string {
  const h2 = blocks.find(
    (b): b is Extract<TermsBlock, { type: 'h2' }> => b.type === 'h2' && !b.sub
  );
  return h2?.text ?? '';
}

export default function TermsOfService() {
  const { t, i18n } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');

  const termsData = useMemo((): TermsContentFile => {
    const raw = t('termsContent', { returnObjects: true });
    if (isTermsContentFile(raw)) return raw;
    return enTerms as TermsContentFile;
  }, [t, i18n.language]);

  const sectionMeta = useMemo(
    () =>
      SECTION_IDS.map((id) => {
        const key = String(id);
        const sec = termsData.sections[key];
        return {
          id,
          match: (sec?.search ?? '').toLowerCase(),
          tocLabel: mainTocLabel(sec?.blocks ?? []),
        };
      }),
    [termsData]
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
        label: tocLabel || t(`termsPage.sectionTitles.${id}`),
      })),
    [sectionMeta, t]
  );

  const sectionHidden = (id: number) =>
    visibleSectionIds !== null && !visibleSectionIds.has(id);

  const lastScrolledFirstId = useRef<number | null>(null);

  useEffect(() => {
    if (visibleSectionIds === null) {
      lastScrolledFirstId.current = null;
      return;
    }
    const firstId = SECTION_IDS.find((m) => visibleSectionIds.has(m));
    if (firstId === undefined) {
      lastScrolledFirstId.current = null;
      return;
    }
    if (lastScrolledFirstId.current === firstId) return;
    lastScrolledFirstId.current = firstId;
    globalThis.document
      .getElementById(`terms-section-${firstId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [visibleSectionIds]);

  return (
    <PageShell>
      <div className="min-h-screen bg-gray-950 text-gray-300 flex flex-col">
        <div className="bg-gradient-to-r from-orange-600/20 via-orange-500/10 to-transparent border-b border-gray-800">
          <div className="max-w-4xl mx-auto px-4 py-10 flex items-center gap-4">
            <div className="bg-orange-500/20 p-3 rounded-xl">
              <FileText className="w-8 h-8 text-orange-400" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white">{t('termsPage.title')}</h1>
              <p className="text-gray-400 text-sm mt-1">{t('termsPage.lastUpdated')}</p>
              {i18n.language !== 'en' && (
                <p className="text-gray-500 text-xs mt-2 max-w-xl">
                  {t('termsPage.translationDisclaimer')}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1">
          <div className="max-w-6xl mx-auto px-4 py-12 flex gap-10 items-start">
            <aside
              className="sticky top-20 shrink-0 w-52 max-lg:hidden"
              aria-label={t('termsPage.onThisPageAria')}
            >
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                {t('termsPage.onThisPage')}
              </p>
              <nav className="flex flex-col gap-1 text-sm">
                {tocLinks.map(({ id, label }) => (
                  <a
                    key={id}
                    href={`#terms-section-${id}`}
                    className="text-gray-400 hover:text-orange-400"
                  >
                    {label}
                  </a>
                ))}
              </nav>
            </aside>
            <div className="flex-1 min-w-0 text-sm leading-relaxed">
              <label className="sr-only" htmlFor="terms-section-search">
                {t('termsPage.searchLabel')}
              </label>
              <input
                id="terms-section-search"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('termsPage.searchPlaceholder')}
                className="w-full mb-8 px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-gray-200 placeholder:text-gray-500"
              />
              {SECTION_IDS.map((id) => {
                const sec = termsData.sections[String(id)];
                if (!sec?.blocks?.length) return null;
                return (
                  <section
                    key={id}
                    id={`terms-section-${id}`}
                    hidden={sectionHidden(id)}
                    className="mb-8"
                  >
                    <TermsBlocks
                      blocks={sec.blocks}
                      emailLabel={t('termsPage.emailLabel')}
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
