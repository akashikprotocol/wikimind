import path from "path";
import { promises as fs } from "fs";
import chalk from "chalk";
import ora from "ora";
import { getWikiRoot, readConfig } from "../utils/config.js";
import { buildGraph, clusterGraph } from "../wiki/graph.js";
import { appendLog } from "../wiki/log.js";
import { WIKI_PATHS } from "../types.js";
import type { WikiGraph } from "../types.js";

interface GraphOptions {
  cluster: boolean;
}

/**
 * Handles the `wikimind graph [--cluster]` command.
 *
 * Rebuilds wiki/graph.json from existing articles.
 * If --cluster is set, calls the LLM to assign topic clusters.
 * Otherwise preserves existing cluster data or defaults to "Uncategorised".
 */
export async function graphCommand(options: GraphOptions): Promise<void> {
  const root = await getWikiRoot();
  if (!root) {
    console.error(chalk.red("Not a wikimind project. Run: wikimind init"));
    process.exit(1);
  }

  const config = await readConfig(root);
  const articlesDir = path.join(root, WIKI_PATHS.concepts);

  let articleFiles: string[];
  try {
    const all = await fs.readdir(articlesDir);
    articleFiles = all.filter((f) => f.endsWith(".md"));
  } catch {
    articleFiles = [];
  }

  if (articleFiles.length === 0) {
    console.error(
      chalk.yellow("No wiki articles found. Run wikimind compile first.")
    );
    process.exit(1);
  }

  // ── Rebuild graph ─────────────────────────────────────────────────────────

  const spinner = ora("Rebuilding graph...").start();
  let graph = await buildGraph(articlesDir);

  if (options.cluster) {
    // LLM clustering requested
    if (!process.env.ANTHROPIC_API_KEY) {
      spinner.warn(
        chalk.yellow(
          "No API key set — skipping LLM clustering. Set ANTHROPIC_API_KEY to enable."
        )
      );
      graph = applyFallbackClusters(graph);
      const graphPath = path.join(root, "wiki", "graph.json");
      await fs.writeFile(graphPath, JSON.stringify(graph, null, 2), "utf-8");
    } else {
      spinner.text = "Assigning clusters via LLM...";
      graph = await clusterGraph(articlesDir, graph, config.model);
    }
  } else {
    // Preserve existing clusters if present, otherwise default to Uncategorised
    const graphPath = path.join(root, "wiki", "graph.json");
    let existingClusters: WikiGraph["clusters"] | undefined;
    try {
      const existing = JSON.parse(
        await fs.readFile(graphPath, "utf-8")
      ) as WikiGraph;
      if (existing.clusters && existing.clusters.length > 0) {
        existingClusters = existing.clusters;
        // Re-apply existing cluster assignments to freshly built nodes
        const nodeClusterMap = new Map<string, string>();
        for (const node of existing.nodes) {
          if (node.cluster) nodeClusterMap.set(node.id, node.cluster);
        }
        graph.clusters = existingClusters;
        for (const node of graph.nodes) {
          node.cluster = nodeClusterMap.get(node.id) ?? "uncategorised";
        }
        // Ensure uncategorised cluster exists if needed
        const hasUncat = graph.nodes.some((n) => n.cluster === "uncategorised");
        if (
          hasUncat &&
          !graph.clusters.some((c) => c.id === "uncategorised")
        ) {
          graph.clusters.push({
            id: "uncategorised",
            name: "Uncategorised",
            color: "#888780",
          });
        }
      } else {
        graph = applyFallbackClusters(graph);
      }
    } catch {
      graph = applyFallbackClusters(graph);
    }
    await fs.writeFile(graphPath, JSON.stringify(graph, null, 2), "utf-8");
  }

  const clusterCount = graph.clusters?.length ?? 0;
  spinner.succeed(chalk.green("Graph updated."));

  console.log(`
  Nodes:    ${graph.nodes.length}
  Edges:    ${graph.edges.length}
  Clusters: ${clusterCount}
`);

  await appendLog(
    root,
    "graph",
    `Rebuilt graph (${graph.nodes.length} nodes, ${graph.edges.length} edges, ${clusterCount} clusters)`
  );
}

function applyFallbackClusters(graph: WikiGraph): WikiGraph {
  graph.clusters = [
    { id: "uncategorised", name: "Uncategorised", color: "#888780" },
  ];
  for (const node of graph.nodes) {
    node.cluster = "uncategorised";
  }
  return graph;
}
