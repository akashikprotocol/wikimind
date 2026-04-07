import { parse as parseYaml } from "yaml";

export interface FrontmatterResult {
  data: Record<string, unknown>;
  content: string;
}

/**
 * Parses YAML frontmatter from a markdown string.
 * Returns the parsed data object and the document body (everything after the closing ---).
 * If no valid frontmatter is found, returns an empty data object and the full content as body.
 */
export function parseFrontmatter(raw: string): FrontmatterResult {
  if (!raw.startsWith("---")) {
    return { data: {}, content: raw };
  }

  const end = raw.indexOf("\n---", 3);
  if (end === -1) {
    return { data: {}, content: raw };
  }

  const yamlBlock = raw.slice(3, end).trim();
  const content = raw.slice(end + 4);

  try {
    const data = (parseYaml(yamlBlock) as Record<string, unknown>) ?? {};
    return { data, content };
  } catch {
    return { data: {}, content: raw };
  }
}
