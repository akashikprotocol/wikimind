import path from "path";
import { promises as fs } from "fs";
import readline from "readline";
import chalk from "chalk";
import ora from "ora";
import { getWikiRoot, readConfig } from "../utils/config.js";
import { fileExists, slugify } from "../utils/fs.js";
import { createClient, completeJSON, complete } from "../llm/client.js";
import { findRelevantArticlesPrompt, answerQueryPrompt } from "../llm/prompts.js";
import { appendLog } from "../wiki/log.js";
import { WIKI_PATHS } from "../types.js";
import type { WikiGraph } from "../types.js";

interface QueryOptions {
  save: boolean;
  promote: boolean;
}

const MAX_ARTICLES_WITHOUT_SEARCH = 15;

function slugifyQuery(query: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const slug = query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim()
    .slice(0, 60);
  return `${date}-${slug}`;
}

/**
 * Highlights [[Wikilinks]] in a string with chalk cyan.
 */
function highlightWikilinks(text: string): string {
  return text.replace(/\[\[([^\]]+)\]\]/g, (_, name: string) =>
    chalk.cyan(`[[${name}]]`)
  );
}

/**
 * Builds a plain-text summary of the concept graph for the relevance prompt.
 */
function summariseGraph(graph: WikiGraph): string {
  if (!graph.nodes.length) return "No concept graph available.";
  return graph.nodes
    .map((n) => `${n.title} (${n.links} links, ${n.sources} sources)`)
    .join(", ");
}

/**
 * Loads and returns a list of article filenames from wiki/concepts/.
 */
async function listArticles(articlesDir: string): Promise<string[]> {
  const files = await fs.readdir(articlesDir);
  return files.filter((f) => f.endsWith(".md"));
}

/**
 * Executes a single query: finds relevant articles, loads them, answers, and
 * optionally saves or promotes the result.
 */
async function runQuery(
  root: string,
  query: string,
  options: QueryOptions,
  config: { model: string },
  schema: string
): Promise<void> {
  const articlesDir = path.join(root, WIKI_PATHS.concepts);
  const allArticles = await listArticles(articlesDir);

  const spinner = ora("Finding relevant articles...").start();

  // ── Step 2: Find relevant articles ────────────────────────────────────────

  let relevantFilenames: string[] = [];

  try {
    const indexContent = await fs.readFile(
      path.join(root, WIKI_PATHS.index),
      "utf-8"
    );

    let graphSummary = "No concept graph available.";
    const graphPath = path.join(root, "wiki", "graph.json");
    if (await fileExists(graphPath)) {
      const raw = await fs.readFile(graphPath, "utf-8");
      const graph = JSON.parse(raw) as WikiGraph;
      graphSummary = summariseGraph(graph);
    }

    const prompt = findRelevantArticlesPrompt(query, indexContent, graphSummary);
    const candidates = await completeJSON<string[]>(
      prompt.system,
      prompt.user,
      config.model
    );

    // Match each LLM filename against actual files using a 3-step fallback chain:
    // 1. Exact match   2. Slugified match   3. Stripped alphanumeric match
    const articleSet = new Set(allArticles);
    const slugToActual = new Map<string, string>();
    const strippedToActual = new Map<string, string>();
    for (const a of allArticles) {
      slugToActual.set(slugify(a.replace(/\.md$/, "")) + ".md", a);
      strippedToActual.set(a.replace(/[^a-z0-9]/g, ""), a);
    }

    const valid: string[] = [];
    for (const f of candidates) {
      const basename = path.basename(f);

      // 1. Exact
      if (articleSet.has(basename)) {
        valid.push(basename);
        continue;
      }

      // 2. Slugified
      const slugged = slugify(basename.replace(/\.md$/, "")) + ".md";
      const bySlug = slugToActual.get(slugged);
      if (bySlug) {
        valid.push(bySlug);
        continue;
      }

      // 3. Stripped alphanumeric
      const stripped = basename.toLowerCase().replace(/[^a-z0-9]/g, "");
      const byStripped = strippedToActual.get(stripped);
      if (byStripped) {
        valid.push(byStripped);
        continue;
      }

      spinner.warn(chalk.yellow(`Skipping unknown article: ${f}`));
    }
    relevantFilenames = valid;
  } catch {
    // Fall through to fallback below
  }

  // Fallback: use all articles when count is manageable
  if (relevantFilenames.length === 0) {
    if (allArticles.length <= MAX_ARTICLES_WITHOUT_SEARCH) {
      relevantFilenames = allArticles;
    } else {
      spinner.fail(
        chalk.yellow("No relevant articles found for this query.")
      );
      return;
    }
  }

  spinner.text = `Loading ${relevantFilenames.length} article(s)...`;

  // ── Step 3: Load articles and answer ──────────────────────────────────────

  const articleBlocks: string[] = [];
  for (const filename of relevantFilenames) {
    try {
      const content = await fs.readFile(
        path.join(articlesDir, filename),
        "utf-8"
      );
      articleBlocks.push(`--- ${filename} ---\n${content}`);
    } catch {
      spinner.warn(chalk.yellow(`Could not read article: ${filename}`));
    }
  }

  spinner.text = "Thinking...";

  const answerPrompt = answerQueryPrompt(
    schema,
    query,
    articleBlocks.join("\n\n")
  );
  const answer = await complete(
    answerPrompt.system,
    answerPrompt.user,
    config.model
  );

  spinner.stop();

  console.log("\n" + highlightWikilinks(answer) + "\n");

  // ── Step 4: Save / Promote ────────────────────────────────────────────────

  if (options.save || options.promote) {
    const slug = slugifyQuery(query);
    const filename = `${slug}.md`;
    const frontmatter = [
      "---",
      `query: "${query.replace(/"/g, '\\"')}"`,
      `date: ${new Date().toISOString().slice(0, 10)}`,
      `sources: [${relevantFilenames.map((f) => `"${f}"`).join(", ")}]`,
      "---",
      "",
    ].join("\n");

    const fileContent = frontmatter + answer + "\n";

    if (options.promote) {
      const dest = path.join(root, WIKI_PATHS.concepts, filename);
      await fs.writeFile(dest, fileContent, "utf-8");
      console.log(
        chalk.green(
          `✓ Answer promoted to wiki article: wiki/concepts/${filename}`
        )
      );
    } else {
      const dest = path.join(root, WIKI_PATHS.queries, filename);
      await fs.writeFile(dest, fileContent, "utf-8");
      console.log(
        chalk.green(`✓ Answer saved to queries/${filename}`)
      );
    }
  }

  // ── Log ───────────────────────────────────────────────────────────────────

  const logTitle = query.length > 60 ? query.slice(0, 60) + "..." : query;
  await appendLog(root, "query", logTitle);
}

