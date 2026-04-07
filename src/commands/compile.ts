import path from "path";
import { promises as fs } from "fs";
import chalk from "chalk";
import ora from "ora";
import { getWikiRoot, readConfig, readState, writeState } from "../utils/config.js";
import { fileExists } from "../utils/fs.js";
import { createClient, complete, completeJSON } from "../llm/client.js";
import { chunkDocument } from "../llm/chunker.js";
import { extractConceptsPrompt, generateArticlePrompt } from "../llm/prompts.js";
import { insertBacklinks } from "../wiki/backlinker.js";
import { buildGraph } from "../wiki/graph.js";
import { collectArticleMeta, generateIndex } from "../wiki/index-builder.js";
import { appendLog } from "../wiki/log.js";
import { WIKI_PATHS } from "../types.js";
import type { ExtractedConcept, WikiState } from "../types.js";

interface CompileOptions {
  full: boolean;
  dryRun: boolean;
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
 * Handles the `wikimind compile` command.
 *
 * Phase 1: Setup — read config/state/schema, resolve which sources need processing.
 * Phase 2: Extract — call LLM to extract concepts from each source, deduplicate.
 * Phase 3: Generate — write/update wiki/concepts/*.md articles.
 * Phase 4: Cross-link — insert backlinks, rebuild graph and index.
 * Phase 5: Finalise — persist updated state.json and append to log.
 *
 * --full     reprocesses all ingested sources regardless of change state.
 * --dry-run  runs phases 1-2 only and prints what would change without writing.
 */
export async function compileCommand(options: CompileOptions): Promise<void> {
  // ── Phase 1: Setup ─────────────────────────────────────────────────────────

  const root = await getWikiRoot();
  if (!root) {
    console.error(chalk.red("Not a wikimind project. Run: wikimind init"));
    process.exit(1);
  }

  const config = await readConfig(root);
  const state = await readState(root);
  const schemaPath = path.join(root, WIKI_PATHS.schema);
  const schema = await fs.readFile(schemaPath, "utf-8");

  // Resolve which sources to process before requiring the API key
  const ingestedEntries = Object.entries(state.ingested);
  const sourcesToProcess: Array<{ key: string; hash: string }> = options.full
    ? ingestedEntries.map(([key, val]) => ({ key, hash: val.hash }))
    : ingestedEntries
        .filter(
          ([, val]) =>
            !val.lastCompiledHash || val.lastCompiledHash !== val.hash
        )
        .map(([key, val]) => ({ key, hash: val.hash }));

  if (sourcesToProcess.length === 0) {
    console.log(chalk.green("Wiki is up to date. No new sources to compile."));
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      chalk.red("Set your Anthropic API key: export ANTHROPIC_API_KEY=sk-...")
    );
    process.exit(1);
  }

  createClient();

  console.log(chalk.bold(`Compiling ${sourcesToProcess.length} source(s)...`));

  // ── Phase 2: Extract Concepts ──────────────────────────────────────────────

  const allConcepts: ExtractedConcept[] = [];

  for (let i = 0; i < sourcesToProcess.length; i++) {
    const { key } = sourcesToProcess[i];
    const spinner = ora(
      `Extracting concepts from ${path.basename(key)}... (${i + 1}/${sourcesToProcess.length})`
    ).start();

    try {
      const sourceContent = await fs.readFile(path.join(root, key), "utf-8");
      const chunks = chunkDocument(sourceContent, config.maxTokensPerChunk);

      for (const chunk of chunks) {
        const prompt = extractConceptsPrompt(schema, chunk);
        const extracted = await completeJSON<
          Omit<ExtractedConcept, "sourceFile">[]
        >(prompt.system, prompt.user, config.model);

        if (!Array.isArray(extracted) || extracted.length === 0) {
          spinner.warn(
            chalk.yellow(`No concepts found in ${path.basename(key)}`)
          );
          continue;
        }

        for (const concept of extracted) {
          allConcepts.push({ ...concept, sourceFile: key });
        }
      }

      spinner.succeed(`Extracted concepts from ${path.basename(key)}`);
    } catch (err) {
      spinner.warn(
        chalk.yellow(
          `Skipping ${path.basename(key)}: ${(err as Error).message}`
        )
      );
    }
  }

  // Deduplicate concepts across all sources by normalised name
  const conceptMap = new Map<string, ExtractedConcept>();
  for (const concept of allConcepts) {
    const normKey = concept.name.toLowerCase();
    const existing = conceptMap.get(normKey);
    if (existing) {
      conceptMap.set(normKey, {
        name: existing.name,
        summary:
          concept.summary.length > existing.summary.length
            ? concept.summary
            : existing.summary,
        related: [...new Set([...existing.related, ...concept.related])],
        passages: [...existing.passages, ...concept.passages],
        sourceFile: existing.sourceFile,
      });
    } else {
      conceptMap.set(normKey, concept);
    }
  }

  const uniqueConcepts = Array.from(conceptMap.values());

  console.log(
    chalk.green(
      `Extracted ${uniqueConcepts.length} unique concept(s) from ${sourcesToProcess.length} source(s).`
    )
  );

