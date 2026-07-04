/**
 * Extract @mentioned users from HTML content.
 * Returns { ids, names } — UUIDs from data-mention-id (preferred),
 * full_names from data-mention or plain @Name as fallback.
 *
 * Shared by comment and task-description mention handling.
 */
export function parseMentions(html: string): {
  ids: string[];
  names: string[];
} {
  const ids = new Set<string>();
  const names = new Set<string>();
  let match: RegExpExecArray | null;

  // Prefer data-mention-id (UUID) when available
  const idRegex = /data-mention-id="([^"]+)"/g;
  while ((match = idRegex.exec(html)) !== null) {
    ids.add(match[1].trim());
  }

  // Collect data-mention names only for tags WITHOUT a data-mention-id
  const spanRegex = /<span[^>]*data-mention="([^"]+)"[^>]*>/g;
  while ((match = spanRegex.exec(html)) !== null) {
    const spanTag = match[0];
    if (!spanTag.includes('data-mention-id')) {
      names.add(match[1].trim());
    }
  }

  // Fallback: plain @Name patterns from text content (no rich text editor)
  const plainText = html.replaceAll(/<[^>]*>/g, ' ');
  const plainMentionRegex = /@([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)+)/g;
  while ((match = plainMentionRegex.exec(plainText)) !== null) {
    names.add(match[1].trim());
  }

  return { ids: [...ids], names: [...names] };
}
