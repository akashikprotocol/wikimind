import Anthropic from "@anthropic-ai/sdk";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const MAX_RETRIES = 3;

let _client: Anthropic | null = null;

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
 * Initialises the Anthropic client from ANTHROPIC_API_KEY.
 * Must be called once before any LLM requests.
 * Throws a clear error if the key is not set.
 */
export function createClient(): void {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Set your Anthropic API key: export ANTHROPIC_API_KEY=sk-..."
    );
  }
  _client = new Anthropic({ apiKey });
}

function getClient(): Anthropic {
  if (!_client) {
    throw new Error("LLM client not initialised. Call createClient() first.");
  }
  return _client;
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
