export interface PromptPair {
  system: string;
  user: string;
}

/**
 * Prompt for extracting distinct concepts from a source document.
 * Returns a JSON array of concept objects.
 */
export function extractConceptsPrompt(schema: string, source: string, customPrompt?: string): PromptPair {
  return {
    system: `You are a knowledge compiler. You read source documents and extract distinct concepts, ideas, entities, and topics that deserve their own wiki article.

Here is the wiki schema that defines conventions:
${schema}

Rules:
- Extract concepts that are substantive enough for a standalone article.
- Each concept should be a noun or noun phrase.
- Include concepts even if they might already exist — duplicates will be merged later.
- For each concept, include direct quotes or key passages from the source.${customPrompt ? `\n\nAdditional instructions from the user:\n${customPrompt}` : ""}`,

    user: `Extract all distinct concepts from this source document.

Source:
${source}

Respond with a JSON array only. No markdown, no backticks, no preamble.

[
  {
    "name": "Concept Name",
    "summary": "2-3 sentence summary of this concept based on the source.",
    "related": ["Other Concept", "Another Concept"],
    "passages": ["Direct quote or key passage from the source relevant to this concept."]
  }
]`,
  };
}

/**
 * Prompt for writing or updating a wiki article for a given concept.
 * If existingArticle is provided, the LLM updates it with new information rather than replacing it.
 */
export function generateArticlePrompt(
  schema: string,
  conceptName: string,
  passages: string[],
  existingArticle: string | null,
  relatedConcepts: string[],
  customPrompt?: string
): PromptPair {
  const passagesText = passages
    .map((p, i) => `--- Passage ${i + 1} ---\n${p}`)
    .join("\n\n");

  const existingSection = existingArticle
    ? `Existing article to update:\n${existingArticle}`
    : "This is a new article. No existing content.";

  return {
    system: `You are a wiki author. You write clear, well-structured markdown articles for a personal knowledge wiki.

Here is the wiki schema that defines conventions:
${schema}

Rules:
- Write in a neutral, encyclopedic tone.
- Use [[Wikilinks]] to link to related concepts.
- If an existing article is provided, UPDATE it with new information rather than replacing it.
- Flag contradictions between old and new information with a > [!contradiction] callout.
- Keep articles between 200-500 words.
- Always include YAML frontmatter.${customPrompt ? `\n\nAdditional instructions from the user:\n${customPrompt}` : ""}`,

    user: `Write or update the wiki article for: "${conceptName}"

Source passages:
${passagesText}

${existingSection}

Known related concepts in this wiki: ${relatedConcepts.join(", ")}

Respond with the complete markdown file including frontmatter. No backticks wrapping the response.`,
  };
}

/**
 * Prompt for generating a clustered master index of all wiki articles.
 * Returns raw markdown — not JSON.
 */
export function buildIndexPrompt(
  schema: string,
  articles: Array<{
    filename: string;
    title: string;
    summary: string;
    sources: string[];
    related: string[];
  }>,
  timestamp: string,
  customPrompt?: string
): PromptPair {
  const uniqueSources = new Set(articles.flatMap((a) => a.sources));

  return {
    system: `You are a wiki indexer. You organise wiki articles into a structured index with topic clusters.

Here is the wiki schema:
${schema}${customPrompt ? `\n\nAdditional instructions from the user:\n${customPrompt}` : ""}`,

    user: `Generate a master index for this wiki. Group articles into logical topic clusters.

Articles:
${JSON.stringify(articles, null, 2)}

Output format — respond with raw markdown, no backticks:

# Index

> Auto-maintained by wikimind. Do not edit manually.

Last updated: ${timestamp}
Pages: ${articles.length} | Sources: ${uniqueSources.size}

## {Cluster Name}

| Page | Summary | Sources |
|------|---------|---------|
| [[Page Name]] | One-line summary | 3 |

## {Another Cluster}
...`,
  };
}

/**
 * Prompt for identifying which wiki articles are relevant to a user's query.
 * Returns a JSON array of article filenames ordered by relevance.
 */
