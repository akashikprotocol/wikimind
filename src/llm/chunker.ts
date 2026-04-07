const CHARS_PER_TOKEN = 4;
const OVERLAP_TOKENS = 200;

/**
 * Splits a document into overlapping chunks if it exceeds maxTokens.
 * Uses a rough estimate of 4 characters per token.
 * Always splits on paragraph boundaries (double newlines) — never mid-sentence.
 * Overlaps adjacent chunks by ~200 tokens to preserve context at boundaries.
 * Returns the document as a single-element array if it fits within maxTokens.
 */
export function chunkDocument(content: string, maxTokens: number): string[] {
  const maxChars = maxTokens * CHARS_PER_TOKEN;

  if (content.length <= maxChars) {
    return [content];
  }

  const overlapChars = OVERLAP_TOKENS * CHARS_PER_TOKEN;
  const paragraphs = content.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    const separator = current ? "\n\n" : "";
    const candidate = current + separator + para;

    if (candidate.length > maxChars && current) {
      chunks.push(current);
      // Start the next chunk with an overlap from the tail of the current chunk
      const overlap = current.slice(-overlapChars);
      current = overlap + "\n\n" + para;
    } else {
      current = candidate;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}
