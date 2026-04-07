import path from "path";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import { glob } from "glob";
import chalk from "chalk";
import ora from "ora";
import { getWikiRoot, readState, writeState } from "../utils/config.js";
import { fileExists } from "../utils/fs.js";
import { normaliseMarkdown, addFrontmatter, extractTitle } from "../utils/markdown.js";
import { WIKI_PATHS } from "../types.js";

const SUPPORTED_EXTENSIONS = new Set([".md", ".txt", ".json"]);

interface IngestOptions {
  file?: string;
}

interface IngestResult {
  path: string;
  status: "new" | "updated" | "unchanged" | "skipped";
}

/**
 * Computes the SHA-256 hash of a string, returned as a hex digest.
 */
function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

/**
 * Converts a JSON file's content into a normalised markdown representation.
 */
function jsonToMarkdown(raw: string, filename: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    const pretty = JSON.stringify(parsed, null, 2);
    return `# ${filename}\n\n\`\`\`json\n${pretty}\n\`\`\`\n`;
  } catch {
    // If JSON is malformed just wrap it verbatim
    return `# ${filename}\n\n\`\`\`json\n${raw}\n\`\`\`\n`;
  }
}

/**
 * Processes a single raw file: normalises its content, adds frontmatter,
 * writes it back in place, and returns its new hash.
 */
async function processFile(
  root: string,
  relPath: string
): Promise<string> {
  const absPath = path.join(root, relPath);
  const ext = path.extname(relPath).toLowerCase();
  const filename = path.basename(relPath);

  let content = await fs.readFile(absPath, "utf-8");

  if (ext === ".json") {
    content = jsonToMarkdown(content, filename);
  }
  // .txt and .md are treated as plain markdown

  content = normaliseMarkdown(content);

  const title = extractTitle(content, filename);
  content = addFrontmatter(content, {
    title,
    source: relPath,
    ingestedAt: new Date().toISOString(),
  });

  await fs.writeFile(absPath, content, "utf-8");
  return sha256(content);
}

/**
 * Handles the `wikimind ingest [--file <path>]` command.
 *
 * Scans raw/ for new or changed files, normalises them into clean markdown,
 * and records the results in .wikimind/state.json.
 */
export async function ingestCommand(options: IngestOptions): Promise<void> {
  const root = await getWikiRoot();
  if (!root) {
    console.error(
      chalk.red("Not a wikimind project. Run: wikimind init")
    );
    process.exit(1);
  }

  const state = await readState(root);
  const rawDir = path.join(root, WIKI_PATHS.raw);

  // ── Resolve the file list ─────────────────────────────────────────────────

  let filePaths: string[]; // relative to root

  if (options.file) {
    const target = path.resolve(options.file);
    if (!(await fileExists(target))) {
      console.error(chalk.red(`File not found: ${options.file}`));
      process.exit(1);
    }
    const ext = path.extname(options.file).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      console.error(
        chalk.red(
          `Unsupported file format. Supported: ${[...SUPPORTED_EXTENSIONS].join(", ")}`
        )
      );
      process.exit(1);
    }
    filePaths = [path.relative(root, target)];
  } else {
    const absMatches = await glob(`${rawDir}/**/*`, { nodir: true });
    if (absMatches.length === 0) {
      console.log(
        chalk.yellow(
          "No files found in raw/. Add your source documents there first."
        )
      );
      return;
    }
    filePaths = absMatches.map((f) => path.relative(root, f));
  }

  // ── Process files ──────────────────────────────────────────────────────────

  const spinner = ora("Ingesting files...").start();
  const results: IngestResult[] = [];

  for (const relPath of filePaths) {
    const ext = path.extname(relPath).toLowerCase();

    // Skip .gitkeep and unsupported types
    if (path.basename(relPath) === ".gitkeep") continue;

    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      spinner.warn(chalk.yellow(`Skipping unsupported file: ${relPath}`));
      results.push({ path: relPath, status: "skipped" });
      continue;
    }

    try {
      // Read raw content to compute pre-normalisation hash for change detection
      const rawContent = await fs.readFile(path.join(root, relPath), "utf-8");
      const rawHash = sha256(rawContent);

      const existing = state.ingested[relPath];

      if (existing && existing.hash === rawHash) {
        results.push({ path: relPath, status: "unchanged" });
        continue;
      }

      const isNew = !existing;
      const newHash = await processFile(root, relPath);

      state.ingested[relPath] = {
        hash: newHash,
        ingestedAt: new Date().toISOString(),
        // Preserve lastCompiledHash if it exists so compile knows what changed
        ...(existing?.lastCompiledHash
          ? { lastCompiledHash: existing.lastCompiledHash }
          : {}),
      };

      results.push({ path: relPath, status: isNew ? "new" : "updated" });
    } catch (err) {
      spinner.warn(
        chalk.yellow(`Failed to ingest ${relPath}: ${(err as Error).message}`)
      );
    }
  }

  spinner.stop();

  // ── Persist state ─────────────────────────────────────────────────────────

  await writeState(root, state);

  // ── Print summary ─────────────────────────────────────────────────────────

  const newFiles = results.filter((r) => r.status === "new");
  const updatedFiles = results.filter((r) => r.status === "updated");
  const unchangedCount = results.filter((r) => r.status === "unchanged").length;

  if (newFiles.length === 0 && updatedFiles.length === 0) {
    console.log(
      chalk.green("Everything up to date. No new files to ingest.")
    );
    return;
  }

  console.log(
    chalk.green(
      `✓ Ingested ${newFiles.length} new file(s), ${updatedFiles.length} updated, ${unchangedCount} unchanged.`
    )
  );

  if (newFiles.length > 0) {
    console.log(`\n${chalk.bold("New:")}`);
    for (const f of newFiles) {
      console.log(`  ${chalk.cyan("+")} ${f.path}`);
    }
  }

  if (updatedFiles.length > 0) {
    console.log(`\n${chalk.bold("Updated:")}`);
    for (const f of updatedFiles) {
      console.log(`  ${chalk.yellow("~")} ${f.path}`);
    }
  }

  console.log(`\nNext step: Run ${chalk.cyan("wikimind compile")}\n`);
}
