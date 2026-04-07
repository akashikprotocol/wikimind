import { promises as fs } from "fs";
import path from "path";
import type { WikiConfig, WikiState } from "../types.js";
import { fileExists } from "./fs.js";

const WIKIMIND_DIR = ".wikimind";
const CONFIG_FILE = "config.json";
const STATE_FILE = "state.json";

/**
 * Walks up the directory tree from cwd looking for a `.wikimind` directory.
 * Returns the absolute path to the directory containing `.wikimind`, or null if not found.
 */
export async function getWikiRoot(): Promise<string | null> {
  let current = process.cwd();

  while (true) {
    const candidate = path.join(current, WIKIMIND_DIR);
    if (await fileExists(candidate)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      // Reached filesystem root without finding .wikimind
      return null;
    }
    current = parent;
  }
}

/**
 * Reads and parses `.wikimind/config.json` from the given wiki root directory.
 */
export async function readConfig(root: string): Promise<WikiConfig> {
  const configPath = path.join(root, WIKIMIND_DIR, CONFIG_FILE);
  const raw = await fs.readFile(configPath, "utf-8");
  return JSON.parse(raw) as WikiConfig;
}

/**
 * Writes the given config object to `.wikimind/config.json` in the given wiki root directory.
 */
export async function writeConfig(root: string, config: WikiConfig): Promise<void> {
  const configPath = path.join(root, WIKIMIND_DIR, CONFIG_FILE);
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Reads and parses `.wikimind/state.json` from the given wiki root directory.
 */
export async function readState(root: string): Promise<WikiState> {
  const statePath = path.join(root, WIKIMIND_DIR, STATE_FILE);
  const raw = await fs.readFile(statePath, "utf-8");
  return JSON.parse(raw) as WikiState;
}

/**
 * Writes the given state object to `.wikimind/state.json` in the given wiki root directory.
 */
export async function writeState(root: string, state: WikiState): Promise<void> {
  const statePath = path.join(root, WIKIMIND_DIR, STATE_FILE);
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");
}
