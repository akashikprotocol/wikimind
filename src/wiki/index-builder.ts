import { promises as fs } from "fs";
import path from "path";
import { parseFrontmatter } from "../utils/frontmatter.js";
import { complete } from "../llm/client.js";
import { buildIndexPrompt } from "../llm/prompts.js";
import { WIKI_PATHS } from "../types.js";
import type { ArticleMeta } from "../types.js";

/**
 * Reads all .md files in wiki/concepts/, parses their YAML frontmatter,
 * and returns an array of ArticleMeta objects.
 */
export async function collectArticleMeta(
  articlesDir: string
): Promise<ArticleMeta[]> {
  const files = await fs.readdir(articlesDir);
  const mdFiles = files.filter((f) => f.endsWith(".md"));
  const articles: ArticleMeta[] = [];

  for (const file of mdFiles) {
    const filePath = path.join(articlesDir, file);
    const raw = await fs.readFile(filePath, "utf-8");
    const { data } = parseFrontmatter(raw);

    articles.push({
      filename: file,
      title: (data.title as string | undefined) ?? file.replace(/\.md$/, ""),
      summary: (data.summary as string | undefined) ?? "",
      sources: Array.isArray(data.sources) ? (data.sources as string[]) : [],
      related: Array.isArray(data.related) ? (data.related as string[]) : [],
      created: (data.created as string | undefined) ?? "",
      updated: (data.updated as string | undefined) ?? "",
    });
  }

  return articles;
}

/**
 * Calls the LLM to generate a clustered master index from article metadata,
 * then writes the result to wiki/index.md.
 */
export async function generateIndex(
  root: string,
  articles: ArticleMeta[],
  schema: string,
  model?: string
): Promise<void> {
  const timestamp = new Date().toISOString();
  const prompt = buildIndexPrompt(schema, articles, timestamp);
  const indexContent = await complete(prompt.system, prompt.user, model);
  const indexPath = path.join(root, WIKI_PATHS.index);
  await fs.writeFile(indexPath, indexContent, "utf-8");
}
