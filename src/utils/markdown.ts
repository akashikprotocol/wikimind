import matter from "gray-matter";

const HTML_TAG_RE = /(<([^>]+)>)/gi;
const EXCESS_NEWLINES_RE = /\n{3,}/g;

/**
 * Strips HTML tags, standardises heading levels (promotes to single H1 if missing),
 * and trims excess whitespace and newlines.
 */
export function normaliseMarkdown(content: string): string {
  // Strip HTML tags
  let result = content.replace(HTML_TAG_RE, "");

  // Fix common encoding artefacts
  result = result
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  // Standardise heading levels: if there is no H1 but there are H2s,
  // promote all headings up by one level so the top level becomes H1.
  const hasH1 = /^# /m.test(result);
  if (!hasH1 && /^## /m.test(result)) {
    result = result.replace(/^(#{1,5}) /gm, (_, hashes: string) =>
      "#".repeat(Math.max(1, hashes.length - 1)) + " "
    );
  }

  // Collapse three-or-more consecutive blank lines into two
  result = result.replace(EXCESS_NEWLINES_RE, "\n\n");

  return result.trim();
}

/**
 * Adds YAML frontmatter to a markdown document.
 * If frontmatter already exists, merges meta without overwriting any existing fields.
 * If it does not exist, prepends the frontmatter block.
 */
export function addFrontmatter(
  content: string,
  meta: { title: string; source: string; ingestedAt: string }
): string {
  const parsed = matter(content);
  // Merge: new meta fills gaps; existing fields are never overwritten
  const merged = { ...meta, ...parsed.data };
  return matter.stringify(parsed.content, merged);
}

/**
 * Extracts a title from the first H1 heading in the document.
 * Falls back to converting the filename to title case
 * (strips extension, converts kebab/snake case to spaced words).
 */
export function extractTitle(content: string, filename: string): string {
  const h1Match = content.match(/^# (.+)$/m);
  if (h1Match) {
    return h1Match[1].trim();
  }

  // Derive from filename: strip extension, replace separators, title-case
  const base = filename.replace(/\.[^.]+$/, "");
  return base
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
