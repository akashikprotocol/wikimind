import path from "path";
import { promises as fs } from "fs";
import { createHash } from "crypto";
import chalk from "chalk";
import ora from "ora";
import { getWikiRoot, readConfig, readState } from "../utils/config.js";
import { fileExists, slugify } from "../utils/fs.js";
import { parseFrontmatter } from "../utils/frontmatter.js";
import { createClient, completeJSON } from "../llm/client.js";
import { lintWikiPrompt } from "../llm/prompts.js";
import { appendLog } from "../wiki/log.js";
import { buildGraph } from "../wiki/graph.js";
import { stringify as stringifyYaml } from "yaml";
import { WIKI_PATHS } from "../types.js";

interface LintOptions {
  structural: boolean;
  fix: boolean;
  prompt?: string;
}

// ── Shared types ──────────────────────────────────────────────────────────────

interface BrokenLink {
  file: string;
  link: string;
  fixable: boolean;
  fixedTarget?: string;
}

interface LintReport {
  brokenLinks: BrokenLink[];
  orphanedArticles: string[];
  staleSources: string[];
  emptyArticles: string[];
  missingFrontmatter: string[];
}

interface LlmReport {
  contradictions: Array<{ article1: string; article2: string; description: string }>;
  gaps: Array<{ concept: string; mentionedIn: string[] }>;
  weakArticles: Array<{ article: string; reason: string }>;
  missingConnections: Array<{ from: string; to: string; reason: string }>;
  suggestedArticles: Array<{ concept: string; reason: string }>;
}

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;
const CHARS_PER_TOKEN = 4;
const SUMMARY_WORD_LIMIT = 200;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the first SUMMARY_WORD_LIMIT words of a string.
 */
function firstWords(text: string, limit: number): string {
  return text.split(/\s+/).slice(0, limit).join(" ");
}

/**
 * Extracts all [[wikilink]] targets from a markdown body string.
 * Handles piped links: [[Target|Display text]] → "Target"
 */
function extractWikilinks(body: string): string[] {
  const links: string[] = [];
  const re = new RegExp(WIKILINK_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const raw = m[1];
    // Take only the part before the pipe (if any)
    const target = raw.includes("|") ? raw.split("|")[0].trim() : raw;
    links.push(target);
  }
  return links;
}

/**
 * Inserts a [[wikilink]] for a target concept name in an article body,
 * if it is mentioned as plain text but not already linked.
 * Uses pipe syntax [[slug|Display]] for Obsidian compatibility.
 * Matches whole words, first mention only, skips headings.
 * Returns the updated body and the number of insertions made.
 */
function insertLink(body: string, targetName: string, targetSlug: string): { text: string; inserted: number } {
  const escaped = targetName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Protect existing wikilinks
  const placeholders: string[] = [];
  let protected_ = body.replace(/\[\[[^\]]+\]\]/g, (m) => {
    const i = placeholders.length;
    placeholders.push(m);
    return `\x00WL${i}\x00`;
  });

  const re = new RegExp(`\\b(${escaped})\\b`, "gi");
  let inserted = 0;
  // Process line-by-line to skip headings, first mention only
  const lines = protected_.split("\n");
  const processed = lines.map((line) => {
    if (inserted > 0) return line;
    if (/^#{1,6}\s/.test(line)) return line;
    return line.replace(re, (match) => {
      if (inserted > 0) return match;
      inserted++;
      return `[[${targetSlug}|${match}]]`;
    });
  });

  const result = processed.join("\n").replace(/\x00WL(\d+)\x00/g, (_, i) => placeholders[parseInt(i, 10)]);
  return { text: result, inserted };
}

// ── Phase 1: Structural checks ────────────────────────────────────────────────

/**
 * Scans all articles in wiki/concepts/ for structural issues:
 * broken wikilinks, orphaned articles, stale sources, empty articles,
 * and missing frontmatter fields.
 */
