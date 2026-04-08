#!/usr/bin/env node

import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { ingestCommand } from "./commands/ingest.js";
import { compileCommand } from "./commands/compile.js";
import { configCommand } from "./commands/config.js";
import { queryCommand } from "./commands/query.js";
import { lintCommand } from "./commands/lint.js";

const program = new Command();

program
  .name("wikimind")
  .description("Compile raw documents into a structured, interlinked wiki using LLMs.")
  .version("0.1.0");

// init
program
  .command("init [name]")
  .description("Initialise a new wikimind project in the current directory or a new subdirectory.")
  .action(async (name: string | undefined) => {
    await initCommand(name);
  });

// TODO: ingest   — copy/index raw source documents

// ingest
program
  .command("ingest")
  .description("Scan raw/ for new or changed files, normalise them, and update state.")
  .option("--file <path>", "Process a single specific file instead of scanning all of raw/.")
  .action(async (opts: { file?: string }) => {
    await ingestCommand({ file: opts.file });
  });

// compile
program
  .command("compile")
  .description("Extract concepts from ingested sources and generate interlinked wiki articles.")
  .option("--full", "Recompile all ingested sources from scratch.", false)
  .option("--dry-run", "Show what would change without writing any files.", false)
  .option("--prompt <text>", "Override the custom prompt for this run.")
  .action(async (opts: { full: boolean; dryRun: boolean; prompt?: string }) => {
    await compileCommand({ full: opts.full, dryRun: opts.dryRun, prompt: opts.prompt });
  });

// query
program
  .command("query [query]")
  .description("Ask a question against the compiled wiki.")
  .option("--save", "Save the answer to queries/.", false)
  .option("--promote", "Promote the answer to a wiki/concepts/ article.", false)
  .option("--prompt <text>", "Override the custom prompt for this run.")
  .action(async (query: string | undefined, opts: { save: boolean; promote: boolean; prompt?: string }) => {
    await queryCommand(query, { save: opts.save, promote: opts.promote, prompt: opts.prompt });
  });

// lint
program
  .command("lint")
  .description("Run health checks on the wiki.")
  .option("--structural", "Run structural checks only, no LLM calls.", false)
  .option("--fix", "Auto-fix broken links and missing connections.", false)
  .option("--prompt <text>", "Override the custom prompt for this run.")
  .action(async (opts: { structural: boolean; fix: boolean; prompt?: string }) => {
    await lintCommand({ structural: opts.structural, fix: opts.fix, prompt: opts.prompt });
  });

// config
program
  .command("config [key] [value]")
  .description("View or update project settings.")
  .action(async (key: string | undefined, value: string | undefined) => {
    await configCommand(key, value);
  });

program.parse(process.argv);
