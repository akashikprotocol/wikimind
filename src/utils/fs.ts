import { promises as fs } from "fs";
import { access } from "fs/promises";

/**
 * Creates a directory and all parent directories if they don't exist.
 * Equivalent to `mkdir -p`.
 */
export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Returns true if the file or directory at the given path exists.
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Converts a string to a kebab-case slug suitable for use as a filename.
 * Lowercases, replaces spaces with hyphens, removes special characters,
 * collapses multiple hyphens, and trims hyphens from both ends.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}
