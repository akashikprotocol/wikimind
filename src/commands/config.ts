import chalk from "chalk";
import { getWikiRoot, readConfig, writeConfig } from "../utils/config.js";
import type { WikiConfig } from "../types.js";

// Keys users are allowed to view/edit (excludes read-only "name" and "created")
const EDITABLE_KEYS = [
  "model",
  "maxTokensPerChunk",
  "outputFormat",
  "autoBacklink",
] as const;

type EditableKey = (typeof EDITABLE_KEYS)[number];

const ALL_DISPLAY_KEYS: (keyof WikiConfig)[] = [
  "name",
  "model",
  "maxTokensPerChunk",
  "outputFormat",
  "autoBacklink",
];

function isEditableKey(key: string): key is EditableKey {
  return (EDITABLE_KEYS as readonly string[]).includes(key);
}

/**
 * Casts a raw string value to the appropriate type for the given config key.
 * Numbers stay numbers, "true"/"false" become booleans, everything else stays string.
 */
function castValue(key: EditableKey, raw: string): WikiConfig[EditableKey] {
  if (key === "maxTokensPerChunk") {
    const n = Number(raw);
    if (isNaN(n)) {
      throw new Error(`"${raw}" is not a valid number for ${key}.`);
    }
    return n;
  }
  if (key === "autoBacklink") {
    if (raw === "true") return true;
    if (raw === "false") return false;
    throw new Error(`"${raw}" is not valid for ${key}. Use true or false.`);
  }
  return raw as WikiConfig[EditableKey];
}

/**
 * Handles the `wikimind config [key] [value]` command.
 *
 * No args   — display all settings.
 * One arg   — display a single setting.
 * Two args  — update a setting and persist config.json.
 */
export async function configCommand(
  key: string | undefined,
  value: string | undefined
): Promise<void> {
  const root = await getWikiRoot();
  if (!root) {
    console.error(chalk.red("Not a wikimind project. Run: wikimind init"));
    process.exit(1);
  }

  const config = await readConfig(root);

  // ── No args: print all ───────────────────────────────────────────────────

  if (!key) {
    console.log(`\n${chalk.bold("wikimind config:")}\n`);
    for (const k of ALL_DISPLAY_KEYS) {
      const label = k.padEnd(20);
      console.log(`  ${chalk.cyan(label)} ${config[k]}`);
    }
    console.log();
    return;
  }

  // ── Key not recognised ───────────────────────────────────────────────────

  if (!isEditableKey(key) && !ALL_DISPLAY_KEYS.includes(key as keyof WikiConfig)) {
    console.error(
      chalk.red(
        `Unknown config key: "${key}". Valid keys: ${EDITABLE_KEYS.join(", ")}`
      )
    );
    process.exit(1);
  }

  // ── One arg: print single value ──────────────────────────────────────────

  if (value === undefined) {
    const k = key as keyof WikiConfig;
    if (!ALL_DISPLAY_KEYS.includes(k)) {
      console.error(
        chalk.red(
          `Unknown config key: "${key}". Valid keys: ${EDITABLE_KEYS.join(", ")}`
        )
      );
      process.exit(1);
    }
    console.log(config[k]);
    return;
  }

  // ── Two args: update value ───────────────────────────────────────────────

  if (!isEditableKey(key)) {
    console.error(chalk.red(`"${key}" is read-only.`));
    process.exit(1);
  }

  let cast: WikiConfig[EditableKey];
  try {
    cast = castValue(key, value);
  } catch (err) {
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }

  // Type-safe update via object spread
  const updated = { ...config, [key]: cast };
  await writeConfig(root, updated);

  console.log(chalk.green(`✓ Set ${key} → ${cast}`));
}
