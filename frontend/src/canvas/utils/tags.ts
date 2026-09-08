// Extract inline hashtags from a text, used for display in outline
// Matches words like #tag, #中文, #tag-1
export function extractTagsFromText(text: string): string[] {
  if (!text) return [];
  // match hash-tags: start of string or whitespace then #word
  const regex = /(^|\s)#([\p{L}\p{N}_-]+)/gu;
  const tags = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const t = m[2];
    if (t) tags.add(t);
  }
  return Array.from(tags);
}

export function sortTagsDefault(tags: string[]): string[] {
  // default: alphabetical, case-insensitive, locale-aware
  return [...tags].sort((a,b) => a.localeCompare(b));
}

