import { promises as fs } from "fs";
import path from "path";
import { parseFrontmatter } from "../utils/frontmatter.js";
import type { WikiGraph } from "../types.js";

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

/**
 * Scans all articles in wiki/concepts/, extracts [[wikilinks]] from article bodies,
 * and builds an adjacency list of concept relationships.
 * Writes the result to wiki/graph.json next to the concepts/ directory.
 */
export async function buildGraph(articlesDir: string): Promise<void> {
  const files = await fs.readdir(articlesDir);
  const mdFiles = files.filter((f) => f.endsWith(".md"));

  const nodes: WikiGraph["nodes"] = [];
  const edges: WikiGraph["edges"] = [];

  for (const file of mdFiles) {
    const filePath = path.join(articlesDir, file);
    const raw = await fs.readFile(filePath, "utf-8");
    const { data, content: body } = parseFrontmatter(raw);

    const title =
      (data.title as string | undefined) ?? file.replace(/\.md$/, "");
    const sources: string[] = Array.isArray(data.sources)
      ? (data.sources as string[])
      : [];
    const nodeId = slugify(title) || file.replace(/\.md$/, "");

    const outLinks = new Set<string>();
    const re = new RegExp(WIKILINK_RE.source, "g");
    let match: RegExpExecArray | null;

    while ((match = re.exec(body)) !== null) {
      const targetId = slugify(match[1]);
      if (targetId && targetId !== nodeId) {
        outLinks.add(targetId);
        edges.push({ from: nodeId, to: targetId });
      }
    }

    nodes.push({
      id: nodeId,
      title,
      sources: sources.length,
      links: outLinks.size,
    });
  }

  const graph: WikiGraph = { nodes, edges };
  const graphPath = path.join(path.dirname(articlesDir), "graph.json");
  await fs.writeFile(graphPath, JSON.stringify(graph, null, 2), "utf-8");
}
