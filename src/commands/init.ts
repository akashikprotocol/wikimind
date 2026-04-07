import path from "path";
import { promises as fs } from "fs";
import chalk from "chalk";
import ora from "ora";
import { ensureDir, fileExists } from "../utils/fs.js";
import { writeConfig, writeState } from "../utils/config.js";
import type { WikiConfig, WikiState } from "../types.js";
import { WIKI_PATHS } from "../types.js";

const schemaContent = `# Wiki Schema

This file defines the structure, conventions, and workflows for this wiki.
The LLM reads this before every compile, query, and lint operation.

## Structure

- \`raw/\` — Source documents. Immutable. The LLM reads but never modifies these.
- \`wiki/concepts/\` — One markdown file per concept, entity, or topic. LLM-generated and LLM-maintained.
- \`wiki/index.md\` — Master index of all pages with one-line summaries. Updated on every compile.
- \`wiki/log.md\` — Chronological record of all operations (ingests, compiles, queries, lints).
- \`queries/\` — Saved query results that haven't been promoted to wiki pages.

## Page Conventions

- Every concept page has YAML frontmatter: title, sources, related, created, updated.
- Use [[Wikilinks]] to link between concept pages.
- Each page should be self-contained — readable without needing to follow links.
- Aim for 200-500 words per concept page. Split large topics into sub-pages.

## Compile Behaviour

- When a new source is ingested, don't just create new pages. Update existing pages where the new source adds information.
- A single source may touch 10-15 existing pages.
- Flag contradictions between sources rather than silently overwriting.
- Always update index.md and log.md after compile.

## Query Behaviour

- Read index.md first to find relevant pages.
- Cite which wiki pages were used in the answer using [[Wikilinks]].
- If the wiki lacks information to answer, say so and suggest what sources to add.
`;

/**
 * Handles the `wikimind init [name]` command.
 * Creates the `.wikimind/` config directory, default folder structure,
 * and writes initial config.json and state.json.
 */
export async function initCommand(name: string | undefined): Promise<void> {
  // Determine the target directory
  let targetDir: string;

  if (name) {
    targetDir = path.resolve(process.cwd(), name);
    await ensureDir(targetDir);
  } else {
    targetDir = process.cwd();
    name = path.basename(targetDir);
  }

  // Guard: check if already a wikimind project
  const wikimindDir = path.join(targetDir, path.dirname(WIKI_PATHS.config));
  if (await fileExists(wikimindDir)) {
    console.error(chalk.red("Error: This directory is already a wikimind project."));
    process.exit(1);
  }

  const spinner = ora("Initialising wiki...").start();

  const now = new Date().toISOString();

  try {
    // Create directory structure
    await ensureDir(wikimindDir);
    await ensureDir(path.join(targetDir, WIKI_PATHS.raw));
    await ensureDir(path.join(targetDir, WIKI_PATHS.concepts));
    await ensureDir(path.join(targetDir, WIKI_PATHS.queries));

    // Write default config.json
    const config: WikiConfig = {
      name,
      model: "claude-sonnet-4-20250514",
      maxTokensPerChunk: 80000,
      outputFormat: "obsidian",
      autoBacklink: true,
      created: now,
    };
    await writeConfig(targetDir, config);

    // Write empty state.json
    const state: WikiState = {
      ingested: {},
      compiled: {},
      lastCompile: null,
    };
    await writeState(targetDir, state);

    // Write placeholder .gitkeep files
    await fs.writeFile(path.join(targetDir, WIKI_PATHS.raw, ".gitkeep"), "", "utf-8");
    await fs.writeFile(path.join(targetDir, WIKI_PATHS.queries, ".gitkeep"), "", "utf-8");

    // Write wiki/schema.md
    await fs.writeFile(
      path.join(targetDir, WIKI_PATHS.schema),
      schemaContent,
      "utf-8"
    );

    // Write wiki/index.md
    await fs.writeFile(
      path.join(targetDir, WIKI_PATHS.index),
      `# Index\n\n> Auto-maintained by wikimind. Do not edit manually.\n\nLast updated: ${now}\nPages: 0 | Sources: 0\n\n<!-- Entries will be added here by wikimind compile -->\n`,
      "utf-8"
    );

    // Write wiki/log.md
    await fs.writeFile(
      path.join(targetDir, WIKI_PATHS.log),
      `# Log\n\n> Chronological record of all wikimind operations.\n\n## [${now}] init | Wiki initialised\n\nWiki "${name}" created.\n`,
      "utf-8"
    );

    spinner.succeed(chalk.green(`✓ Wiki "${name}" initialised.`));
  } catch (err) {
    spinner.fail(chalk.red("Failed to initialise wiki."));
    throw err;
  }

  console.log(`
${chalk.bold("Created:")}
  ${chalk.cyan(".wikimind/config.json")}    — project settings
  ${chalk.cyan("wiki/schema.md")}           — wiki structure and conventions
  ${chalk.cyan("wiki/index.md")}            — master index (auto-maintained)
  ${chalk.cyan("wiki/log.md")}              — operation log

${chalk.bold("Next steps:")}
  1. Drop your source files into ${chalk.cyan("raw/")}
  2. Run: ${chalk.cyan("wikimind ingest")}
`);
}
