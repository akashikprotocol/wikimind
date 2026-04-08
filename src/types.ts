export const WIKI_PATHS = {
  config: ".wikimind/config.json",
  state: ".wikimind/state.json",
  schema: "wiki/schema.md",
  index: "wiki/index.md",
  log: "wiki/log.md",
  raw: "raw",
  concepts: "wiki/concepts",
  queries: "queries",
} as const;

export interface WikiConfig {
  name: string;
  model: string;
  maxTokensPerChunk: number;
  outputFormat: "obsidian" | "standard";
  autoBacklink: boolean;
  created: string;
  customPrompt?: string;
}

export interface WikiState {
  ingested: Record<string, {
    hash: string;
    ingestedAt: string;
    lastCompiledHash?: string;
  }>;
  compiled: Record<string, {
    sources: string[];
    compiledAt: string;
  }>;
  lastCompile: string | null;
}

export interface ExtractedConcept {
  name: string;
  summary: string;
  related: string[];
  passages: string[];
  sourceFile: string;
}

export interface ArticleMeta {
  filename: string;
  title: string;
  summary: string;
  sources: string[];
  related: string[];
  created: string;
  updated: string;
}

export interface WikiGraph {
  nodes: Array<{
    id: string;
    title: string;
    sources: number;
    links: number;
  }>;
  edges: Array<{
    from: string;
    to: string;
  }>;
}
