/** Segment: plain string, bold, or mailto link */
export type TextSeg = string | { strong: string } | { mailto: string };

export type TermsBlock =
  | { type: 'h2'; text: string; sub?: boolean }
  | { type: 'h3'; text: string }
  | { type: 'p'; text?: string; uppercase?: boolean; segments?: TextSeg[] }
  | { type: 'ul'; items: TextSeg[][]; className?: string }
  | { type: 'ol'; items: TextSeg[][] }
  | {
      type: 'note';
      variant: 'yellow' | 'red';
      strong: string;
      segments?: TextSeg[];
      text?: string;
    }
  | { type: 'tier'; title: string; paragraphs: ({ text?: string; segments?: TextSeg[] } | string)[] }
  | { type: 'dmcaBox'; title: string; lines: string[]; email: string }
  | {
      type: 'feesNote';
      strong: string;
      text: string;
    }
  | {
      type: 'stripeLinkP';
      before: string;
      linkLabel: string;
      href: string;
      after: string;
    };