/**
 * Handles the `wikimind query [query] [--save] [--promote]` command.
 *
 * If a query string is provided, runs it once.
 * If stdin is a TTY and no query is provided, enters interactive REPL mode.
 */
export async function queryCommand(
  queryArg: string | undefined,
  options: QueryOptions
): Promise<void> {
  // ── Step 1: Setup ─────────────────────────────────────────────────────────

  const root = await getWikiRoot();
  if (!root) {
    console.error(chalk.red("Not a wikimind project. Run: wikimind init"));
    process.exit(1);
  }

  const config = await readConfig(root);
  const schemaPath = path.join(root, WIKI_PATHS.schema);
  const schema = await fs.readFile(schemaPath, "utf-8");

  const articlesDir = path.join(root, WIKI_PATHS.concepts);
  const articles = await listArticles(articlesDir);
  if (articles.length === 0) {
    console.error(
      chalk.yellow(
        "No wiki articles found. Run wikimind compile first."
      )
    );
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      chalk.red("Set your Anthropic API key: export ANTHROPIC_API_KEY=sk-...")
    );
    process.exit(1);
  }

  createClient();

  // ── Single-shot mode ──────────────────────────────────────────────────────

  if (queryArg) {
    await runQuery(root, queryArg.trim(), options, config, schema);
    return;
  }

  // ── Non-interactive stdin: print usage ────────────────────────────────────

  if (!process.stdin.isTTY) {
    console.error(
      chalk.yellow(
        'Please provide a query. Usage: wikimind query "your question"'
      )
    );
    process.exit(1);
  }

  // ── Interactive REPL mode ─────────────────────────────────────────────────

  console.log(
    chalk.bold('\nwikimind query mode') +
      chalk.dim(' (type "exit" to quit)\n')
  );

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (): void => {
    rl.question(chalk.cyan("> "), async (input) => {
      const trimmed = input.trim();
      if (trimmed === "exit" || trimmed === "") {
        if (trimmed === "exit") rl.close();
        else ask();
        return;
      }
      try {
        await runQuery(root, trimmed, options, config, schema);
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
      }
      ask();
    });
  };

  rl.on("close", () => {
    console.log();
    process.exit(0);
  });

  ask();
}