export function findRelevantArticlesPrompt(
  query: string,
  index: string,
  graphSummary: string,
  customPrompt?: string
): PromptPair {
  return {
    system: `You are a wiki search assistant. Given a user's question and a wiki index, identify which articles are most relevant to answering the question.${customPrompt ? `\n\nAdditional instructions from the user:\n${customPrompt}` : ""}`,

    user: `Question: ${query}

Wiki index:
${index}

Concept graph summary:
${graphSummary}

Return a JSON array of filenames (just the filename, not the path) for the most relevant articles. Return at most 10. Order by relevance.
Filenames must be kebab-case with a .md extension, e.g. "sahil-david.md", not "Sahil David.md".

Respond with JSON only. No markdown, no backticks.
["concept-one.md", "concept-two.md"]`,
  };
}

/**
 * Prompt for synthesising an answer to a user's query from loaded wiki articles.
 * The LLM must cite sources using [[Wikilinks]] and acknowledge gaps.
 */
export function answerQueryPrompt(
  schema: string,
  query: string,
  articles: string,
  customPrompt?: string
): PromptPair {
  return {
    system: `You are a knowledge assistant answering questions using a personal wiki.

Here is the wiki schema:
${schema}

Rules:
- Answer using ONLY information from the provided wiki articles.
- Cite which articles you drew from using [[Article Name]] wikilinks.
- If the wiki doesn't contain enough information to fully answer, say so explicitly and suggest what sources the user should add to fill the gap.
- Be concise and direct. No filler.
- Structure your answer with clear paragraphs. Use headings only if the answer covers multiple distinct topics.${customPrompt ? `\n\nAdditional instructions from the user:\n${customPrompt}` : ""}`,

    user: `Question: ${query}

Wiki articles:
${articles}

Answer the question.`,
  };
}

/**
 * Prompt for auditing wiki quality: contradictions, gaps, weak articles,
 * missing connections, and suggested new articles.
 * Returns structured JSON.
 */
export function lintWikiPrompt(
  schema: string,
  index: string,
  articles: string,
  customPrompt?: string
): PromptPair {
  return {
    system: `You are a wiki quality auditor. You analyse a personal knowledge wiki and identify issues, gaps, and improvement opportunities.

Here is the wiki schema:
${schema}${customPrompt ? `\n\nAdditional instructions from the user:\n${customPrompt}` : ""}`,

    user: `Audit this wiki for quality issues.

Index:
${index}

Articles:
${articles}

Check for:
1. Contradictions — places where two articles make conflicting claims
2. Gaps — important concepts mentioned in articles but lacking their own page
3. Stale content — articles that reference outdated information or need updating
4. Weak articles — pages that are too thin or vague to be useful
5. Missing connections — articles that should link to each other but don't
6. Suggested new articles — topics that would strengthen the wiki

Respond in JSON only. No markdown, no backticks.

{
  "contradictions": [
    { "article1": "filename.md", "article2": "filename.md", "description": "What conflicts" }
  ],
  "gaps": [
    { "concept": "Missing Concept Name", "mentionedIn": ["filename.md", "filename.md"] }
  ],
  "weakArticles": [
    { "article": "filename.md", "reason": "Why it's weak" }
  ],
  "missingConnections": [
    { "from": "filename.md", "to": "filename.md", "reason": "Why they should link" }
  ],
  "suggestedArticles": [
    { "concept": "Suggested Topic", "reason": "Why it would strengthen the wiki" }
  ]
}`,
  };
}

/**
 * Prompt for grouping wiki concepts into topic clusters.
 * Returns a JSON object with a clusters array.
 */
export function clusterNodesPrompt(
  nodes: Array<{ id: string; title: string }>,
  edges: Array<{ from: string; to: string }>
): PromptPair {
  return {
    system: `You are a knowledge organiser. Given a list of wiki concepts and their connections, group them into 3-7 topic clusters.`,
    user: `Group these concepts into logical topic clusters. Each concept must belong to exactly one cluster.

Concepts:
${JSON.stringify(nodes, null, 2)}

Connections:
${JSON.stringify(edges, null, 2)}

Respond with JSON only. No markdown, no backticks.

{
  "clusters": [
    {
      "name": "Short Cluster Name",
      "color": "#hex color",
      "nodes": ["node-id-1", "node-id-2"]
    }
  ]
}

Use these colors in order for clusters: #534AB7, #1D9E75, #D85A30, #378ADD, #D4537E, #639922, #BA7517
Keep cluster names short (1-3 words).`,
  };
}