async function runStructuralChecks(
  root: string,
  articlesDir: string,
  articleFiles: string[]
): Promise<LintReport> {
  const state = await readState(root);
  const articleSet = new Set(articleFiles);

  // Build slug → filename mapping for fixable broken-link detection
  const slugToFile = new Map<string, string>();
  for (const f of articleFiles) {
    slugToFile.set(slugify(f.replace(/\.md$/, "")), f);
  }

  // Build incoming-link counts to find orphaned articles
  const incomingLinks = new Map<string, number>();
  for (const f of articleFiles) {
    incomingLinks.set(f, 0);
  }

  const brokenLinks: BrokenLink[] = [];
  const emptyArticles: string[] = [];
  const missingFrontmatter: string[] = [];

  for (const file of articleFiles) {
    const raw = await fs.readFile(path.join(articlesDir, file), "utf-8");
    const { data, content: body } = parseFrontmatter(raw);

    // Check required frontmatter fields
    if (!data.title || !data.sources || !data.related) {
      missingFrontmatter.push(file);
    }

    // Check empty body (excluding frontmatter)
    if (body.trim().length < 50) {
      emptyArticles.push(file);
    }

    // Scan for wikilinks
    const links = extractWikilinks(body);
    for (const link of links) {
      const targetSlug = slugify(link) + ".md";
      const exactExists = articleSet.has(targetSlug) || articleSet.has(link + ".md");

      if (exactExists) {
        const resolved = articleSet.has(targetSlug) ? targetSlug : link + ".md";
        incomingLinks.set(resolved, (incomingLinks.get(resolved) ?? 0) + 1);
      } else {
        // Try slug match for fixability
        const slugMatch = slugToFile.get(slugify(link));
        brokenLinks.push({
          file,
          link,
          fixable: !!slugMatch,
          fixedTarget: slugMatch,
        });
        if (slugMatch) {
          incomingLinks.set(slugMatch, (incomingLinks.get(slugMatch) ?? 0) + 1);
        }
      }
    }
  }

  const orphanedArticles = [...incomingLinks.entries()]
    .filter(([, count]) => count === 0)
    .map(([file]) => file);

  // Stale sources: raw files whose hash differs from lastCompiledHash
  const staleSources: string[] = [];
  for (const [relPath, entry] of Object.entries(state.ingested)) {
    const absPath = path.join(root, relPath);
    if (!(await fileExists(absPath))) continue;

    if (entry.lastCompiledHash) {
      const content = await fs.readFile(absPath, "utf-8");
      const currentHash = createHash("sha256").update(content, "utf-8").digest("hex");
      if (currentHash !== entry.lastCompiledHash) {
        staleSources.push(relPath);
      }
    }
  }

  return { brokenLinks, orphanedArticles, staleSources, emptyArticles, missingFrontmatter };
}

// ── Phase 2: LLM analysis ─────────────────────────────────────────────────────

/**
 * Loads article content for the LLM. If total chars exceed the token budget,
 * uses a summary (frontmatter + first 200 words) instead of the full article.
 */
async function loadArticlesForLlm(
  articlesDir: string,
  articleFiles: string[],
  maxTokens: number
): Promise<string> {
  const budget = maxTokens * CHARS_PER_TOKEN;
  const fullBlocks: string[] = [];
  let totalChars = 0;

  for (const file of articleFiles) {
    const content = await fs.readFile(path.join(articlesDir, file), "utf-8");
    const block = `--- ${file} ---\n${content}`;
    totalChars += block.length;
    fullBlocks.push(block);
  }

  if (totalChars <= budget) {
    return fullBlocks.join("\n\n");
  }

  // Truncate to summaries
  const summaryBlocks: string[] = [];
  for (let i = 0; i < articleFiles.length; i++) {
    const { data, content: body } = parseFrontmatter(
      await fs.readFile(path.join(articlesDir, articleFiles[i]), "utf-8")
    );
    const summary = firstWords(body, SUMMARY_WORD_LIMIT);
    const fm = Object.entries(data)
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join("\n");
    summaryBlocks.push(`--- ${articleFiles[i]} ---\n---\n${fm}\n---\n${summary}...`);
  }
  return summaryBlocks.join("\n\n");
}

// ── Phase 3: Auto-fix ──────────────────────────────────────────────────────────

interface AutoFixResult {
  fixedLinks: number;
  unfixableLinks: number;
  insertedConnections: number;
  fixedFrontmatter: number;
}

/**
 * Auto-fixes broken links, missing connections, missing frontmatter,
 * and ensures all articles have aliases and pipe-syntax wikilinks.
 */
