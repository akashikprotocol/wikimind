# wikimind

An open-source CLI that compiles raw documents into a structured, interlinked wiki using LLMs. Drop files in. Get a knowledge base out.

Most knowledge lives scattered across bookmarks, PDFs, notes, and articles you saved but never revisited. LLMs are good at synthesising information. Your filesystem is good at storing it. Nothing connects the two.

`wikimind` bridges that gap. Point it at a folder of raw documents and it compiles them into a structured wiki — extracting concepts, generating interlinked articles, building indexes, and maintaining the whole thing as your sources grow. Ask it questions. Run health checks. Every interaction compounds the knowledge base.

Inspired by Andrej Karpathy's workflow for LLM-compiled knowledge bases. https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
Built with TypeScript, powered by Claude, and designed to output clean markdown that works natively in Obsidian.

## Commands (coming soon)

- `wikimind init` — Set up project structure
- `wikimind ingest` — Process raw documents
- `wikimind compile` — LLM compiles wiki from raw sources
- `wikimind query` — Ask questions against the wiki
- `wikimind lint` — Health check for inconsistencies and gaps

## Install

```bash
npm install -g wikimind
```

## Roadmap

### v0.1.0 — Placeholder (current)
- [x] Package scaffolding and npm publish

### v0.2.0 — Foundation
- [ ] `wikimind init` — initialise project config and folder structure
- [ ] `wikimind ingest` — copy/index raw source documents

### v0.3.0 — Compilation
- [ ] `wikimind compile` — LLM pass to extract concepts and generate wiki articles
- [ ] Auto-generated backlinks and `[[wikilinks]]`
- [ ] Index pages per topic/tag

### v0.4.0 — Query & Maintenance
- [ ] `wikimind query` — natural language Q&A against the compiled wiki
- [ ] `wikimind lint` — detect broken links, gaps, and inconsistencies

### v1.0.0 — Stable
- [ ] Full Obsidian vault compatibility
- [ ] Incremental compilation (only reprocess changed sources)
- [ ] Plugin/provider abstraction (support models beyond Claude)

## Status

Early development. Star the repo and watch for updates.

## License

Apache-2.0
