import { promises as fs } from "fs";
import path from "path";
import { WIKI_PATHS } from "../types.js";

/**
 * Appends a new operation entry to wiki/log.md.
 * Format: ## [<ISO timestamp>] <type> | <title>
 */
export async function appendLog(
  root: string,
  type: "init" | "ingest" | "compile" | "query" | "lint",
  title: string,
  detail?: string
): Promise<void> {
  const logPath = path.join(root, WIKI_PATHS.log);
  const timestamp = new Date().toISOString();

  const lines = [`\n## [${timestamp}] ${type} | ${title}`];
  if (detail) {
    lines.push("", detail);
  }
  lines.push("");

  await fs.appendFile(logPath, lines.join("\n"), "utf-8");
}
