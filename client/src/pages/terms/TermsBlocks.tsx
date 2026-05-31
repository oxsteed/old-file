import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TermsBlock, TextSeg } from './termsTypes';

function renderSegments(segments: TextSeg[]): ReactNode[] {
  return segments.map((seg, i) => {
    if (typeof seg === 'string') return <span key={i}>{seg}</span>;
    if ('mailto' in seg) {
      return (
        <a
          key={i}
          href={`mailto:${seg.mailto}`}
          className="text-orange-500 underline"
        >
          {seg.mailto}
        </a>
      );
    }
    if ('routeLink' in seg) {
      return (
        <Link
          key={i}
          to={seg.routeLink.to}
          className="text-orange-500 underline"
        >
          {seg.routeLink.label}
        </Link>
      );
    }
    return <strong key={i}>{seg.strong}</strong>;
  });
}

function renderParagraph(block: Extract<TermsBlock, { type: 'p' }>) {
  const cls = block.uppercase ? 'mb-3 uppercase' : 'mb-3';
  if (block.segments?.length) {
    return <p className={cls}>{renderSegments(block.segments)}</p>;
  }
  return <p className={cls}>{block.text}</p>;
}

function renderUlItems(items: TextSeg[][]) {
  return items.map((row, j) => (
    <li key={j}>{renderSegments(row)}</li>
  ));
}

export function TermsBlocks({
  blocks,
  emailLabel,
}: {
  blocks: TermsBlock[];
  emailLabel?: string;
}) {
  const { t } = useTranslation();
  const resolvedEmailLabel = emailLabel ?? t('termsPage.emailLabel', 'Email:');
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'h2':
            return (
              <h2
                key={i}
                className={
                  b.sub
                    ? 'mb-3'
                    : 'text-lg font-bold text-orange-400 mb-3'
                }
              >
                {b.text}
              </h2>
            );
          case 'h3':
            return (
              <h3
                key={i}
                className="text-md font-semibold text-orange-300 mb-2"
              >
                {b.text}
              </h3>
            );
          case 'p':
            return <span key={i}>{renderParagraph(b)}</span>;
          case 'ul':
            return (
              <ul
                key={i}
                className={b.className ?? 'list-disc ml-5 space-y-2 mb-3'}
              >
                {renderUlItems(b.items)}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i} className="list-decimal ml-5 space-y-2 mb-3">
                {renderUlItems(b.items)}
              </ol>
            );
          case 'note': {
            const wrap =
              b.variant === 'red'
                ? 'text-xs bg-red-900/30 border border-red-700/50 rounded-lg p-3 text-red-400'
                : 'text-xs bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-3 text-yellow-400';
            const body = b.segments?.length ? (
              <>
                {' '}
                {renderSegments(b.segments)}
              </>
            ) : (
              <> {b.text}</>
            );
            return (
              <p key={i} className={wrap}>
                <strong>{b.strong}</strong>
                {body}
              </p>
            );
          }
          case 'tier':
            return (
              <div
                key={i}
                className="border border-gray-700 rounded-xl p-4"
              >
                <h3 className="font-bold text-white mb-1">{b.title}</h3>
                {b.paragraphs.map((para, j) => {
                  if (typeof para === 'string') {
                    return <p key={j}>{para}</p>;
                  }
                  const body = para.segments?.length ? (
                    <>{renderSegments(para.segments)}</>
                  ) : (
                    para.text
                  );
                  return <p key={j}>{body}</p>;
                })}
              </div>
            );
          case 'dmcaBox':
            return (
              <div
                key={i}
                className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 mb-3"
              >
                <p className="mb-1">
                  <strong className="text-white">{b.title}</strong>
                </p>
                {b.lines.map((line, j) => (
                  <p key={j}>{line}</p>
                ))}
                <p>
                  {resolvedEmailLabel}{' '}
                  <a
                    href={`mailto:${b.email}`}
                    className="text-orange-500 underline"
                  >
                    {b.email}
                  </a>
                </p>
              </div>
            );
          case 'feesNote':
            return (
              <p
                key={i}
                className="text-xs bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-3 text-yellow-400 mb-3"
              >
                <strong>{b.strong}</strong> {b.text}
              </p>
            );
          case 'stripeLinkP':
            return (
              <p key={i} className="mb-3">
                {b.before}
                <a
                  href={b.href}
                  className="text-orange-500 underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {b.linkLabel}
                </a>
                {b.after}
              </p>
            );
          default:
            return null;
        }
      })}
    </>
  );
}