async function autoFix(
  articlesDir: string,
  articleFiles: string[],
  brokenLinks: BrokenLink[],
  missingFrontmatter: string[],
  missingConnections: LlmReport["missingConnections"]
): Promise<AutoFixResult> {
  let fixedLinks = 0;
  let unfixableLinks = 0;
  let insertedConnections = 0;
  let fixedFrontmatter = 0;

  const articleSet = new Set(articleFiles.map(f => f.replace(/\.md$/, "")));

  // 1. Fix broken links using pipe syntax
  const fixableByFile = new Map<string, BrokenLink[]>();
  for (const bl of brokenLinks) {
    if (!bl.fixable || !bl.fixedTarget) {
      unfixableLinks++;
      continue;
    }
    const arr = fixableByFile.get(bl.file) ?? [];
    arr.push(bl);
    fixableByFile.set(bl.file, arr);
  }

  for (const [file, fixes] of fixableByFile) {
    const filePath = path.join(articlesDir, file);
    let content = await fs.readFile(filePath, "utf-8");
    for (const fix of fixes) {
      const targetSlug = fix.fixedTarget!.replace(/\.md$/, "");
      const escaped = fix.link.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Fix piped links: [[Wrong Target|display]] → [[correct-slug|display]]
      const rePiped = new RegExp(`\\[\\[${escaped}\\|([^\\]]+)\\]\\]`, "g");
      const pipedCount = (content.match(rePiped) ?? []).length;
      content = content.replace(rePiped, `[[${targetSlug}|$1]]`);
      fixedLinks += pipedCount;
      // Fix plain links: [[Wrong Name]] → [[correct-slug|Wrong Name]]
      const rePlain = new RegExp(`\\[\\[${escaped}\\]\\]`, "g");
      const plainCount = (content.match(rePlain) ?? []).length;
      content = content.replace(rePlain, `[[${targetSlug}|${fix.link}]]`);
      fixedLinks += plainCount;
    }
    await fs.writeFile(filePath, content, "utf-8");
  }

  // 2. Fix missing connections using pipe syntax
  for (const mc of missingConnections) {
    const fromPath = path.join(articlesDir, mc.from);
    const toSlug = mc.to.replace(/\.md$/, "");
    const toTitle = toSlug.replace(/-/g, " ");
    if (!(await fileExists(fromPath))) continue;

    const raw = await fs.readFile(fromPath, "utf-8");
    const { frontmatter, body } = splitFm(raw);
    const { text: newBody, inserted } = insertLink(body, toTitle, toSlug);
    if (inserted > 0) {
      await fs.writeFile(fromPath, frontmatter + newBody, "utf-8");
      insertedConnections += inserted;
    }
  }

  // 3. Fix missing frontmatter
  for (const file of missingFrontmatter) {
    const filePath = path.join(articlesDir, file);
    const raw = await fs.readFile(filePath, "utf-8");
    const { data, content: body } = parseFrontmatter(raw);

    const h1Match = raw.match(/^# (.+)$/m);
    const title = (data.title as string) ||
      (h1Match ? h1Match[1].trim() :
       file.replace(/\.md$/, "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()));

    const now = new Date().toISOString();
    const newData: Record<string, unknown> = {
      title,
      aliases: [title],
      sources: [],
      related: [],
      created: now,
      updated: now,
      ...data,
    };
    // Ensure aliases includes title
    if (!Array.isArray(newData.aliases)) newData.aliases = [title];
    else if (!(newData.aliases as string[]).includes(title)) (newData.aliases as string[]).push(title);

    const yamlStr = stringifyYaml(newData).trimEnd();
    const bodyContent = body.replace(/^\n+/, "");
    await fs.writeFile(filePath, `---\n${yamlStr}\n---\n\n${bodyContent}`, "utf-8");
    fixedFrontmatter++;
  }

  // 4. Ensure aliases and convert wikilinks to pipe syntax in all articles
  for (const file of articleFiles) {
    const filePath = path.join(articlesDir, file);
    let content = await fs.readFile(filePath, "utf-8");
    let modified = false;

    // Add aliases to frontmatter if missing
    const { data, content: body } = parseFrontmatter(content);
    if (data.title) {
      const title = data.title as string;
      const aliases = Array.isArray(data.aliases) ? [...data.aliases] as string[] : [];
      if (!aliases.includes(title)) {
        aliases.push(title);
        data.aliases = aliases;
        const yamlStr = stringifyYaml(data).trimEnd();
        content = `---\n${yamlStr}\n---${body}`;
        modified = true;
      }
    }

    // Convert unresolved [[Link Text]] to [[slug|Link Text]] pipe syntax
    content = content.replace(/\[\[([^\]|]+)\]\]/g, (match, linkText: string) => {
      const trimmed = linkText.trim();
      const slug = slugify(trimmed);
      if (articleSet.has(trimmed)) return match; // already resolves by filename
      if (slug === trimmed) return match; // already a slug
      if (articleSet.has(slug)) {
        modified = true;
        return `[[${slug}|${trimmed}]]`;
      }
      return match;
    });

    if (modified) {
      await fs.writeFile(filePath, content, "utf-8");
    }
  }

  return { fixedLinks, unfixableLinks, insertedConnections, fixedFrontmatter };
}

function splitFm(content: string): { frontmatter: string; body: string } {
  if (!content.startsWith("---")) return { frontmatter: "", body: content };
  const end = content.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: "", body: content };
  return { frontmatter: content.slice(0, end + 4), body: content.slice(end + 4) };
}

// ── Print helpers ──────────────────────────────────────────────────────────────

function printStructural(report: LintReport): void {
  console.log(`\n${chalk.bold("Structural checks:")}\n`);

  if (report.brokenLinks.length) {
    console.log(`  ${chalk.red(`Broken links (${report.brokenLinks.length}):`)} `);
    for (const bl of report.brokenLinks) {
      const fix = bl.fixable ? chalk.dim(` (fixable → ${bl.fixedTarget})`) : "";
      console.log(`    ${chalk.red("✗")} [[${bl.link}]] in ${bl.file}${fix}`);
    }
  } else {
    console.log(`  ${chalk.green("✓")} No broken links`);
  }

  if (report.orphanedArticles.length) {
    console.log(`\n  ${chalk.yellow(`Orphaned articles (${report.orphanedArticles.length}):`)} `);
    for (const f of report.orphanedArticles) {
      console.log(`    ${chalk.yellow("⚠")} ${f} — no incoming links`);
    }
  } else {
    console.log(`  ${chalk.green("✓")} No orphaned articles`);
  }

  if (report.staleSources.length) {
    console.log(`\n  ${chalk.yellow(`Stale sources (${report.staleSources.length}):`)} `);
    for (const s of report.staleSources) {
      console.log(`    ${chalk.yellow("⚠")} ${s} — modified since last compile`);
    }
  } else {
    console.log(`  ${chalk.green("✓")} No stale sources`);
  }

  const emptyLabel = report.emptyArticles.length
    ? chalk.yellow(`Empty articles (${report.emptyArticles.length}):`)
    : chalk.green("✓ Empty articles: 0");
  console.log(`\n  ${emptyLabel}`);
  for (const f of report.emptyArticles) {
    console.log(`    ${chalk.yellow("⚠")} ${f}`);
  }

  const fmLabel = report.missingFrontmatter.length
    ? chalk.yellow(`Missing frontmatter (${report.missingFrontmatter.length}):`)
    : chalk.green("✓ Missing frontmatter: 0");
  console.log(`  ${fmLabel}`);
  for (const f of report.missingFrontmatter) {
    console.log(`    ${chalk.yellow("⚠")} ${f}`);
  }
}

function printLlm(llm: LlmReport): void {
  console.log(`\n${chalk.bold("LLM analysis:")}\n`);

  if (llm.contradictions.length) {
    console.log(`  ${chalk.red(`Contradictions (${llm.contradictions.length}):`)} `);
    for (const c of llm.contradictions) {
      console.log(`    ${chalk.red("✗")} ${c.article1} vs ${c.article2}`);
      console.log(`      ${chalk.dim(`"${c.description}"`)}`);
    }
  } else {
    console.log(`  ${chalk.green("✓")} No contradictions found`);
  }

  if (llm.gaps.length) {
    console.log(`\n  ${chalk.yellow(`Gaps (${llm.gaps.length}):`)} `);
    for (const g of llm.gaps) {
      console.log(
        `    ${chalk.yellow("⚠")} "${g.concept}" — mentioned in ${g.mentionedIn.length} article(s) but has no page`
      );
    }
  } else {
    console.log(`  ${chalk.green("✓")} No concept gaps`);
  }

  if (llm.weakArticles.length) {
    console.log(`\n  ${chalk.yellow(`Weak articles (${llm.weakArticles.length}):`)} `);
    for (const w of llm.weakArticles) {
      console.log(`    ${chalk.yellow("⚠")} ${w.article} — ${chalk.dim(`"${w.reason}"`)}`);
    }
  } else {
    console.log(`  ${chalk.green("✓")} No weak articles`);
  }

  if (llm.missingConnections.length) {
    console.log(`\n  ${chalk.cyan(`Missing connections (${llm.missingConnections.length}):`)} `);
    for (const mc of llm.missingConnections) {
      console.log(`    ${chalk.cyan("→")} ${mc.from} should link to ${mc.to}`);
    }
  } else {
    console.log(`  ${chalk.green("✓")} No missing connections`);
  }

  if (llm.suggestedArticles.length) {
    console.log(`\n  ${chalk.blue(`Suggested new articles (${llm.suggestedArticles.length}):`)} `);
    for (const s of llm.suggestedArticles) {
      console.log(`    ${chalk.blue("+")} "${s.concept}" — ${chalk.dim(s.reason)}`);
    }
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Handles the `wikimind lint [--structural] [--fix]` command.
 *
 * Phase 1: Structural checks (broken links, orphans, stale sources, etc.) — no LLM.
 * Phase 2: LLM quality analysis (contradictions, gaps, weak articles, connections).
 * Phase 3: Auto-fix safe issues if --fix flag is set.
 */
export async function lintCommand(options: LintOptions): Promise<void> {
  const root = await getWikiRoot();
  if (!root) {
    console.error(chalk.red("Not a wikimind project. Run: wikimind init"));
    process.exit(1);
  }

  const config = await readConfig(root);
  const articlesDir = path.join(root, WIKI_PATHS.concepts);
  const customPrompt = options.prompt || config.customPrompt || undefined;

  let articleFiles: string[];
  try {
    const all = await fs.readdir(articlesDir);
    articleFiles = all.filter((f) => f.endsWith(".md"));
  } catch {
    articleFiles = [];
  }

  if (articleFiles.length === 0) {
    console.error(chalk.yellow("No wiki articles found. Run wikimind compile first."));
    process.exit(1);
  }

  // ── Phase 1 ───────────────────────────────────────────────────────────────

  const structSpinner = ora("Running structural checks...").start();
  const structural = await runStructuralChecks(root, articlesDir, articleFiles);
  structSpinner.stop();
  printStructural(structural);

  if (options.structural) {
    // Summarise and exit without LLM
    printSummary(articleFiles.length, structural, null, null);
    await logResult(root, articleFiles.length, structural, null);
    return;
  }

  // ── Phase 2 ───────────────────────────────────────────────────────────────

  let llm: LlmReport | null = null;

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log(
      chalk.yellow(
        "\nSkipping LLM analysis — no API key set. Run with --structural or set ANTHROPIC_API_KEY."
      )
    );
  } else {
    createClient();

    const llmSpinner = ora("Running LLM analysis...").start();
    try {
      const schema = await fs.readFile(path.join(root, WIKI_PATHS.schema), "utf-8");
      const index = await fs.readFile(path.join(root, WIKI_PATHS.index), "utf-8");
      const articlesText = await loadArticlesForLlm(
        articlesDir,
        articleFiles,
        config.maxTokensPerChunk
      );

      const prompt = lintWikiPrompt(schema, index, articlesText, customPrompt);
      llm = await completeJSON<LlmReport>(prompt.system, prompt.user, config.model);
      llmSpinner.stop();
      printLlm(llm);
    } catch (err) {
      llmSpinner.fail(chalk.yellow(`LLM analysis failed: ${(err as Error).message}`));
    }
  }

  // ── Phase 3: Auto-fix ─────────────────────────────────────────────────────

  let fixResult: AutoFixResult | null = null;

  if (options.fix) {
    const fixSpinner = ora("Applying auto-fixes...").start();
    try {
      fixResult = await autoFix(
        articlesDir,
        articleFiles,
        structural.brokenLinks,
        structural.missingFrontmatter,
        llm?.missingConnections ?? []
      );
      fixSpinner.succeed(chalk.green("Auto-fixes applied."));
    } catch (err) {
      fixSpinner.warn(chalk.yellow(`Auto-fix failed: ${(err as Error).message}`));
    }

    // Rebuild graph after fixes
    const graphSpinner = ora("Rebuilding graph...").start();
    try {
      await buildGraph(articlesDir);
      graphSpinner.succeed("Graph updated.");
    } catch (err) {
      graphSpinner.warn(chalk.yellow(`Graph rebuild failed: ${(err as Error).message}`));
    }
  }

  // ── Summary + log ─────────────────────────────────────────────────────────

  printSummary(articleFiles.length, structural, llm, fixResult);
  await logResult(root, articleFiles.length, structural, llm);
}

function printSummary(
  articleCount: number,
  structural: LintReport,
  llm: LlmReport | null,
  fixResult: AutoFixResult | null
): void {
  const orphans = structural.orphanedArticles.length;
  const stale = structural.staleSources.length;
  const contradictions = llm?.contradictions.length ?? 0;
  const weak = llm?.weakArticles.length ?? 0;
  const missing = llm?.missingConnections.length ?? 0;

  if (fixResult) {
    // Print fix summary
    console.log(`\n${chalk.bold.green("✓ Fixed:")}\n`);
    if (fixResult.fixedLinks > 0)
      console.log(`  - ${fixResult.fixedLinks} broken links repaired`);
    if (fixResult.insertedConnections > 0)
      console.log(`  - ${fixResult.insertedConnections} missing connections inserted`);
    if (fixResult.fixedFrontmatter > 0)
      console.log(`  - ${fixResult.fixedFrontmatter} missing frontmatter added`);

    const couldNotFix: string[] = [];
    if (fixResult.unfixableLinks > 0)
      couldNotFix.push(`  - ${fixResult.unfixableLinks} broken links (no matching article found)`);
    if (orphans > 0)
      couldNotFix.push(`  - ${orphans} orphaned articles (need manual review)`);
    if (contradictions > 0)
      couldNotFix.push(`  - ${contradictions} contradictions (need manual review)`);
    if (weak > 0)
      couldNotFix.push(`  - ${weak} weak articles (run wikimind compile --full to regenerate)`);

    if (couldNotFix.length > 0) {
      console.log(`\n${chalk.bold.yellow("Could not fix:")}\n`);
      for (const line of couldNotFix) console.log(line);
    }
  } else {
    // Standard summary (no fix applied)
    const totalBrokenLinks = structural.brokenLinks.length;
    console.log(`\n${chalk.bold("Wiki health report:")}\n`);
    console.log(`  ${chalk.green("✓")} ${articleCount} article(s)`);

    if (totalBrokenLinks > 0) {
      console.log(`  ${chalk.red("✗")} ${totalBrokenLinks} broken link(s)`);
    } else {
      console.log(`  ${chalk.green("✓")} No broken links`);
    }

    if (orphans > 0) console.log(`  ${chalk.yellow("⚠")} ${orphans} orphaned article(s)`);
    if (stale > 0) console.log(`  ${chalk.yellow("⚠")} ${stale} stale source(s)`);
    if (contradictions > 0) console.log(`  ${chalk.red("✗")} ${contradictions} contradiction(s)`);
    if (missing > 0) console.log(`  ${chalk.cyan("→")} ${missing} missing connection(s)`);
    if (weak > 0) console.log(`  ${chalk.yellow("⚠")} ${weak} weak article(s)`);

    console.log();

    const fixableLinks = structural.brokenLinks.filter((b) => b.fixable).length;
    if (fixableLinks > 0 || missing > 0 || structural.missingFrontmatter.length > 0) {
      console.log(
        chalk.dim("Run wikimind lint --fix to auto-repair broken links, missing connections, and frontmatter.")
      );
    }
    if (stale > 0) {
      console.log(chalk.dim("Run wikimind compile to reprocess stale sources."));
    }
  }
  console.log();
}

async function logResult(
  root: string,
  articleCount: number,
  structural: LintReport,
  llm: LlmReport | null
): Promise<void> {
  const parts = [
    `${articleCount} articles checked`,
    `${structural.brokenLinks.length} broken links`,
  ];
  if (llm) {
    parts.push(`${llm.contradictions.length} contradiction(s)`);
    parts.push(`${llm.gaps.length} gap(s)`);
  }
  await appendLog(root, "lint", parts.join(" — "));
}
