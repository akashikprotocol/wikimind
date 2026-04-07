#!/usr/bin/env node

const ROADMAP = `
wikimind — Roadmap

  v0.1.0  Placeholder (current)
  ✔  Package scaffolding and npm publish

  v0.2.0  Foundation
  ○  wikimind init    — initialise project config and folder structure
  ○  wikimind ingest  — copy/index raw source documents

  v0.3.0  Compilation
  ○  wikimind compile — LLM pass to extract concepts and generate wiki articles
  ○  Auto-generated backlinks and [[wikilinks]]
  ○  Index pages per topic/tag

  v0.4.0  Query & Maintenance
  ○  wikimind query   — natural language Q&A against the compiled wiki
  ○  wikimind lint    — detect broken links, gaps, and inconsistencies

  v1.0.0  Stable
  ○  Full Obsidian vault compatibility
  ○  Incremental compilation (only reprocess changed sources)
  ○  Plugin/provider abstraction (support models beyond Claude)

  https://github.com/akashikprotocol/llmwiki
`;

const command = process.argv[2];

if (command === "roadmap") {
  console.log(ROADMAP);
} else {
  console.log("wikimind v0.1.0 — coming soon. https://github.com/akashikprotocol/llmwiki");
  console.log("  Commands: roadmap");
}

