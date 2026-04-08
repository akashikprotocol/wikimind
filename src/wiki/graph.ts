import { promises as fs } from "fs";
import path from "path";
import { parseFrontmatter } from "../utils/frontmatter.js";
import { completeJSON, createClient } from "../llm/client.js";
import { clusterNodesPrompt } from "../llm/prompts.js";
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
 * Returns the graph object.
 */
export async function buildGraph(articlesDir: string): Promise<WikiGraph> {
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
      const raw = match[1];
      const target = raw.includes("|") ? raw.split("|")[0].trim() : raw;
      const targetId = slugify(target);
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
  return graph;
}

/**
 * Assigns each node in the graph to a topic cluster using the LLM.
 * Updates graph.json in-place with cluster data.
 * Falls back to a single "Uncategorised" cluster on error.
 */
export async function clusterGraph(
  articlesDir: string,
  graph: WikiGraph,
  model?: string
): Promise<WikiGraph> {
  const graphPath = path.join(path.dirname(articlesDir), "graph.json");

  try {
    createClient();
    const prompt = clusterNodesPrompt(
      graph.nodes.map((n) => ({ id: n.id, title: n.title })),
      graph.edges
    );
    const result = await completeJSON<{
      clusters: Array<{ name: string; color: string; nodes: string[] }>;
    }>(prompt.system, prompt.user, model);

    const clusters: WikiGraph["clusters"] = [];
    const nodeClusterMap = new Map<string, string>();

    for (const c of result.clusters) {
      const clusterId = slugify(c.name);
      clusters.push({ id: clusterId, name: c.name, color: c.color });
      for (const nodeId of c.nodes) {
        nodeClusterMap.set(nodeId, clusterId);
      }
    }

    graph.clusters = clusters;
    for (const node of graph.nodes) {
      node.cluster = nodeClusterMap.get(node.id) ?? "uncategorised";
    }

    // Ensure any unassigned nodes get the fallback cluster
    const unassigned = graph.nodes.filter((n) => n.cluster === "uncategorised");
    if (unassigned.length > 0 && !clusters.some((c) => c.id === "uncategorised")) {
      clusters.push({ id: "uncategorised", name: "Uncategorised", color: "#888780" });
    }
  } catch {
    graph.clusters = [{ id: "uncategorised", name: "Uncategorised", color: "#888780" }];
    for (const node of graph.nodes) {
      node.cluster = "uncategorised";
    }
  }

  await fs.writeFile(graphPath, JSON.stringify(graph, null, 2), "utf-8");
  return graph;
}
