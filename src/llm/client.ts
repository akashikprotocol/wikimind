import Anthropic from "@anthropic-ai/sdk";
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const MAX_RETRIES = 3;

type AnyClient = Anthropic | AnthropicVertex;

let _client: AnyClient | null = null;

function isRetryableError(err: unknown): boolean {
  if (typeof err === "object" && err !== null && "status" in err) {
    const status = (err as { status: number }).status;
    return status === 429 || (status >= 500 && status < 600);
  }
  return false;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Initialises the Anthropic client.
 * If CLAUDE_CODE_USE_VERTEX=1, connects via Google Cloud Vertex AI using
 * CLOUD_ML_REGION and ANTHROPIC_VERTEX_PROJECT_ID.
 * Otherwise, connects directly using ANTHROPIC_API_KEY.
 */
export function createClient(): void {
  if (process.env.CLAUDE_CODE_USE_VERTEX === "1") {
    const region = process.env.CLOUD_ML_REGION;
    const projectId = process.env.ANTHROPIC_VERTEX_PROJECT_ID;
    if (!region) {
      throw new Error(
        "CLAUDE_CODE_USE_VERTEX=1 requires CLOUD_ML_REGION to be set."
      );
    }
    if (!projectId) {
      throw new Error(
        "CLAUDE_CODE_USE_VERTEX=1 requires ANTHROPIC_VERTEX_PROJECT_ID to be set."
      );
    }
    _client = new AnthropicVertex({ region, projectId });
  } else {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Set your Anthropic API key: export ANTHROPIC_API_KEY=sk-..."
      );
    }
    _client = new Anthropic({ apiKey });
  }
}

function getClient(): AnyClient {
  if (!_client) {
    throw new Error("LLM client not initialised. Call createClient() first.");
  }
  return _client;
}

/**
 * Returns true if LLM credentials are present in the environment.
 * Checks CLAUDE_CODE_USE_VERTEX (+ CLOUD_ML_REGION + ANTHROPIC_VERTEX_PROJECT_ID)
 * or ANTHROPIC_API_KEY for direct access.
 */
export function hasLLMCredentials(): boolean {
  if (process.env.CLAUDE_CODE_USE_VERTEX === "1") {
    return !!(process.env.CLOUD_ML_REGION && process.env.ANTHROPIC_VERTEX_PROJECT_ID);
  }
  return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * Sends a message to Claude and returns the text response.
 * Retries up to 3 times with exponential backoff on rate limits (429) and server errors (5xx).
 * Uses the provided model, or falls back to the default.
 */
export async function complete(
  systemPrompt: string,
  userPrompt: string,
  model?: string
): Promise<string> {
  const client = getClient();
  const resolvedModel = model ?? DEFAULT_MODEL;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const msg = await client.messages.create({
        model: resolvedModel,
        max_tokens: 8192,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });

      if (!msg.content.length || msg.content[0].type !== "text") {
        throw new Error("Unexpected non-text response from Anthropic API.");
      }

      return msg.content[0].text;
    } catch (err: unknown) {
      if (isRetryableError(err) && attempt < MAX_RETRIES - 1) {
        await sleep(Math.pow(2, attempt) * 1000);
        continue;
      }
      throw err;
    }
  }

  throw new Error("Max retries exceeded.");
}

/**
 * Like complete(), but parses the response as JSON.
 * Strips markdown code fences before parsing.
 * If JSON parsing still fails, retries once with an explicit JSON-only instruction.
 * Throws with the raw response if JSON parsing fails on the second attempt.
 */
export async function completeJSON<T>(
  systemPrompt: string,
  userPrompt: string,
  model?: string
): Promise<T> {
  const raw = await complete(systemPrompt, userPrompt, model);
  const stripped = stripCodeFences(raw);

  try {
    return JSON.parse(stripped) as T;
  } catch {
    const retryPrompt =
      userPrompt +
      "\n\nRespond with valid JSON only. No markdown, no backticks, no preamble.";
    const raw2 = await complete(systemPrompt, retryPrompt, model);
    const stripped2 = stripCodeFences(raw2);
    try {
      return JSON.parse(stripped2) as T;
    } catch {
      throw new Error(`LLM returned invalid JSON. Raw response:\n${raw2}`);
    }
  }
}

function stripCodeFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}
