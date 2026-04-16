import { useTranslate } from '../hooks/useTranslate';

/**
 * Renders user-generated text translated to the current UI language.
 *
 * Usage:
 *   <TranslatableText text={job.description} as="p" className="job-desc" />
 *
 * - Shows the original text instantly (no layout shift).
 * - Swaps to the translated version once the API responds.
 * - When language is English, renders immediately with zero network calls.
 *
 * @param {string}  text       - Source text (expected English).
 * @param {string}  [as]       - HTML tag to render. Default: 'span'.
 * @param {string}  [className]
 * @param {object}  [style]
 * @param {boolean} [showLoader] - If true, shows a subtle opacity pulse while loading.
 */
export default function TranslatableText({
  text,
  as: Tag = 'span',
  className,
  style,
  showLoader = false,
}) {
  const [translated, loading] = useTranslate(text);

  return (
    <Tag
      className={className}
      style={{
        ...style,
        ...(showLoader && loading ? { opacity: 0.6, transition: 'opacity 0.2s' } : {}),
      }}
    >
      {translated}
    </Tag>
  );
}
