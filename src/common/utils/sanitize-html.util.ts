import sanitizeHtml, { IOptions, simpleTransform } from 'sanitize-html';

const SANITIZE_OPTIONS: IOptions = {
  allowedTags: [
    'p',
    'br',
    'b',
    'i',
    'em',
    'strong',
    'a',
    'ul',
    'ol',
    'li',
    'blockquote',
    'code',
    'pre',
    'h1',
    'h2',
    'h3',
    'span',
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    span: ['class', 'data-mention-id', 'data-mention'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  // Force safe link attributes
  transformTags: {
    a: simpleTransform('a', {
      target: '_blank',
      rel: 'noopener noreferrer',
    }),
  },
};

export function sanitize(dirty: string): string {
  return sanitizeHtml(dirty, SANITIZE_OPTIONS);
}
