import { promises as fs } from "fs";
import path from "path";

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

/**
 * Splits a markdown file at its frontmatter boundary.
 * Returns { frontmatter, body } where frontmatter includes the closing --- line.
 */
function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  if (!content.startsWith("---")) {
    return { frontmatter: "", body: content };
  }
  const end = content.indexOf("\n---", 3);
  if (end === -1) {
    return { frontmatter: "", body: content };
  }
  return {
    frontmatter: content.slice(0, end + 4),
    body: content.slice(end + 4),
  };
}

/**
 * Inserts [[wikilinks]] for unlinked concept name mentions in a body of text.
 * - Protects existing [[...]] from being double-wrapped.
 * - Skips heading lines (lines starting with #).
 * - Case-insensitive matching; preserves original casing in the link text.
 * - Processes longer names first to avoid partial matches.
 * Returns the updated text and the number of links inserted.
 */
function insertBacklinksInBody(
  body: string,
  conceptNames: string[]
): { text: string; count: number } {
  // Protect existing [[wikilinks]] with placeholders so we never double-wrap them
  const placeholders: string[] = [];
  const protected_ = body.replace(/\[\[[^\]]+\]\]/g, (match) => {
    const idx = placeholders.length;
    placeholders.push(match);
    return `\x00WL${idx}\x00`;
  });

  // Build a single alternation regex, longer names first (so "Attention Mechanism"
  // is matched before "Attention" and won't be overlapped)
  // Skip concepts shorter than 4 characters (avoids matching "C", "CSS", "HTML" etc.)
  const filtered = conceptNames.filter((n) => n.length >= 4);
  const sorted = [...filtered].sort((a, b) => b.length - a.length);
  let count = 0;

  // Track which concepts have already been linked (first-mention-only)
  const linked = new Set<string>();

  const lines = protected_.split("\n");
  const processed = lines.map((line) => {
    // Skip heading lines
    if (/^#{1,6}\s/.test(line)) return line;

    const remaining = sorted.filter((n) => !linked.has(n.toLowerCase()));
    if (!remaining.length) return line;

    const pattern = remaining.map(escapeRegex).join("|");
    const regex = new RegExp(`\\b(${pattern})\\b`, "gi");
    return line.replace(regex, (match) => {
      const key = match.toLowerCase();
      if (linked.has(key)) return match; // already linked earlier
      linked.add(key);
      count++;
      return `[[${slugify(match)}|${match}]]`;
    });
  });

  // Restore original wikilinks
  let result = processed
    .join("\n")
    .replace(/\x00WL(\d+)\x00/g, (_, idx) => placeholders[parseInt(idx, 10)]);

  return { text: result, count };
}

/**
 * Scans all articles in wiki/concepts/, finds plain-text mentions of other concept
 * names that aren't already wikilinked, and wraps them in [[Wikilinks]].
 * Skips headings and frontmatter. Case-insensitive matching.
 * Returns the total number of backlinks inserted across all articles.
 */
export async function insertBacklinks(
  articlesDir: string,
  allConceptNames: string[]
): Promise<number> {
  const files = await fs.readdir(articlesDir);
  const mdFiles = files.filter((f) => f.endsWith(".md"));
  let totalInserted = 0;

  for (const file of mdFiles) {
    const filePath = path.join(articlesDir, file);
    const content = await fs.readFile(filePath, "utf-8");
    const { frontmatter, body } = splitFrontmatter(content);

    // Don't wikilink the article's own concept name inside itself
    const currentSlug = file.replace(/\.md$/, "");
    const otherNames = allConceptNames.filter((n) => slugify(n) !== currentSlug);

    const { text: newBody, count } = insertBacklinksInBody(body, otherNames);

    if (count > 0) {
      await fs.writeFile(filePath, frontmatter + newBody, "utf-8");
      totalInserted += count;
    }
  }

  return totalInserted;
}