  // ── Dry run — stop here ────────────────────────────────────────────────────

  if (options.dryRun) {
    const articlesDir = path.join(root, WIKI_PATHS.concepts);
    let wouldCreate = 0;
    let wouldUpdate = 0;

    for (const concept of uniqueConcepts) {
      const slug = slugify(concept.name);
      const articlePath = path.join(articlesDir, `${slug}.md`);
      if (await fileExists(articlePath)) {
        wouldUpdate++;
      } else {
        wouldCreate++;
      }
    }

    console.log(`
${chalk.bold("Dry run — no files written.")}

Would process: ${sourcesToProcess.length} source(s)
Would extract: ~${uniqueConcepts.length} concepts
Would create:  ~${wouldCreate} new articles
Would update:  ~${wouldUpdate} existing articles
`);
    return;
  }

  // ── Phase 3: Generate / Update Articles ────────────────────────────────────

  const articlesDir = path.join(root, WIKI_PATHS.concepts);
  await fs.mkdir(articlesDir, { recursive: true });

  const allConceptNames = uniqueConcepts.map((c) => c.name);
  let newCount = 0;
  let updatedCount = 0;

  for (let i = 0; i < uniqueConcepts.length; i++) {
    const concept = uniqueConcepts[i];
    const slug = slugify(concept.name);
    const articlePath = path.join(articlesDir, `${slug}.md`);
    const spinner = ora(
      `Writing ${concept.name}... (${i + 1}/${uniqueConcepts.length})`
    ).start();

    try {
      const exists = await fileExists(articlePath);
      const existingContent = exists
        ? await fs.readFile(articlePath, "utf-8")
        : null;

      const otherNames = allConceptNames.filter((n) => n !== concept.name);
      const prompt = generateArticlePrompt(
        schema,
        concept.name,
        concept.passages,
        existingContent,
        otherNames
      );

      const articleContent = await complete(
        prompt.system,
        prompt.user,
        config.model
      );
      await fs.writeFile(articlePath, articleContent, "utf-8");

      if (exists) {
        updatedCount++;
        spinner.succeed(`Updated ${concept.name}`);
      } else {
        newCount++;
        spinner.succeed(`Created ${concept.name}`);
      }
    } catch (err) {
      spinner.warn(
        chalk.yellow(
          `Failed to write ${concept.name}: ${(err as Error).message}`
        )
      );
    }
  }

  console.log(
    chalk.green(
      `Generated ${newCount} new article(s), updated ${updatedCount} existing article(s).`
    )
  );

  // ── Phase 4: Cross-link and Index ──────────────────────────────────────────

  let backlinksInserted = 0;

  const backlinkSpinner = ora("Inserting backlinks...").start();
  try {
    backlinksInserted = await insertBacklinks(articlesDir, allConceptNames);
    backlinkSpinner.succeed(`${backlinksInserted} backlink(s) inserted.`);
  } catch (err) {
    backlinkSpinner.warn(
      chalk.yellow(`Backlink pass failed: ${(err as Error).message}`)
    );
  }

  const graphSpinner = ora("Rebuilding graph...").start();
  try {
    await buildGraph(articlesDir);
    graphSpinner.succeed("Graph updated.");
  } catch (err) {
    graphSpinner.warn(
      chalk.yellow(`Graph build failed: ${(err as Error).message}`)
    );
  }

  const indexSpinner = ora("Rebuilding index...").start();
  try {
    const articles = await collectArticleMeta(articlesDir);
    await generateIndex(root, articles, schema, config.model);
    indexSpinner.succeed("Index updated.");
  } catch (err) {
    indexSpinner.warn(
      chalk.yellow(`Index build failed: ${(err as Error).message}`)
    );
  }

  // ── Phase 5: Finalise ──────────────────────────────────────────────────────

  const now = new Date().toISOString();

  const updatedState: WikiState = {
    ...state,
    ingested: { ...state.ingested },
    compiled: { ...state.compiled },
  };

  // Mark each processed source as compiled at its current hash
  for (const { key, hash } of sourcesToProcess) {
    if (updatedState.ingested[key]) {
      updatedState.ingested[key] = {
        ...updatedState.ingested[key],
        lastCompiledHash: hash,
      };
    }
  }

  // Record compiled articles
  for (const concept of uniqueConcepts) {
    const slug = slugify(concept.name);
    updatedState.compiled[slug] = {
      sources: sourcesToProcess.map((s) => s.key),
      compiledAt: now,
    };
  }

  updatedState.lastCompile = now;
  await writeState(root, updatedState);

  const logDetail = `Compiled ${sourcesToProcess.length} source(s) → ${uniqueConcepts.length} concept(s) (${newCount} new, ${updatedCount} updated)`;
  await appendLog(root, "compile", logDetail);

  console.log(`
${chalk.green("✓ Compile complete.")}

Sources processed:  ${sourcesToProcess.length}
Concepts extracted: ${uniqueConcepts.length}
Articles created:   ${newCount}
Articles updated:   ${updatedCount}
Backlinks inserted: ${backlinksInserted}

Open ${chalk.cyan("wiki/index.md")} to browse your wiki.
`);
}
